// Auth and quote use cases; rules and messages mirror backend/go-service/internal/{auth,quote}.
// Check order for every action: 403 role, 404 visibility, 400 input, 409 state.
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { jwtVerify, SignJWT } from 'jose'
import {
  conflict,
  CUSTOMER_EVENTS,
  CUSTOMER_STATUSES,
  invalid,
  notFound,
  NotFoundError,
  Problems,
  RESPONDABLE_STATUSES,
  roleForbidden,
  unauthorized,
  type Actor,
  type EventAction,
  type Quote,
  type QuoteItem,
  type QuoteStatus,
} from './domain.js'
import { goQuote, parseUuid } from './gojson.js'
import { calculate, Money, type PricingResult } from './pricing.js'
import {
  DuplicateError,
  type ListFilter,
  type Login,
  type NewEvent,
  type PublicView,
  type QuoteSummary,
  type Repository,
} from './repository.js'

const TOKEN_TTL_SECONDS = 24 * 60 * 60
const BCRYPT_COST = 10
const BCRYPT_MAX_BYTES = 72

/** Same cost as Go's bcrypt.DefaultCost; like Go, passwords over 72 bytes are an internal error. */
export async function hashPassword(password: string): Promise<string> {
  if (Buffer.byteLength(password) > BCRYPT_MAX_BYTES) throw new Error('bcrypt: password length exceeds 72 bytes')
  return bcrypt.hash(password, BCRYPT_COST)
}

/**
 * Token claims are part of the cross-backend contract (BearerAuth in contracts/openapi.yaml): HS256,
 * sub = user id, tid = tenant id, role, iat, exp (24h). The role claim is informational; the actor's
 * current role and active flag are read from the database on every request.
 */
export class AuthService {
  private readonly key: Uint8Array

  constructor(
    private readonly repo: Repository,
    secret: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.key = new TextEncoder().encode(secret)
  }

  /** Unknown email, inactive account and wrong password all fail the same way. */
  async login(email: string, password: string): Promise<{ accessToken: string; login: Login }> {
    const login = await this.repo.findLogin(email.trim())
    if (!login || !(await bcrypt.compare(password, login.passwordHash))) {
      throw unauthorized('invalid email or password')
    }
    const iat = Math.floor(this.now().getTime() / 1000)
    const accessToken = await new SignJWT({ tid: login.organizationId, role: login.role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(login.userId)
      .setIssuedAt(iat)
      .setExpirationTime(iat + TOKEN_TTL_SECONDS)
      .sign(this.key)
    return { accessToken, login }
  }

  /** Verifies a bearer token and loads the actor it belongs to. */
  async authenticate(token: string): Promise<Actor> {
    let userId: string
    let tenantId: string
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        requiredClaims: ['exp'],
        currentDate: this.now(),
      })
      userId = parseUuid(typeof payload.sub === 'string' ? payload.sub : '')
      tenantId = parseUuid(typeof payload.tid === 'string' ? payload.tid : '')
    } catch {
      throw unauthorized('invalid or expired token')
    }
    const actor = await this.repo.loadActor(tenantId, userId)
    if (!actor) throw unauthorized('account is inactive')
    return actor
  }
}

/** A create/update payload as decoded; null means the field was absent. */
export interface QuoteInput {
  clientId: string | null
  dealId: string | null
  quoteNumber: string
  expiryDate: string | null
  items: ItemInput[]
}

export interface ItemInput {
  title: string
  categoryId: string | null
  description: string
  quantity: Money | null
  unitPrice: Money | null
  discountPercent: Money | null // default 0
  taxPercent: Money | null // default 7
}

const DEFAULT_TAX_PERCENT = new Money(7)

interface Validated {
  clientId: string
  dealId: string | null
  quoteNumber: string
  expiryDate: string
  items: QuoteItem[]
  totals: PricingResult
}

const quoteNotFound = () => notFound('quote not found')
const publicNotFound = () => notFound('quote expired or not found')
const stateConflict = (verb: string, s: QuoteStatus) => conflict(`cannot ${verb} a quote that is ${s}`)

/** null for a missing or blank comment. */
function trimmed(s: string | null): string | null {
  const t = s?.trim() ?? ''
  return t === '' ? null : t
}

function validateSignature(signerName: string, signatureData: string): string {
  const p = new Problems()
  const signer = signerName.trim()
  if (signer === '') p.add('signerName is required')
  if (signatureData.trim() === '') p.add('signatureDataUrl is required')
  p.check()
  return signer
}

function canView(a: Actor, q: Quote): boolean {
  switch (a.role) {
    case 'rm':
      return q.createdBy?.id === a.userId
    case 'wo':
      return q.creatorTeamWo !== null && q.creatorTeamWo === a.userId
    case 'woc':
      return true
    case 'customer':
      return a.clientId !== null && a.clientId === q.clientId && CUSTOMER_STATUSES.includes(q.status)
    default:
      return false
  }
}

function customerHistory(q: Quote): Quote {
  return { ...q, history: q.history.filter((e) => CUSTOMER_EVENTS.includes(e.action)) }
}

/** Hides internal history from customers. */
function forActor(a: Actor, q: Quote): Quote {
  return a.role === 'customer' ? customerHistory(q) : q
}

export class QuoteService {
  constructor(
    private readonly repo: Repository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(a: Actor, input: QuoteInput): Promise<Quote> {
    if (a.role !== 'rm') throw roleForbidden()
    const v = await this.validate(a.tenantId, input)
    const q: Quote = {
      id: randomUUID(),
      organizationId: a.tenantId,
      clientId: v.clientId,
      clientName: '',
      dealId: v.dealId,
      quoteNumber: v.quoteNumber,
      status: 'draft',
      expiryDate: v.expiryDate,
      subtotal: v.totals.subtotal,
      discountAmount: v.totals.discountAmount,
      taxAmount: v.totals.taxAmount,
      grandTotal: v.totals.grandTotal,
      accessToken: randomUUID(),
      signedBy: null,
      signatureData: null,
      signedAt: null,
      createdBy: { id: a.userId, name: a.name },
      creatorTeamWo: null,
      items: v.items,
      history: [],
    }
    try {
      await this.repo.createQuote(q, a.userId, this.now(), this.event('created', a.userId, null))
    } catch (err) {
      throw duplicate(err, q.quoteNumber)
    }
    return this.get(a, q.id)
  }

  async update(a: Actor, id: string, input: QuoteInput): Promise<Quote> {
    if (a.role !== 'rm') throw roleForbidden()
    const current = await this.visible(a, id)
    const v = await this.validate(a.tenantId, input)
    if (current.status !== 'draft') throw stateConflict('edit', current.status)
    const next: Quote = {
      ...current,
      clientId: v.clientId,
      dealId: v.dealId,
      quoteNumber: v.quoteNumber,
      expiryDate: v.expiryDate,
      subtotal: v.totals.subtotal,
      discountAmount: v.totals.discountAmount,
      taxAmount: v.totals.taxAmount,
      grandTotal: v.totals.grandTotal,
      items: v.items,
    }
    let replaced: boolean
    try {
      replaced = await this.repo.replaceQuote(next, this.event('updated', a.userId, null))
    } catch (err) {
      throw duplicate(err, v.quoteNumber)
    }
    if (!replaced) throw await this.raced(a.tenantId, id, 'edit')
    return this.get(a, id)
  }

  /** Two passes like the Go service: required fields, then values; prices the items; checks the client exists. */
  private async validate(orgId: string, input: QuoteInput): Promise<Validated> {
    const p = new Problems()
    if (input.clientId === null) p.add('clientId is required')
    if (input.expiryDate === null) p.add('expiryDate is required')
    input.items.forEach((it, i) => {
      if (it.categoryId === null) p.add(`items[${i}].categoryId is required`)
      if (it.quantity === null) p.add(`items[${i}].quantity is required`)
      if (it.unitPrice === null) p.add(`items[${i}].unitPrice is required`)
    })
    p.check()

    const categories = await this.repo.activeCategoryIds(orgId)
    const quoteNumber = input.quoteNumber.trim()
    const expiryDate = input.expiryDate!
    if (quoteNumber === '') p.add('quoteNumber is required')
    if (expiryDate < this.today()) p.add('expiryDate must not be in the past')
    const items = input.items.map((it, i): QuoteItem => {
      if (it.title.trim() === '') p.add(`items[${i}].title is required`)
      if (!categories.has(it.categoryId!)) p.add(`items[${i}].categoryId is not an active category`)
      return {
        id: randomUUID(),
        title: it.title,
        category: { id: it.categoryId!, name: '' },
        description: it.description,
        quantity: it.quantity!,
        unitPrice: it.unitPrice!,
        discountPercent: it.discountPercent ?? new Money(0),
        taxPercent: it.taxPercent ?? DEFAULT_TAX_PERCENT,
        lineTotal: new Money(0),
      }
    })
    let totals: PricingResult | null = null
    try {
      totals = calculate(items)
    } catch (err) {
      p.add((err as Error).message)
    }
    p.check()
    totals!.lineTotals.forEach((t, i) => (items[i]!.lineTotal = t))
    if (!(await this.repo.clientExists(orgId, input.clientId!))) throw invalid('clientId does not exist')
    return { clientId: input.clientId!, dealId: input.dealId, quoteNumber, expiryDate, items, totals: totals! }
  }

  async list(a: Actor, status: QuoteStatus | null): Promise<QuoteSummary[]> {
    const f: ListFilter = { orgId: a.tenantId, status, createdBy: null, teamWo: null, clientId: null, statuses: null }
    switch (a.role) {
      case 'rm':
        f.createdBy = a.userId
        break
      case 'wo':
        f.teamWo = a.userId
        break
      case 'woc':
        break
      case 'customer':
        if (a.clientId === null) return []
        f.clientId = a.clientId
        f.statuses = CUSTOMER_STATUSES
        break
      default:
        throw roleForbidden()
    }
    return this.repo.listQuotes(f)
  }

  /** Returns a visible quote. A customer opening a sent quote marks it viewed. */
  async get(a: Actor, id: string): Promise<Quote> {
    if (a.role === 'admin') throw roleForbidden()
    let q = await this.visible(a, id)
    if (a.role === 'customer' && q.status === 'sent') {
      await this.markViewed(q.id, a.userId)
      q = (await this.repo.getQuote(a.tenantId, id))!
    }
    return forActor(a, q)
  }

  async submit(a: Actor, id: string, comment: string | null): Promise<Quote> {
    if (a.role !== 'rm') throw roleForbidden()
    const q = await this.visible(a, id)
    if (q.status !== 'draft') throw stateConflict('submit', q.status)
    if (q.creatorTeamWo === null) throw conflict('you must be in a team led by a WO to submit')
    return this.transition(a, q, 'submit', ['draft'], 'pending_approval', 'submitted', comment)
  }

  async approve(a: Actor, id: string, comment: string | null): Promise<Quote> {
    if (a.role !== 'wo') throw roleForbidden()
    const q = await this.visible(a, id)
    return this.transition(a, q, 'approve', ['pending_approval'], 'approved', 'approved', comment)
  }

  async return(a: Actor, id: string, comment: string | null): Promise<Quote> {
    if (a.role !== 'wo') throw roleForbidden()
    const q = await this.visible(a, id)
    if (trimmed(comment) === null) throw invalid('comment is required')
    return this.transition(a, q, 'return', ['pending_approval'], 'draft', 'returned', comment)
  }

  async send(a: Actor, id: string): Promise<Quote> {
    if (a.role !== 'rm') throw roleForbidden()
    const q = await this.visible(a, id)
    if (q.status !== 'approved') throw stateConflict('send', q.status)
    if (this.isExpired(q)) throw conflict('quote has expired')
    return this.transition(a, q, 'send', ['approved'], 'sent', 'sent', null)
  }

  async accept(a: Actor, id: string, signerName: string, signatureData: string): Promise<Quote> {
    if (a.role !== 'customer') throw roleForbidden()
    const q = await this.visible(a, id)
    const signer = validateSignature(signerName, signatureData)
    this.respondable(q, 'accept')
    const ok = await this.repo.accept(q.id, RESPONDABLE_STATUSES, signer, signatureData, this.event('accepted', a.userId, null))
    if (!ok) throw await this.raced(a.tenantId, q.id, 'accept')
    return this.get(a, id)
  }

  async reject(a: Actor, id: string, comment: string | null): Promise<Quote> {
    if (a.role !== 'customer') throw roleForbidden()
    const q = await this.visible(a, id)
    this.respondable(q, 'reject')
    return this.transition(a, q, 'reject', RESPONDABLE_STATUSES, 'rejected', 'rejected', comment)
  }

  /** A sent, unexpired quote by share link; marked viewed on first open. */
  async getPublic(accessToken: string): Promise<PublicView> {
    const v = await this.publicQuote(accessToken)
    if (v.quote.status === 'sent') {
      await this.markViewed(v.quote.id, null)
      return this.publicQuote(accessToken)
    }
    return v
  }

  async acceptPublic(accessToken: string, signerName: string, signatureData: string): Promise<Quote> {
    const signer = validateSignature(signerName, signatureData)
    const { quote: q } = await this.publicQuote(accessToken)
    if (!RESPONDABLE_STATUSES.includes(q.status)) throw stateConflict('accept', q.status)
    const ok = await this.repo.accept(q.id, RESPONDABLE_STATUSES, signer, signatureData, this.event('accepted', null, null))
    if (!ok) throw await this.raced(q.organizationId, q.id, 'accept')
    return this.customerView(q)
  }

  async rejectPublic(accessToken: string, comment: string | null): Promise<Quote> {
    const { quote: q } = await this.publicQuote(accessToken)
    if (!RESPONDABLE_STATUSES.includes(q.status)) throw stateConflict('reject', q.status)
    const ok = await this.repo.transition(q.id, RESPONDABLE_STATUSES, 'rejected', this.event('rejected', null, comment))
    if (!ok) throw await this.raced(q.organizationId, q.id, 'reject')
    return this.customerView(q)
  }

  /** Loads a quote and hides it (404) unless the actor's role lets them see it. */
  private async visible(a: Actor, id: string): Promise<Quote> {
    const q = await this.repo.getQuote(a.tenantId, id)
    if (!q || !canView(a, q)) throw quoteNotFound()
    return q
  }

  private async transition(
    a: Actor, q: Quote, verb: string, from: QuoteStatus[], to: QuoteStatus, action: EventAction, comment: string | null,
  ): Promise<Quote> {
    if (!from.includes(q.status)) throw stateConflict(verb, q.status)
    if (!(await this.repo.transition(q.id, from, to, this.event(action, a.userId, comment)))) {
      throw await this.raced(a.tenantId, q.id, verb)
    }
    return this.get(a, q.id)
  }

  /** Turns a lost conditional update into the same conflict the pre-check would have given. */
  private async raced(orgId: string, id: string, verb: string): Promise<Error> {
    const q = await this.repo.getQuote(orgId, id)
    if (!q) return new NotFoundError('not found')
    return stateConflict(verb, q.status)
  }

  private respondable(q: Quote, verb: string): void {
    if (this.isExpired(q)) throw conflict('quote has expired')
    if (!RESPONDABLE_STATUSES.includes(q.status)) throw stateConflict(verb, q.status)
  }

  /** Someone else may already have moved it on; that is fine. */
  private async markViewed(id: string, actorId: string | null): Promise<void> {
    await this.repo.transition(id, ['sent'], 'viewed', this.event('viewed', actorId, null))
  }

  /** Drafts, unsent, expired and unknown quotes are all "not found". */
  private async publicQuote(accessToken: string): Promise<PublicView> {
    const v = await this.repo.getByAccessToken(accessToken)
    if (!v || !CUSTOMER_STATUSES.includes(v.quote.status) || this.isExpired(v.quote)) throw publicNotFound()
    return v
  }

  private async customerView(q: Quote): Promise<Quote> {
    return customerHistory((await this.repo.getQuote(q.organizationId, q.id))!)
  }

  private event(action: EventAction, actorId: string | null, comment: string | null): NewEvent {
    return { action, actorId, comment: trimmed(comment), at: this.now() }
  }

  /** Today's date in UTC as YYYY-MM-DD; dates compare correctly as strings. */
  private today(): string {
    return this.now().toISOString().slice(0, 10)
  }

  /** expiryDate is the last valid day. */
  private isExpired(q: Quote): boolean {
    return q.status === 'expired' || q.expiryDate < this.today()
  }
}

function duplicate(err: unknown, number: string): unknown {
  return err instanceof DuplicateError ? conflict(`quoteNumber ${goQuote(number)} already exists`) : err
}

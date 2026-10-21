// Use cases; rules and messages mirror backend/go-service/internal/{auth,quote}.
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { jwtVerify, SignJWT } from 'jose'
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  type Login,
  type Quote,
  type QuoteItem,
  type QuoteStatus,
} from './domain.js'
import { calculate, type PricingResult } from './pricing.js'
import type { PublicView, QuoteSummary, Repository } from './repository.js'

/** Token claims are part of the cross-backend contract: HS256, sub, tid, role, iat, exp (24h). */
export class AuthService {
  private readonly key: Uint8Array

  constructor(
    private readonly repo: Repository,
    secret: string,
  ) {
    this.key = new TextEncoder().encode(secret)
  }

  /** Unknown email and wrong password fail the same way. */
  async login(email: string, password: string): Promise<{ accessToken: string; login: Login }> {
    const login = await this.repo.findLogin(email.trim())
    if (!login || !(await bcrypt.compare(password, login.passwordHash))) {
      throw new UnauthorizedError('unauthorized: invalid email or password')
    }
    const accessToken = await new SignJWT({ tid: login.organizationId, role: login.role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(login.userId)
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(this.key)
    return { accessToken, login }
  }

  /** Returns the tenant id of a valid token; any failure is an UnauthorizedError. */
  async verify(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'], requiredClaims: ['exp', 'sub'] })
      if (typeof payload.tid !== 'string' || !UUID_RE.test(payload.tid)) throw new Error('bad tid')
      return payload.tid
    } catch {
      throw new UnauthorizedError('unauthorized: invalid or expired token')
    }
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface CreateQuoteInput {
  organizationId: string
  clientId: string
  dealId: string | null
  quoteNumber: string
  expiryDate: string
  items: Omit<QuoteItem, 'id' | 'lineTotal'>[]
}

export class QuoteService {
  constructor(
    private readonly repo: Repository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: CreateQuoteInput): Promise<Quote> {
    const problems: string[] = []
    const quoteNumber = input.quoteNumber.trim()
    if (quoteNumber === '') problems.push('quoteNumber is required')
    if (input.expiryDate < this.today()) problems.push('expiryDate must not be in the past')
    input.items.forEach((it, i) => {
      if (it.title.trim() === '') problems.push(`items[${i}].title is required`)
    })
    let priced: PricingResult | null = null
    try {
      priced = calculate(input.items)
    } catch (err) {
      problems.push((err as Error).message)
    }
    if (problems.length > 0 || !priced) throw new ValidationError(problems)

    if (!(await this.repo.clientBelongsTo(input.organizationId, input.clientId))) {
      throw new ValidationError(['clientId does not exist'])
    }

    const lineTotals = priced.lineTotals
    const quote: Quote = {
      id: randomUUID(),
      organizationId: input.organizationId,
      clientId: input.clientId,
      dealId: input.dealId,
      quoteNumber,
      status: 'draft',
      expiryDate: input.expiryDate,
      subtotal: priced.subtotal,
      discountAmount: priced.discountAmount,
      taxAmount: priced.taxAmount,
      grandTotal: priced.grandTotal,
      accessToken: randomUUID(),
      signedBy: null,
      signatureData: null,
      signedAt: null,
      createdAt: this.now(),
      items: input.items.map((it, i) => ({ ...it, id: randomUUID(), lineTotal: lineTotals[i]! })),
    }
    await this.repo.createQuote(quote)
    return quote
  }

  list(orgId: string, status: QuoteStatus | null): Promise<QuoteSummary[]> {
    return this.repo.listQuotes(orgId, status)
  }

  async get(orgId: string, id: string): Promise<Quote> {
    const q = await this.repo.getQuote(orgId, id)
    if (!q) throw new NotFoundError('not found: quote not found')
    return q
  }

  /** Expired quotes are reported as not found, and a sent quote is marked viewed on first open. */
  async getPublic(accessToken: string): Promise<PublicView> {
    const v = await this.repo.getPublic(accessToken)
    if (!v || this.isExpired(v.quote)) throw expiredOrNotFound()
    if (v.quote.status === 'sent') await this.repo.updateStatus(v.quote.id, 'viewed', ['sent'])
    return v
  }

  async accept(accessToken: string, signerName: string, signatureData: string): Promise<Quote> {
    const problems: string[] = []
    const signer = signerName.trim()
    if (signer === '') problems.push('signerName is required')
    if (signatureData.trim() === '') problems.push('signatureDataUrl is required')
    if (problems.length > 0) throw new ValidationError(problems)

    const v = await this.repo.getPublic(accessToken)
    if (!v || this.isExpired(v.quote)) throw expiredOrNotFound()
    const accepted = await this.repo.acceptQuote(v.quote.id, signer, signatureData, this.now())
    if (!accepted) throw new ConflictError(`conflict: quote is ${v.quote.status} and can no longer be accepted`)
    return accepted
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

function expiredOrNotFound(): NotFoundError {
  return new NotFoundError('not found: quote expired or not found')
}

// Fastify wiring. API routes live under /api/v1 and must match contracts/openapi.yaml path for path.
import cors from '@fastify/cors'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import {
  ConflictError,
  isQuoteStatus,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  type Client,
  type Quote,
  type QuoteItem,
  type QuoteStatus,
} from './domain.js'
import { JsonNumber, money, parseJson, stringify } from './json.js'
import { Money } from './pricing.js'
import type { PublicView, QuoteSummary, Repository } from './repository.js'
import { UUID_RE, type AuthService, type QuoteService } from './services.js'

// Error codes are part of the contract (ErrorResponse.code) and must match the other backends.
const VALIDATION = 'VALIDATION_ERROR'
const UNAUTHORIZED = 'UNAUTHORIZED'
const NOT_FOUND = 'NOT_FOUND'
const CONFLICT = 'CONFLICT'
const INTERNAL = 'INTERNAL_ERROR'

const DEFAULT_TAX_PERCENT = new Money(7)

export interface Deps {
  repo: Repository
  auth: AuthService
  quotes: QuoteService
  corsOrigins: string[]
  logger?: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string
  }
}

export async function buildApp(d: Deps): Promise<FastifyInstance> {
  const app = Fastify({ logger: d.logger ?? false })
  app.decorateRequest('tenantId', '')

  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, parseJson(body as string))
    } catch (err) {
      done(malformed((err as Error).message), undefined)
    }
  })
  app.setReplySerializer((payload) => stringify(payload))
  app.setErrorHandler((err, req, reply) => sendError(err, req, reply))
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ code: NOT_FOUND, message: 'route not found' }))

  await app.register(cors, {
    origin: d.corsOrigins,
    allowedHeaders: ['Authorization', 'Content-Type'],
  })

  // Operational endpoint, intentionally outside /api/v1 and the contract.
  app.get('/healthz', async (_req, reply) => {
    try {
      await d.repo.ping()
      return { status: 'ok', storage: 'postgres' }
    } catch {
      return reply.code(503).send({ status: 'degraded', storage: 'postgres' })
    }
  })

  const requireAuth = async (req: FastifyRequest) => {
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
    if (token === '') throw new UnauthorizedError('unauthorized: missing bearer token')
    req.tenantId = await d.auth.verify(token)
  }

  app.post('/api/v1/auth/login', async (req) => {
    const body = object(req.body)
    const res = await d.auth.login(str(body.email, 'email'), str(body.password, 'password'))
    return {
      accessToken: res.accessToken,
      tenantId: res.login.organizationId,
      user: { id: res.login.userId, name: res.login.fullName, role: res.login.role },
    }
  })

  app.get('/api/v1/clients', { preHandler: requireAuth }, async (req) =>
    (await d.repo.listClients(req.tenantId)).map(clientView),
  )

  app.get<{ Querystring: { status?: string } }>('/api/v1/quotes', { preHandler: requireAuth }, async (req) => {
    const raw = req.query.status ?? ''
    let status: QuoteStatus | null = null
    if (raw !== '') {
      if (!isQuoteStatus(raw)) throw new ValidationError([`status ${JSON.stringify(raw)} is not a valid QuoteStatus`])
      status = raw
    }
    return (await d.quotes.list(req.tenantId, status)).map(quoteSummary)
  })

  app.post('/api/v1/quotes', { preHandler: requireAuth }, async (req, reply) => {
    const body = object(req.body)
    const problems: string[] = []
    const clientId = optUuid(body.clientId, 'clientId')
    const expiryDate = optDate(body.expiryDate, 'expiryDate')
    if (clientId === null) problems.push('clientId is required')
    if (expiryDate === null) problems.push('expiryDate is required')
    const inputs = body.items === undefined || body.items === null ? [] : array(body.items, 'items')
    const items = inputs.map((raw, i): Omit<QuoteItem, 'id' | 'lineTotal'> => {
      const it = object(raw)
      const quantity = optDecimal(it.quantity, `items[${i}].quantity`)
      const unitPrice = optDecimal(it.unitPrice, `items[${i}].unitPrice`)
      if (quantity === null) problems.push(`items[${i}].quantity is required`)
      if (unitPrice === null) problems.push(`items[${i}].unitPrice is required`)
      return {
        title: str(it.title, `items[${i}].title`),
        description: optStr(it.description, `items[${i}].description`),
        quantity: quantity ?? new Money(0),
        unitPrice: unitPrice ?? new Money(0),
        discountPercent: optDecimal(it.discountPercent, `items[${i}].discountPercent`) ?? new Money(0),
        taxPercent: optDecimal(it.taxPercent, `items[${i}].taxPercent`) ?? DEFAULT_TAX_PERCENT,
      }
    })
    if (problems.length > 0 || clientId === null || expiryDate === null) throw new ValidationError(problems)

    const q = await d.quotes.create({
      organizationId: req.tenantId,
      clientId,
      dealId: optUuid(body.dealId, 'dealId'),
      quoteNumber: str(body.quoteNumber, 'quoteNumber'),
      expiryDate,
      items,
    })
    return reply.code(201).send(quoteDetail(q))
  })

  app.get<{ Params: { id: string } }>('/api/v1/quotes/:id', { preHandler: requireAuth }, async (req) => {
    if (!UUID_RE.test(req.params.id)) throw new NotFoundError('not found: quote not found')
    return quoteDetail(await d.quotes.get(req.tenantId, req.params.id))
  })

  app.get<{ Params: { accessToken: string } }>('/api/v1/public/quotes/:accessToken', async (req) => {
    return publicView(await d.quotes.getPublic(accessToken(req.params.accessToken)))
  })

  app.post<{ Params: { accessToken: string } }>('/api/v1/public/quotes/:accessToken/accept', async (req) => {
    const token = accessToken(req.params.accessToken)
    const body = object(req.body)
    const q = await d.quotes.accept(token, str(body.signerName, 'signerName'), str(body.signatureDataUrl, 'signatureDataUrl'))
    return quoteDetail(q)
  })

  return app
}

function sendError(err: unknown, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ValidationError) {
    return reply.code(400).send({ code: VALIDATION, message: err.message, details: err.details.length ? err.details : undefined })
  }
  if (err instanceof UnauthorizedError) return reply.code(401).send({ code: UNAUTHORIZED, message: err.message })
  if (err instanceof NotFoundError) return reply.code(404).send({ code: NOT_FOUND, message: err.message })
  if (err instanceof ConflictError) return reply.code(409).send({ code: CONFLICT, message: err.message })
  const status = (err as { statusCode?: number }).statusCode
  if (status !== undefined && status >= 400 && status < 500) {
    return reply.code(status).send({ code: VALIDATION, message: (err as Error).message })
  }
  req.log.error(err, 'internal error')
  return reply.code(500).send({ code: INTERNAL, message: 'internal server error' })
}

// Body decoding: wrong JSON types are "malformed JSON body", like Go's json.Unmarshal; absent fields are zero values.

function malformed(reason: string): ValidationError {
  return new ValidationError([`malformed JSON body: ${reason}`])
}

function object(v: unknown): Record<string, unknown> {
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof JsonNumber)) {
    return v as Record<string, unknown>
  }
  if (v === undefined || v === null) return {}
  throw malformed('expected a JSON object')
}

function array(v: unknown, field: string): unknown[] {
  if (Array.isArray(v)) return v
  throw malformed(`${field} must be an array`)
}

function str(v: unknown, field: string): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  throw malformed(`${field} must be a string`)
}

function optStr(v: unknown, field: string): string | null {
  return v === undefined || v === null ? null : str(v, field)
}

function optUuid(v: unknown, field: string): string | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'string' && UUID_RE.test(v)) return v.toLowerCase()
  throw malformed(`${field} must be a UUID`)
}

function optDate(v: unknown, field: string): string | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T00:00:00Z`)
    if (!Number.isNaN(d.getTime()) && d.toISOString().startsWith(v)) return v
  }
  throw malformed(`${field} must be a date (YYYY-MM-DD)`)
}

/** Accepts a JSON number or numeric string, like shopspring/decimal in the Go service. */
function optDecimal(v: unknown, field: string): Money | null {
  if (v === undefined || v === null) return null
  try {
    if (v instanceof JsonNumber) return new Money(v.text)
    if (typeof v === 'string') return new Money(v)
  } catch {
    // fall through
  }
  throw malformed(`${field} must be a number`)
}

/** A malformed token is reported like an unknown one. */
function accessToken(raw: string): string {
  if (!UUID_RE.test(raw)) throw new NotFoundError('not found: quote expired or not found')
  return raw.toLowerCase()
}

// Wire shapes, field for field with contracts/openapi.yaml.

function clientView(c: Client) {
  return { id: c.id, name: c.name, email: c.email === '' ? null : c.email }
}

function quoteSummary(s: QuoteSummary) {
  return {
    id: s.id,
    quoteNumber: s.quoteNumber,
    clientName: s.clientName,
    status: s.status,
    grandTotal: money(s.grandTotal),
    expiryDate: s.expiryDate,
  }
}

function itemViews(items: QuoteItem[]) {
  return items.map((it) => ({
    title: it.title,
    quantity: money(it.quantity),
    unitPrice: money(it.unitPrice),
    lineTotal: money(it.lineTotal),
  }))
}

function quoteDetail(q: Quote) {
  return {
    id: q.id,
    quoteNumber: q.quoteNumber,
    status: q.status,
    expiryDate: q.expiryDate,
    subtotal: money(q.subtotal),
    discountAmount: money(q.discountAmount),
    taxAmount: money(q.taxAmount),
    grandTotal: money(q.grandTotal),
    accessToken: q.accessToken,
    signedBy: q.signedBy,
    signedAt: q.signedAt,
    items: itemViews(q.items),
  }
}

function publicView(v: PublicView) {
  const q = v.quote
  return {
    quoteNumber: q.quoteNumber,
    status: q.status,
    expiryDate: q.expiryDate,
    signedBy: q.signedBy,
    signedAt: q.signedAt,
    vendorName: v.vendorName,
    vendorLogo: null,
    grandTotal: money(q.grandTotal),
    items: itemViews(q.items),
  }
}

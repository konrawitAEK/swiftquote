// Fastify wiring. API routes live under /api/v1 and must match contracts/openapi.yaml path for path.
// Error precedence, shared with the Go and Spring services:
// 401 session, 400 malformed JSON, then the service's 403 role, 404 visibility, 400 content, 409 state.
import { STATUS_CODES } from 'node:http'
import cors from '@fastify/cors'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import type { AdminService, CatalogService, ClientService, DashboardService } from './admin.js'
import {
  ConflictError,
  ForbiddenError,
  invalid,
  isQuoteStatus,
  NotFoundError,
  roleForbidden,
  unauthorized,
  UnauthorizedError,
  ValidationError,
  type Actor,
  type QuoteStatus,
} from './domain.js'
import { goQuote, parseDate, pathUuid, unmarshal, type StructType } from './gojson.js'
import { stringify } from './json.js'
import { pdfFileName, renderQuotePdf } from './pdf.js'
import type { Money } from './pricing.js'
import type { Repository } from './repository.js'
import type { AuthService, QuoteDocument, QuoteInput, QuoteService } from './services.js'
import {
  adminUserView,
  audienceOf,
  categoryView,
  clientView,
  dashboardView,
  productView,
  publicView,
  quoteDetail,
  quoteSummary,
  teamView,
} from './views.js'

// Error codes are part of the contract (ErrorResponse.code) and must match the other backends.
const VALIDATION = 'VALIDATION_ERROR'
const UNAUTHORIZED = 'UNAUTHORIZED'
const FORBIDDEN = 'FORBIDDEN'
const NOT_FOUND = 'NOT_FOUND'
const CONFLICT = 'CONFLICT'
const INTERNAL = 'INTERNAL_ERROR'

/** Fiber's default body limit, so the same payloads are accepted. */
const BODY_LIMIT = 4 * 1024 * 1024

export interface Deps {
  repo: Repository
  auth: AuthService
  quotes: QuoteService
  admin: AdminService
  catalog: CatalogService
  clients: ClientService
  dashboard: DashboardService
  corsOrigins: string[]
  logger?: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null
  }
}

// Request bodies, as the Go service's request structs (names appear in "malformed JSON body" details).
const str = { kind: 'string', goType: 'string' } as const
const uuid = { kind: '*uuid' } as const
const decimal = { kind: '*decimal' } as const
const optStr = { kind: '*string' } as const
const optBool = { kind: '*bool' } as const
const role = { kind: 'string', goType: 'domain.Role' } as const

const loginRequest: StructType = { name: 'loginRequest', fields: { email: str, password: str } }
const quoteItemInput: StructType = {
  name: 'quoteItemInput',
  fields: {
    productId: uuid, description: str, quantity: decimal, unitPrice: decimal,
    discountType: optStr, discountValue: decimal, taxPercent: decimal,
  },
}
const createQuoteRequest: StructType = {
  name: 'createQuoteRequest',
  fields: {
    clientId: uuid, dealId: uuid, quoteNumber: str, expiryDate: { kind: '*date' },
    items: { kind: 'slice', elem: quoteItemInput },
  },
}
const commentRequest: StructType = { name: 'commentRequest', fields: { comment: optStr } }
const acceptQuoteRequest: StructType = { name: 'acceptQuoteRequest', fields: { signerName: str, signatureDataUrl: str } }
const createUserRequest: StructType = {
  name: 'createUserRequest',
  fields: { email: str, name: str, password: optStr, role, teamId: uuid, clientId: uuid },
}
const updateUserRequest: StructType = {
  name: 'updateUserRequest',
  fields: { name: str, role, active: optBool, teamId: uuid, clientId: uuid, password: optStr },
}
const teamRequest: StructType = { name: 'teamRequest', fields: { name: str, woUserId: uuid } }
const createCategoryRequest: StructType = { name: 'createCategoryRequest', fields: { name: str } }
const updateCategoryRequest: StructType = { name: 'updateCategoryRequest', fields: { name: str, active: optBool } }
const createProductRequest: StructType = {
  name: 'createProductRequest',
  fields: { name: str, categoryId: uuid, unitPrice: decimal, unitCost: decimal, stock: decimal },
}
const updateProductRequest: StructType = {
  name: 'updateProductRequest',
  fields: { name: str, categoryId: uuid, unitPrice: decimal, unitCost: decimal, stock: decimal, active: optBool },
}

/** Like Go's json.Unmarshal of the raw body: a malformed body is a 400 with Go's message. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decode(req: FastifyRequest, t: StructType): Record<string, any> {
  const res = unmarshal(rawBody(req), t)
  if (!res.ok) throw new ValidationError([`malformed JSON body: ${res.error}`])
  return res.value
}

function rawBody(req: FastifyRequest): Buffer {
  return Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
}

/** An optional {"comment": ...} body; an empty body means no comment. */
function optionalComment(req: FastifyRequest): string | null {
  return rawBody(req).length === 0 ? null : (decode(req, commentRequest).comment as string | null)
}

function toQuoteInput(body: Record<string, unknown>): QuoteInput {
  const items = (body.items as Record<string, unknown>[] | null) ?? []
  return {
    clientId: body.clientId as string | null,
    dealId: body.dealId as string | null,
    quoteNumber: body.quoteNumber as string,
    expiryDate: body.expiryDate as string | null,
    items: items.map((it) => ({
      productId: it.productId as string | null,
      description: it.description as string,
      quantity: it.quantity as Money | null,
      unitPrice: it.unitPrice as Money | null,
      discountType: it.discountType as string | null,
      discountValue: it.discountValue as Money | null,
      taxPercent: it.taxPercent as Money | null,
    })),
  }
}

/** A quote PDF as an attachment named after the quote number. */
async function sendPdf(reply: FastifyReply, d: QuoteDocument) {
  const pdf = await renderQuotePdf(d.quote, d.vendorName)
  return reply
    .header('Content-Type', 'application/pdf')
    .header('Content-Disposition', `attachment; filename="${pdfFileName(d.quote.quoteNumber)}"`)
    .send(pdf)
}

/** Fiber's c.Query: the first value, "" when absent. */
function query(req: FastifyRequest, name: string): string {
  const v = (req.query as Record<string, string | string[] | undefined>)[name]
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

type Method = 'GET' | 'POST' | 'PUT'
type Handler = (req: FastifyRequest<{ Params: Record<string, string> }>, reply: FastifyReply) => Promise<unknown>

// Fiber's method order for the Allow header of a 405.
const ALLOW_ORDER = ['GET', 'HEAD', 'POST', 'PUT']

export async function buildApp(d: Deps): Promise<FastifyInstance> {
  // Fiber matches paths case-insensitively and ignores a trailing slash.
  const app = Fastify({
    logger: d.logger ?? false,
    bodyLimit: BODY_LIMIT,
    routerOptions: { caseSensitive: false, ignoreTrailingSlash: true },
  })
  app.decorateRequest('actor', null)

  // Bodies stay raw: they are decoded per route after authentication, as in Go.
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))
  app.setReplySerializer((payload) => stringify(payload))
  app.setErrorHandler((err, req, reply) => sendError(err, req, reply))

  const known: { method: Method; re: RegExp }[] = []
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0]!
    const allowed = ALLOW_ORDER.filter(
      (m) => m !== req.method && known.some((r) => (r.method === m || (m === 'HEAD' && r.method === 'GET')) && r.re.test(path)),
    )
    if (allowed.length > 0) {
      return reply.code(405).header('Allow', allowed.join(', ')).send({ code: VALIDATION, message: 'Method Not Allowed' })
    }
    return reply.code(404).send({ code: NOT_FOUND, message: 'route not found' })
  })

  await app.register(cors, {
    origin: d.corsOrigins,
    allowedHeaders: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  })

  /** Validates the bearer token and loads the current actor. */
  const requireAuth = async (req: FastifyRequest) => {
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
    if (token === '') throw unauthorized('missing bearer token')
    req.actor = await d.auth.authenticate(token)
  }
  const actor = (req: FastifyRequest): Actor => req.actor!

  const route = (method: Method, url: string, handler: Handler, auth = true) => {
    known.push({ method, re: new RegExp(`^${url.replace(/:[^/]+/g, '[^/]+')}/?$`, 'i') })
    app.route({ method, url, handler, ...(auth ? { preHandler: requireAuth } : {}) })
  }

  // Operational endpoint, intentionally outside /api/v1 and the contract.
  route(
    'GET',
    '/healthz',
    async (_req, reply) => {
      try {
        await d.repo.ping()
        return { status: 'ok', storage: 'postgres' }
      } catch {
        return reply.code(503).send({ status: 'degraded', storage: 'postgres' })
      }
    },
    false,
  )

  const api = '/api/v1'

  route(
    'POST',
    `${api}/auth/login`,
    async (req) => {
      const body = decode(req, loginRequest)
      const res = await d.auth.login(body.email, body.password)
      return {
        accessToken: res.accessToken,
        tenantId: res.login.organizationId,
        user: { id: res.login.userId, name: res.login.fullName, role: res.login.role },
      }
    },
    false,
  )

  route('GET', `${api}/clients`, async (req) => (await d.clients.list(actor(req))).map(clientView))
  route('GET', `${api}/categories`, async (req) => (await d.catalog.list(actor(req))).map(categoryView))
  route('GET', `${api}/products`, async (req) => (await d.catalog.listProducts(actor(req))).map(productView))

  route('GET', `${api}/quotes`, async (req) => {
    const a = actor(req)
    if (a.role === 'admin') throw roleForbidden()
    const raw = query(req, 'status')
    let status: QuoteStatus | null = null
    if (raw !== '') {
      if (!isQuoteStatus(raw)) throw invalid(`status ${goQuote(raw)} is not a valid QuoteStatus`)
      status = raw
    }
    return (await d.quotes.list(a, status)).map(quoteSummary)
  })

  route('POST', `${api}/quotes`, async (req, reply) => {
    const body = decode(req, createQuoteRequest)
    const q = await d.quotes.create(actor(req), toQuoteInput(body))
    return reply.code(201).send(quoteDetail(q, audienceOf(actor(req).role)))
  })

  route('GET', `${api}/quotes/:id`, async (req) =>
    quoteDetail(await d.quotes.get(actor(req), pathUuid(req.params.id!)), audienceOf(actor(req).role)))

  route('PUT', `${api}/quotes/:id`, async (req) => {
    const body = decode(req, createQuoteRequest)
    return quoteDetail(await d.quotes.update(actor(req), pathUuid(req.params.id!), toQuoteInput(body)), audienceOf(actor(req).role))
  })

  route('GET', `${api}/quotes/:id/pdf`, async (req, reply) =>
    sendPdf(reply, await d.quotes.document(actor(req), pathUuid(req.params.id!))))

  // Workflow steps that take an optional {"comment"} body.
  const actions: Record<string, (a: Actor, id: string, comment: string | null) => Promise<unknown>> = {
    submit: (a, id, c) => d.quotes.submit(a, id, c),
    approve: (a, id, c) => d.quotes.approve(a, id, c),
    return: (a, id, c) => d.quotes.return(a, id, c),
    send: (a, id) => d.quotes.send(a, id),
    reject: (a, id, c) => d.quotes.reject(a, id, c),
  }
  for (const [name, action] of Object.entries(actions)) {
    route('POST', `${api}/quotes/:id/${name}`, async (req) => {
      const comment = optionalComment(req)
      const q = (await action(actor(req), pathUuid(req.params.id!), comment)) as Parameters<typeof quoteDetail>[0]
      return quoteDetail(q, audienceOf(actor(req).role))
    })
  }

  route('POST', `${api}/quotes/:id/accept`, async (req) => {
    const body = decode(req, acceptQuoteRequest)
    const q = await d.quotes.accept(actor(req), pathUuid(req.params.id!), body.signerName, body.signatureDataUrl)
    return quoteDetail(q, audienceOf(actor(req).role))
  })

  route('GET', `${api}/dashboard/summary`, async (req) => {
    const a = actor(req)
    if (a.role !== 'woc') throw roleForbidden()
    const range = { from: null as string | null, to: null as string | null }
    for (const name of ['from', 'to'] as const) {
      const raw = query(req, name)
      if (raw === '') continue
      try {
        range[name] = parseDate(raw)
      } catch {
        throw invalid(`${name} must be a date (YYYY-MM-DD)`)
      }
    }
    return dashboardView(await d.dashboard.summary(a, range))
  })

  route('GET', `${api}/admin/users`, async (req) => (await d.admin.listUsers(actor(req))).map(adminUserView))

  route('POST', `${api}/admin/users`, async (req, reply) => {
    const b = decode(req, createUserRequest)
    const u = await d.admin.createUser(actor(req), {
      email: b.email, name: b.name, password: b.password, role: b.role, active: null, teamId: b.teamId, clientId: b.clientId,
    })
    return reply.code(201).send(adminUserView(u))
  })

  route('PUT', `${api}/admin/users/:id`, async (req) => {
    const b = decode(req, updateUserRequest)
    const u = await d.admin.updateUser(actor(req), pathUuid(req.params.id!), {
      email: '', name: b.name, password: b.password, role: b.role, active: b.active, teamId: b.teamId, clientId: b.clientId,
    })
    return adminUserView(u)
  })

  // Deletes are POSTs whose body is ignored (never decoded), so any or no body is fine.
  route('POST', `${api}/admin/users/:id/delete`, async (req, reply) => {
    await d.admin.deleteUser(actor(req), pathUuid(req.params.id!))
    return reply.code(204).send()
  })

  route('GET', `${api}/admin/teams`, async (req) => (await d.admin.listTeams(actor(req))).map(teamView))

  route('POST', `${api}/admin/teams`, async (req, reply) => {
    const b = decode(req, teamRequest)
    return reply.code(201).send(teamView(await d.admin.createTeam(actor(req), b.name, b.woUserId)))
  })

  route('PUT', `${api}/admin/teams/:id`, async (req) => {
    const b = decode(req, teamRequest)
    return teamView(await d.admin.updateTeam(actor(req), pathUuid(req.params.id!), b.name, b.woUserId))
  })

  route('POST', `${api}/admin/teams/:id/delete`, async (req, reply) => {
    await d.admin.deleteTeam(actor(req), pathUuid(req.params.id!))
    return reply.code(204).send()
  })

  route('POST', `${api}/admin/categories`, async (req, reply) => {
    const b = decode(req, createCategoryRequest)
    return reply.code(201).send(categoryView(await d.catalog.create(actor(req), b.name)))
  })

  route('PUT', `${api}/admin/categories/:id`, async (req) => {
    const b = decode(req, updateCategoryRequest)
    return categoryView(await d.catalog.update(actor(req), pathUuid(req.params.id!), b.name, b.active))
  })

  route('POST', `${api}/admin/categories/:id/delete`, async (req, reply) => {
    await d.catalog.delete(actor(req), pathUuid(req.params.id!))
    return reply.code(204).send()
  })

  route('POST', `${api}/admin/products`, async (req, reply) => {
    const b = decode(req, createProductRequest)
    const p = await d.catalog.createProduct(actor(req), {
      name: b.name, categoryId: b.categoryId, unitPrice: b.unitPrice, unitCost: b.unitCost, stock: b.stock, active: null,
    })
    return reply.code(201).send(productView(p))
  })

  route('PUT', `${api}/admin/products/:id`, async (req) => {
    const b = decode(req, updateProductRequest)
    const p = await d.catalog.updateProduct(actor(req), pathUuid(req.params.id!), {
      name: b.name, categoryId: b.categoryId, unitPrice: b.unitPrice, unitCost: b.unitCost, stock: b.stock, active: b.active,
    })
    return productView(p)
  })

  route('POST', `${api}/admin/products/:id/delete`, async (req, reply) => {
    await d.catalog.deleteProduct(actor(req), pathUuid(req.params.id!))
    return reply.code(204).send()
  })

  // Share-link routes; a malformed token is reported like an unknown one.
  route(
    'GET',
    `${api}/public/quotes/:accessToken`,
    async (req) => publicView(await d.quotes.getPublic(pathUuid(req.params.accessToken!))),
    false,
  )

  route(
    'GET',
    `${api}/public/quotes/:accessToken/pdf`,
    async (req, reply) => sendPdf(reply, await d.quotes.publicDocument(pathUuid(req.params.accessToken!))),
    false,
  )

  route(
    'POST',
    `${api}/public/quotes/:accessToken/accept`,
    async (req) => {
      const b = decode(req, acceptQuoteRequest)
      const q = await d.quotes.acceptPublic(pathUuid(req.params.accessToken!), b.signerName, b.signatureDataUrl)
      return quoteDetail(q, 'customer')
    },
    false,
  )

  route(
    'POST',
    `${api}/public/quotes/:accessToken/reject`,
    async (req) => {
      const comment = optionalComment(req)
      return quoteDetail(await d.quotes.rejectPublic(pathUuid(req.params.accessToken!), comment), 'customer')
    },
    false,
  )

  return app
}

function sendError(err: unknown, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ValidationError) {
    const details = err.details.length > 0 ? err.details : undefined
    return reply.code(400).send({ code: VALIDATION, message: err.message, details })
  }
  if (err instanceof UnauthorizedError) return reply.code(401).send({ code: UNAUTHORIZED, message: err.message })
  if (err instanceof ForbiddenError) return reply.code(403).send({ code: FORBIDDEN, message: err.message })
  if (err instanceof NotFoundError) return reply.code(404).send({ code: NOT_FOUND, message: err.message })
  if (err instanceof ConflictError) return reply.code(409).send({ code: CONFLICT, message: err.message })
  // Framework errors (e.g. body too large) carry Fiber's status text, as in the Go service.
  const status = (err as { statusCode?: number }).statusCode
  if (status !== undefined && status >= 400 && status < 500) {
    const message = status === 413 ? 'Request Entity Too Large' : (STATUS_CODES[status] ?? 'Bad Request')
    return reply.code(status).send({ code: VALIDATION, message })
  }
  req.log.error(err, 'internal error')
  return reply.code(500).send({ code: INTERNAL, message: 'internal server error' })
}

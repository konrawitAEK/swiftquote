// End-to-end over Fastify and Postgres. Mirrors backend/go-service/internal/delivery/http/router_test.go
// and the Spring suite so all backends are held to the same behaviour.
// Runs when TEST_DATABASE_URL points at a database migrated with db/migrations (make test-node does this);
// each test restores the seed with db/test/reset_to_seed.sql.
import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AdminService, CatalogService, ClientService, DashboardService } from './admin.js'
import { buildApp } from './app.js'
import { Repository } from './repository.js'
import { AuthService, QuoteService } from './services.js'

const ACME_CLIENT = '00000000-0000-4000-8000-000000000003'
const GLOBEX_CLIENT = '00000000-0000-4000-8000-000000000004'
const TEAM_ALPHA = '00000000-0000-4000-8000-000000000020'
const WO_USER = '00000000-0000-4000-8000-000000000011'
const RM1_USER = '00000000-0000-4000-8000-000000000012'
const ADMIN_USER = '00000000-0000-4000-8000-000000000002'
const CAT_SOFTWARE = '00000000-0000-4000-8000-000000000030'
const CAT_SERVICES = '00000000-0000-4000-8000-000000000031'
const CAT_HARDWARE = '00000000-0000-4000-8000-000000000032'
const PROD_CRM = '00000000-0000-4000-8000-000000000040' // Software, 4500 / cost 1800, untracked
const PROD_CONSULTING = '00000000-0000-4000-8000-000000000043' // Services, 2000 / cost 900, untracked
const PROD_LAPTOP = '00000000-0000-4000-8000-000000000044' // Hardware, 32900 / cost 26500, stock 25
const PROD_MOUSE = '00000000-0000-4000-8000-000000000045' // Hardware, 590 / cost 310, stock 200
const UNKNOWN = '00000000-0000-4000-8000-0000000000ff'

const RM1 = 'rm1@swiftquote.dev'
const WO = 'wo@swiftquote.dev'
const ADMIN = 'demo@swiftquote.dev'
const WOC = 'woc@swiftquote.dev'
const ACME_BUYER = 'buyer@acme.example'

const DB_URL = process.env.TEST_DATABASE_URL
const RESET_SQL = readFileSync(new URL('../../../db/test/reset_to_seed.sql', import.meta.url), 'utf8')

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

const inAMonth = () => {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() + 1)
  return d.toISOString().slice(0, 10)
}

const quoteBody = (quoteNumber: string): Json => ({
  clientId: ACME_CLIENT,
  quoteNumber,
  expiryDate: inAMonth(),
  items: [
    { productId: PROD_CONSULTING, quantity: 2, unitPrice: 100, discountValue: 10 },
    { productId: PROD_CRM, quantity: 1, unitPrice: 1.5 },
  ],
})

/** A quote of laptops and mice at list price (tracked stock). */
const stockBody = (quoteNumber: string, laptops: number, mice = 1): Json => ({
  ...quoteBody(quoteNumber),
  items: [
    { productId: PROD_MOUSE, quantity: mice },
    { productId: PROD_LAPTOP, quantity: laptops },
  ],
})

const actions = (q: Json) => (q.history as Json[]).map((e) => e.action)
const measure = (m: Json) => `${m.count}/${m.amount}`
const sign = { signerName: 'Alice Acme', signatureDataUrl: 'data:image/png;base64,AAAA' }

describe.skipIf(!DB_URL)('API (Postgres)', () => {
  let pool: pg.Pool
  let app: FastifyInstance
  let tokens: Map<string, string>

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL })
    const repo = new Repository(pool)
    app = await buildApp({
      repo,
      auth: new AuthService(repo, 'test-secret-at-least-32-bytes-long'),
      quotes: new QuoteService(repo),
      admin: new AdminService(repo),
      catalog: new CatalogService(repo),
      clients: new ClientService(repo),
      dashboard: new DashboardService(repo),
      corsOrigins: ['http://localhost:3000'],
    })
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query(RESET_SQL)
    tokens = new Map()
  })

  async function call(method: Method, url: string, token?: string, body?: unknown, raw?: string) {
    const res = await app.inject({
      method,
      url,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      payload: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    })
    const isJson = String(res.headers['content-type'] ?? '').startsWith('application/json')
    const json = isJson && res.body ? (JSON.parse(res.body) as Json) : {}
    return { status: res.statusCode, raw: res.body, json, headers: res.headers, bytes: res.rawPayload }
  }

  /** Logs in once per email (password "password") and returns the token. */
  async function as(email: string): Promise<string> {
    const cached = tokens.get(email)
    if (cached) return cached
    const res = await call('POST', '/api/v1/auth/login', undefined, { email, password: 'password' })
    expect(res.status, `login ${email}: ${res.raw}`).toBe(200)
    tokens.set(email, res.json.accessToken)
    return res.json.accessToken
  }

  /** Asserts a status and, for errors, the ErrorResponse code; returns the decoded body. */
  async function expectStatus(status: number, code: string, method: Method, url: string, token?: string, body?: unknown) {
    const res = await call(method, url, token, body)
    expect(res.status, `${method} ${url}: ${res.raw}`).toBe(status)
    if (code) expect(res.json.code, `${method} ${url}: ${res.raw}`).toBe(code)
    return res.json
  }

  async function create(email: string, number: string): Promise<string> {
    return (await expectStatus(201, '', 'POST', '/api/v1/quotes', await as(email), quoteBody(number))).id
  }

  /** A new quote by rm1, approved by wo and sent; returns id and access token. */
  async function sent(number: string): Promise<[string, string]> {
    const id = await create(RM1, number)
    await expectStatus(200, '', 'POST', `/api/v1/quotes/${id}/submit`, await as(RM1))
    await expectStatus(200, '', 'POST', `/api/v1/quotes/${id}/approve`, await as(WO))
    const q = await expectStatus(200, '', 'POST', `/api/v1/quotes/${id}/send`, await as(RM1))
    return [id, q.accessToken]
  }

  it('runs the workflow from draft to accepted', async () => {
    const rm = await as(RM1)
    const wo = await as(WO)

    const created = await call('POST', '/api/v1/quotes', rm, quoteBody('Q-001'))
    expect(created.status, created.raw).toBe(201)
    // Money is rendered with exactly two decimals, as the Go service does.
    for (const s of ['"subtotal":201.50', '"discountAmount":20.00', '"taxAmount":12.71', '"grandTotal":194.21',
      '"signedAt":null', '"signedBy":null', '"quantity":2.00', '"description":null']) {
      expect(created.raw).toContain(s)
    }
    let q = created.json
    const { id, accessToken: link } = q
    expect(q).toMatchObject({ status: 'draft', clientId: ACME_CLIENT, clientName: 'Acme Corporation', expiryDate: inAMonth() })
    expect(q.createdBy).toEqual({ id: RM1_USER, name: 'Nok Rattana' })
    expect(q.items[0].category).toEqual({ id: CAT_SERVICES, name: 'Services' })
    expect(q.items[0]).toMatchObject({ product: { id: PROD_CONSULTING, name: 'Consulting (per hour)' }, title: 'Consulting (per hour)' })
    expect(Object.keys(q.items[0])).toEqual(['product', 'title', 'category', 'description', 'quantity', 'unitPrice',
      'discountType', 'discountValue', 'discountAmount', 'taxPercent', 'lineTotal', 'unitCost', 'costTotal', 'profit'])
    // Cost 2 x 900 + 1 x 1800 = 3600; profit = 181.50 - 3600.
    for (const s of ['"discountType":"percent","discountValue":10.00,"discountAmount":20.00', '"unitCost":900.00',
      '"costTotal":1800.00,"profit":-1620.00', '"grandTotal":194.21,"costTotal":3600.00,"profit":-3418.50,"accessToken"']) {
      expect(created.raw).toContain(s)
    }
    expect(actions(q)).toEqual(['created'])
    expect(q.history[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)

    // Drafts are not reachable through the share link.
    await expectStatus(404, 'NOT_FOUND', 'GET', `/api/v1/public/quotes/${link}`)

    await expectStatus(200, '', 'POST', `/api/v1/quotes/${id}/submit`, rm)
    const locked = await expectStatus(409, 'CONFLICT', 'PUT', `/api/v1/quotes/${id}`, rm, quoteBody('Q-001'))
    expect(locked.message).toBe('conflict: cannot edit a quote that is pending_approval')
    await expectStatus(404, 'NOT_FOUND', 'POST', `/api/v1/quotes/${id}/approve`, await as('wo2@swiftquote.dev'))
    const blank = await expectStatus(400, 'VALIDATION_ERROR', 'POST', `/api/v1/quotes/${id}/return`, wo, { comment: '  ' })
    expect(blank.details).toEqual(['comment is required'])
    q = await expectStatus(200, '', 'POST', `/api/v1/quotes/${id}/return`, wo, { comment: 'Discount too high' })
    expect(q.status).toBe('draft')
    expect(q.history[2]).toMatchObject({ action: 'returned', comment: 'Discount too high', actor: { id: WO_USER, name: 'Somchai Wong' } })

    const body = quoteBody('Q-001')
    body.items = [{ productId: PROD_CONSULTING, quantity: 2, unitPrice: 100, discountValue: 5 }]
    const edited = await call('PUT', `/api/v1/quotes/${id}`, rm, body)
    expect(edited.raw).toContain('"grandTotal":203.30')

    const early = await expectStatus(409, 'CONFLICT', 'POST', `/api/v1/quotes/${id}/send`, rm)
    expect(early.message).toBe('conflict: cannot send a quote that is draft')
    await expectStatus(200, '', 'POST', `/api/v1/quotes/${id}/submit`, rm, { comment: 'Reduced discount' })
    await expectStatus(200, '', 'POST', `/api/v1/quotes/${id}/approve`, wo)
    q = await expectStatus(200, '', 'POST', `/api/v1/quotes/${id}/send`, rm)
    expect(actions(q)).toEqual(['created', 'submitted', 'returned', 'updated', 'submitted', 'approved', 'sent'])

    // The customer of another client cannot see it; Acme's customer can, and opening it marks it viewed.
    await expectStatus(404, 'NOT_FOUND', 'GET', `/api/v1/quotes/${id}`, await as('buyer@globex.example'))
    const customer = await as(ACME_BUYER)
    expect((await call('GET', '/api/v1/quotes', customer)).json).toHaveLength(1)
    const viewed = await call('GET', `/api/v1/quotes/${id}`, customer)
    q = viewed.json
    expect(q.status).toBe('viewed')
    // Cost and profit are omitted for customers, not just null.
    expect(viewed.raw).not.toMatch(/unitCost|costTotal|profit/)
    expect(Object.keys(q.items[0])).toEqual(['product', 'title', 'category', 'description', 'quantity', 'unitPrice',
      'discountType', 'discountValue', 'discountAmount', 'taxPercent', 'lineTotal'])
    expect(actions(q)).toEqual(['sent', 'viewed'])

    const forbidden = await expectStatus(403, 'FORBIDDEN', 'POST', `/api/v1/quotes/${id}/accept`, rm, sign)
    expect(forbidden.message).toBe('forbidden: your role cannot perform this action')
    const accepted = await call('POST', `/api/v1/quotes/${id}/accept`, customer, sign)
    q = accepted.json
    expect(q).toMatchObject({ status: 'accepted', signedBy: 'Alice Acme' })
    expect(accepted.raw).not.toMatch(/unitCost|costTotal|profit/)
    expect(q.signedAt).toMatch(/Z$/)
    const again = await expectStatus(409, 'CONFLICT', 'POST', `/api/v1/quotes/${id}/accept`, customer, sign)
    expect(again.message).toBe('conflict: cannot accept a quote that is accepted')

    q = await expectStatus(200, '', 'GET', `/api/v1/quotes/${id}`, rm)
    expect(actions(q)).toEqual(
      ['created', 'submitted', 'returned', 'updated', 'submitted', 'approved', 'sent', 'viewed', 'accepted'])
  })

  it('scopes quote visibility by role', async () => {
    await create(RM1, 'Q-RM1')
    await create('rm3@swiftquote.dev', 'Q-RM3')
    const want: Record<string, string[]> = {
      [RM1]: ['Q-RM1'],
      'rm2@swiftquote.dev': [],
      'rm3@swiftquote.dev': ['Q-RM3'],
      [WO]: ['Q-RM1'],
      'wo2@swiftquote.dev': ['Q-RM3'],
      [WOC]: ['Q-RM3', 'Q-RM1'],
      [ACME_BUYER]: [],
      'buyer@globex.example': [],
    }
    for (const [email, numbers] of Object.entries(want)) {
      const res = await call('GET', '/api/v1/quotes', await as(email))
      expect(res.status).toBe(200)
      expect(res.json.map((q: Json) => q.quoteNumber), email).toEqual(numbers)
    }
    const list = await call('GET', '/api/v1/quotes', await as(WOC))
    expect(list.json[1].createdBy).toEqual({ id: RM1_USER, name: 'Nok Rattana' })
    await expectStatus(403, 'FORBIDDEN', 'GET', '/api/v1/quotes', await as(ADMIN))
  })

  it('enforces role permissions', async () => {
    const id = await create(RM1, 'Q-PERM')
    const cases: [string, Method, string, string, unknown][] = [
      ['wo cannot create', 'POST', '/api/v1/quotes', WO, quoteBody('X')],
      ['woc cannot create', 'POST', '/api/v1/quotes', WOC, quoteBody('X')],
      ['admin cannot create', 'POST', '/api/v1/quotes', ADMIN, quoteBody('X')],
      ['customer cannot create', 'POST', '/api/v1/quotes', ACME_BUYER, quoteBody('X')],
      ['admin cannot read quotes', 'GET', `/api/v1/quotes/${id}`, ADMIN, undefined],
      ['woc cannot approve', 'POST', `/api/v1/quotes/${id}/approve`, WOC, undefined],
      ['rm cannot approve', 'POST', `/api/v1/quotes/${id}/approve`, RM1, undefined],
      ['wo cannot submit', 'POST', `/api/v1/quotes/${id}/submit`, WO, undefined],
      ['wo cannot list clients', 'GET', '/api/v1/clients', WO, undefined],
      ['rm cannot see dashboard', 'GET', '/api/v1/dashboard/summary', RM1, undefined],
      ['admin cannot see dashboard', 'GET', '/api/v1/dashboard/summary', ADMIN, undefined],
      ['woc cannot manage users', 'GET', '/api/v1/admin/users', WOC, undefined],
      ['rm cannot manage teams', 'POST', '/api/v1/admin/teams', RM1, { name: 'X', woUserId: WO_USER }],
    ]
    for (const [name, method, url, email, body] of cases) {
      const res = await call(method, url, await as(email), body)
      expect([res.status, res.json.code], name).toEqual([403, 'FORBIDDEN'])
    }
  })

  it('requires a team led by a WO to submit', async () => {
    await expectStatus(201, '', 'POST', '/api/v1/admin/users', await as(ADMIN),
      { email: 'Solo@SwiftQuote.dev', name: 'Solo RM', password: 'password', role: 'rm' })
    const id = await create('solo@swiftquote.dev', 'Q-SOLO')
    const res = await expectStatus(409, 'CONFLICT', 'POST', `/api/v1/quotes/${id}/submit`, await as('solo@swiftquote.dev'))
    expect(res.message).toBe('conflict: you must be in a team led by a WO to submit')
  })

  it('serves the public share link', async () => {
    const [, link] = await sent('Q-LINK')

    const v = await call('GET', `/api/v1/public/quotes/${link}`)
    expect(v.status).toBe(200)
    expect(v.raw).not.toMatch(/unitCost|costTotal|profit/)
    expect(v.raw).toContain('"vendorLogo":null')
    expect(v.json).toMatchObject({ status: 'viewed', vendorName: 'Demo Co., Ltd.', signedBy: null })
    const rejected = await call('POST', `/api/v1/public/quotes/${link}/reject`, undefined, { comment: 'Too expensive' })
    const q = rejected.json
    expect(q.status).toBe('rejected')
    expect(rejected.raw).not.toMatch(/unitCost|costTotal|profit/)
    expect(actions(q)).toEqual(['sent', 'viewed', 'rejected'])
    expect(q.history.at(-1)).toMatchObject({ comment: 'Too expensive', actor: null })
    const res = await expectStatus(409, 'CONFLICT', 'POST', `/api/v1/public/quotes/${link}/accept`, undefined,
      { signerName: 'A', signatureDataUrl: 'data:x' })
    expect(res.message).toBe('conflict: cannot accept a quote that is rejected')
    const bad = await expectStatus(404, 'NOT_FOUND', 'GET', '/api/v1/public/quotes/not-a-uuid')
    expect(bad.message).toBe('not found: quote expired or not found')
    // Signature validation comes before the lookup.
    await expectStatus(400, 'VALIDATION_ERROR', 'POST', '/api/v1/public/quotes/not-a-uuid/accept', undefined, { signerName: 'A' })
  })

  it('accepts through the share link', async () => {
    const [, link] = await sent('Q-SIGN')
    const q = await expectStatus(200, '', 'POST', `/api/v1/public/quotes/${link}/accept`, undefined, sign)
    expect(q).toMatchObject({ status: 'accepted', signedBy: 'Alice Acme' })
    expect(actions(q)).toEqual(['sent', 'accepted'])
    const after = await expectStatus(200, '', 'GET', `/api/v1/public/quotes/${link}`)
    expect(after).toMatchObject({ status: 'accepted', signedBy: 'Alice Acme' })
  })

  it('refuses to send an expired quote and hides it from the link', async () => {
    const id = await create(RM1, 'Q-OLD')
    await pool.query(`UPDATE quotes SET status = 'approved', expiry_date = current_date - 1 WHERE id = $1`, [id])
    const res = await expectStatus(409, 'CONFLICT', 'POST', `/api/v1/quotes/${id}/send`, await as(RM1))
    expect(res.message).toBe('conflict: quote has expired')

    const { rows } = await pool.query(`UPDATE quotes SET status = 'sent' WHERE id = $1 RETURNING access_token`, [id])
    await expectStatus(404, 'NOT_FOUND', 'GET', `/api/v1/public/quotes/${rows[0].access_token}`)
    const expired = await expectStatus(409, 'CONFLICT', 'POST', `/api/v1/quotes/${id}/accept`, await as(ACME_BUYER), sign)
    expect(expired.message).toBe('conflict: quote has expired')
  })

  it('lets admins manage users and teams', async () => {
    const adm = await as(ADMIN)

    expect((await call('GET', '/api/v1/admin/users', adm)).json).toHaveLength(9)

    const u = await expectStatus(201, '', 'POST', '/api/v1/admin/users', adm,
      { email: 'new.rm@swiftquote.dev', name: 'New RM', password: 'password1', role: 'rm', teamId: TEAM_ALPHA })
    expect(u).toMatchObject({ email: 'new.rm@swiftquote.dev', role: 'rm', active: true, client: null })
    expect(u.team.name).toBe('Team Alpha')
    const dup = await expectStatus(409, 'CONFLICT', 'POST', '/api/v1/admin/users', adm,
      { email: 'NEW.RM@swiftquote.dev', name: 'Dup', password: 'password1', role: 'rm' })
    expect(dup.message).toBe('conflict: email "new.rm@swiftquote.dev" already exists')

    const invalid: [Json, string[]][] = [
      [{ email: 'a@b.c', name: 'A', password: 'short', role: 'rm' }, ['password must be at least 8 characters']],
      [{ email: 'a@b.c', name: 'A', password: 'password', role: 'boss' }, ['role "boss" is not a valid Role']],
      [{ email: 'a@b.c', name: 'A', password: 'password', role: 'customer' }, ['clientId is required for customer']],
      [{ email: 'a@b.c', name: 'A', password: 'password', role: 'wo', teamId: TEAM_ALPHA }, ['teamId is only allowed for rm']],
      [{ email: 'a@b.c', name: 'A', password: 'password', role: 'rm', clientId: GLOBEX_CLIENT },
        ['clientId is only allowed for customer']],
      [{ name: '', role: 'customer', teamId: UNKNOWN, clientId: UNKNOWN },
        ['email is required', 'password must be at least 8 characters', 'name is required', 'teamId is only allowed for rm']],
      [{ email: 'nope', name: 'A', password: 'password', role: 'rm', teamId: UNKNOWN }, ['email is not valid']],
      [{ email: 'a@b.c', name: 'A', password: 'password', role: 'rm', teamId: UNKNOWN }, ['teamId does not exist']],
    ]
    for (const [body, details] of invalid) {
      const res = await expectStatus(400, 'VALIDATION_ERROR', 'POST', '/api/v1/admin/users', adm, body)
      expect(res.details).toEqual(details)
    }

    const self = await expectStatus(400, 'VALIDATION_ERROR', 'PUT', `/api/v1/admin/users/${ADMIN_USER}`, adm,
      { name: 'Demo Admin', role: 'admin', active: false })
    expect(self.details).toEqual(['you cannot change your own role or deactivate yourself'])
    const leads = await expectStatus(409, 'CONFLICT', 'PUT', `/api/v1/admin/users/${WO_USER}`, adm,
      { name: 'Somchai Wong', role: 'rm', active: true })
    expect(leads.message).toBe('conflict: user leads a team; assign another WO first')
    const missing = await expectStatus(404, 'NOT_FOUND', 'PUT', `/api/v1/admin/users/${UNKNOWN}`, adm,
      { name: 'X', role: 'rm', active: true })
    expect(missing.message).toBe('not found: user not found')

    // Deactivating someone ends their existing session and blocks login.
    const rmToken = await as(RM1)
    const off = await expectStatus(200, '', 'PUT', `/api/v1/admin/users/${RM1_USER}`, adm,
      { name: 'Nok Rattana', role: 'rm', active: false, teamId: TEAM_ALPHA })
    expect(off.active).toBe(false)
    const inactive = await expectStatus(401, 'UNAUTHORIZED', 'GET', '/api/v1/quotes', rmToken)
    expect(inactive.message).toBe('unauthorized: account is inactive')
    await expectStatus(401, 'UNAUTHORIZED', 'POST', '/api/v1/auth/login', undefined, { email: RM1, password: 'password' })

    const notWo = await expectStatus(400, 'VALIDATION_ERROR', 'POST', '/api/v1/admin/teams', adm, { name: 'Gamma', woUserId: RM1_USER })
    expect(notWo.details).toEqual(['woUserId must be an active WO'])
    let team = await expectStatus(201, '', 'POST', '/api/v1/admin/teams', adm,
      { name: 'Gamma', woUserId: '00000000-0000-4000-8000-000000000014' })
    expect(team).toMatchObject({ name: 'Gamma', wo: { name: 'Anan Boon' }, members: [] })
    const dupTeam = await expectStatus(409, 'CONFLICT', 'POST', '/api/v1/admin/teams', adm, { name: 'Team Alpha', woUserId: WO_USER })
    expect(dupTeam.message).toBe('conflict: team "Team Alpha" already exists')
    team = await expectStatus(200, '', 'PUT', `/api/v1/admin/teams/${team.id}`, adm, { name: 'Gamma Team', woUserId: WO_USER })
    expect(team.name).toBe('Gamma Team')
    await expectStatus(404, 'NOT_FOUND', 'PUT', '/api/v1/admin/teams/nope', adm, { name: 'X', woUserId: WO_USER })

    const teams = (await call('GET', '/api/v1/admin/teams', adm)).json
    expect(teams).toHaveLength(3)
    // New RM + Ploy; Nok is inactive.
    expect(teams[1].members.map((m: Json) => m.name)).toEqual(['New RM', 'Ploy Siri'])
  })

  it('deletes users, teams and categories', async () => {
    const adm = await as(ADMIN)
    const rm = await as(RM1)
    const del = (kind: string, id: string, token?: string, raw?: string) =>
      call('POST', `/api/v1/admin/${kind}/${id}/delete`, token, undefined, raw)
    const expectError = async (res: Awaited<ReturnType<typeof del>>, status: number, code: string, message: string) => {
      expect([res.status, res.json.code, res.json.message], res.raw).toEqual([status, code, message])
    }

    for (const kind of ['users', 'teams', 'categories']) {
      await expectError(await del(kind, UNKNOWN), 401, 'UNAUTHORIZED', 'unauthorized: missing bearer token')
      await expectError(await del(kind, UNKNOWN, rm), 403, 'FORBIDDEN', 'forbidden: your role cannot perform this action')
      const noun = { users: 'user', teams: 'team', categories: 'category' }[kind]
      await expectError(await del(kind, UNKNOWN, adm), 404, 'NOT_FOUND', `not found: ${noun} not found`)
      await expectError(await del(kind, 'nope', adm), 404, 'NOT_FOUND', `not found: ${noun} not found`)
      const wrong = await call('GET', `/api/v1/admin/${kind}/${UNKNOWN}/delete`, adm)
      expect([wrong.status, wrong.headers.allow, wrong.json.message]).toEqual([405, 'POST', 'Method Not Allowed'])
    }

    const self = await del('users', ADMIN_USER, adm)
    expect([self.status, self.json.message, self.json.details]).toEqual(
      [400, 'request validation failed', ['you cannot delete yourself']])
    await expectError(await del('users', WO_USER, adm), 409, 'CONFLICT', 'conflict: user leads a team; assign another WO first')
    await expectError(await del('teams', TEAM_ALPHA, adm), 409, 'CONFLICT',
      'conflict: team has members; move them to another team first')

    // A quote gives rm1 history and puts Services and Software on a quote line.
    await create(RM1, 'Q-DEL')
    await expectError(await del('users', RM1_USER, adm), 409, 'CONFLICT', 'conflict: user has quote history; deactivate instead')
    await expectError(await del('categories', CAT_SERVICES, adm), 409, 'CONFLICT',
      'conflict: category is used on quotes; retire it instead')

    // Success with no body (but a JSON Content-Type), {} and malformed JSON: the body is never read.
    const u = await expectStatus(201, '', 'POST', '/api/v1/admin/users', adm,
      { email: 'gone@swiftquote.dev', name: 'Gone', password: 'password', role: 'rm' })
    let res = await del('users', u.id, adm)
    expect([res.status, res.raw]).toEqual([204, ''])
    expect((await pool.query('SELECT 1 FROM users WHERE id = $1', [u.id])).rowCount).toBe(0)
    expect((await call('GET', '/api/v1/admin/users', adm)).json).toHaveLength(9)
    await expectError(await del('users', u.id, adm), 404, 'NOT_FOUND', 'not found: user not found')

    // A team with only an inactive member still has members.
    const team = await expectStatus(201, '', 'POST', '/api/v1/admin/teams', adm,
      { name: 'Gamma', woUserId: '00000000-0000-4000-8000-000000000014' })
    const member = await expectStatus(201, '', 'POST', '/api/v1/admin/users', adm,
      { email: 'idle@swiftquote.dev', name: 'Idle', password: 'password', role: 'rm', teamId: team.id })
    await expectStatus(200, '', 'PUT', `/api/v1/admin/users/${member.id}`, adm,
      { name: 'Idle', role: 'rm', active: false, teamId: team.id })
    await expectError(await del('teams', team.id, adm), 409, 'CONFLICT',
      'conflict: team has members; move them to another team first')
    await expectStatus(200, '', 'PUT', `/api/v1/admin/users/${member.id}`, adm, { name: 'Idle', role: 'rm', active: false })
    res = await del('teams', team.id, adm, '{}')
    expect([res.status, res.raw]).toEqual([204, ''])
    expect((await call('GET', '/api/v1/admin/teams', adm)).json).toHaveLength(2)

    const c = await expectStatus(201, '', 'POST', '/api/v1/admin/categories', adm, { name: 'Disposable' })
    res = await del('categories', c.id, adm, '{not json')
    expect([res.status, res.raw]).toEqual([204, ''])
    expect((await call('GET', '/api/v1/categories', adm)).json).toHaveLength(3)
  })

  it('summarises the dashboard', async () => {
    const customer = await as(ACME_BUYER)
    // Each quote is Consulting (Services) 192.60 + Setup fee (Software) 1.61 = 194.21 incl. VAT.
    const [a] = await sent('Q-A')
    await expectStatus(200, '', 'POST', `/api/v1/quotes/${a}/accept`, customer, sign)
    const [b] = await sent('Q-B')
    await expectStatus(200, '', 'POST', `/api/v1/quotes/${b}/reject`, customer)
    await sent('Q-C') // pending: with the customer
    const d = await create(RM1, 'Q-D')
    await expectStatus(200, '', 'POST', `/api/v1/quotes/${d}/submit`, await as(RM1)) // in approval
    await create('rm3@swiftquote.dev', 'Q-E') // draft, Team Beta

    const woc = await as(WOC)
    const res = await call('GET', '/api/v1/dashboard/summary', woc)
    expect(res.status, res.raw).toBe(200)
    expect(res.raw).toContain('"conversionRate":0.3333')
    expect(res.raw).toContain('"won":{"count":1,"amount":194.21}')
    const s = res.json
    expect(s.from).toBeNull()
    expect(s.to).toBeNull()
    expect(measure(s.won)).toBe('1/194.21')
    expect(measure(s.pending)).toBe('1/194.21')
    expect(measure(s.inApproval)).toBe('1/194.21')
    expect(s.sentCount).toBe(3)
    expect(s.byStatus.map((r: Json) => r.status)).toEqual(
      ['draft', 'pending_approval', 'approved', 'sent', 'viewed', 'accepted', 'rejected', 'expired'])
    expect(s.byStatus[0].count).toBe(1)

    // Won is grouped by signing month (this month), pending by expiry month (next month).
    expect(s.byMonth).toHaveLength(2)
    expect(measure(s.byMonth[0].won)).toBe('1/194.21')
    expect(measure(s.byMonth[1].pending)).toBe('1/194.21')

    expect(s.byRm).toHaveLength(2)
    expect(s.byRm[0]).toMatchObject({ user: { id: RM1_USER, name: 'Nok Rattana' }, team: 'Team Alpha', quoteCount: 4, sentCount: 3 })
    expect(measure(s.byRm[0].pending)).toBe('1/194.21')
    expect(s.byTeam[0].name).toBe('Team Alpha')

    expect(s.byCategory).toHaveLength(2)
    expect(s.byCategory[0].category.name).toBe('Services')
    expect(res.raw).toContain('"won":{"count":1,"amount":192.60}')
    expect(measure(s.byCategory[1].pending)).toBe('1/1.61')

    const future = new Date()
    future.setUTCFullYear(future.getUTCFullYear() + 1)
    const empty = await call('GET', `/api/v1/dashboard/summary?from=${future.toISOString().slice(0, 10)}`, woc)
    expect(empty.json.sentCount).toBe(0)
    expect(empty.raw).toContain('"conversionRate":0.0000')
    expect(empty.json.from).toBe(future.toISOString().slice(0, 10))
    const reversed = await expectStatus(400, 'VALIDATION_ERROR', 'GET', '/api/v1/dashboard/summary?from=2026-12-01&to=2026-01-01', woc)
    expect(reversed.details).toEqual(['from must not be after to'])
    const bad = await expectStatus(400, 'VALIDATION_ERROR', 'GET', '/api/v1/dashboard/summary?from=yesterday', woc)
    expect(bad.details).toEqual(['from must be a date (YYYY-MM-DD)'])
  })

  it('manages categories', async () => {
    const adm = await as(ADMIN)
    const rm = await as(RM1)

    let c = await expectStatus(201, '', 'POST', '/api/v1/admin/categories', adm, { name: ' Training ' })
    expect(c).toMatchObject({ name: 'Training', active: true })
    const training = c.id
    const dup = await expectStatus(409, 'CONFLICT', 'POST', '/api/v1/admin/categories', adm, { name: 'Software' })
    expect(dup.message).toBe('conflict: category "Software" already exists')
    await expectStatus(400, 'VALIDATION_ERROR', 'POST', '/api/v1/admin/categories', adm, { name: '' })
    await expectStatus(403, 'FORBIDDEN', 'POST', '/api/v1/admin/categories', rm, { name: 'X' })
    const noActive = await expectStatus(400, 'VALIDATION_ERROR', 'PUT', `/api/v1/admin/categories/${CAT_SOFTWARE}`, adm, { name: 'Software' })
    expect(noActive.details).toEqual(['active is required'])
    const missing = await expectStatus(404, 'NOT_FOUND', 'PUT', `/api/v1/admin/categories/${UNKNOWN}`, adm, { name: 'X', active: true })
    expect(missing.message).toBe('not found: category not found')

    // Retiring a category keeps it listed but stops RMs from using it.
    c = await expectStatus(200, '', 'PUT', `/api/v1/admin/categories/${CAT_SOFTWARE}`, adm, { name: 'Software', active: false })
    expect(c.active).toBe(false)
    expect((await call('GET', '/api/v1/categories', rm)).json).toHaveLength(4)
    await expectStatus(403, 'FORBIDDEN', 'GET', '/api/v1/categories', await as(WO))

    // A product added to a retired category is refused.
    const retired = await expectStatus(400, 'VALIDATION_ERROR', 'POST', '/api/v1/admin/products', adm,
      { name: 'Box', categoryId: CAT_SOFTWARE, unitPrice: 1, unitCost: 1 })
    expect(retired.details).toEqual(['categoryId is not an active category'])

    // A category used by products (but not on quotes) cannot be deleted.
    const t = await expectStatus(201, '', 'POST', '/api/v1/admin/products', adm,
      { name: 'Workshop', categoryId: training, unitPrice: 10, unitCost: 4 })
    const blocked = await call('POST', `/api/v1/admin/categories/${training}/delete`, adm)
    expect([blocked.status, blocked.json.message]).toEqual(
      [409, 'conflict: category is used by products; move them to another category first'])
    // Used on quotes is reported first.
    const q = await expectStatus(201, '', 'POST', '/api/v1/quotes', rm,
      { ...quoteBody('Q-CAT'), items: [{ productId: t.id, quantity: 1 }] })
    expect(q.items[0]).toMatchObject({ title: 'Workshop', category: { id: training, name: 'Training' }, unitPrice: 10 })
    const onQuotes = await call('POST', `/api/v1/admin/categories/${training}/delete`, adm)
    expect([onQuotes.status, onQuotes.json.message]).toEqual([409, 'conflict: category is used on quotes; retire it instead'])
  })

  it('maps errors like the Go service', async () => {
    const rm = await as(RM1)
    await create(RM1, 'Q-DUP')
    const withField = (key: string, value: unknown) => ({ ...quoteBody('Q-X'), [key]: value })
    const cases: [string, Method, string, string | undefined, unknown, number, string, string?, string[]?][] = [
      ['wrong password', 'POST', '/api/v1/auth/login', undefined, { email: RM1, password: 'nope' }, 401, 'UNAUTHORIZED',
        'unauthorized: invalid email or password'],
      ['no token', 'GET', '/api/v1/quotes', undefined, undefined, 401, 'UNAUTHORIZED', 'unauthorized: missing bearer token'],
      ['bad token', 'GET', '/api/v1/quotes', 'garbage', undefined, 401, 'UNAUTHORIZED', 'unauthorized: invalid or expired token'],
      ['unknown route', 'GET', '/api/v1/nope', undefined, undefined, 404, 'NOT_FOUND', 'route not found'],
      ['wrong method', 'DELETE', '/api/v1/quotes', undefined, undefined, 405, 'VALIDATION_ERROR', 'Method Not Allowed'],
      ['invalid status filter', 'GET', '/api/v1/quotes?status=bogus', rm, undefined, 400, 'VALIDATION_ERROR',
        'request validation failed', ['status "bogus" is not a valid QuoteStatus']],
      ['duplicate number', 'POST', '/api/v1/quotes', rm, quoteBody('Q-DUP'), 409, 'CONFLICT', 'conflict: quoteNumber "Q-DUP" already exists'],
      ['missing fields', 'POST', '/api/v1/quotes', rm, { quoteNumber: ' ', items: [{ title: '', discountType: 'fixed' }] }, 400,
        'VALIDATION_ERROR', 'request validation failed', ['clientId is required', 'expiryDate is required',
          'items[0].productId is required', 'items[0].quantity is required',
          'items[0].discountType "fixed" is not a valid DiscountType']],
      ['invalid values', 'POST', '/api/v1/quotes', rm, withField('items', [
        { productId: PROD_CONSULTING, quantity: 0.5, unitPrice: -1, discountValue: 101 }]), 400, 'VALIDATION_ERROR',
        'request validation failed', ['items[0]: quantity must be at least 1']],
      ['unknown product then pricing', 'POST', '/api/v1/quotes', rm, { ...withField('items', [
        { productId: UNKNOWN, quantity: 1 }, { productId: PROD_CRM, quantity: 1, discountValue: -1 }]), quoteNumber: '' }, 400,
        'VALIDATION_ERROR', 'request validation failed', ['quoteNumber is required', 'items[0].productId is not an active product']],
      ['amount above the line', 'POST', '/api/v1/quotes', rm, withField('items', [
        { productId: PROD_CRM, quantity: 2, unitPrice: 50, discountType: 'amount', discountValue: 100.005 }]), 400,
        'VALIDATION_ERROR', 'request validation failed', ['items[0]: discountValue must not exceed the line amount']],
      ['percent above 100', 'POST', '/api/v1/quotes', rm, withField('items', [
        { productId: PROD_CRM, quantity: 1, discountValue: 100.01 }]), 400,
        'VALIDATION_ERROR', 'request validation failed', ['items[0]: discountValue must be between 0 and 100']],
      ['discountType type', 'POST', '/api/v1/quotes', rm, withField('items', [{ productId: PROD_CRM, quantity: 1, discountType: 1 }]),
        400, 'VALIDATION_ERROR', 'request validation failed',
        ['malformed JSON body: json: cannot unmarshal number into Go struct field quoteItemInput.items.discountType of type string']],
      ['no items', 'POST', '/api/v1/quotes', rm, withField('items', []), 400, 'VALIDATION_ERROR', 'request validation failed',
        ['quote must have at least one item']],
      ['past expiry', 'POST', '/api/v1/quotes', rm, { ...withField('expiryDate', '2000-01-01'), quoteNumber: '' }, 400,
        'VALIDATION_ERROR', 'request validation failed', ['quoteNumber is required', 'expiryDate must not be in the past']],
      ['bad date', 'POST', '/api/v1/quotes', rm, withField('expiryDate', '01/01/2099'), 400, 'VALIDATION_ERROR',
        'request validation failed',
        ['malformed JSON body: parsing time "01/01/2099" as "2006-01-02": cannot parse "01/01/2099" as "2006"']],
      ['other tenant client', 'POST', '/api/v1/quotes', rm, withField('clientId', UNKNOWN), 400, 'VALIDATION_ERROR',
        'request validation failed', ['clientId does not exist']],
      ['unknown quote', 'GET', `/api/v1/quotes/${UNKNOWN}`, rm, undefined, 404, 'NOT_FOUND', 'not found: quote not found'],
      ['malformed quote id', 'GET', '/api/v1/quotes/nope', rm, undefined, 404, 'NOT_FOUND', 'not found: quote not found'],
      ['malformed id after role check', 'POST', '/api/v1/quotes/nope/approve', rm, undefined, 403, 'FORBIDDEN'],
    ]
    for (const [name, method, url, token, body, status, code, message, details] of cases) {
      const res = await call(method, url, token, body)
      expect([res.status, res.json.code], `${name}: ${res.raw}`).toEqual([status, code])
      expect(res.json.message, name).toBe(message ?? 'forbidden: your role cannot perform this action')
      expect(res.json.details, name).toEqual(details)
    }

    const malformed = await call('POST', '/api/v1/quotes', rm, undefined, '{not json')
    expect(malformed.status).toBe(400)
    expect(malformed.json.details).toEqual(["malformed JSON body: invalid character 'n' looking for beginning of object key string"])
    // The session is checked before the body.
    expect((await call('POST', '/api/v1/quotes', undefined, undefined, '{not json')).status).toBe(401)
    const allow = await call('DELETE', '/api/v1/quotes/x')
    expect(allow.headers.allow).toBe('GET, HEAD, PUT')
  })

  it('keeps decimal input exact (no float rounding)', async () => {
    const body = quoteBody('Q-EXACT')
    body.items = [{ productId: PROD_CONSULTING, quantity: '3', unitPrice: 33.33, discountValue: 15 }]
    const res = await call('POST', '/api/v1/quotes', await as(RM1), body)
    expect(res.status, res.raw).toBe(201)
    expect(res.raw).toContain('"grandTotal":90.94')
  })
  it('lists and manages products', async () => {
    const adm = await as(ADMIN)
    for (const email of [ADMIN, WOC, WO, RM1]) {
      const res = await call('GET', '/api/v1/products', await as(email))
      expect(res.status, email).toBe(200)
      expect(res.json).toHaveLength(6)
    }
    const list = await call('GET', '/api/v1/products', await as(RM1))
    expect(list.raw).toContain(`{"id":"${PROD_LAPTOP}","name":"Laptop 14-inch","category":{"id":"${CAT_HARDWARE}",`
      + '"name":"Hardware"},"unitPrice":32900.00,"unitCost":26500.00,"stock":25.00,"active":true}')
    expect(list.raw).toContain('"name":"Website redesign","category":{"id":"00000000-0000-4000-8000-000000000031","name":"Services"},'
      + '"unitPrice":45000.00,"unitCost":28000.00,"stock":null,"active":true}')
    expect((await call('GET', '/api/v1/products', await as(ACME_BUYER))).status).toBe(403)

    const p = await call('POST', '/api/v1/admin/products', adm,
      { name: '  USB-C dock ', categoryId: CAT_HARDWARE, unitPrice: 2490, unitCost: 1500.5, stock: 3.5 })
    expect(p.status, p.raw).toBe(201)
    expect(p.raw).toContain('"name":"USB-C dock","category":{"id":"00000000-0000-4000-8000-000000000032","name":"Hardware"},'
      + '"unitPrice":2490.00,"unitCost":1500.50,"stock":3.50,"active":true}')
    const untracked = await expectStatus(201, '', 'POST', '/api/v1/admin/products', adm,
      { name: 'Training day', categoryId: CAT_SERVICES, unitPrice: 0, unitCost: 0, stock: null })
    expect(untracked.stock).toBeNull()
    const dup = await expectStatus(409, 'CONFLICT', 'POST', '/api/v1/admin/products', adm,
      { name: 'Wireless mouse', categoryId: CAT_HARDWARE, unitPrice: 1, unitCost: 1 })
    expect(dup.message).toBe('conflict: product "Wireless mouse" already exists')

    const invalid: [string, Json, string[]][] = [
      ['POST', {}, ['name is required', 'categoryId is required', 'unitPrice is required', 'unitCost is required']],
      ['POST', { name: 'X', categoryId: CAT_HARDWARE, unitPrice: -1, unitCost: -0.01, stock: -1 },
        ['unitPrice must not be negative', 'unitCost must not be negative', 'stock must not be negative']],
      ['POST', { name: 'X', categoryId: UNKNOWN, unitPrice: 1, unitCost: 1 }, ['categoryId is not an active category']],
      ['PUT', { name: 'X', categoryId: CAT_HARDWARE, unitPrice: 1, unitCost: 1 }, ['active is required']],
      ['PUT', { name: 'X', unitPrice: -1 }, ['categoryId is required', 'unitCost is required', 'unitPrice must not be negative',
        'active is required']],
      ['PUT', { name: ' ', categoryId: UNKNOWN, unitPrice: 1, unitCost: 1, active: true }, ['name is required']],
    ]
    for (const [method, body, details] of invalid) {
      const url = method === 'POST' ? '/api/v1/admin/products' : `/api/v1/admin/products/${p.json.id}`
      const res = await expectStatus(400, 'VALIDATION_ERROR', method as Method, url, adm, body)
      expect(res.details, JSON.stringify(body)).toEqual(details)
    }

    const rm = await as(RM1)
    await expectStatus(403, 'FORBIDDEN', 'POST', '/api/v1/admin/products', rm, { name: 'X' })
    await expectStatus(403, 'FORBIDDEN', 'PUT', `/api/v1/admin/products/${UNKNOWN}`, rm, {})
    await expectStatus(403, 'FORBIDDEN', 'POST', `/api/v1/admin/products/${UNKNOWN}/delete`, await as(WOC))
    const missing = await expectStatus(404, 'NOT_FOUND', 'PUT', `/api/v1/admin/products/${UNKNOWN}`, adm, {})
    expect(missing.message).toBe('not found: product not found')
    const dupPut = await expectStatus(409, 'CONFLICT', 'PUT', `/api/v1/admin/products/${p.json.id}`, adm,
      { name: 'Laptop 14-inch', categoryId: CAT_HARDWARE, unitPrice: 1, unitCost: 1, active: true })
    expect(dupPut.message).toBe('conflict: product "Laptop 14-inch" already exists')

    // A line keeps the cost it was saved with; retiring the product stops new lines using it.
    const q = await expectStatus(201, '', 'POST', '/api/v1/quotes', rm,
      { ...quoteBody('Q-PROD'), items: [{ productId: p.json.id, quantity: 2, discountType: 'amount', discountValue: 90 }] })
    expect(q.items[0]).toMatchObject({ title: 'USB-C dock', unitPrice: 2490, discountType: 'amount', discountValue: 90,
      discountAmount: 90, lineTotal: 4890, unitCost: 1500.5, costTotal: 3001, profit: 1889 })
    const put = await expectStatus(200, '', 'PUT', `/api/v1/admin/products/${p.json.id}`, adm,
      { name: 'USB-C dock', categoryId: CAT_HARDWARE, unitPrice: 2590, unitCost: 1600, stock: null, active: false })
    expect(put).toMatchObject({ unitPrice: 2590, unitCost: 1600, stock: null, active: false })
    expect((await expectStatus(200, '', 'GET', `/api/v1/quotes/${q.id}`, rm)).items[0].unitCost).toBe(1500.5)
    const retired = await expectStatus(400, 'VALIDATION_ERROR', 'POST', '/api/v1/quotes', rm,
      { ...quoteBody('Q-RETIRED'), items: [{ productId: p.json.id, quantity: 1 }] })
    expect(retired.details).toEqual(['items[0].productId is not an active product'])
    expect((await call('GET', '/api/v1/products', rm)).json).toHaveLength(8)

    // Delete: used on quotes, unknown, wrong method, then success with any body.
    const del = (id: string, raw?: string) => call('POST', `/api/v1/admin/products/${id}/delete`, adm, undefined, raw)
    let res = await del(p.json.id)
    expect([res.status, res.json.message]).toEqual([409, 'conflict: product is used on quotes; retire it instead'])
    res = await del(UNKNOWN)
    expect([res.status, res.json.message]).toEqual([404, 'not found: product not found'])
    res = await del('nope')
    expect(res.status).toBe(404)
    const wrong = await call('GET', `/api/v1/admin/products/${UNKNOWN}/delete`, adm)
    expect([wrong.status, wrong.headers.allow]).toEqual([405, 'POST'])
    const wrongList = await call('GET', '/api/v1/admin/products', adm)
    expect([wrongList.status, wrongList.headers.allow]).toEqual([405, 'POST'])
    res = await del(untracked.id, '{not json')
    expect([res.status, res.raw]).toEqual([204, ''])
    expect((await call('GET', '/api/v1/products', adm)).json).toHaveLength(7)
  })

  it('checks stock on submit and send and deducts it on accept', async () => {
    const rm = await as(RM1)
    const wo = await as(WO)
    const stock = async (id: string) => (await pool.query('SELECT stock FROM products WHERE id = $1', [id])).rows[0].stock

    // Submit: the quote's total per product, first failing product in line order.
    let id = await expectStatus(201, '', 'POST', '/api/v1/quotes', rm, stockBody('Q-S1', 26)).then((q) => q.id)
    let res = await expectStatus(409, 'CONFLICT', 'POST', `/api/v1/quotes/${id}/submit`, rm)
    expect(res.message).toBe('conflict: not enough stock for Laptop 14-inch (available 25)')
    id = await expectStatus(201, '', 'POST', '/api/v1/quotes', rm, stockBody('Q-S2', 26, 201)).then((q) => q.id)
    res = await expectStatus(409, 'CONFLICT', 'POST', `/api/v1/quotes/${id}/submit`, rm)
    expect(res.message).toBe('conflict: not enough stock for Wireless mouse (available 200)')
    const split = { ...stockBody('Q-S3', 20), items: [{ productId: PROD_LAPTOP, quantity: 20 }, { productId: PROD_LAPTOP, quantity: 6 }] }
    id = await expectStatus(201, '', 'POST', '/api/v1/quotes', rm, split).then((q) => q.id)
    res = await expectStatus(409, 'CONFLICT', 'POST', `/api/v1/quotes/${id}/submit`, rm)
    expect(res.message).toBe('conflict: not enough stock for Laptop 14-inch (available 25)')
    // Role and state come first.
    await expectStatus(403, 'FORBIDDEN', 'POST', `/api/v1/quotes/${id}/submit`, wo)

    // Send: stock may have changed since approval.
    const [a] = await sent('Q-A') // untracked products only
    id = await expectStatus(201, '', 'POST', '/api/v1/quotes', rm, stockBody('Q-S4', 20)).then((q) => q.id)
    await expectStatus(200, '', 'POST', `/api/v1/quotes/${id}/submit`, rm)
    await expectStatus(200, '', 'POST', `/api/v1/quotes/${id}/approve`, wo)
    await pool.query(`UPDATE products SET stock = 2.5 WHERE id = $1`, [PROD_LAPTOP])
    res = await expectStatus(409, 'CONFLICT', 'POST', `/api/v1/quotes/${id}/send`, rm)
    expect(res.message).toBe('conflict: not enough stock for Laptop 14-inch (available 2.5)')
    await pool.query(`UPDATE products SET stock = 25 WHERE id = $1`, [PROD_LAPTOP])
    const s4 = await expectStatus(200, '', 'POST', `/api/v1/quotes/${id}/send`, rm)

    // A second quote for 10 more laptops is sent while 25 are in stock.
    const s5 = await expectStatus(201, '', 'POST', '/api/v1/quotes', rm, stockBody('Q-S5', 10)).then((q) => q.id)
    await expectStatus(200, '', 'POST', `/api/v1/quotes/${s5}/submit`, rm)
    await expectStatus(200, '', 'POST', `/api/v1/quotes/${s5}/approve`, wo)
    const s5Link = (await expectStatus(200, '', 'POST', `/api/v1/quotes/${s5}/send`, rm)).accessToken

    // Accepting deducts stock; untracked products are ignored.
    const customer = await as(ACME_BUYER)
    await expectStatus(200, '', 'POST', `/api/v1/quotes/${a}/accept`, customer, sign)
    await expectStatus(200, '', 'POST', `/api/v1/public/quotes/${s4.accessToken}/accept`, undefined, sign)
    expect([await stock(PROD_LAPTOP), await stock(PROD_MOUSE)]).toEqual(['5.00', '199.00'])

    // Not enough left: 409 and nothing changes (status, signature, stock).
    res = await expectStatus(409, 'CONFLICT', 'POST', `/api/v1/quotes/${s5}/accept`, customer, sign)
    expect(res.message).toBe('conflict: not enough stock for Laptop 14-inch (available 5)')
    res = await expectStatus(409, 'CONFLICT', 'POST', `/api/v1/public/quotes/${s5Link}/accept`, undefined, sign)
    expect(res.message).toBe('conflict: not enough stock for Laptop 14-inch (available 5)')
    const after = await expectStatus(200, '', 'GET', `/api/v1/quotes/${s5}`, rm)
    expect([after.status, after.signedBy]).toEqual(['sent', null])
    expect([await stock(PROD_LAPTOP), await stock(PROD_MOUSE)]).toEqual(['5.00', '199.00'])

    // Rejecting never touches stock; an untracked product is fine at any quantity.
    await expectStatus(200, '', 'POST', `/api/v1/public/quotes/${s5Link}/reject`, undefined)
    expect(await stock(PROD_LAPTOP)).toBe('5.00')
    await pool.query(`UPDATE products SET stock = NULL WHERE id = $1`, [PROD_LAPTOP])
    id = await expectStatus(201, '', 'POST', '/api/v1/quotes', rm, stockBody('Q-S6', 1000)).then((q) => q.id)
    await expectStatus(200, '', 'POST', `/api/v1/quotes/${id}/submit`, rm)
  })

  it('exports quotes as PDF', async () => {
    const rm = await as(RM1)
    const body = quoteBody('Q/PDF 1')
    body.items[0].description = 'บริการติดตั้งและอบรม (2 วัน)'
    const id = (await expectStatus(201, '', 'POST', '/api/v1/quotes', rm, body)).id
    const pdf = (token?: string, qid = id) => call('GET', `/api/v1/quotes/${qid}/pdf`, token)

    let res = await pdf(rm)
    expect([res.status, res.json.message]).toEqual([409, 'conflict: cannot export a quote that is draft'])
    await expectStatus(200, '', 'POST', `/api/v1/quotes/${id}/submit`, rm)
    res = await pdf(rm)
    expect([res.status, res.json.message]).toEqual([409, 'conflict: cannot export a quote that is pending_approval'])
    await expectStatus(200, '', 'POST', `/api/v1/quotes/${id}/approve`, await as(WO))

    res = await pdf(rm)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toBe('attachment; filename="Q_PDF_1.pdf"')
    expect(res.raw.startsWith('%PDF-')).toBe(true)
    expect((await pdf(await as(WO))).status).toBe(200)
    expect((await pdf(await as(WOC))).status).toBe(200)
    expect((await pdf(await as(ADMIN))).status).toBe(403)
    expect((await pdf(await as('rm2@swiftquote.dev'))).status).toBe(404)
    expect((await pdf(rm, UNKNOWN)).status).toBe(404)
    expect((await pdf()).status).toBe(401)

    const { accessToken } = await expectStatus(200, '', 'POST', `/api/v1/quotes/${id}/send`, rm)
    expect((await pdf(await as('buyer@globex.example'))).status).toBe(404)
    // Neither the customer's download nor the share link's marks the quote viewed.
    res = await pdf(await as(ACME_BUYER))
    expect(res.status).toBe(200)
    res = await call('GET', `/api/v1/public/quotes/${accessToken}/pdf`)
    expect([res.status, res.headers['content-type'], res.raw.slice(0, 5)]).toEqual([200, 'application/pdf', '%PDF-'])
    expect(res.headers['content-disposition']).toBe('attachment; filename="Q_PDF_1.pdf"')
    expect((await expectStatus(200, '', 'GET', `/api/v1/quotes/${id}`, rm)).status).toBe('sent')
    res = await call('GET', `/api/v1/public/quotes/${UNKNOWN}/pdf`)
    expect([res.status, res.json.message]).toEqual([404, 'not found: quote expired or not found'])

    // Accepted quotes carry the signer.
    await expectStatus(200, '', 'POST', `/api/v1/public/quotes/${accessToken}/accept`, undefined, sign)
    res = await call('GET', `/api/v1/public/quotes/${accessToken}/pdf`)
    expect(res.status).toBe(200)
    const wrong = await call('POST', `/api/v1/quotes/${id}/pdf`, rm)
    expect([wrong.status, wrong.headers.allow]).toEqual([405, 'GET, HEAD'])
  })
})

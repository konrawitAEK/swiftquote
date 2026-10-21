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
    { title: 'Consulting', categoryId: CAT_SERVICES, quantity: 2, unitPrice: 100, discountPercent: 10 },
    { title: 'Setup fee', categoryId: CAT_SOFTWARE, quantity: 1, unitPrice: 1.5 },
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
    return { status: res.statusCode, raw: res.body, json: res.body ? (JSON.parse(res.body) as Json) : {}, headers: res.headers }
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
    body.items = [{ title: 'Consulting', categoryId: CAT_SERVICES, quantity: 2, unitPrice: 100, discountPercent: 5 }]
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
    q = await expectStatus(200, '', 'GET', `/api/v1/quotes/${id}`, customer)
    expect(q.status).toBe('viewed')
    expect(actions(q)).toEqual(['sent', 'viewed'])

    const forbidden = await expectStatus(403, 'FORBIDDEN', 'POST', `/api/v1/quotes/${id}/accept`, rm, sign)
    expect(forbidden.message).toBe('forbidden: your role cannot perform this action')
    q = await expectStatus(200, '', 'POST', `/api/v1/quotes/${id}/accept`, customer, sign)
    expect(q).toMatchObject({ status: 'accepted', signedBy: 'Alice Acme' })
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
    expect(v.raw).toContain('"vendorLogo":null')
    expect(v.json).toMatchObject({ status: 'viewed', vendorName: 'Demo Co., Ltd.', signedBy: null })
    const q = await expectStatus(200, '', 'POST', `/api/v1/public/quotes/${link}/reject`, undefined, { comment: 'Too expensive' })
    expect(q.status).toBe('rejected')
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

    let res = await expectStatus(400, 'VALIDATION_ERROR', 'POST', '/api/v1/quotes', rm, quoteBody('Q-CAT'))
    expect(res.details).toEqual(['items[1].categoryId is not an active category'])
    const body = quoteBody('Q-CAT')
    body.items = [{ title: 'x', quantity: 1, unitPrice: 1 }]
    res = await expectStatus(400, 'VALIDATION_ERROR', 'POST', '/api/v1/quotes', rm, body)
    expect(res.details).toEqual(['items[0].categoryId is required'])

    body.items = [{ title: 'Workshop', categoryId: CAT_SERVICES, quantity: 1, unitPrice: 10 }]
    const q = await expectStatus(201, '', 'POST', '/api/v1/quotes', rm, body)
    expect(q.items[0].category.name).toBe('Services')
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
      ['missing fields', 'POST', '/api/v1/quotes', rm, { quoteNumber: ' ', items: [{ title: '' }] }, 400, 'VALIDATION_ERROR',
        'request validation failed', ['clientId is required', 'expiryDate is required', 'items[0].categoryId is required',
          'items[0].quantity is required', 'items[0].unitPrice is required']],
      ['invalid values', 'POST', '/api/v1/quotes', rm, withField('items', [
        { title: ' ', categoryId: CAT_SERVICES, quantity: 0.5, unitPrice: -1, discountPercent: 101 }]), 400, 'VALIDATION_ERROR',
        'request validation failed', ['items[0].title is required', 'items[0]: quantity must be at least 1']],
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
    body.items = [{ title: 'Precise', categoryId: CAT_SERVICES, quantity: '3', unitPrice: 33.33, discountPercent: 15 }]
    const res = await call('POST', '/api/v1/quotes', await as(RM1), body)
    expect(res.status, res.raw).toBe(201)
    expect(res.raw).toContain('"grandTotal":90.94')
  })
})

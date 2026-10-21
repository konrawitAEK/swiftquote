// End-to-end over Fastify and Postgres. Mirrors backend/go-service/internal/delivery/http/router_test.go
// and the Spring ApiIntegrationTest so all backends are held to the same behaviour.
// Runs when TEST_DATABASE_URL points at a database migrated with db/migrations (make test-node does this).
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { Repository } from './repository.js'
import { AuthService, QuoteService } from './services.js'

const DEMO_ORG = '00000000-0000-4000-8000-000000000001'
const DEMO_USER = '00000000-0000-4000-8000-000000000002'
const DEMO_CLIENT = '00000000-0000-4000-8000-000000000003'
const DB_URL = process.env.TEST_DATABASE_URL

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!DB_URL)('API (Postgres)', () => {
  let pool: pg.Pool
  let app: FastifyInstance

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL })
    const repo = new Repository(pool)
    app = await buildApp({
      repo,
      auth: new AuthService(repo, 'test-secret-at-least-32-bytes-long'),
      quotes: new QuoteService(repo),
      corsOrigins: ['http://localhost:3000'],
    })
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  // Removes everything except the demo seed, like the Go test's resetDB.
  beforeEach(async () => {
    await pool.query('DELETE FROM quotes')
    await pool.query('DELETE FROM clients WHERE id <> $1', [DEMO_CLIENT])
    await pool.query('DELETE FROM users WHERE id <> $1', [DEMO_USER])
    await pool.query('DELETE FROM organizations WHERE id <> $1', [DEMO_ORG])
  })

  async function call(method: 'GET' | 'POST', url: string, token?: string, body?: unknown) {
    const res = await app.inject({
      method,
      url,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      payload: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.statusCode, raw: res.body, json: res.body ? (JSON.parse(res.body) as Json) : {} }
  }

  async function login(email = 'demo@swiftquote.dev'): Promise<string> {
    const res = await call('POST', '/api/v1/auth/login', undefined, { email, password: 'password' })
    expect(res.status, res.raw).toBe(200)
    return res.json.accessToken
  }

  const inAMonth = () => {
    const d = new Date()
    d.setUTCMonth(d.getUTCMonth() + 1)
    return d.toISOString().slice(0, 10)
  }

  const validQuote = (quoteNumber: string): Json => ({
    clientId: DEMO_CLIENT,
    quoteNumber,
    expiryDate: inAMonth(),
    items: [
      { title: 'Consulting', quantity: 2, unitPrice: 100, discountPercent: 10 },
      { title: 'Setup fee', quantity: 1, unitPrice: 1.5 },
    ],
  })

  async function insertOrg(): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Other', $2)`, [id, id])
    return id
  }

  async function insertQuote(number: string, status: string, token: string, expiry: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO quotes (id, organization_id, client_id, quote_number, status, expiry_date, access_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, DEMO_ORG, DEMO_CLIENT, number, status, expiry, token],
    )
    return id
  }

  it('runs the quote lifecycle', async () => {
    const token = await login()

    const created = await call('POST', '/api/v1/quotes', token, validQuote('Q-001'))
    expect(created.status, created.raw).toBe(201)
    // Money is rendered with exactly two decimals, as the Go service does.
    for (const s of ['"subtotal":201.50', '"discountAmount":20.00', '"taxAmount":12.71', '"grandTotal":194.21',
      '"signedAt":null', '"signedBy":null', '"quantity":2.00']) {
      expect(created.raw).toContain(s)
    }
    expect(created.json).toMatchObject({ status: 'draft', expiryDate: inAMonth() })
    const { id, accessToken } = created.json

    const detail = await call('GET', `/api/v1/quotes/${id}`, token)
    expect(detail.json.accessToken).toBe(accessToken)
    expect(detail.json.items.map((i: Json) => i.title)).toEqual(['Consulting', 'Setup fee'])

    const clients = await call('GET', '/api/v1/clients', token)
    expect(clients.json).toEqual([{ id: DEMO_CLIENT, name: 'Acme Corporation', email: 'buyer@acme.example' }])

    const list = await call('GET', '/api/v1/quotes', token)
    expect(list.json).toHaveLength(1)
    expect(list.json[0].clientName).toBe('Acme Corporation')

    const pub = await call('GET', `/api/v1/public/quotes/${accessToken}`)
    expect(pub.status).toBe(200)
    expect(pub.raw).toContain('"vendorLogo":null')
    expect(pub.json).toMatchObject({ vendorName: 'Demo Co., Ltd.', status: 'draft', signedBy: null })

    const sign = { signerName: 'Jane Buyer', signatureDataUrl: 'data:image/png;base64,AAAA' }
    const accepted = await call('POST', `/api/v1/public/quotes/${accessToken}/accept`, undefined, sign)
    expect(accepted.status, accepted.raw).toBe(200)
    expect(accepted.json).toMatchObject({ status: 'accepted', signedBy: 'Jane Buyer' })
    expect(accepted.json.signedAt).toMatch(/Z$/)

    const again = await call('POST', `/api/v1/public/quotes/${accessToken}/accept`, undefined, sign)
    expect(again.status).toBe(409)
    expect(again.json.code).toBe('CONFLICT')

    const after = await call('GET', `/api/v1/public/quotes/${accessToken}`)
    expect(after.json).toMatchObject({ status: 'accepted', signedBy: 'Jane Buyer' })
  })

  const bad = randomUUID()
  const withField = (key: string, value: unknown) => {
    const q = validQuote('Q-NEW')
    if (value === undefined) delete q[key]
    else q[key] = value
    return q
  }
  it.each<[string, 'GET' | 'POST', string, boolean, unknown, number, string]>([
    ['wrong password', 'POST', '/api/v1/auth/login', false, { email: 'demo@swiftquote.dev', password: 'nope' }, 401, 'UNAUTHORIZED'],
    ['unknown email', 'POST', '/api/v1/auth/login', false, { email: 'x@y.z', password: 'password' }, 401, 'UNAUTHORIZED'],
    ['list without token', 'GET', '/api/v1/quotes', false, undefined, 401, 'UNAUTHORIZED'],
    ['clients without token', 'GET', '/api/v1/clients', false, undefined, 401, 'UNAUTHORIZED'],
    ['get quote without token', 'GET', `/api/v1/quotes/${bad}`, false, undefined, 401, 'UNAUTHORIZED'],
    ['unknown quote id', 'GET', `/api/v1/quotes/${bad}`, true, undefined, 404, 'NOT_FOUND'],
    ['malformed quote id', 'GET', '/api/v1/quotes/not-a-uuid', true, undefined, 404, 'NOT_FOUND'],
    ['unknown route', 'GET', '/api/v1/nope', false, undefined, 404, 'NOT_FOUND'],
    ['invalid status filter', 'GET', '/api/v1/quotes?status=bogus', true, undefined, 400, 'VALIDATION_ERROR'],
    ['create without token', 'POST', '/api/v1/quotes', false, validQuote('Q-X'), 401, 'UNAUTHORIZED'],
    ['duplicate quote number', 'POST', '/api/v1/quotes', true, validQuote('Q-DUP'), 409, 'CONFLICT'],
    ['no items', 'POST', '/api/v1/quotes', true, withField('items', []), 400, 'VALIDATION_ERROR'],
    ['missing clientId', 'POST', '/api/v1/quotes', true, withField('clientId', undefined), 400, 'VALIDATION_ERROR'],
    ['past expiry', 'POST', '/api/v1/quotes', true, withField('expiryDate', '2000-01-01'), 400, 'VALIDATION_ERROR'],
    ['bad date format', 'POST', '/api/v1/quotes', true, withField('expiryDate', '01/01/2099'), 400, 'VALIDATION_ERROR'],
    ['quantity below 1', 'POST', '/api/v1/quotes', true,
      withField('items', [{ title: 'x', quantity: 0, unitPrice: 1 }]), 400, 'VALIDATION_ERROR'],
    ['unknown access token', 'GET', `/api/v1/public/quotes/${bad}`, false, undefined, 404, 'NOT_FOUND'],
    ['malformed access token', 'GET', '/api/v1/public/quotes/not-a-uuid', false, undefined, 404, 'NOT_FOUND'],
    ['accept without signature', 'POST', `/api/v1/public/quotes/${bad}/accept`, false, { signerName: 'A' }, 400, 'VALIDATION_ERROR'],
  ])('error: %s', async (_, method, url, authed, body, status, code) => {
    const token = await login()
    await call('POST', '/api/v1/quotes', token, validQuote('Q-DUP'))

    const res = await call(method, url, authed ? token : undefined, body)

    expect(res.status, res.raw).toBe(status)
    expect(res.json.code).toBe(code)
    expect(res.json.message).toBeTruthy()
  })

  it('rejects a bad bearer token', async () => {
    const res = await call('GET', '/api/v1/quotes', 'garbage')
    expect(res.status).toBe(401)
    expect(res.json.code).toBe('UNAUTHORIZED')
  })

  it('rejects a client of another tenant', async () => {
    const otherClient = randomUUID()
    await pool.query(`INSERT INTO clients (id, organization_id, name) VALUES ($1, $2, 'Other client')`, [
      otherClient, await insertOrg(),
    ])
    const res = await call('POST', '/api/v1/quotes', await login(), withField('clientId', otherClient))
    expect(res.status).toBe(400)
    expect(res.json.code).toBe('VALIDATION_ERROR')
  })

  it('treats an expired quote as not found', async () => {
    const token = randomUUID()
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
    await insertQuote('Q-OLD', 'sent', token, yesterday)
    expect((await call('GET', `/api/v1/public/quotes/${token}`)).status).toBe(404)
    const accept = await call('POST', `/api/v1/public/quotes/${token}/accept`, undefined, {
      signerName: 'A', signatureDataUrl: 'data:x',
    })
    expect(accept.status).toBe(404)
  })

  it('scopes quotes and clients to the tenant', async () => {
    const created = await call('POST', '/api/v1/quotes', await login(), validQuote('Q-001'))
    const otherOrg = await insertOrg()
    const otherUser = randomUUID()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name)
       SELECT $1, 'other@example.com', password_hash, 'Other' FROM users WHERE id = $2`,
      [otherUser, DEMO_USER],
    )
    await pool.query(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`, [
      otherOrg, otherUser,
    ])

    const other = await login('other@example.com')
    expect((await call('GET', '/api/v1/quotes', other)).json).toEqual([])
    expect((await call('GET', '/api/v1/clients', other)).json).toEqual([])
    expect((await call('GET', `/api/v1/quotes/${created.json.id}`, other)).status).toBe(404)
  })

  it('marks a sent quote viewed when the client opens it', async () => {
    const token = randomUUID()
    const id = await insertQuote('Q-SENT', 'sent', token, inAMonth())
    await call('GET', `/api/v1/public/quotes/${token}`)
    const { rows } = await pool.query('SELECT status FROM quotes WHERE id = $1', [id])
    expect(rows[0].status).toBe('viewed')
  })

  it('keeps decimal input exact (no float rounding)', async () => {
    const body = withField('items', [{ title: 'Precise', quantity: '3', unitPrice: 33.33, discountPercent: 15 }])
    const res = await call('POST', '/api/v1/quotes', await login(), body)
    expect(res.raw).toContain('"grandTotal":90.94')
  })
})

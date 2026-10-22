// Postgres persistence on the shared schema in db/migrations (plain SQL, no ORM).
// Queries mirror backend/go-service/internal/storage/postgres so all backends read and aggregate identically.
import pg from 'pg'
import type {
  Actor,
  Category,
  Client,
  EventAction,
  Quote,
  QuoteEvent,
  QuoteItem,
  QuoteStatus,
  Ref,
  Role,
} from './domain.js'
import { Money } from './pricing.js'

// Keep DATE as 'YYYY-MM-DD' instead of a local-midnight Date; NUMERIC already arrives as a string.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v)
// TIMESTAMPTZ as RFC 3339 in UTC with Go's trimmed fraction (time.RFC3339Nano), keeping microseconds.
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, rfc3339)
// count(*) is a bigint; dashboard counts are far below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v))

const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'

export function rfc3339(v: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?$/.exec(v)
  if (!m) return new Date(v).toISOString()
  const [, date, time, frac = '', sign, h, mi = '0', s = '0'] = m
  const offset = (Number(h) * 3600 + Number(mi) * 60 + Number(s)) * 1000 * (sign === '-' ? -1 : 1)
  const base = new Date(Date.parse(`${date}T${time}Z`) - offset).toISOString().slice(0, 19)
  const trimmed = frac.replace(/0+$/, '')
  return `${base}${trimmed === '.' ? '' : trimmed}Z`
}

export class DuplicateError extends Error {}

/** A delete blocked by a foreign key (a row was referenced after the service's checks). */
export class InUseError extends Error {}

const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === UNIQUE_VIOLATION
const isForeignKeyViolation = (err: unknown) => (err as { code?: string }).code === FOREIGN_KEY_VIOLATION

/** Runs a delete, reporting a foreign-key violation as InUseError. */
async function deleting<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new InUseError()
    throw err
  }
}

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function ref(id: string | null, name: string | null): Ref | null {
  return id === null || name === null ? null : { id, name }
}

/** Decimals are sent in plain notation so Postgres never sees exponent forms it would reject. */
const num = (d: Money) => d.toFixed()

export interface Login {
  userId: string
  email: string
  passwordHash: string
  fullName: string
  organizationId: string
  role: Role
}

export interface QuoteSummary {
  id: string
  quoteNumber: string
  clientName: string
  status: QuoteStatus
  grandTotal: Money
  expiryDate: string
  createdBy: Ref | null
}

export interface PublicView {
  quote: Quote
  vendorName: string
}

export interface ListFilter {
  orgId: string
  status: QuoteStatus | null
  createdBy: string | null
  teamWo: string | null
  clientId: string | null
  statuses: QuoteStatus[] | null
}

/** An audit entry written together with a state change. */
export interface NewEvent {
  action: EventAction
  actorId: string | null
  comment: string | null
  at: Date
}

export interface AdminUser {
  id: string
  email: string
  name: string
  role: Role
  active: boolean
  team: Ref | null
  client: Ref | null
}

export interface UserInput {
  email: string
  name: string
  password: string | null
  role: string
  active: boolean | null
  teamId: string | null
  clientId: string | null
}

export interface Team {
  id: string
  name: string
  wo: Ref | null
  members: Ref[]
}

/** Optional inclusive UTC date bounds (YYYY-MM-DD). */
export interface Range {
  from: string | null
  to: string | null
}

export interface Measure {
  count: number
  amount: Money
}

export interface StatusRow {
  status: QuoteStatus
  count: number
  amount: Money
}

export interface MonthRow {
  month: string
  won: Measure
  pending: Measure
}

export interface RmRow {
  user: Ref
  team: string | null
  quoteCount: number
  sentCount: number
  won: Measure
  pending: Measure
}

export interface TeamRow {
  id: string
  name: string
  won: Measure
  pending: Measure
}

export interface CategoryRow {
  category: Ref | null
  won: Measure
  pending: Measure
}

// quoteColumns/quoteFrom join the client, the creator and the creator's current team so visibility can be decided.
const QUOTE_COLUMNS = `
  SELECT q.id, q.organization_id, q.client_id, c.name AS client_name, q.deal_id, q.quote_number, q.status,
    q.expiry_date, q.subtotal, q.discount_amount, q.tax_amount, q.grand_total, q.access_token,
    q.signed_by, q.signature_data, q.signed_at,
    cb.id AS creator_id, cb.full_name AS creator_name, t.wo_user_id`

const QUOTE_FROM = `
  FROM quotes q
  JOIN clients c ON c.id = q.client_id
  LEFT JOIN users cb ON cb.id = q.created_by
  LEFT JOIN organization_members cm ON cm.user_id = q.created_by AND cm.organization_id = q.organization_id
  LEFT JOIN teams t ON t.id = cm.team_id`

function mapQuote(r: Row): Quote {
  return {
    id: r.id,
    organizationId: r.organization_id,
    clientId: r.client_id,
    clientName: r.client_name,
    dealId: r.deal_id,
    quoteNumber: r.quote_number,
    status: r.status,
    expiryDate: r.expiry_date,
    subtotal: new Money(r.subtotal),
    discountAmount: new Money(r.discount_amount),
    taxAmount: new Money(r.tax_amount),
    grandTotal: new Money(r.grand_total),
    accessToken: r.access_token,
    signedBy: r.signed_by,
    signatureData: r.signature_data,
    signedAt: r.signed_at,
    createdBy: ref(r.creator_id, r.creator_name),
    creatorTeamWo: r.wo_user_id,
    items: [],
    history: [],
  }
}

const USER_SELECT = `
  SELECT u.id, u.email, u.full_name, m.role, m.active, t.id AS team_id, t.name AS team_name,
    c.id AS client_id, c.name AS client_name
  FROM organization_members m
  JOIN users u ON u.id = m.user_id
  LEFT JOIN teams t ON t.id = m.team_id
  LEFT JOIN clients c ON c.id = m.client_id`

function mapUser(r: Row): AdminUser {
  return {
    id: r.id,
    email: r.email,
    name: r.full_name,
    role: r.role,
    active: r.active,
    team: ref(r.team_id, r.team_name),
    client: ref(r.client_id, r.client_name),
  }
}

// Dashboard SQL, shared verbatim with the Go and Spring services. $2/$3 are the optional inclusive UTC date bounds.
const IN_RANGE = `($2::date IS NULL OR (q.created_at AT TIME ZONE 'UTC')::date >= $2)
	AND ($3::date IS NULL OR (q.created_at AT TIME ZONE 'UTC')::date <= $3)`
const IS_WON = `q.status = 'accepted'`
const IS_PENDING = `(q.status IN ('sent', 'viewed') AND q.expiry_date >= (now() AT TIME ZONE 'UTC')::date)`
const IS_SENT = `q.status IN ('sent', 'viewed', 'accepted', 'rejected')`
// Line amount incl. VAT, rounded per line exactly like pricing, so categories add up to grand totals.
const LINE_GROSS = `(i.line_total + round(i.line_total * i.tax_percent / 100, 2))`

const measure = (count: unknown, amount: unknown): Measure => ({ count: Number(count), amount: new Money(String(amount)) })

export class Repository {
  constructor(private readonly pool: pg.Pool) {}

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1')
  }

  private async tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const conn = await this.pool.connect()
    try {
      await conn.query('BEGIN')
      const out = await fn(conn)
      await conn.query('COMMIT')
      return out
    } catch (err) {
      await conn.query('ROLLBACK')
      throw err
    } finally {
      conn.release()
    }
  }

  private async exists(sql: string, args: unknown[]): Promise<boolean> {
    const { rows } = await this.pool.query(sql, args)
    return rows[0]?.exists === true
  }

  // ---- auth

  /** An active user by email (case-insensitive); a user in several tenants logs into their earliest membership. */
  async findLogin(email: string): Promise<Login | null> {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.email, u.password_hash, u.full_name, m.organization_id, m.role
       FROM users u
       JOIN organization_members m ON m.user_id = u.id
       WHERE lower(u.email) = lower($1) AND m.active
       ORDER BY m.created_at
       LIMIT 1`,
      [email],
    )
    const r = rows[0]
    if (!r) return null
    return {
      userId: r.id,
      email: r.email,
      passwordHash: r.password_hash,
      fullName: r.full_name,
      organizationId: r.organization_id,
      role: r.role,
    }
  }

  /** The active member userId of tenantId, or null. */
  async loadActor(tenantId: string, userId: string): Promise<Actor | null> {
    const { rows } = await this.pool.query(
      `SELECT u.full_name, m.role, m.team_id, m.client_id
       FROM organization_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1 AND m.user_id = $2 AND m.active`,
      [tenantId, userId],
    )
    const r = rows[0]
    if (!r) return null
    return { userId, name: r.full_name, tenantId, role: r.role, teamId: r.team_id, clientId: r.client_id }
  }

  // ---- clients and categories

  async listClients(orgId: string): Promise<Client[]> {
    const { rows } = await this.pool.query(
      `SELECT id, name, COALESCE(email, '') AS email FROM clients WHERE organization_id = $1 ORDER BY name, id`,
      [orgId],
    )
    return rows.map((r) => ({ id: r.id, name: r.name, email: r.email }))
  }

  clientExists(orgId: string, clientId: string): Promise<boolean> {
    return this.exists(`SELECT EXISTS (SELECT 1 FROM clients WHERE id = $1 AND organization_id = $2)`, [clientId, orgId])
  }

  async listCategories(orgId: string): Promise<Category[]> {
    const { rows } = await this.pool.query(
      `SELECT id, name, active FROM product_categories WHERE organization_id = $1 ORDER BY name, id`,
      [orgId],
    )
    return rows.map((r) => ({ id: r.id, name: r.name, active: r.active }))
  }

  async getCategory(orgId: string, id: string): Promise<Category | null> {
    const { rows } = await this.pool.query(
      `SELECT id, name, active FROM product_categories WHERE organization_id = $1 AND id = $2`,
      [orgId, id],
    )
    const r = rows[0]
    return r ? { id: r.id, name: r.name, active: r.active } : null
  }

  /** Throws DuplicateError if the name exists in the tenant. */
  async createCategory(orgId: string, id: string, name: string): Promise<void> {
    try {
      await this.pool.query(`INSERT INTO product_categories (id, organization_id, name) VALUES ($1, $2, $3)`, [
        id, orgId, name,
      ])
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateError()
      throw err
    }
  }

  async updateCategory(orgId: string, id: string, name: string, active: boolean): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE product_categories SET name = $3, active = $4 WHERE organization_id = $1 AND id = $2`,
        [orgId, id, name, active],
      )
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateError()
      throw err
    }
  }

  categoryInUse(_orgId: string, id: string): Promise<boolean> {
    return this.exists(`SELECT EXISTS (SELECT 1 FROM quote_items WHERE category_id = $1)`, [id])
  }

  /** InUseError if a quote line references it. */
  async deleteCategory(orgId: string, id: string): Promise<void> {
    await deleting(() => this.pool.query(`DELETE FROM product_categories WHERE organization_id = $1 AND id = $2`, [orgId, id]))
  }

  async activeCategoryIds(orgId: string): Promise<Set<string>> {
    const { rows } = await this.pool.query(
      `SELECT id FROM product_categories WHERE organization_id = $1 AND active`,
      [orgId],
    )
    return new Set(rows.map((r) => r.id as string))
  }

  // ---- quotes

  /** Persists q, its items and ev; a duplicate number throws DuplicateError. */
  async createQuote(q: Quote, createdBy: string, createdAt: Date, ev: NewEvent): Promise<void> {
    await this.tx(async (c) => {
      try {
        await c.query(
          `INSERT INTO quotes (id, organization_id, client_id, deal_id, quote_number, status, expiry_date,
             subtotal, discount_amount, tax_amount, grand_total, access_token, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            q.id, q.organizationId, q.clientId, q.dealId, q.quoteNumber, q.status, q.expiryDate,
            num(q.subtotal), num(q.discountAmount), num(q.taxAmount), num(q.grandTotal), q.accessToken,
            createdBy, createdAt,
          ],
        )
      } catch (err) {
        if (isUniqueViolation(err)) throw new DuplicateError()
        throw err
      }
      await insertItems(c, q)
      await insertEvent(c, q.id, ev)
    })
  }

  /** Overwrites a draft's fields and items; false if it is no longer a draft. Duplicate number throws DuplicateError. */
  async replaceQuote(q: Quote, ev: NewEvent): Promise<boolean> {
    return this.tx(async (c) => {
      let changed: number
      try {
        const res = await c.query(
          `UPDATE quotes
           SET client_id = $2, deal_id = $3, quote_number = $4, expiry_date = $5,
             subtotal = $6, discount_amount = $7, tax_amount = $8, grand_total = $9
           WHERE id = $1 AND status = 'draft'`,
          [
            q.id, q.clientId, q.dealId, q.quoteNumber, q.expiryDate,
            num(q.subtotal), num(q.discountAmount), num(q.taxAmount), num(q.grandTotal),
          ],
        )
        changed = res.rowCount ?? 0
      } catch (err) {
        if (isUniqueViolation(err)) throw new DuplicateError()
        throw err
      }
      if (changed === 0) return false
      await c.query(`DELETE FROM quote_items WHERE quote_id = $1`, [q.id])
      await insertItems(c, q)
      await insertEvent(c, q.id, ev)
      return true
    })
  }

  async listQuotes(f: ListFilter): Promise<QuoteSummary[]> {
    const { rows } = await this.pool.query(
      `SELECT q.id, q.quote_number, c.name, q.status, q.grand_total, q.expiry_date, cb.id AS creator_id,
         cb.full_name AS creator_name
       FROM quotes q
       JOIN clients c ON c.id = q.client_id
       LEFT JOIN users cb ON cb.id = q.created_by
       LEFT JOIN organization_members cm ON cm.user_id = q.created_by AND cm.organization_id = q.organization_id
       LEFT JOIN teams t ON t.id = cm.team_id
       WHERE q.organization_id = $1
         AND ($2::text IS NULL OR q.status = $2)
         AND ($3::uuid IS NULL OR q.created_by = $3)
         AND ($4::uuid IS NULL OR t.wo_user_id = $4)
         AND ($5::uuid IS NULL OR q.client_id = $5)
         AND ($6::text[] IS NULL OR q.status = ANY($6))
       ORDER BY q.created_at DESC, q.id`,
      [f.orgId, f.status, f.createdBy, f.teamWo, f.clientId, f.statuses],
    )
    return rows.map((r) => ({
      id: r.id,
      quoteNumber: r.quote_number,
      clientName: r.name,
      status: r.status,
      grandTotal: new Money(r.grand_total),
      expiryDate: r.expiry_date,
      createdBy: ref(r.creator_id, r.creator_name),
    }))
  }

  /** A quote of orgId with items, history, client name, creator and creator's team WO. */
  async getQuote(orgId: string, id: string): Promise<Quote | null> {
    const { rows } = await this.pool.query(`${QUOTE_COLUMNS}${QUOTE_FROM} WHERE q.id = $1 AND q.organization_id = $2`, [
      id, orgId,
    ])
    if (!rows[0]) return null
    const q = mapQuote(rows[0])
    q.items = await this.items(q.id)
    q.history = await this.history(q.id)
    return q
  }

  async getByAccessToken(accessToken: string): Promise<PublicView | null> {
    const { rows } = await this.pool.query(
      `${QUOTE_COLUMNS}, o.name AS vendor_name${QUOTE_FROM}
       JOIN organizations o ON o.id = q.organization_id
       WHERE q.access_token = $1`,
      [accessToken],
    )
    const r = rows[0]
    if (!r) return null
    const q = mapQuote(r)
    q.items = await this.items(q.id)
    return { quote: q, vendorName: r.vendor_name }
  }

  /** Sets status to `to` only if it is one of `from` and records ev; false if it was not. */
  async transition(id: string, from: QuoteStatus[], to: QuoteStatus, ev: NewEvent): Promise<boolean> {
    return this.tx(async (c) => {
      const res = await c.query(`UPDATE quotes SET status = $2 WHERE id = $1 AND status = ANY($3)`, [id, to, from])
      if ((res.rowCount ?? 0) === 0) return false
      await insertEvent(c, id, ev)
      return true
    })
  }

  /** Records the signature like transition to accepted. */
  async accept(id: string, from: QuoteStatus[], signedBy: string, signatureData: string, ev: NewEvent): Promise<boolean> {
    return this.tx(async (c) => {
      const res = await c.query(
        `UPDATE quotes SET status = 'accepted', signed_by = $2, signature_data = $3, signed_at = $4
         WHERE id = $1 AND status = ANY($5)`,
        [id, signedBy, signatureData, ev.at, from],
      )
      if ((res.rowCount ?? 0) === 0) return false
      await insertEvent(c, id, ev)
      return true
    })
  }

  private async items(quoteId: string): Promise<QuoteItem[]> {
    const { rows } = await this.pool.query(
      `SELECT i.id, i.title, COALESCE(i.description, '') AS description, i.quantity, i.unit_price,
         i.discount_percent, i.tax_percent, i.line_total, c.id AS category_id, c.name AS category_name
       FROM quote_items i
       LEFT JOIN product_categories c ON c.id = i.category_id
       WHERE i.quote_id = $1
       ORDER BY i.position, i.id`,
      [quoteId],
    )
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: ref(r.category_id, r.category_name),
      description: r.description,
      quantity: new Money(r.quantity),
      unitPrice: new Money(r.unit_price),
      discountPercent: new Money(r.discount_percent),
      taxPercent: new Money(r.tax_percent),
      lineTotal: new Money(r.line_total),
    }))
  }

  private async history(quoteId: string): Promise<QuoteEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT e.action, e.actor_user_id, u.full_name, e.comment, e.created_at
       FROM quote_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
       WHERE e.quote_id = $1
       ORDER BY e.seq`,
      [quoteId],
    )
    return rows.map((r) => ({
      action: r.action,
      actor: ref(r.actor_user_id, r.full_name),
      comment: r.comment,
      at: r.created_at,
    }))
  }

  // ---- admin

  async listUsers(orgId: string): Promise<AdminUser[]> {
    const { rows } = await this.pool.query(`${USER_SELECT} WHERE m.organization_id = $1 ORDER BY u.full_name, u.id`, [
      orgId,
    ])
    return rows.map(mapUser)
  }

  async getUser(orgId: string, id: string): Promise<AdminUser | null> {
    const { rows } = await this.pool.query(`${USER_SELECT} WHERE m.organization_id = $1 AND u.id = $2`, [orgId, id])
    return rows[0] ? mapUser(rows[0]) : null
  }

  /** Inserts the user and membership; DuplicateError if the email exists. */
  async createUser(orgId: string, id: string, in_: UserInput, passwordHash: string): Promise<void> {
    await this.tx(async (c) => {
      try {
        await c.query(`INSERT INTO users (id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)`, [
          id, in_.email, passwordHash, in_.name,
        ])
      } catch (err) {
        if (isUniqueViolation(err)) throw new DuplicateError()
        throw err
      }
      await c.query(
        `INSERT INTO organization_members (organization_id, user_id, role, team_id, client_id, active)
         VALUES ($1, $2, $3, $4, $5, TRUE)`,
        [orgId, id, in_.role, in_.teamId, in_.clientId],
      )
    })
  }

  /** Replaces name and membership; a non-null passwordHash resets the password. */
  async updateUser(orgId: string, id: string, in_: UserInput, passwordHash: string | null): Promise<void> {
    await this.tx(async (c) => {
      await c.query(`UPDATE users SET full_name = $2, password_hash = COALESCE($3, password_hash) WHERE id = $1`, [
        id, in_.name, passwordHash,
      ])
      await c.query(
        `UPDATE organization_members SET role = $3, team_id = $4, client_id = $5, active = $6
         WHERE organization_id = $1 AND user_id = $2`,
        [orgId, id, in_.role, in_.teamId, in_.clientId, in_.active],
      )
    })
  }

  /** Removes the membership, then the account itself once it belongs to no organization; InUseError on a foreign key. */
  async deleteUser(orgId: string, id: string): Promise<void> {
    await deleting(() =>
      this.tx(async (c) => {
        await c.query(`DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2`, [orgId, id])
        await c.query(
          `DELETE FROM users WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM organization_members WHERE user_id = $1)`,
          [id],
        )
      }),
    )
  }

  /** Whether the user created a quote or acted in any quote's history, in any organization. */
  hasQuoteHistory(userId: string): Promise<boolean> {
    return this.exists(
      `SELECT EXISTS (SELECT 1 FROM quotes WHERE created_by = $1)
         OR EXISTS (SELECT 1 FROM quote_events WHERE actor_user_id = $1) AS exists`,
      [userId],
    )
  }

  teamExists(orgId: string, teamId: string): Promise<boolean> {
    return this.exists(`SELECT EXISTS (SELECT 1 FROM teams WHERE id = $1 AND organization_id = $2)`, [teamId, orgId])
  }

  leadsTeam(orgId: string, userId: string): Promise<boolean> {
    return this.exists(`SELECT EXISTS (SELECT 1 FROM teams WHERE wo_user_id = $1 AND organization_id = $2)`, [
      userId, orgId,
    ])
  }

  isActiveWo(orgId: string, userId: string): Promise<boolean> {
    return this.exists(
      `SELECT EXISTS (SELECT 1 FROM organization_members
         WHERE user_id = $1 AND organization_id = $2 AND role = 'wo' AND active)`,
      [userId, orgId],
    )
  }

  listTeams(orgId: string): Promise<Team[]> {
    return this.teams(orgId, null)
  }

  async getTeam(orgId: string, id: string): Promise<Team | null> {
    return (await this.teams(orgId, id))[0] ?? null
  }

  /** Teams (all, or one) with their WO and active RMs. */
  private async teams(orgId: string, only: string | null): Promise<Team[]> {
    const { rows } = await this.pool.query(
      `SELECT t.id, t.name, w.id AS wo_id, w.full_name AS wo_name
       FROM teams t
       LEFT JOIN users w ON w.id = t.wo_user_id
       WHERE t.organization_id = $1 AND ($2::uuid IS NULL OR t.id = $2)
       ORDER BY t.name, t.id`,
      [orgId, only],
    )
    const teams: Team[] = rows.map((r) => ({ id: r.id, name: r.name, wo: ref(r.wo_id, r.wo_name), members: [] }))
    const byId = new Map(teams.map((t) => [t.id, t]))
    const members = await this.pool.query(
      `SELECT m.team_id, u.id, u.full_name
       FROM organization_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1 AND m.role = 'rm' AND m.active AND m.team_id IS NOT NULL
       ORDER BY u.full_name, u.id`,
      [orgId],
    )
    for (const r of members.rows) byId.get(r.team_id)?.members.push({ id: r.id, name: r.full_name })
    return teams
  }

  /** Whether any membership, active or not, is placed in the team. */
  teamHasMembers(_orgId: string, id: string): Promise<boolean> {
    return this.exists(`SELECT EXISTS (SELECT 1 FROM organization_members WHERE team_id = $1)`, [id])
  }

  /** InUseError if a member was placed in the team meanwhile. */
  async deleteTeam(orgId: string, id: string): Promise<void> {
    // members.team_id is ON DELETE SET NULL, so no foreign key stops this; re-check emptiness in the same statement.
    const res = await this.pool.query(
      `DELETE FROM teams t WHERE t.organization_id = $1 AND t.id = $2
         AND NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.team_id = t.id)`,
      [orgId, id],
    )
    if ((res.rowCount ?? 0) === 0) throw new InUseError()
  }

  /** DuplicateError for an existing team name. */
  async createTeam(orgId: string, id: string, name: string, woUserId: string): Promise<void> {
    try {
      await this.pool.query(`INSERT INTO teams (id, organization_id, name, wo_user_id) VALUES ($1, $2, $3, $4)`, [
        id, orgId, name, woUserId,
      ])
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateError()
      throw err
    }
  }

  async updateTeam(orgId: string, id: string, name: string, woUserId: string): Promise<void> {
    try {
      await this.pool.query(`UPDATE teams SET name = $3, wo_user_id = $4 WHERE id = $2 AND organization_id = $1`, [
        orgId, id, name, woUserId,
      ])
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateError()
      throw err
    }
  }

  // ---- dashboard

  async countByStatus(orgId: string, r: Range): Promise<StatusRow[]> {
    const { rows } = await this.pool.query(
      `SELECT q.status, count(*) AS n, COALESCE(sum(q.grand_total), 0) AS amount
       FROM quotes q
       WHERE q.organization_id = $1 AND ${IN_RANGE}
       GROUP BY q.status`,
      [orgId, r.from, r.to],
    )
    return rows.map((x) => ({ status: x.status, count: Number(x.n), amount: new Money(x.amount) }))
  }

  async pendingTotal(orgId: string, r: Range): Promise<Measure> {
    const { rows } = await this.pool.query(
      `SELECT count(*) AS n, COALESCE(sum(q.grand_total), 0) AS amount
       FROM quotes q
       WHERE q.organization_id = $1 AND ${IS_PENDING} AND ${IN_RANGE}`,
      [orgId, r.from, r.to],
    )
    return measure(rows[0]!.n, rows[0]!.amount)
  }

  async byMonth(orgId: string, r: Range): Promise<MonthRow[]> {
    const { rows } = await this.pool.query(
      `SELECT month, sum(won_count) AS wc, sum(won_amount) AS wa, sum(pending_count) AS pc, sum(pending_amount) AS pa
       FROM (
         SELECT to_char(q.signed_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
           1 AS won_count, q.grand_total AS won_amount, 0 AS pending_count, 0 AS pending_amount
         FROM quotes q
         WHERE q.organization_id = $1 AND ${IS_WON} AND q.signed_at IS NOT NULL AND ${IN_RANGE}
         UNION ALL
         SELECT to_char(q.expiry_date, 'YYYY-MM'), 0, 0, 1, q.grand_total
         FROM quotes q
         WHERE q.organization_id = $1 AND ${IS_PENDING} AND ${IN_RANGE}
       ) m
       GROUP BY month
       ORDER BY month`,
      [orgId, r.from, r.to],
    )
    return rows.map((x) => ({ month: x.month, won: measure(x.wc, x.wa), pending: measure(x.pc, x.pa) }))
  }

  async byRm(orgId: string, r: Range): Promise<RmRow[]> {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.full_name, t.name AS team,
         count(*) AS quotes,
         count(*) FILTER (WHERE ${IS_SENT}) AS sent,
         count(*) FILTER (WHERE ${IS_WON}) AS wc,
         COALESCE(sum(q.grand_total) FILTER (WHERE ${IS_WON}), 0) AS won_amount,
         count(*) FILTER (WHERE ${IS_PENDING}) AS pc,
         COALESCE(sum(q.grand_total) FILTER (WHERE ${IS_PENDING}), 0) AS pa
       FROM quotes q
       JOIN users u ON u.id = q.created_by
       LEFT JOIN organization_members m ON m.user_id = u.id AND m.organization_id = q.organization_id
       LEFT JOIN teams t ON t.id = m.team_id
       WHERE q.organization_id = $1 AND ${IN_RANGE}
       GROUP BY u.id, u.full_name, t.name
       ORDER BY won_amount DESC, u.full_name, u.id`,
      [orgId, r.from, r.to],
    )
    return rows.map((x) => ({
      user: { id: x.id, name: x.full_name },
      team: x.team,
      quoteCount: Number(x.quotes),
      sentCount: Number(x.sent),
      won: measure(x.wc, x.won_amount),
      pending: measure(x.pc, x.pa),
    }))
  }

  async byTeam(orgId: string, r: Range): Promise<TeamRow[]> {
    const { rows } = await this.pool.query(
      `SELECT t.id, t.name,
         count(q.id) FILTER (WHERE ${IS_WON}) AS wc,
         COALESCE(sum(q.grand_total) FILTER (WHERE ${IS_WON}), 0) AS won_amount,
         count(q.id) FILTER (WHERE ${IS_PENDING}) AS pc,
         COALESCE(sum(q.grand_total) FILTER (WHERE ${IS_PENDING}), 0) AS pa
       FROM teams t
       LEFT JOIN organization_members m ON m.team_id = t.id
       LEFT JOIN quotes q ON q.created_by = m.user_id AND q.organization_id = t.organization_id AND ${IN_RANGE}
       WHERE t.organization_id = $1
       GROUP BY t.id, t.name
       ORDER BY won_amount DESC, t.name, t.id`,
      [orgId, r.from, r.to],
    )
    return rows.map((x) => ({ id: x.id, name: x.name, won: measure(x.wc, x.won_amount), pending: measure(x.pc, x.pa) }))
  }

  async byCategory(orgId: string, r: Range): Promise<CategoryRow[]> {
    const { rows } = await this.pool.query(
      `SELECT c.id, c.name,
         count(*) FILTER (WHERE ${IS_WON}) AS wc,
         COALESCE(sum(${LINE_GROSS}) FILTER (WHERE ${IS_WON}), 0) AS won_amount,
         count(*) FILTER (WHERE ${IS_PENDING}) AS pc,
         COALESCE(sum(${LINE_GROSS}) FILTER (WHERE ${IS_PENDING}), 0) AS pa
       FROM quote_items i
       JOIN quotes q ON q.id = i.quote_id
       LEFT JOIN product_categories c ON c.id = i.category_id
       WHERE q.organization_id = $1 AND (${IS_WON} OR ${IS_PENDING}) AND ${IN_RANGE}
       GROUP BY c.id, c.name
       ORDER BY (c.id IS NULL), won_amount DESC, c.name, c.id`,
      [orgId, r.from, r.to],
    )
    return rows.map((x) => ({
      category: ref(x.id, x.name),
      won: measure(x.wc, x.won_amount),
      pending: measure(x.pc, x.pa),
    }))
  }
}

async function insertItems(c: pg.PoolClient, q: Quote): Promise<void> {
  for (const [i, it] of q.items.entries()) {
    await c.query(
      `INSERT INTO quote_items (id, quote_id, title, description, quantity, unit_price,
         discount_percent, tax_percent, line_total, position, category_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        it.id, q.id, it.title, it.description, num(it.quantity), num(it.unitPrice),
        num(it.discountPercent), num(it.taxPercent), num(it.lineTotal), i, it.category?.id ?? null,
      ],
    )
  }
}

async function insertEvent(c: pg.PoolClient, quoteId: string, ev: NewEvent): Promise<void> {
  await c.query(
    `INSERT INTO quote_events (quote_id, actor_user_id, action, comment, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [quoteId, ev.actorId, ev.action, ev.comment, ev.at],
  )
}

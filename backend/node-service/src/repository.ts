// Postgres persistence on the shared schema in db/migrations (plain SQL, no ORM).
import pg from 'pg'
import {
  ACCEPTABLE_STATUSES,
  ConflictError,
  type Client,
  type Login,
  type Quote,
  type QuoteItem,
  type QuoteStatus,
} from './domain.js'
import { Money } from './pricing.js'

// Keep DATE as 'YYYY-MM-DD' instead of a local-midnight Date; NUMERIC already arrives as a string.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v)

const UNIQUE_VIOLATION = '23505'

export interface QuoteSummary {
  id: string
  quoteNumber: string
  clientName: string
  status: QuoteStatus
  grandTotal: Money
  expiryDate: string
}

export interface PublicView {
  quote: Quote
  vendorName: string
}

const QUOTE_COLUMNS = `q.id, q.organization_id, q.client_id, q.deal_id, q.quote_number, q.status, q.expiry_date,
  q.subtotal, q.discount_amount, q.tax_amount, q.grand_total, q.access_token,
  q.signed_by, q.signature_data, q.signed_at, COALESCE(q.created_at, now()) AS created_at`

type Row = Record<string, unknown>

function mapQuote(r: Row): Quote {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    clientId: r.client_id as string,
    dealId: (r.deal_id as string | null) ?? null,
    quoteNumber: r.quote_number as string,
    status: r.status as QuoteStatus,
    expiryDate: r.expiry_date as string,
    subtotal: new Money(r.subtotal as string),
    discountAmount: new Money(r.discount_amount as string),
    taxAmount: new Money(r.tax_amount as string),
    grandTotal: new Money(r.grand_total as string),
    accessToken: r.access_token as string,
    signedBy: (r.signed_by as string | null) ?? null,
    signatureData: (r.signature_data as string | null) ?? null,
    signedAt: (r.signed_at as Date | null) ?? null,
    createdAt: r.created_at as Date,
    items: [],
  }
}

export class Repository {
  constructor(private readonly pool: pg.Pool) {}

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1')
  }

  /** Case-insensitive; a user in several tenants logs into their earliest membership. */
  async findLogin(email: string): Promise<Login | null> {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.email, u.password_hash, u.full_name, m.organization_id, m.role
       FROM users u
       JOIN organization_members m ON m.user_id = u.id
       WHERE lower(u.email) = lower($1)
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

  async listClients(orgId: string): Promise<Client[]> {
    const { rows } = await this.pool.query(
      `SELECT id, organization_id, name, email FROM clients WHERE organization_id = $1 ORDER BY name, id`,
      [orgId],
    )
    return rows.map((r) => ({ id: r.id, organizationId: r.organization_id, name: r.name, email: r.email }))
  }

  async clientBelongsTo(orgId: string, clientId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT EXISTS (SELECT 1 FROM clients WHERE id = $1 AND organization_id = $2) AS ok`,
      [clientId, orgId],
    )
    return rows[0]?.ok === true
  }

  /** Inserts the quote and its items atomically; a duplicate number in the tenant throws ConflictError. */
  async createQuote(q: Quote): Promise<void> {
    const conn = await this.pool.connect()
    try {
      await conn.query('BEGIN')
      await conn.query(
        `INSERT INTO quotes (id, organization_id, client_id, deal_id, quote_number, status, expiry_date,
           subtotal, discount_amount, tax_amount, grand_total, access_token, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          q.id, q.organizationId, q.clientId, q.dealId, q.quoteNumber, q.status, q.expiryDate,
          q.subtotal.toFixed(2), q.discountAmount.toFixed(2), q.taxAmount.toFixed(2), q.grandTotal.toFixed(2),
          q.accessToken, q.createdAt,
        ],
      )
      for (const [i, it] of q.items.entries()) {
        await conn.query(
          `INSERT INTO quote_items (id, quote_id, title, description, quantity, unit_price,
             discount_percent, tax_percent, line_total, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            it.id, q.id, it.title, it.description, it.quantity.toString(), it.unitPrice.toString(),
            it.discountPercent.toString(), it.taxPercent.toString(), it.lineTotal.toFixed(2), i,
          ],
        )
      }
      await conn.query('COMMIT')
    } catch (err) {
      await conn.query('ROLLBACK')
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictError(`conflict: quoteNumber ${JSON.stringify(q.quoteNumber)} already exists`)
      }
      throw err
    } finally {
      conn.release()
    }
  }

  async listQuotes(orgId: string, status: QuoteStatus | null): Promise<QuoteSummary[]> {
    const { rows } = await this.pool.query(
      `SELECT q.id, q.quote_number, c.name, q.status, q.grand_total, q.expiry_date
       FROM quotes q
       JOIN clients c ON c.id = q.client_id
       WHERE q.organization_id = $1 AND ($2::text IS NULL OR q.status = $2)
       ORDER BY q.created_at DESC`,
      [orgId, status],
    )
    return rows.map((r) => ({
      id: r.id,
      quoteNumber: r.quote_number,
      clientName: r.name,
      status: r.status,
      grandTotal: new Money(r.grand_total),
      expiryDate: r.expiry_date,
    }))
  }

  async getQuote(orgId: string, id: string): Promise<Quote | null> {
    const { rows } = await this.pool.query(
      `SELECT ${QUOTE_COLUMNS} FROM quotes q WHERE q.id = $1 AND q.organization_id = $2`,
      [id, orgId],
    )
    return rows[0] ? this.withItems(mapQuote(rows[0])) : null
  }

  async getPublic(accessToken: string): Promise<PublicView | null> {
    const { rows } = await this.pool.query(
      `SELECT ${QUOTE_COLUMNS}, o.name AS vendor_name
       FROM quotes q
       JOIN organizations o ON o.id = q.organization_id
       WHERE q.access_token = $1`,
      [accessToken],
    )
    const r = rows[0]
    if (!r) return null
    return { quote: await this.withItems(mapQuote(r)), vendorName: r.vendor_name }
  }

  /** Sets status only if it is currently one of `from`; returns whether a row changed. */
  async updateStatus(id: string, to: QuoteStatus, from: QuoteStatus[]): Promise<boolean> {
    const res = await this.pool.query(`UPDATE quotes SET status = $2 WHERE id = $1 AND status = ANY($3::text[])`, [
      id, to, from,
    ])
    return (res.rowCount ?? 0) > 0
  }

  /** Records the signature only while the quote is still acceptable; null if it no longer is. */
  async acceptQuote(id: string, signedBy: string, signatureData: string, at: Date): Promise<Quote | null> {
    const { rows } = await this.pool.query(
      `UPDATE quotes q
       SET status = 'accepted', signed_by = $2, signature_data = $3, signed_at = $4
       WHERE q.id = $1 AND q.status = ANY($5::text[])
       RETURNING ${QUOTE_COLUMNS}`,
      [id, signedBy, signatureData, at, ACCEPTABLE_STATUSES],
    )
    return rows[0] ? this.withItems(mapQuote(rows[0])) : null
  }

  private async withItems(q: Quote): Promise<Quote> {
    const { rows } = await this.pool.query(
      `SELECT id, title, description, quantity, unit_price, discount_percent, tax_percent, line_total
       FROM quote_items WHERE quote_id = $1 ORDER BY position, id`,
      [q.id],
    )
    q.items = rows.map(
      (r): QuoteItem => ({
        id: r.id,
        title: r.title,
        description: r.description,
        quantity: new Money(r.quantity),
        unitPrice: new Money(r.unit_price),
        discountPercent: new Money(r.discount_percent),
        taxPercent: new Money(r.tax_percent),
        lineTotal: new Money(r.line_total),
      }),
    )
    return q
  }
}

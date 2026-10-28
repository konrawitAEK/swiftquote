// Core SwiftQuote types, independent of transport and storage. Mirrors backend/go-service/internal/domain.
// Monetary and quantity values are Decimal, never JS numbers; timestamps are RFC 3339 strings in UTC.
import type { Money } from './pricing.js'

export const ROLES = ['admin', 'woc', 'wo', 'rm', 'customer'] as const
export type Role = (typeof ROLES)[number]

export function isRole(s: string): s is Role {
  return (ROLES as readonly string[]).includes(s)
}

/** The contract's enum order. */
export const QUOTE_STATUSES = [
  'draft', 'pending_approval', 'approved', 'sent', 'viewed', 'accepted', 'rejected', 'expired',
] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

export function isQuoteStatus(s: string): s is QuoteStatus {
  return (QUOTE_STATUSES as readonly string[]).includes(s)
}

/** The states a customer can see: the quote has been sent to them. */
export const CUSTOMER_STATUSES: QuoteStatus[] = ['sent', 'viewed', 'accepted', 'rejected']

/** The states in which a customer may still accept or reject. */
export const RESPONDABLE_STATUSES: QuoteStatus[] = ['sent', 'viewed']

export type EventAction =
  | 'created' | 'updated' | 'submitted' | 'approved' | 'returned' | 'sent' | 'viewed' | 'accepted' | 'rejected'

/** The history entries a customer may see. */
export const CUSTOMER_EVENTS: EventAction[] = ['sent', 'viewed', 'accepted', 'rejected']

/** A lightweight {id, name} reference used in responses. */
export interface Ref {
  id: string
  name: string
}

/** The authenticated caller, loaded from the database on every request. */
export interface Actor {
  userId: string
  name: string
  tenantId: string
  role: Role
  teamId: string | null
  clientId: string | null
}

/** One audit-trail entry. actor is null when a customer acted through the share link. */
export interface QuoteEvent {
  action: EventAction
  actor: Ref | null
  comment: string | null
  at: string
}

export const DISCOUNT_TYPES = ['percent', 'amount'] as const
export type DiscountType = (typeof DISCOUNT_TYPES)[number]

export function isDiscountType(s: string): s is DiscountType {
  return (DISCOUNT_TYPES as readonly string[]).includes(s)
}

export interface QuoteItem {
  id: string
  /** null for lines created before products existed */
  product: Ref | null
  title: string
  /** null for lines created before categories existed */
  category: Ref | null
  description: string
  quantity: Money
  unitPrice: Money
  discountType: DiscountType
  /** a percent or an amount for the whole line, per discountType */
  discountValue: Money
  taxPercent: Money
  lineTotal: Money
  /** the product's cost when the line was saved; null for older lines */
  unitCost: Money | null
}

export interface Quote {
  id: string
  organizationId: string
  clientId: string
  clientName: string
  dealId: string | null
  quoteNumber: string
  status: QuoteStatus
  /** YYYY-MM-DD */
  expiryDate: string
  subtotal: Money
  discountAmount: Money
  taxAmount: Money
  grandTotal: Money
  accessToken: string
  /** RFC 3339 */
  createdAt: string
  signedBy: string | null
  signatureData: string | null
  signedAt: string | null
  createdBy: Ref | null
  /** The WO currently leading the creator's team, if any; it decides who may approve. */
  creatorTeamWo: string | null
  items: QuoteItem[]
  history: QuoteEvent[]
}

export interface Category {
  id: string
  name: string
  active: boolean
}

/** A catalog product; stock null means not tracked. */
export interface Product {
  id: string
  name: string
  category: Ref
  unitPrice: Money
  unitCost: Money
  stock: Money | null
  active: boolean
}

export interface Client {
  id: string
  name: string
  email: string
}

// Failures mapped to ErrorResponse codes by the HTTP layer. Messages are "<kind>: <msg>" like the Go service.

export class NotFoundError extends Error {}

export class ConflictError extends Error {}

export class UnauthorizedError extends Error {}

export class ForbiddenError extends Error {}

export class ValidationError extends Error {
  constructor(readonly details: string[]) {
    super('request validation failed')
  }
}

export const notFound = (msg: string) => new NotFoundError(`not found: ${msg}`)
export const conflict = (msg: string) => new ConflictError(`conflict: ${msg}`)
export const unauthorized = (msg: string) => new UnauthorizedError(`unauthorized: ${msg}`)
export const invalid = (detail: string) => new ValidationError([detail])

/** The single 403 used by every backend. */
export const roleForbidden = () => new ForbiddenError('forbidden: your role cannot perform this action')

/** Collects validation details; check() throws when any were added. */
export class Problems {
  readonly details: string[] = []

  add(detail: string): void {
    this.details.push(detail)
  }

  check(): void {
    if (this.details.length > 0) throw new ValidationError(this.details)
  }
}

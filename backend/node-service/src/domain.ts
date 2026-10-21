// Core SwiftQuote types, independent of transport and storage.
// Monetary and quantity values are decimal strings or Decimal, never JS numbers.
import type { Decimal } from 'decimal.js'

export const QUOTE_STATUSES = ['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

/** States from which a client may still sign. */
export const ACCEPTABLE_STATUSES: QuoteStatus[] = ['draft', 'sent', 'viewed']

export function isQuoteStatus(s: string): s is QuoteStatus {
  return (QUOTE_STATUSES as readonly string[]).includes(s)
}

export interface QuoteItem {
  id: string
  title: string
  description: string | null
  quantity: Decimal
  unitPrice: Decimal
  discountPercent: Decimal
  taxPercent: Decimal
  lineTotal: Decimal
}

export interface Quote {
  id: string
  organizationId: string
  clientId: string
  dealId: string | null
  quoteNumber: string
  status: QuoteStatus
  /** YYYY-MM-DD */
  expiryDate: string
  subtotal: Decimal
  discountAmount: Decimal
  taxAmount: Decimal
  grandTotal: Decimal
  accessToken: string
  signedBy: string | null
  signatureData: string | null
  signedAt: Date | null
  createdAt: Date
  items: QuoteItem[]
}

export interface Client {
  id: string
  organizationId: string
  name: string
  email: string | null
}

/** A user and the tenant membership they log into. */
export interface Login {
  userId: string
  email: string
  passwordHash: string
  fullName: string
  organizationId: string
  role: string
}

// Failures mapped to ErrorResponse codes by the HTTP layer. Messages mirror the Go service.

export class NotFoundError extends Error {}

export class ConflictError extends Error {}

export class UnauthorizedError extends Error {}

export class ValidationError extends Error {
  constructor(readonly details: string[]) {
    super('request validation failed')
  }
}

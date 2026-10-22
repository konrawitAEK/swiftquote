import { isAxiosError } from 'axios'
import type { components } from '@/api/schema'

// Types generated from contracts/openapi.yaml (`make gen-types`).
export type Schemas = components['schemas']
export type QuoteStatus = Schemas['QuoteStatus']
export type Role = Schemas['Role']
export type ErrorResponse = Schemas['ErrorResponse']
export type LoginRequest = Schemas['LoginRequest']
export type AuthResponse = Schemas['AuthResponse']
export type Client = Schemas['Client']
export type ProductCategory = Schemas['ProductCategory']
export type CreateCategoryRequest = Schemas['CreateCategoryRequest']
export type UpdateCategoryRequest = Schemas['UpdateCategoryRequest']
export type CreateQuoteRequest = Schemas['CreateQuoteRequest']
export type CommentRequest = Schemas['CommentRequest']
export type AcceptQuoteRequest = Schemas['AcceptQuoteRequest']
export type QuoteSummary = Schemas['QuoteSummary']
export type QuoteDetail = Schemas['QuoteDetail']
export type PublicQuoteView = Schemas['PublicQuoteView']
export type DashboardSummary = Schemas['DashboardSummary']
export type AdminUser = Schemas['AdminUser']
export type CreateUserRequest = Schemas['CreateUserRequest']
export type UpdateUserRequest = Schemas['UpdateUserRequest']
export type Team = Schemas['Team']
export type TeamRequest = Schemas['TeamRequest']

/** Browser-facing API base URL, inlined at build time. */
export const PUBLIC_API_URL: string = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1'

function isErrorResponse(body: unknown): body is ErrorResponse {
  return typeof body === 'object' && body !== null && typeof (body as ErrorResponse).message === 'string'
}

/** True when the request never got an HTTP response (API down, DNS, CORS, ...). */
export function isNetworkError(err: unknown): boolean {
  return !isAxiosError(err) || !err.response
}

/**
 * Human-readable text for a failed call: the API's ErrorResponse, the fallback for an error status
 * without one, or "Cannot reach the API" when no response came back.
 */
export function errorText(err: unknown, fallback = 'Something went wrong'): string {
  if (isNetworkError(err)) return 'Cannot reach the API'
  const body: unknown = isAxiosError(err) ? err.response?.data : undefined
  if (!isErrorResponse(body)) return fallback
  return body.details?.length ? `${body.message}: ${body.details.join('; ')}` : body.message
}

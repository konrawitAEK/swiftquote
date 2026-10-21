import type { components } from '@/api/schema'

// Types generated from contracts/openapi.yaml (`make gen-types`).
export type Schemas = components['schemas']
export type QuoteStatus = Schemas['QuoteStatus']
export type Role = Schemas['Role']
export type ErrorResponse = Schemas['ErrorResponse']

/** Browser-facing API base URL, inlined at build time. */
export const PUBLIC_API_URL: string = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1'

/** Human-readable text for an ErrorResponse (or a network failure). */
export function errorText(error: ErrorResponse | undefined, fallback = 'Something went wrong'): string {
  if (!error) return fallback
  return error.details?.length ? `${error.message}: ${error.details.join('; ')}` : error.message
}

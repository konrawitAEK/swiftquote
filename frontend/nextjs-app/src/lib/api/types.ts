import { isAxiosError } from 'axios'
import type { ErrorResponse } from '@/models'

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

import createClient, { type Middleware } from 'openapi-fetch'
import type { components, paths } from './schema'

// Types generated from contracts/openapi.yaml (`make gen-types`).
export type Schemas = components['schemas']
export type QuoteStatus = Schemas['QuoteStatus']
export type Role = Schemas['Role']
export type ErrorResponse = Schemas['ErrorResponse']

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8080/api/v1'

const TOKEN_KEY = 'swiftquote.token'

// localStorage can throw (private mode, blocked storage); auth then lasts for the tab only.
let memoryToken: string | null = null

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken
  } catch {
    return memoryToken
  }
}

export function setToken(token: string | null): void {
  memoryToken = token
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // keep the in-memory copy
  }
}

/** Fired when an authenticated request comes back 401, so the app can return to login. */
export const AUTH_EXPIRED_EVENT = 'swiftquote:auth-expired'

const authMiddleware: Middleware = {
  onRequest({ request }) {
    const token = getToken()
    if (token) request.headers.set('Authorization', `Bearer ${token}`)
    return request
  },
  onResponse({ request, response }) {
    if (response.status === 401 && request.headers.has('Authorization')) {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
    }
    return response
  },
}

export const api = createClient<paths>({ baseUrl: API_URL })
api.use(authMiddleware)

/** Human-readable text for an ErrorResponse (or a network failure). */
export function errorText(error: ErrorResponse | undefined, fallback = 'Something went wrong'): string {
  if (!error) return fallback
  return error.details?.length ? `${error.message}: ${error.details.join('; ')}` : error.message
}

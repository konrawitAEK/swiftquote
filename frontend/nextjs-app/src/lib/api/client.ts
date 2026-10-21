'use client'

import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from '@/api/schema'
import { readCookie, TOKEN_COOKIE } from '@/lib/auth/session'
import { PUBLIC_API_URL } from './types'

export { errorText, type ErrorResponse, type QuoteStatus, type Role, type Schemas } from './types'

/** Fired when an authenticated request comes back 401, so the app can return to login. */
export const AUTH_EXPIRED_EVENT = 'swiftquote:auth-expired'

const authMiddleware: Middleware = {
  onRequest({ request }) {
    const token = readCookie(TOKEN_COOKIE)
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

/** Typed client for calls made from the browser (Client Components). */
export const api = createClient<paths>({ baseUrl: PUBLIC_API_URL })
api.use(authMiddleware)

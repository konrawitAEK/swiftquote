import axios, { isAxiosError } from 'axios'
import { readCookie, TOKEN_COOKIE } from '@/lib/auth/session'
import { PUBLIC_API_URL } from './types'

/** Fired when an authenticated request comes back 401, so the app can return to login. */
export const AUTH_EXPIRED_EVENT = 'swiftquote:auth-expired'

/** Axios instance for calls made from the browser (Client Components' services). */
export const http = axios.create({ baseURL: PUBLIC_API_URL })

// The share-link pages and login need no session, so they never get the token.
const PUBLIC_PATHS = /^\/(public\/|auth\/login$)/

http.interceptors.request.use((config) => {
  const token = readCookie(TOKEN_COOKIE)
  if (token && !PUBLIC_PATHS.test(config.url ?? '')) config.headers.set('Authorization', `Bearer ${token}`)
  return config
})

http.interceptors.response.use(undefined, (error: unknown) => {
  if (isAxiosError(error) && error.response?.status === 401 && error.config?.headers?.has('Authorization')) {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
  }
  return Promise.reject(error)
})

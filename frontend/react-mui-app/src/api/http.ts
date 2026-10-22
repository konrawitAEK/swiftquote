import axios, { isAxiosError } from 'axios'
import type { ErrorResponse } from '../models'

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

/** The one HTTP client every service uses. */
export const http = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
})

http.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.set('Authorization', `Bearer ${token}`)
  return config
})

http.interceptors.response.use(undefined, (error: unknown) => {
  if (isAxiosError(error) && error.response?.status === 401 && error.config?.headers.has('Authorization')) {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
  }
  return Promise.reject(error)
})

function isErrorResponse(data: unknown): data is ErrorResponse {
  return typeof data === 'object' && data !== null && typeof (data as { message?: unknown }).message === 'string'
}

/**
 * Human-readable text for a failed call: the API's ErrorResponse (`message: details; ...`),
 * `unreachable` when no response came back, or `fallback` otherwise.
 */
export function errorText(err: unknown, fallback = 'Something went wrong', unreachable = 'Cannot reach the API'): string {
  if (!isAxiosError(err)) return fallback
  if (!err.response) return unreachable
  const data: unknown = err.response.data
  if (!isErrorResponse(data)) return fallback
  return data.details?.length ? `${data.message}: ${data.details.join('; ')}` : data.message
}

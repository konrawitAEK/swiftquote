import axios, { isAxiosError } from 'axios'
import type { ErrorResponse } from '../models'

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8080/api/v1'

export const TOKEN_KEY = 'swiftquote.token'

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

/** The API's 400 `details` (one message per invalid field), or [] for any other failure. */
export function errorDetails(err: unknown): string[] {
  if (!isAxiosError(err) || !isErrorResponse(err.response?.data)) return []
  return err.response.data.details ?? []
}

/**
 * Downloads a file (`responseType: 'blob'`) and saves it in the browser. The name comes from
 * Content-Disposition when the API exposes it, else `fallbackName`. Error bodies arrive as a Blob too,
 * so they are parsed back into the ErrorResponse JSON for `errorText`.
 */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  try {
    const res = await http.get<Blob>(url, { responseType: 'blob', headers: { Accept: 'application/pdf, application/json' } })
    saveBlob(res.data, filenameFrom(res.headers['content-disposition']) ?? fallbackName)
  } catch (err) {
    if (isAxiosError(err) && err.response?.data instanceof Blob) {
      try {
        err.response.data = JSON.parse(await err.response.data.text())
      } catch {
        // not JSON; errorText falls back to its generic message
      }
    }
    throw err
  }
}

/** `attachment; filename="Q-1.pdf"` (or RFC 5987 `filename*=UTF-8''...`) to `Q-1.pdf`. */
export function filenameFrom(header: unknown): string | null {
  if (typeof header !== 'string') return null
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      // fall through to the plain form
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/.exec(header)
  const name = (plain?.[2] ?? plain?.[1])?.trim()
  return name || null
}

function saveBlob(blob: Blob, name: string): void {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 0)
}

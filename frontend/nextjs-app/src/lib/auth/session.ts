import { ROLE_LABELS } from './roles'
import type { AuthResponse, Role } from '@/models'

/** JWT for API calls; a cookie (not only browser storage) so Server Components can use it too. */
export const TOKEN_COOKIE = 'swiftquote_token'
/** The signed-in user ({id, name, role}) so the server can guard routes by role. */
export const USER_COOKIE = 'swiftquote_user'

export type AuthUser = AuthResponse['user']

/** The stored user, or null if missing, malformed or from an older version (unknown role). */
export function parseUser(raw: string | undefined | null): AuthUser | null {
  if (!raw) return null
  try {
    const user = JSON.parse(decodeURIComponent(raw)) as AuthUser
    return user && typeof user.id === 'string' && (user.role as Role) in ROLE_LABELS ? user : null
  } catch {
    return null
  }
}

export function encodeUser(user: AuthUser): string {
  return encodeURIComponent(JSON.stringify({ id: user.id, name: user.name, role: user.role }))
}

// Browser-only cookie helpers (document.cookie).

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const prefix = `${name}=`
  const hit = document.cookie.split('; ').find((c) => c.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

/** Seconds until the JWT's exp claim (0 if unreadable), so the session cookies die with the token. */
export function tokenMaxAge(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
    return typeof payload.exp === 'number' ? Math.max(0, Math.floor(payload.exp - Date.now() / 1000)) : 0
  } catch {
    return 0
  }
}

/** Sets a cookie for maxAge seconds, or deletes it when value is null. */
export function writeCookie(name: string, value: string | null, maxAge = 0): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie =
    value === null
      ? `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
      : `${name}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`
}

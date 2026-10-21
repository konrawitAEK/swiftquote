import type { Role, Schemas } from '@/lib/api/types'
import { ROLE_LABELS } from './roles'

/** JWT for API calls; a cookie (not only browser storage) so Server Components can use it too. */
export const TOKEN_COOKIE = 'swiftquote_token'
/** The signed-in user ({id, name, role}) so the server can guard routes by role. */
export const USER_COOKIE = 'swiftquote_user'
export const COOKIE_MAX_AGE = 7 * 24 * 60 * 60

export type AuthUser = Schemas['AuthResponse']['user']

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

export function writeCookie(name: string, value: string | null): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie =
    value === null
      ? `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
      : `${name}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`
}

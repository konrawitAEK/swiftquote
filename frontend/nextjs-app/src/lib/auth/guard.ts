import 'server-only'

import { jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { homePath, ROLE_LABELS } from './roles'
import { parseUser, TOKEN_COOKIE, USER_COOKIE, type AuthUser } from './session'
import type { Role } from '@/models'

// The secret the backends sign tokens with (server-side env only; never NEXT_PUBLIC_).
const secret = process.env.JWT_SECRET ? new TextEncoder().encode(process.env.JWT_SECRET) : null

/**
 * The session from the request cookies, or null. Identity and role come from the verified JWT, so editing
 * the readable user cookie cannot change what the server lets through; that cookie only supplies the name.
 */
export async function getSession(): Promise<AuthUser | null> {
  const jar = await cookies()
  const token = jar.get(TOKEN_COOKIE)?.value
  if (!token || !secret) return null
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })
    const role = payload.role as Role
    if (typeof payload.sub !== 'string' || !(role in ROLE_LABELS)) return null
    const stored = parseUser(jar.get(USER_COOKIE)?.value)
    return { id: payload.sub, role, name: stored?.id === payload.sub ? stored.name : '' }
  } catch {
    return null // bad signature or expired
  }
}

/** Server-side route guard: no session → /login; a role that may not open the page → its home. */
export async function requireRole(roles: Role[]): Promise<AuthUser> {
  const user = await getSession()
  if (!user) redirect('/logout')
  if (!roles.includes(user.role)) redirect(homePath(user.role))
  return user
}

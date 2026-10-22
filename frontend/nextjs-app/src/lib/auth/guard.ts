import 'server-only'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { homePath } from './roles'
import { parseUser, TOKEN_COOKIE, USER_COOKIE, type AuthUser } from './session'
import type { Role } from '@/models'

/** The session from the request cookies, or null. */
export async function getSession(): Promise<AuthUser | null> {
  const jar = await cookies()
  if (!jar.get(TOKEN_COOKIE)?.value) return null
  return parseUser(jar.get(USER_COOKIE)?.value)
}

/** Server-side route guard: no session → /login; a role that may not open the page → its home. */
export async function requireRole(roles: Role[]): Promise<AuthUser> {
  const user = await getSession()
  if (!user) redirect('/logout')
  if (!roles.includes(user.role)) redirect(homePath(user.role))
  return user
}

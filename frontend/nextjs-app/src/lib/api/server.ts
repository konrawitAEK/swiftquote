import 'server-only'

import createClient from 'openapi-fetch'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { paths } from '@/api/schema'
import { TOKEN_COOKIE } from '@/lib/auth/session'
import { PUBLIC_API_URL } from './types'

/** Inside docker the server reaches the API over the compose network, not via localhost. */
const SERVER_API_URL = process.env.API_INTERNAL_URL || PUBLIC_API_URL

/** Typed client for Server Components, authenticated with the session cookie. */
export async function serverApi() {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  return createClient<paths>({
    baseUrl: SERVER_API_URL,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: 'no-store',
  })
}

/** A 401 means the session is gone: clear the cookies (route handler) and land on /login. */
export function redirectIfUnauthorized(response: Response | undefined): void {
  if (response?.status === 401) redirect('/logout')
}

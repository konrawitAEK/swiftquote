import 'server-only'

import axios, { isAxiosError, type AxiosInstance } from 'axios'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { TOKEN_COOKIE } from '@/lib/auth/session'
import { PUBLIC_API_URL } from './types'

/** Inside docker the server reaches the API over the compose network, not via localhost. */
const SERVER_API_URL = process.env.API_INTERNAL_URL || PUBLIC_API_URL

/**
 * Axios instance for Server Components, authenticated with the session cookie.
 * A 401 means the API no longer accepts the session (e.g. the account was deactivated while the token is still
 * valid): show the login form with a notice. The next sign-in replaces the cookies.
 * redirect() throws, so callers that catch errors must call unstable_rethrow() first.
 */
export async function serverApi(): Promise<AxiosInstance> {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value
  const instance = axios.create({
    baseURL: SERVER_API_URL,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  instance.interceptors.response.use(undefined, (error: unknown) => {
    if (isAxiosError(error) && error.response?.status === 401) redirect('/login?expired=1')
    return Promise.reject(error)
  })
  return instance
}

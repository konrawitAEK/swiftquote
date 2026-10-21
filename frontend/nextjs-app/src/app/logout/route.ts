import { NextResponse } from 'next/server'
import { TOKEN_COOKIE, USER_COOKIE } from '@/lib/auth/session'

/** Clears the session cookies and goes to /login (used when the server sees a 401 or a broken session). */
export function GET() {
  // Relative Location: request.url inside the standalone container is http://0.0.0.0:3000.
  const res = new NextResponse(null, { status: 307, headers: { Location: '/login', 'Cache-Control': 'no-store' } })
  res.cookies.delete(TOKEN_COOKIE)
  res.cookies.delete(USER_COOKIE)
  return res
}

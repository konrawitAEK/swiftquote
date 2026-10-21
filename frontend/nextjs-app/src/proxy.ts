import { NextResponse, type NextRequest } from 'next/server'
import { TOKEN_COOKIE } from '@/lib/auth/session'

/** Cheap gate by cookie presence; pages still check the session and role on the server. */
export function proxy(request: NextRequest) {
  if (!request.cookies.get(TOKEN_COOKIE)?.value) {
    const login = request.nextUrl.clone()
    login.pathname = '/login'
    login.search = ''
    return NextResponse.redirect(login)
  }
  return NextResponse.next()
}

export const config = {
  // Everything except login/logout, the public client portal and static assets.
  matcher: ['/((?!login|logout|p/|_next/|icon\\.svg|favicon\\.ico).*)'],
}

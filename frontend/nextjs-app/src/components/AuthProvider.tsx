'use client'

import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AUTH_EXPIRED_EVENT } from '@/lib/api/http'
import { errorText, isNetworkError } from '@/lib/api/types'
import { authService } from '@/services/authService'
import {
  encodeUser,
  parseUser,
  readCookie,
  TOKEN_COOKIE,
  tokenMaxAge,
  USER_COOKIE,
  writeCookie,
  type AuthUser,
} from '@/lib/auth/session'

export interface AuthState {
  user: AuthUser | null
  /** Resolves to the signed-in user, or an error message. */
  login: (email: string, password: string) => Promise<AuthUser | string>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

/** Tells the app's other tabs that this tab signed in or out (cookies change silently, unlike localStorage). */
const SESSION_CHANNEL = 'swiftquote-session'

function announceSessionChange(): void {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(SESSION_CHANNEL)
  channel.postMessage('changed')
  channel.close()
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export function AuthProvider({ initialUser, children }: { initialUser: AuthUser | null; children: ReactNode }) {
  const [user, setUser] = useState(initialUser)
  const router = useRouter()

  const logout = useCallback(() => {
    writeCookie(TOKEN_COOKIE, null)
    writeCookie(USER_COOKIE, null)
    announceSessionChange()
    setUser(null)
    router.replace('/login')
    router.refresh()
  }, [router])

  useEffect(() => {
    window.addEventListener(AUTH_EXPIRED_EVENT, logout)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, logout)
  }, [logout])

  // Another tab logged out or signed in as someone else: reload, and the server routes this tab by the session
  // it now has. Checked on a broadcast and whenever the tab comes back into view (in case a message was missed).
  useEffect(() => {
    const sync = () => {
      const current = readCookie(TOKEN_COOKIE) ? parseUser(readCookie(USER_COOKIE)) : null
      if ((current?.id ?? null) !== (user?.id ?? null)) window.location.replace('/')
    }
    const onVisible = () => document.visibilityState === 'visible' && sync()
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(SESSION_CHANNEL)
    channel?.addEventListener('message', sync)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      channel?.close()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [user])

  const login = useCallback(async (email: string, password: string) => {
    try {
      const data = await authService.login({ email, password })
      const maxAge = tokenMaxAge(data.accessToken)
      writeCookie(TOKEN_COOKIE, data.accessToken, maxAge)
      writeCookie(USER_COOKIE, encodeUser(data.user), maxAge)
      announceSessionChange()
      setUser(data.user)
      return data.user
    } catch (e) {
      return isNetworkError(e) ? 'Cannot reach the API. Is the backend running on :8080?' : errorText(e, 'Login failed')
    }
  }, [])

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

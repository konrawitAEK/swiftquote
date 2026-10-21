'use client'

import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, AUTH_EXPIRED_EVENT, errorText } from '@/lib/api/client'
import { encodeUser, TOKEN_COOKIE, USER_COOKIE, writeCookie, type AuthUser } from '@/lib/auth/session'

export interface AuthState {
  user: AuthUser | null
  /** Resolves to the signed-in user, or an error message. */
  login: (email: string, password: string) => Promise<AuthUser | string>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

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
    setUser(null)
    router.replace('/login')
    router.refresh()
  }, [router])

  useEffect(() => {
    window.addEventListener(AUTH_EXPIRED_EVENT, logout)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, logout)
  }, [logout])

  const login = useCallback(async (email: string, password: string) => {
    try {
      const { data, error } = await api.POST('/auth/login', { body: { email, password } })
      if (!data) return errorText(error, 'Login failed')
      writeCookie(TOKEN_COOKIE, data.accessToken)
      writeCookie(USER_COOKIE, encodeUser(data.user))
      setUser(data.user)
      return data.user
    } catch {
      return 'Cannot reach the API. Is the backend running on :8080?'
    }
  }, [])

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

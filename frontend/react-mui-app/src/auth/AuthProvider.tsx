import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, AUTH_EXPIRED_EVENT, errorText, getToken, setToken } from '../api/client'
import { AuthContext, type AuthUser } from './auth'

const USER_KEY = 'swiftquote.user'

function loadUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

function saveUser(user: AuthUser | null): void {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  } catch {
    // non-essential: only used for the header greeting
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState(getToken)
  const [user, setUser] = useState(loadUser)

  const logout = useCallback(() => {
    setToken(null)
    saveUser(null)
    setTokenState(null)
    setUser(null)
  }, [])

  useEffect(() => {
    window.addEventListener(AUTH_EXPIRED_EVENT, logout)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, logout)
  }, [logout])

  const login = useCallback(async (email: string, password: string) => {
    try {
      const { data, error } = await api.POST('/auth/login', { body: { email, password } })
      if (!data) return errorText(error, 'Login failed')
      setToken(data.accessToken)
      saveUser(data.user)
      setTokenState(data.accessToken)
      setUser(data.user)
      return null
    } catch {
      return 'Cannot reach the API. Is the backend running on :8080?'
    }
  }, [])

  const value = useMemo(
    () => ({ isAuthenticated: token !== null, user, login, logout }),
    [token, user, login, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}


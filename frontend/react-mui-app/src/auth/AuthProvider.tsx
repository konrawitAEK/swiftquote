import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AUTH_EXPIRED_EVENT, errorText, getToken } from '../api/http'
import { AuthContext, type AuthUser } from './auth'
import { authService } from './authService'
import { ROLE_LABELS } from './roles'

const USER_KEY = 'swiftquote.user'

/** The stored user, or null if missing or from an older app version (unknown role). */
function loadUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    const user = raw ? (JSON.parse(raw) as AuthUser) : null
    return user && user.role in ROLE_LABELS ? user : null
  } catch {
    return null
  }
}

function saveUser(user: AuthUser | null): void {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  } catch {
    // non-essential: the session still works for this tab
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState(loadUser)
  // A token without a usable stored user (e.g. saved by an older version) is discarded.
  const [token, setTokenState] = useState(() => (user ? getToken() : null))

  const logout = useCallback(() => {
    authService.logout()
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
      const data = await authService.login(email, password)
      saveUser(data.user)
      setTokenState(data.accessToken)
      setUser(data.user)
      return null
    } catch (err) {
      return errorText(err, 'Login failed', 'Cannot reach the API. Is the backend running on :8080?')
    }
  }, [])

  const value = useMemo(
    () => ({ isAuthenticated: token !== null, user, login, logout }),
    [token, user, login, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}


import { createContext, useContext } from 'react'
import type { Schemas } from '../api/client'

export type AuthUser = Schemas['AuthResponse']['user']

export interface AuthState {
  isAuthenticated: boolean
  user: AuthUser | null
  /** Resolves to an error message, or null on success. */
  login: (email: string, password: string) => Promise<string | null>
  logout: () => void
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

import { http, setToken } from '../api/http'
import type { Schemas } from '../api/types'

export const authService = {
  /** Signs in and stores the access token for later requests. */
  async login(email: string, password: string): Promise<Schemas['AuthResponse']> {
    const body: Schemas['LoginRequest'] = { email, password }
    const { data } = await http.post<Schemas['AuthResponse']>('/auth/login', body)
    setToken(data.accessToken)
    return data
  },

  /** Forgets the stored token (the API is stateless, so there is no call to make). */
  logout(): void {
    setToken(null)
  },
}

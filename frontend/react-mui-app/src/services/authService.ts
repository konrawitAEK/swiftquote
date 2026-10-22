import { http, setToken } from '../api/http'
import type { AuthResponse, LoginRequest } from '../models'

export const authService = {
  /** Signs in and stores the access token for later requests. */
  async login(email: string, password: string): Promise<AuthResponse> {
    const body: LoginRequest = { email, password }
    const { data } = await http.post<AuthResponse>('/auth/login', body)
    setToken(data.accessToken)
    return data
  },

  /** Forgets the stored token (the API is stateless, so there is no call to make). */
  logout(): void {
    setToken(null)
  },
}

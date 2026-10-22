import { http } from '@/lib/api/http'
import type { AuthResponse, LoginRequest } from '@/lib/api/types'

export const authService = {
  async login(credentials: LoginRequest): Promise<AuthResponse> {
    const { data } = await http.post<AuthResponse>('/auth/login', credentials)
    return data
  },
}

import { http } from '../api/http'
import type { Schemas } from '../api/types'

type User = Schemas['AdminUser']
type Team = Schemas['Team']
type Category = Schemas['ProductCategory']

const byId = (base: string, id: string) => `${base}/${encodeURIComponent(id)}`

export const adminService = {
  async listUsers(): Promise<User[]> {
    const { data } = await http.get<User[]>('/admin/users')
    return data
  },

  async listTeams(): Promise<Team[]> {
    const { data } = await http.get<Team[]>('/admin/teams')
    return data
  },

  async listClients(): Promise<Schemas['Client'][]> {
    const { data } = await http.get<Schemas['Client'][]>('/clients')
    return data
  },

  async listCategories(): Promise<Category[]> {
    const { data } = await http.get<Category[]>('/categories')
    return data
  },

  async createUser(body: Schemas['CreateUserRequest']): Promise<User> {
    const { data } = await http.post<User>('/admin/users', body)
    return data
  },

  async updateUser(id: string, body: Schemas['UpdateUserRequest']): Promise<User> {
    const { data } = await http.put<User>(byId('/admin/users', id), body)
    return data
  },

  async createTeam(body: Schemas['TeamRequest']): Promise<Team> {
    const { data } = await http.post<Team>('/admin/teams', body)
    return data
  },

  async updateTeam(id: string, body: Schemas['TeamRequest']): Promise<Team> {
    const { data } = await http.put<Team>(byId('/admin/teams', id), body)
    return data
  },

  async createCategory(body: Schemas['CreateCategoryRequest']): Promise<Category> {
    const { data } = await http.post<Category>('/admin/categories', body)
    return data
  },

  async updateCategory(id: string, body: Schemas['UpdateCategoryRequest']): Promise<Category> {
    const { data } = await http.put<Category>(byId('/admin/categories', id), body)
    return data
  },

  /** Permanent delete (204); the API refuses with 409 when the row is still in use. */
  async remove(kind: 'user' | 'team' | 'category', id: string): Promise<void> {
    const base = { user: '/admin/users', team: '/admin/teams', category: '/admin/categories' }[kind]
    await http.post<void>(`${byId(base, id)}/delete`)
  },
}

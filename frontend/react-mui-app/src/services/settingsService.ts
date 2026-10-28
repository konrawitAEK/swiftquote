import { http } from '../api/http'
import type {
  AdminUser,
  Client,
  CreateCategoryRequest,
  CreateProductRequest,
  CreateUserRequest,
  Product,
  ProductCategory,
  Team,
  TeamRequest,
  UpdateCategoryRequest,
  UpdateProductRequest,
  UpdateUserRequest,
} from '../models'

type User = AdminUser
type Category = ProductCategory

const byId = (base: string, id: string) => `${base}/${encodeURIComponent(id)}`

export const settingsService = {
  async listUsers(): Promise<User[]> {
    const { data } = await http.get<User[]>('/admin/users')
    return data
  },

  async listTeams(): Promise<Team[]> {
    const { data } = await http.get<Team[]>('/admin/teams')
    return data
  },

  async listClients(): Promise<Client[]> {
    const { data } = await http.get<Client[]>('/clients')
    return data
  },

  async listCategories(): Promise<Category[]> {
    const { data } = await http.get<Category[]>('/categories')
    return data
  },

  async listProducts(): Promise<Product[]> {
    const { data } = await http.get<Product[]>('/products')
    return data
  },

  async createUser(body: CreateUserRequest): Promise<User> {
    const { data } = await http.post<User>('/admin/users', body)
    return data
  },

  async updateUser(id: string, body: UpdateUserRequest): Promise<User> {
    const { data } = await http.put<User>(byId('/admin/users', id), body)
    return data
  },

  async createTeam(body: TeamRequest): Promise<Team> {
    const { data } = await http.post<Team>('/admin/teams', body)
    return data
  },

  async updateTeam(id: string, body: TeamRequest): Promise<Team> {
    const { data } = await http.put<Team>(byId('/admin/teams', id), body)
    return data
  },

  async createCategory(body: CreateCategoryRequest): Promise<Category> {
    const { data } = await http.post<Category>('/admin/categories', body)
    return data
  },

  async updateCategory(id: string, body: UpdateCategoryRequest): Promise<Category> {
    const { data } = await http.put<Category>(byId('/admin/categories', id), body)
    return data
  },

  async createProduct(body: CreateProductRequest): Promise<Product> {
    const { data } = await http.post<Product>('/admin/products', body)
    return data
  },

  async updateProduct(id: string, body: UpdateProductRequest): Promise<Product> {
    const { data } = await http.put<Product>(byId('/admin/products', id), body)
    return data
  },

  /** Permanent delete (204); the API refuses with 409 when the row is still in use. */
  async remove(kind: 'user' | 'team' | 'category' | 'product', id: string): Promise<void> {
    const base = { user: '/admin/users', team: '/admin/teams', category: '/admin/categories', product: '/admin/products' }[kind]
    await http.post<void>(`${byId(base, id)}/delete`)
  },
}

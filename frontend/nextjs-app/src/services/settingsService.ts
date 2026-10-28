import type { AxiosInstance } from 'axios'
import { http } from '@/lib/api/http'
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
} from '@/models'

export type SettingsData = { users: AdminUser[]; teams: Team[]; clients: Client[]; categories: ProductCategory[]; products: Product[] }
export type DeleteKind = 'user' | 'team' | 'category' | 'product'

const DELETE_PATHS: Record<DeleteKind, string> = { user: 'users', team: 'teams', category: 'categories', product: 'products' }

async function get<T>(api: AxiosInstance, url: string): Promise<T> {
  const { data } = await api.get<T>(url)
  return data
}

/** Back Office settings (role admin). loadAll() runs on the server (pass serverApi()); the dialogs' writes run in the browser. */
export const settingsService = {
  /** Everything the console shows; on failure, rejects with the first failing call's error (users, teams, clients, categories, products). */
  async loadAll(api: AxiosInstance = http): Promise<SettingsData> {
    // Started together; awaited in order so the first failing call's error wins.
    const users = get<AdminUser[]>(api, '/admin/users')
    const teams = get<Team[]>(api, '/admin/teams')
    const clients = get<Client[]>(api, '/clients')
    const categories = get<ProductCategory[]>(api, '/categories')
    const products = get<Product[]>(api, '/products')
    for (const p of [users, teams, clients, categories, products]) p.catch(() => {}) // no unhandled rejections
    return {
      users: await users,
      teams: await teams,
      clients: await clients,
      categories: await categories,
      products: await products,
    }
  },

  async createUser(body: CreateUserRequest): Promise<AdminUser> {
    const { data } = await http.post<AdminUser>('/admin/users', body)
    return data
  },
  async updateUser(id: string, body: UpdateUserRequest): Promise<AdminUser> {
    const { data } = await http.put<AdminUser>(`/admin/users/${encodeURIComponent(id)}`, body)
    return data
  },

  async createTeam(body: TeamRequest): Promise<Team> {
    const { data } = await http.post<Team>('/admin/teams', body)
    return data
  },
  async updateTeam(id: string, body: TeamRequest): Promise<Team> {
    const { data } = await http.put<Team>(`/admin/teams/${encodeURIComponent(id)}`, body)
    return data
  },

  async createCategory(body: CreateCategoryRequest): Promise<ProductCategory> {
    const { data } = await http.post<ProductCategory>('/admin/categories', body)
    return data
  },
  async updateCategory(id: string, body: UpdateCategoryRequest): Promise<ProductCategory> {
    const { data } = await http.put<ProductCategory>(`/admin/categories/${encodeURIComponent(id)}`, body)
    return data
  },

  async createProduct(body: CreateProductRequest): Promise<Product> {
    const { data } = await http.post<Product>('/admin/products', body)
    return data
  },
  /** Full replace; also how a product is retired or reactivated (active). */
  async updateProduct(id: string, body: UpdateProductRequest): Promise<Product> {
    const { data } = await http.put<Product>(`/admin/products/${encodeURIComponent(id)}`, body)
    return data
  },

  /** Permanent delete (204); the API refuses (409) when the record is still in use. */
  async remove(kind: DeleteKind, id: string): Promise<void> {
    await http.post(`/admin/${DELETE_PATHS[kind]}/${encodeURIComponent(id)}/delete`)
  },
}

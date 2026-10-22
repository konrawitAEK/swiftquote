import { http } from '@/lib/api/http'
import type { Client, CreateQuoteRequest, ProductCategory, QuoteDetail } from '@/lib/api/types'

const quotePath = (id: string) => `/quotes/${encodeURIComponent(id)}`

export const quoteBuilderService = {
  async listCategories(): Promise<ProductCategory[]> {
    const { data } = await http.get<ProductCategory[]>('/categories')
    return data
  },
  async listClients(): Promise<Client[]> {
    const { data } = await http.get<Client[]>('/clients')
    return data
  },
  async get(id: string): Promise<QuoteDetail> {
    const { data } = await http.get<QuoteDetail>(quotePath(id))
    return data
  },
  async create(body: CreateQuoteRequest): Promise<QuoteDetail> {
    const { data } = await http.post<QuoteDetail>('/quotes', body)
    return data
  },
  async update(id: string, body: CreateQuoteRequest): Promise<QuoteDetail> {
    const { data } = await http.put<QuoteDetail>(quotePath(id), body)
    return data
  },
}

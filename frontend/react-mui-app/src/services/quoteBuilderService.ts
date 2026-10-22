import { http } from '../api/http'
import type { Client, CreateQuoteRequest, ProductCategory, QuoteDetail } from '../models'

type Quote = QuoteDetail

export const quoteBuilderService = {
  async listCategories(): Promise<ProductCategory[]> {
    const { data } = await http.get<ProductCategory[]>('/categories')
    return data
  },

  async listClients(): Promise<Client[]> {
    const { data } = await http.get<Client[]>('/clients')
    return data
  },

  async get(id: string): Promise<Quote> {
    const { data } = await http.get<Quote>(`/quotes/${encodeURIComponent(id)}`)
    return data
  },

  async create(body: CreateQuoteRequest): Promise<Quote> {
    const { data } = await http.post<Quote>('/quotes', body)
    return data
  },

  async update(id: string, body: CreateQuoteRequest): Promise<Quote> {
    const { data } = await http.put<Quote>(`/quotes/${encodeURIComponent(id)}`, body)
    return data
  },
}

import { http } from '../api/http'
import type { Schemas } from '../api/types'

type Quote = Schemas['QuoteDetail']

export const quoteBuilderService = {
  async listCategories(): Promise<Schemas['ProductCategory'][]> {
    const { data } = await http.get<Schemas['ProductCategory'][]>('/categories')
    return data
  },

  async listClients(): Promise<Schemas['Client'][]> {
    const { data } = await http.get<Schemas['Client'][]>('/clients')
    return data
  },

  async get(id: string): Promise<Quote> {
    const { data } = await http.get<Quote>(`/quotes/${encodeURIComponent(id)}`)
    return data
  },

  async create(body: Schemas['CreateQuoteRequest']): Promise<Quote> {
    const { data } = await http.post<Quote>('/quotes', body)
    return data
  },

  async update(id: string, body: Schemas['CreateQuoteRequest']): Promise<Quote> {
    const { data } = await http.put<Quote>(`/quotes/${encodeURIComponent(id)}`, body)
    return data
  },
}

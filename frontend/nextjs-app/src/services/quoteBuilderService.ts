import type { AxiosInstance } from 'axios'
import { http } from '@/lib/api/http'
import type { Client, CreateQuoteRequest, Product, QuoteDetail } from '@/models'

const quotePath = (id: string) => `/quotes/${encodeURIComponent(id)}`

/** Reads run on the server (pass serverApi()); saving runs in the browser. */
export const quoteBuilderService = {
  /** All products, retired ones included; only active ones may go on a line. */
  async listProducts(api: AxiosInstance = http): Promise<Product[]> {
    const { data } = await api.get<Product[]>('/products')
    return data
  },
  async listClients(api: AxiosInstance = http): Promise<Client[]> {
    const { data } = await api.get<Client[]>('/clients')
    return data
  },
  async get(id: string, api: AxiosInstance = http): Promise<QuoteDetail> {
    const { data } = await api.get<QuoteDetail>(quotePath(id))
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

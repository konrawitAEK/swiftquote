import type { AxiosInstance } from 'axios'
import { http } from '@/lib/api/http'
import type { QuoteStatus, QuoteSummary } from '@/models'

/** Reads take the axios instance: serverApi() from the page's Server Component, the browser's http by default. */
export const quotesService = {
  /** Quotes visible to the signed-in user, optionally filtered by status. */
  async list(status?: QuoteStatus, api: AxiosInstance = http): Promise<QuoteSummary[]> {
    const { data } = await api.get<QuoteSummary[]>('/quotes', { params: status ? { status } : {} })
    return data
  },
}

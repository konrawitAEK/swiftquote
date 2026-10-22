import { http } from '../api/http'
import type { QuoteStatus, QuoteSummary } from '../models'

export const quotesService = {
  async list(status?: QuoteStatus): Promise<QuoteSummary[]> {
    const { data } = await http.get<QuoteSummary[]>('/quotes', { params: status ? { status } : {} })
    return data
  },
}

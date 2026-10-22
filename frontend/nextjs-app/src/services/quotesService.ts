import { http } from '@/lib/api/http'
import type { QuoteStatus, QuoteSummary } from '@/models'

export const quotesService = {
  /** Quotes visible to the signed-in user, optionally filtered by status. */
  async list(status?: QuoteStatus): Promise<QuoteSummary[]> {
    const { data } = await http.get<QuoteSummary[]>('/quotes', { params: status ? { status } : {} })
    return data
  },
}

import { http } from '../../api/http'
import type { QuoteStatus, Schemas } from '../../api/types'

export const quotesService = {
  async list(status?: QuoteStatus): Promise<Schemas['QuoteSummary'][]> {
    const { data } = await http.get<Schemas['QuoteSummary'][]>('/quotes', { params: status ? { status } : {} })
    return data
  },
}

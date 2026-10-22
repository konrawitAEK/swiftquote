import { http } from '../api/http'
import type { AcceptQuoteRequest, CommentRequest, PublicQuoteView, QuoteDetail } from '../models'

const publicPath = (accessToken: string, action?: string) =>
  `/public/quotes/${encodeURIComponent(accessToken)}${action ? `/${action}` : ''}`

export const publicQuoteService = {
  async get(accessToken: string): Promise<PublicQuoteView> {
    const { data } = await http.get<PublicQuoteView>(publicPath(accessToken))
    return data
  },

  async accept(accessToken: string, body: AcceptQuoteRequest): Promise<QuoteDetail> {
    const { data } = await http.post<QuoteDetail>(publicPath(accessToken, 'accept'), body)
    return data
  },

  async reject(accessToken: string, comment: string | null): Promise<QuoteDetail> {
    const body: CommentRequest = { comment }
    const { data } = await http.post<QuoteDetail>(publicPath(accessToken, 'reject'), body)
    return data
  },
}

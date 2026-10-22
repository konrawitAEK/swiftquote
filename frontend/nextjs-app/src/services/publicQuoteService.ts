import { http } from '@/lib/api/http'
import type { AcceptQuoteRequest, CommentRequest, PublicQuoteView, QuoteDetail } from '@/models'

const quotePath = (accessToken: string) => `/public/quotes/${encodeURIComponent(accessToken)}`

/** Client portal calls: no login, addressed by the quote's access token. */
export const publicQuoteService = {
  async get(accessToken: string): Promise<PublicQuoteView> {
    const { data } = await http.get<PublicQuoteView>(quotePath(accessToken))
    return data
  },
  async accept(accessToken: string, body: AcceptQuoteRequest): Promise<QuoteDetail> {
    const { data } = await http.post<QuoteDetail>(`${quotePath(accessToken)}/accept`, body)
    return data
  },
  async reject(accessToken: string, comment: CommentRequest['comment']): Promise<QuoteDetail> {
    const body: CommentRequest = { comment }
    const { data } = await http.post<QuoteDetail>(`${quotePath(accessToken)}/reject`, body)
    return data
  },
}

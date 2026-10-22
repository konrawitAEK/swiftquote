import { http } from '../../api/http'
import type { Schemas } from '../../api/types'

const publicPath = (accessToken: string, action?: string) =>
  `/public/quotes/${encodeURIComponent(accessToken)}${action ? `/${action}` : ''}`

export const publicQuoteService = {
  async get(accessToken: string): Promise<Schemas['PublicQuoteView']> {
    const { data } = await http.get<Schemas['PublicQuoteView']>(publicPath(accessToken))
    return data
  },

  async accept(accessToken: string, body: Schemas['AcceptQuoteRequest']): Promise<Schemas['QuoteDetail']> {
    const { data } = await http.post<Schemas['QuoteDetail']>(publicPath(accessToken, 'accept'), body)
    return data
  },

  async reject(accessToken: string, comment: string | null): Promise<Schemas['QuoteDetail']> {
    const body: Schemas['CommentRequest'] = { comment }
    const { data } = await http.post<Schemas['QuoteDetail']>(publicPath(accessToken, 'reject'), body)
    return data
  },
}

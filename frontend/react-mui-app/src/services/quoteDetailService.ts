import { http } from '../api/http'
import type { Schemas } from '../api/types'

type Quote = Schemas['QuoteDetail']

const quotePath = (id: string, action?: string) => `/quotes/${encodeURIComponent(id)}${action ? `/${action}` : ''}`

/** Workflow actions that take an optional comment. */
async function withComment(id: string, action: 'submit' | 'approve' | 'return' | 'reject', comment: string | null): Promise<Quote> {
  const body: Schemas['CommentRequest'] = { comment }
  const { data } = await http.post<Quote>(quotePath(id, action), body)
  return data
}

export const quoteDetailService = {
  async get(id: string): Promise<Quote> {
    const { data } = await http.get<Quote>(quotePath(id))
    return data
  },

  submit: (id: string, comment: string | null) => withComment(id, 'submit', comment),
  approve: (id: string, comment: string | null) => withComment(id, 'approve', comment),
  return: (id: string, comment: string | null) => withComment(id, 'return', comment),
  reject: (id: string, comment: string | null) => withComment(id, 'reject', comment),

  async send(id: string): Promise<Quote> {
    const { data } = await http.post<Quote>(quotePath(id, 'send'))
    return data
  },

  async accept(id: string, body: Schemas['AcceptQuoteRequest']): Promise<Quote> {
    const { data } = await http.post<Quote>(quotePath(id, 'accept'), body)
    return data
  },
}

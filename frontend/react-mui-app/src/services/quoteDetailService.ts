import { http } from '../api/http'
import type { AcceptQuoteRequest, CommentRequest, QuoteDetail } from '../models'

type Quote = QuoteDetail

const quotePath = (id: string, action?: string) => `/quotes/${encodeURIComponent(id)}${action ? `/${action}` : ''}`

/** Workflow actions that take an optional comment. */
async function withComment(id: string, action: 'submit' | 'approve' | 'return' | 'reject', comment: string | null): Promise<Quote> {
  const body: CommentRequest = { comment }
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

  async accept(id: string, body: AcceptQuoteRequest): Promise<Quote> {
    const { data } = await http.post<Quote>(quotePath(id, 'accept'), body)
    return data
  },
}

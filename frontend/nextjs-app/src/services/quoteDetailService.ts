import { http } from '@/lib/api/http'
import type { AcceptQuoteRequest, CommentRequest, QuoteDetail } from '@/lib/api/types'

type Comment = CommentRequest['comment']

const quotePath = (id: string) => `/quotes/${encodeURIComponent(id)}`

async function transition(id: string, action: 'submit' | 'approve' | 'return' | 'reject', comment: Comment): Promise<QuoteDetail> {
  const body: CommentRequest = { comment }
  const { data } = await http.post<QuoteDetail>(`${quotePath(id)}/${action}`, body)
  return data
}

export const quoteDetailService = {
  async get(id: string): Promise<QuoteDetail> {
    const { data } = await http.get<QuoteDetail>(quotePath(id))
    return data
  },
  submit: (id: string, comment: Comment) => transition(id, 'submit', comment),
  approve: (id: string, comment: Comment) => transition(id, 'approve', comment),
  return: (id: string, comment: Comment) => transition(id, 'return', comment),
  reject: (id: string, comment: Comment) => transition(id, 'reject', comment),
  async send(id: string): Promise<QuoteDetail> {
    const { data } = await http.post<QuoteDetail>(`${quotePath(id)}/send`)
    return data
  },
  async accept(id: string, body: AcceptQuoteRequest): Promise<QuoteDetail> {
    const { data } = await http.post<QuoteDetail>(`${quotePath(id)}/accept`, body)
    return data
  },
}

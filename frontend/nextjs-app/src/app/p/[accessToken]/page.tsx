import type { Metadata } from 'next'
import { PublicQuote } from './PublicQuote'

export const metadata: Metadata = { title: 'Quotation · SwiftQuote', robots: { index: false } }

/** Client portal: no login, addressed by the quote's access token. */
export default async function PublicQuotePage({ params }: { params: Promise<{ accessToken: string }> }) {
  const { accessToken } = await params
  return <PublicQuote accessToken={accessToken} />
}

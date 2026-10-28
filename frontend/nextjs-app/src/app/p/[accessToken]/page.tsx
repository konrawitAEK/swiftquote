import type { Metadata } from 'next'
import { PublicQuote } from './PublicQuote'

export const metadata: Metadata = { title: 'Quotation · SwiftQuote', robots: { index: false } }

/**
 * Client portal: no login, addressed by the quote's access token.
 * Deliberately fetched in the browser, unlike the signed-in pages: the first GET marks the quote "viewed", and
 * link-preview bots (Slack, LINE unfurls) fetch the HTML without running JS. Rendering it on the server would let
 * them mark quotes viewed that no customer opened.
 */
export default async function PublicQuotePage({ params }: { params: Promise<{ accessToken: string }> }) {
  const { accessToken } = await params
  return <PublicQuote accessToken={accessToken} />
}

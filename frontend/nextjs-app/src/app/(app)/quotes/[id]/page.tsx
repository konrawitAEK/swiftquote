import { unstable_rethrow } from 'next/navigation'
import { serverApi } from '@/lib/api/server'
import { errorText } from '@/lib/api/types'
import { requireRole } from '@/lib/auth/guard'
import { quoteDetailService } from '@/services/quoteDetailService'
import type { QuoteDetail as Quote } from '@/models'
import { QuoteDetail } from './QuoteDetail'

/**
 * Server Component: the quote (lines and history) is fetched on the server with the session cookie. A missing
 * or hidden quote (404) shows the API's message in the view's error alert.
 */
export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, { id }] = await Promise.all([requireRole(['rm', 'wo', 'woc', 'customer']), params])

  let quote: Quote | null = null
  let error: string | null = null
  try {
    quote = await quoteDetailService.get(id, await serverApi())
  } catch (e) {
    unstable_rethrow(e) // a 401 redirect() works by throwing; let it through.
    error = errorText(e, 'Could not load quotation')
  }

  return <QuoteDetail id={id} role={user.role} quote={quote} error={error} />
}

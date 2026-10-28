import { unstable_rethrow } from 'next/navigation'
import { serverApi } from '@/lib/api/server'
import { errorText, isNetworkError } from '@/lib/api/types'
import { requireRole } from '@/lib/auth/guard'
import { STATUS_LABELS } from '@/lib/auth/roles'
import { quotesService } from '@/services/quotesService'
import type { QuoteStatus, QuoteSummary } from '@/models'
import { QuotesList } from './QuotesList'

/** A QuoteStatus search param, or '' (no filter) when absent or unknown. */
function statusParam(value: string | string[] | undefined): QuoteStatus | '' {
  return typeof value === 'string' && Object.hasOwn(STATUS_LABELS, value) ? (value as QuoteStatus) : ''
}

/**
 * Server Component: the list is fetched on the server with the session cookie; the filter comes from ?status=
 * so a filter change is a server round-trip.
 */
export default async function QuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, sp] = await Promise.all([requireRole(['rm', 'wo', 'woc', 'customer']), searchParams])
  const status = statusParam(sp.status)

  let quotes: QuoteSummary[] | null = null
  let error: string | null = null
  try {
    quotes = await quotesService.list(status || undefined, await serverApi())
  } catch (e) {
    unstable_rethrow(e) // a 401 redirect() works by throwing; let it through.
    if (!isNetworkError(e)) quotes = []
    error = errorText(e, 'Could not load quotes')
  }

  return <QuotesList role={user.role} quotes={quotes} error={error} status={status} />
}

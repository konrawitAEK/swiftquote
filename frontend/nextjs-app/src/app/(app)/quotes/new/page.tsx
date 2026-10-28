import { requireRole } from '@/lib/auth/guard'
import { loadBuilder } from '../_builder/loadBuilder'
import { QuoteBuilder } from '../_builder/QuoteBuilder'

/** Server Component: clients and products are fetched on the server; saving happens in the browser. */
export default async function NewQuotePage() {
  await requireRole(['rm'])
  return <QuoteBuilder data={await loadBuilder()} />
}

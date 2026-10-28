import { requireRole } from '@/lib/auth/guard'
import { loadBuilder } from '../../_builder/loadBuilder'
import { QuoteBuilder } from '../../_builder/QuoteBuilder'

/** Server Component: the draft, clients and products are fetched on the server; saving happens in the browser. */
export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const [, { id }] = await Promise.all([requireRole(['rm']), params])
  return <QuoteBuilder id={id} data={await loadBuilder(id)} />
}

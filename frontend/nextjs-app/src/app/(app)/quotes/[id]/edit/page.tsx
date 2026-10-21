import { requireRole } from '@/lib/auth/guard'
import { QuoteBuilder } from '../../_builder/QuoteBuilder'

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const [, { id }] = await Promise.all([requireRole(['rm']), params])
  return <QuoteBuilder id={id} />
}

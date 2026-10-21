import { requireRole } from '@/lib/auth/guard'
import { QuoteBuilder } from '../_builder/QuoteBuilder'

export default async function NewQuotePage() {
  await requireRole(['rm'])
  return <QuoteBuilder />
}

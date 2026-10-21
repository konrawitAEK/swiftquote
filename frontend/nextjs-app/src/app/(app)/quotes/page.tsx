import { requireRole } from '@/lib/auth/guard'
import { QuotesList } from './QuotesList'

export default async function QuotesPage() {
  const user = await requireRole(['rm', 'wo', 'woc', 'customer'])
  return <QuotesList role={user.role} />
}

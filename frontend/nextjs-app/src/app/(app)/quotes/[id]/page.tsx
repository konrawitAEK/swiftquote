import { requireRole } from '@/lib/auth/guard'
import { QuoteDetail } from './QuoteDetail'

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, { id }] = await Promise.all([requireRole(['rm', 'wo', 'woc', 'customer']), params])
  return <QuoteDetail id={id} role={user.role} />
}

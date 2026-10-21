import { requireRole } from '@/lib/auth/guard'
import { AdminConsole } from './AdminConsole'

export default async function AdminPage() {
  await requireRole(['admin'])
  return <AdminConsole />
}

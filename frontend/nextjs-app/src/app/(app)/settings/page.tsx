import { requireRole } from '@/lib/auth/guard'
import { SettingsConsole } from './SettingsConsole'

/** Back Office (role admin): users, teams, product categories and products. */
export default async function SettingsPage() {
  await requireRole(['admin'])
  return <SettingsConsole />
}

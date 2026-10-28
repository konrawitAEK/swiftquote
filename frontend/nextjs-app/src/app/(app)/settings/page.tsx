import { unstable_rethrow } from 'next/navigation'
import { serverApi } from '@/lib/api/server'
import { errorText } from '@/lib/api/types'
import { requireRole } from '@/lib/auth/guard'
import { settingsService, type SettingsData } from '@/services/settingsService'
import { SettingsConsole } from './SettingsConsole'

/**
 * Back Office (role admin): users, teams, product categories and products.
 * Server Component: everything the console shows is fetched on the server with the session cookie.
 */
export default async function SettingsPage() {
  await requireRole(['admin'])

  let data: SettingsData | null = null
  let error: string | null = null
  try {
    data = await settingsService.loadAll(await serverApi())
  } catch (e) {
    unstable_rethrow(e) // a 401 redirect() works by throwing; let it through.
    error = errorText(e, 'Could not load')
  }

  return <SettingsConsole data={data} error={error} />
}

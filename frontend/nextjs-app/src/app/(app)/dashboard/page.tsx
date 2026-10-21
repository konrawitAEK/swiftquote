import { Box, Typography } from '@mui/material'
import { unstable_rethrow } from 'next/navigation'
import { errorText } from '@/lib/api/types'
import { redirectIfUnauthorized, serverApi } from '@/lib/api/server'
import { requireRole } from '@/lib/auth/guard'
import { DashboardView } from './DashboardView'
import type { Summary } from './measures'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** A YYYY-MM-DD search param, or '' when absent or malformed. */
function dateParam(value: string | string[] | undefined): string {
  return typeof value === 'string' && ISO_DATE.test(value) ? value : ''
}

/**
 * Server Component: the summary is fetched on the server with the session cookie; the period comes
 * from ?from=&to= so a date change is a server round-trip. The view toggles live in DashboardView.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [, sp] = await Promise.all([requireRole(['woc']), searchParams])
  const from = dateParam(sp.from)
  const to = dateParam(sp.to)

  let data: Summary | null = null
  let error: string | null = null
  try {
    const api = await serverApi()
    const res = await api.GET('/dashboard/summary', { params: { query: { ...(from ? { from } : {}), ...(to ? { to } : {}) } } })
    redirectIfUnauthorized(res.response)
    data = res.data ?? null
    if (!data) error = errorText(res.error, 'Could not load the dashboard')
  } catch (e) {
    unstable_rethrow(e) // redirect() works by throwing; let it through.
    error = 'Cannot reach the API'
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          Sales dashboard
        </Typography>
        <Typography color="text.secondary">Quotations created in the selected period</Typography>
      </Box>
      <DashboardView data={data} error={error} from={from} to={to} />
    </Box>
  )
}

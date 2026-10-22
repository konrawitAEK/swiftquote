import 'server-only'

import { serverApi } from '@/lib/api/server'
import type { DashboardSummary } from '@/lib/api/types'

/** Server-side: called from the dashboard Server Component with the session cookie. */
export const dashboardService = {
  /** from/to are YYYY-MM-DD; empty means no bound. A 401 redirects (rethrow it with unstable_rethrow). */
  async getSummary(range: { from: string; to: string }): Promise<DashboardSummary> {
    const api = await serverApi()
    const params = { ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) }
    const { data } = await api.get<DashboardSummary>('/dashboard/summary', { params })
    return data
  },
}

import { http } from '../api/http'
import type { DashboardSummary } from '../models'

export const dashboardService = {
  /** `from` / `to` are ISO dates; empty means unbounded. */
  async summary(from?: string, to?: string): Promise<DashboardSummary> {
    const params = { ...(from ? { from } : {}), ...(to ? { to } : {}) }
    const { data } = await http.get<DashboardSummary>('/dashboard/summary', { params })
    return data
  },
}

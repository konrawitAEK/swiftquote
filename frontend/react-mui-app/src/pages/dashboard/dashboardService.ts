import { http } from '../../api/http'
import type { Schemas } from '../../api/types'

export const dashboardService = {
  /** `from` / `to` are ISO dates; empty means unbounded. */
  async summary(from?: string, to?: string): Promise<Schemas['DashboardSummary']> {
    const params = { ...(from ? { from } : {}), ...(to ? { to } : {}) }
    const { data } = await http.get<Schemas['DashboardSummary']>('/dashboard/summary', { params })
    return data
  },
}

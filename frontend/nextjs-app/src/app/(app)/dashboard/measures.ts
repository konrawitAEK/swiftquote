import type { DashboardSummary, Measure } from '@/models'

export type Summary = DashboardSummary
export type { Measure } from '@/models'

/** Which figure the dashboard ranks and charts. */
export type MeasureKey = 'won' | 'pending'

/** The three views the WOC can switch between. */
export type View = 'won' | 'pending' | 'category'

export const MEASURE_LABELS: Record<MeasureKey, string> = {
  won: 'Sold',
  pending: 'Waiting on customer',
}

/** Rows sorted by the selected measure's amount, largest first (the API sorts by won). */
export function byAmount<T extends Record<MeasureKey, Measure>>(rows: T[], key: MeasureKey): T[] {
  return [...rows].sort((a, b) => b[key].amount - a[key].amount)
}

export const maxAmount = (rows: Measure[]) => Math.max(0, ...rows.map((m) => m.amount))

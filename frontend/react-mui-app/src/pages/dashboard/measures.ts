import type { DashboardSummary, Measure } from '../../models'
import { formatMoney } from '../../pricing/pricing'

export type Summary = DashboardSummary
export type { Measure } from '../../models'

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

const MINUS = '−'

/** Profit over revenue, profit / (cost + profit), on the lines that have a cost; null when there are none. */
export function margin(m: Pick<Measure, 'cost' | 'profit'>): number | null {
  const revenue = m.cost + m.profit
  return revenue === 0 ? null : m.profit / revenue
}

/** Margin to one decimal place ("12.3%", "−4.0%"), or "—" when cost + profit is 0. */
export function formatMargin(m: Pick<Measure, 'cost' | 'profit'>): string {
  const r = margin(m)
  if (r === null) return '—'
  const pct = Math.round(Math.abs(r) * 1000 + Number.EPSILON) / 10
  return `${r < 0 && pct > 0 ? MINUS : ''}${pct.toFixed(1)}%`
}

/** Money with a true minus sign for losses ("−฿1,200.00"); zero and gains are unsigned. */
export function formatSignedMoney(value: number): string {
  return value < 0 ? MINUS + formatMoney(-value) : formatMoney(value)
}

/** True when the measure lost money, for the error colour. */
export const isLoss = (m: Pick<Measure, 'profit'>) => m.profit < 0

/** The stat tile's second line: "Profit ฿X · Y% margin". */
export const profitLine = (m: Pick<Measure, 'cost' | 'profit'>) => `Profit ${formatSignedMoney(m.profit)} · ${formatMargin(m)} margin`

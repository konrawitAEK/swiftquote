'use client'

import {
  Alert,
  Box,
  Card,
  CardContent,
  LinearProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { usePathname, useRouter } from 'next/navigation'
import { useOptimistic, useState, useTransition } from 'react'
import { StatusChip } from '@/components/StatusChip'
import { formatMoney } from '@/lib/pricing/pricing'
import { CategoryBreakdown } from './CategoryBreakdown'
import { DateRange } from './DateRange'
import { type MeasureKey, type Summary, type View } from './measures'
import { MonthlyBars } from './MonthlyBars'
import { RankTables } from './RankTables'
import { StatTile } from './StatTile'

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 })

/** Client Component: Sold / Pending / By product category toggles over the server-fetched summary. */
export function DashboardView({ data, error, from, to }: { data: Summary | null; error: string | null; from: string; to: string }) {
  const [view, setView] = useState<View>('won')
  const [categoryMeasure, setCategoryMeasure] = useState<MeasureKey>('won')
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const pathname = usePathname()

  // Shows the new dates at once while the server renders the new period.
  const [period, setOptimisticPeriod] = useOptimistic({ from, to })

  const setPeriod = (nextFrom: string, nextTo: string) => {
    const q = new URLSearchParams()
    if (nextFrom) q.set('from', nextFrom)
    if (nextTo) q.set('to', nextTo)
    const qs = q.toString()
    startTransition(() => {
      setOptimisticPeriod({ from: nextFrom, to: nextTo })
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    })
  }

  const measure: MeasureKey = view === 'category' ? categoryMeasure : view

  return (
    <Stack spacing={3}>
      {/* One control row: view, then period. */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { md: 'center' } }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
          <ToggleButtonGroup exclusive size="small" color="primary" value={view} onChange={(_, v: View | null) => v && setView(v)}>
            <ToggleButton value="won">Sold</ToggleButton>
            <ToggleButton value="pending">Pending</ToggleButton>
            <ToggleButton value="category">By product category</ToggleButton>
          </ToggleButtonGroup>
          {view === 'category' && (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={categoryMeasure}
              onChange={(_, v: MeasureKey | null) => v && setCategoryMeasure(v)}
            >
              <ToggleButton value="won">Sold</ToggleButton>
              <ToggleButton value="pending">Pending</ToggleButton>
            </ToggleButtonGroup>
          )}
        </Stack>
        <DateRange from={period.from} to={period.to} onChange={setPeriod} />
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {pending && <LinearProgress />}

      {data && (
        <>
          <Tiles data={data} view={view} measure={measure} />

          {view === 'category' ? (
            <CategoryBreakdown data={data} measure={measure} />
          ) : (
            <Card>
              <CardContent>
                <Typography variant="h6">{view === 'won' ? 'Sold by month' : 'Pending by expiry month'}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {view === 'won'
                    ? 'Grand total incl. VAT, by the month the customer signed'
                    : 'Grand total incl. VAT of quotes waiting on the customer, by the month they expire'}
                </Typography>
                <MonthlyBars
                  points={data.byMonth.map((m) => ({ month: m.month, value: m[view] }))}
                  empty={view === 'won' ? 'No accepted quotations in this period yet.' : 'Nothing is waiting on customers.'}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>
                Pipeline by status
              </Typography>
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
                {data.byStatus
                  .filter((s) => s.status !== 'expired')
                  .map((s) => (
                    <Stack key={s.status} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <StatusChip status={s.status} />
                      <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>{s.count}</Typography>
                    </Stack>
                  ))}
              </Stack>
            </CardContent>
          </Card>

          <RankTables data={data} measure={measure} />
        </>
      )}
    </Stack>
  )
}

function Tiles({ data, view, measure }: { data: Summary; view: View; measure: MeasureKey }) {
  const grid = { display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '2fr 1fr 1fr 1fr' } }
  if (view === 'pending') {
    return (
      <Box sx={grid}>
        <StatTile label="Waiting on customers" value={formatMoney(data.pending.amount)} profit={data.pending} hero />
        <StatTile label="Quotes waiting" value={String(data.pending.count)} hint="sent or viewed, not expired" />
        <StatTile label="In internal approval" value={formatMoney(data.inApproval.amount)} profit={data.inApproval} hint={`${data.inApproval.count} ${data.inApproval.count === 1 ? 'quote' : 'quotes'} not yet sent`} />
        <StatTile label="Sold so far" value={formatMoney(data.won.amount)} profit={data.won} />
      </Box>
    )
  }
  if (view === 'category') {
    const rows = data.byCategory.filter((r) => r[measure].count > 0)
    const top = [...rows].sort((a, b) => b[measure].amount - a[measure].amount)[0]
    return (
      <Box sx={grid}>
        <StatTile label={measure === 'won' ? 'Sold' : 'Waiting on customers'} value={formatMoney(data[measure].amount)} profit={data[measure]} hero />
        <StatTile label="Top category" value={top ? (top.category?.name ?? 'Uncategorized') : '—'} />
        <StatTile label="Top category amount" value={top ? formatMoney(top[measure].amount) : '—'} profit={top?.[measure]} />
        <StatTile label="Categories" value={String(rows.length)} hint="with lines in this view" />
      </Box>
    )
  }
  return (
    <Box sx={grid}>
      <StatTile label="Sold" value={formatMoney(data.won.amount)} profit={data.won} hero />
      <StatTile label="Quotes won" value={String(data.won.count)} />
      <StatTile label="Quotes sent" value={String(data.sentCount)} />
      <StatTile label="Conversion" value={percent.format(data.conversionRate)} hint="won ÷ sent" />
    </Box>
  )
}

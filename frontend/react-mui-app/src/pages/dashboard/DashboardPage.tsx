import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  LinearProgress,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { errorText } from '../../api/http'
import { StatusChip } from '../../components/StatusChip'
import { formatMoney } from '../../pricing/pricing'
import { CategoryBreakdown } from './CategoryBreakdown'
import { dashboardService } from './dashboardService'
import { type MeasureKey, type Summary, type View } from './measures'
import { MonthlyBars } from './MonthlyBars'
import { RankTables } from './RankTables'
import { StatTile } from './StatTile'

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 })

/** Sales summary for WOC: sold, waiting on customers, or by product category. */
export function DashboardPage() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [view, setView] = useState<View>('won')
  const [categoryMeasure, setCategoryMeasure] = useState<MeasureKey>('won')
  const [data, setData] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    dashboardService
      .summary(from, to)
      .then((data) => {
        if (cancelled) return
        setData(data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setData(null)
        setError(errorText(err, 'Could not load the dashboard'))
      })
    return () => {
      cancelled = true
    }
  }, [from, to])

  const measure: MeasureKey = view === 'category' ? categoryMeasure : view

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          Sales dashboard
        </Typography>
        <Typography color="text.secondary">Quotations created in the selected period</Typography>
      </Box>

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
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <TextField size="small" type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField size="small" type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          {(from || to) && (
            <Button
              onClick={() => {
                setFrom('')
                setTo('')
              }}
            >
              All time
            </Button>
          )}
        </Stack>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {!data && !error && <LinearProgress />}

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
        <StatTile label="Waiting on customers" value={formatMoney(data.pending.amount)} hero />
        <StatTile label="Quotes waiting" value={String(data.pending.count)} hint="sent or viewed, not expired" />
        <StatTile label="In internal approval" value={formatMoney(data.inApproval.amount)} hint={`${data.inApproval.count} ${data.inApproval.count === 1 ? 'quote' : 'quotes'} not yet sent`} />
        <StatTile label="Sold so far" value={formatMoney(data.won.amount)} />
      </Box>
    )
  }
  if (view === 'category') {
    const rows = data.byCategory.filter((r) => r[measure].count > 0)
    const top = [...rows].sort((a, b) => b[measure].amount - a[measure].amount)[0]
    return (
      <Box sx={grid}>
        <StatTile label={measure === 'won' ? 'Sold' : 'Waiting on customers'} value={formatMoney(data[measure].amount)} hero />
        <StatTile label="Top category" value={top ? (top.category?.name ?? 'Uncategorized') : '—'} />
        <StatTile label="Top category amount" value={top ? formatMoney(top[measure].amount) : '—'} />
        <StatTile label="Categories" value={String(rows.length)} hint="with lines in this view" />
      </Box>
    )
  }
  return (
    <Box sx={grid}>
      <StatTile label="Sold" value={formatMoney(data.won.amount)} hero />
      <StatTile label="Quotes won" value={String(data.won.count)} />
      <StatTile label="Quotes sent" value={String(data.sentCount)} />
      <StatTile label="Conversion" value={percent.format(data.conversionRate)} hint="won ÷ sent" />
    </Box>
  )
}

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { api, errorText, type Schemas } from '../../api/client'
import { StatusChip } from '../../components/StatusChip'
import { formatMoney } from '../../pricing/pricing'

type Summary = Schemas['DashboardSummary']

const compact = new Intl.NumberFormat('th-TH', { notation: 'compact', maximumFractionDigits: 1 })
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 })

/** Sales summary for WOC. */
export function DashboardPage() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [data, setData] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .GET('/dashboard/summary', { params: { query: { ...(from ? { from } : {}), ...(to ? { to } : {}) } } })
      .then(({ data, error }) => {
        if (cancelled) return
        setData(data ?? null)
        setError(data ? null : errorText(error, 'Could not load the dashboard'))
      })
      .catch(() => !cancelled && setError('Cannot reach the API'))
    return () => {
      cancelled = true
    }
  }, [from, to])

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
            Sales dashboard
          </Typography>
          <Typography color="text.secondary">Quotations created in the selected period</Typography>
        </Box>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <TextField
            size="small"
            type="date"
            label="From"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            type="date"
            label="To"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
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
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '2fr 1fr 1fr 1fr' } }}>
            <StatTile label="Accepted sales" value={formatMoney(data.acceptedAmount)} hero />
            <StatTile label="Quotes accepted" value={String(data.acceptedCount)} />
            <StatTile label="Quotes sent" value={String(data.sentCount)} />
            <StatTile label="Conversion" value={percent.format(data.conversionRate)} hint="accepted ÷ sent" />
          </Box>

          <Card>
            <CardContent>
              <Typography variant="h6">Accepted sales by month</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Grand total incl. VAT, by the month the customer signed
              </Typography>
              <MonthlyBars rows={data.byMonth} />
            </CardContent>
          </Card>

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

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' } }}>
            <Card>
              <CardContent>
                <Typography variant="h6">By RM</Typography>
              </CardContent>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>RM</TableCell>
                      <TableCell>Team</TableCell>
                      <TableCell align="right">Quotes</TableCell>
                      <TableCell align="right">Sent</TableCell>
                      <TableCell align="right">Won</TableCell>
                      <TableCell>Accepted sales</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody sx={{ '& td': { fontVariantNumeric: 'tabular-nums' } }}>
                    {data.byRm.map((r) => (
                      <TableRow key={r.user.id}>
                        <TableCell>{r.user.name}</TableCell>
                        <TableCell>{r.team ?? '—'}</TableCell>
                        <TableCell align="right">{r.quoteCount}</TableCell>
                        <TableCell align="right">{r.sentCount}</TableCell>
                        <TableCell align="right">{r.acceptedCount}</TableCell>
                        <TableCell sx={{ minWidth: 180 }}>
                          <InlineBar value={r.acceptedAmount} max={maxOf(data.byRm.map((x) => x.acceptedAmount))} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.byRm.length === 0 && <EmptyRow cols={6} />}
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
            <Card>
              <CardContent>
                <Typography variant="h6">By team</Typography>
              </CardContent>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Team</TableCell>
                      <TableCell align="right">Won</TableCell>
                      <TableCell>Accepted sales</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody sx={{ '& td': { fontVariantNumeric: 'tabular-nums' } }}>
                    {data.byTeam.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>{t.name}</TableCell>
                        <TableCell align="right">{t.acceptedCount}</TableCell>
                        <TableCell sx={{ minWidth: 160 }}>
                          <InlineBar value={t.acceptedAmount} max={maxOf(data.byTeam.map((x) => x.acceptedAmount))} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.byTeam.length === 0 && <EmptyRow cols={3} />}
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
          </Box>
        </>
      )}
    </Stack>
  )
}

const maxOf = (values: number[]) => Math.max(0, ...values)

function StatTile({ label, value, hint, hero }: { label: string; value: string; hint?: string; hero?: boolean }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography sx={{ fontWeight: 600, fontSize: hero ? { xs: 32, md: 44 } : 28, lineHeight: 1.2, mt: 0.5 }}>
          {value}
        </Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}

/** Value text plus a thin bar scaled to the column maximum; the text carries the value, the bar the comparison. */
function InlineBar({ value, max }: { value: number; max: number }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Box sx={{ flex: 1, height: 8, bgcolor: 'action.hover', borderRadius: '0 4px 4px 0' }}>
        <Box
          sx={{
            width: `${max > 0 ? (value / max) * 100 : 0}%`,
            height: '100%',
            bgcolor: 'primary.main',
            borderRadius: '0 4px 4px 0',
          }}
        />
      </Box>
      <Typography variant="body2" sx={{ minWidth: 96, textAlign: 'right' }}>
        {formatMoney(value)}
      </Typography>
    </Stack>
  )
}

/** Single-series column chart; values live in per-column tooltips and the y-axis ticks. */
function MonthlyBars({ rows }: { rows: Summary['byMonth'] }) {
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
        No accepted quotations in this period yet.
      </Typography>
    )
  }
  const max = maxOf(rows.map((r) => r.acceptedAmount))
  const ticks = [max, max / 2, 0]
  const height = 180
  return (
    <Stack direction="row" spacing={1}>
      <Stack sx={{ height, justifyContent: 'space-between', pb: 0 }}>
        {ticks.map((t, i) => (
          <Typography key={i} variant="caption" color="text.secondary" sx={{ lineHeight: 1, textAlign: 'right', minWidth: 40 }}>
            {compact.format(t)}
          </Typography>
        ))}
      </Stack>
      <Box sx={{ flex: 1, overflowX: 'auto' }}>
        <Stack
          direction="row"
          sx={{ height, alignItems: 'flex-end', gap: '2px', borderBottom: 1, borderColor: 'divider', minWidth: rows.length * 40 }}
        >
          {rows.map((r) => (
            <Tooltip
              key={r.month}
              arrow
              title={`${r.month}: ${formatMoney(r.acceptedAmount)} from ${r.acceptedCount} quote${r.acceptedCount === 1 ? '' : 's'}`}
            >
              {/* Full-height hit target, larger than the bar itself. */}
              <Box sx={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: 'default' }}>
                <Box
                  role="img"
                  aria-label={`${r.month}: ${formatMoney(r.acceptedAmount)}`}
                  sx={{
                    width: '100%',
                    maxWidth: 24,
                    height: `${max > 0 ? Math.max((r.acceptedAmount / max) * 100, 1) : 0}%`,
                    bgcolor: 'primary.main',
                    borderRadius: '4px 4px 0 0',
                  }}
                />
              </Box>
            </Tooltip>
          ))}
        </Stack>
        <Stack direction="row" sx={{ gap: '2px', minWidth: rows.length * 40 }}>
          {rows.map((r) => (
            <Typography key={r.month} variant="caption" color="text.secondary" sx={{ flex: 1, textAlign: 'center' }}>
              {r.month}
            </Typography>
          ))}
        </Stack>
      </Box>
    </Stack>
  )
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} sx={{ color: 'text.secondary', textAlign: 'center' }}>
        Nothing in this period.
      </TableCell>
    </TableRow>
  )
}

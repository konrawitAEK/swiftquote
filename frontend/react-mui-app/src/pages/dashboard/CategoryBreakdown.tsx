import { Card, CardContent, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { formatMoney } from '../../pricing/pricing'
import { InlineBar } from './InlineBar'
import { ProfitCells, ProfitHeadCells } from './ProfitCells'
import { byAmount, maxAmount, MEASURE_LABELS, type MeasureKey, type Summary } from './measures'

/** Amount by product category (line total incl. VAT), with each category's share of the total. */
export function CategoryBreakdown({ data, measure }: { data: Summary; measure: MeasureKey }) {
  const rows = byAmount(data.byCategory, measure).filter((r) => r[measure].count > 0)
  const total = rows.reduce((sum, r) => sum + r[measure].amount, 0)
  const max = maxAmount(rows.map((r) => r[measure]))
  return (
    <Card>
      <CardContent>
        <Typography variant="h6">{MEASURE_LABELS[measure]} by product category</Typography>
        <Typography variant="body2" color="text.secondary">
          Line amounts after discount, incl. VAT · total {formatMoney(total)} · cost and profit before VAT
        </Typography>
      </CardContent>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Category</TableCell>
              <TableCell align="right">Lines</TableCell>
              <TableCell align="right">Share</TableCell>
              <TableCell>Amount</TableCell>
              <ProfitHeadCells />
            </TableRow>
          </TableHead>
          <TableBody sx={{ '& td': { fontVariantNumeric: 'tabular-nums' } }}>
            {rows.map((r) => (
              <TableRow key={r.category?.id ?? 'none'}>
                <TableCell sx={{ fontWeight: 500, color: r.category ? 'text.primary' : 'text.secondary' }}>
                  {r.category?.name ?? 'Uncategorized'}
                </TableCell>
                <TableCell align="right">{r[measure].count}</TableCell>
                <TableCell align="right">{total > 0 ? `${((r[measure].amount / total) * 100).toFixed(1)}%` : '—'}</TableCell>
                <TableCell sx={{ minWidth: { xs: 160, sm: 240 } }}>
                  <InlineBar value={r[measure].amount} max={max} />
                </TableCell>
                <ProfitCells m={r[measure]} />
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} sx={{ color: 'text.secondary', textAlign: 'center' }}>
                  Nothing in this period.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  )
}

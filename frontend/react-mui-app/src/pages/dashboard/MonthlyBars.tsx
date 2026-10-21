import { Box, Stack, Tooltip, Typography } from '@mui/material'
import { formatMoney } from '../../pricing/pricing'
import { maxAmount, type Measure } from './measures'

const compact = new Intl.NumberFormat('th-TH', { notation: 'compact', maximumFractionDigits: 1 })
const HEIGHT = 180

/** Single-series column chart; values live in per-column tooltips and the y-axis ticks. */
export function MonthlyBars({ points, empty }: { points: { month: string; value: Measure }[]; empty: string }) {
  const rows = points.filter((p) => p.value.count > 0)
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
        {empty}
      </Typography>
    )
  }
  const max = maxAmount(rows.map((r) => r.value))
  return (
    <Stack direction="row" spacing={1}>
      <Stack sx={{ height: HEIGHT, justifyContent: 'space-between' }}>
        {[max, max / 2, 0].map((t, i) => (
          <Typography key={i} variant="caption" color="text.secondary" sx={{ lineHeight: 1, textAlign: 'right', minWidth: 40 }}>
            {compact.format(t)}
          </Typography>
        ))}
      </Stack>
      <Box sx={{ flex: 1, overflowX: 'auto' }}>
        <Stack
          direction="row"
          sx={{ height: HEIGHT, alignItems: 'flex-end', gap: '2px', borderBottom: 1, borderColor: 'divider', minWidth: rows.length * 40 }}
        >
          {rows.map((r) => (
            <Tooltip
              key={r.month}
              arrow
              title={`${r.month}: ${formatMoney(r.value.amount)} from ${r.value.count} quote${r.value.count === 1 ? '' : 's'}`}
            >
              {/* Full-height hit target, larger than the bar itself. */}
              <Box sx={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                <Box
                  role="img"
                  aria-label={`${r.month}: ${formatMoney(r.value.amount)}`}
                  sx={{
                    width: '100%',
                    maxWidth: 24,
                    height: `${max > 0 ? Math.max((r.value.amount / max) * 100, 1) : 0}%`,
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

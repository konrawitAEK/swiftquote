import { Box, Stack, Typography } from '@mui/material'
import { formatMoney } from '../../pricing/pricing'

/** Value text plus a thin bar scaled to the column maximum; the text carries the value, the bar the comparison. */
export function InlineBar({ value, max }: { value: number; max: number }) {
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
      <Typography variant="body2" sx={{ minWidth: 104, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {formatMoney(value)}
      </Typography>
    </Stack>
  )
}

import { Card, CardContent, Typography } from '@mui/material'
import { isLoss, profitLine, type Measure } from './measures'

/**
 * A labelled headline number; `hero` is the one figure the current view leads with. A tile for a money
 * measure passes it as `profit` to get a second line with its profit and margin (before VAT).
 */
export function StatTile({
  label,
  value,
  hint,
  hero,
  profit,
}: {
  label: string
  value: string
  hint?: string
  hero?: boolean
  profit?: Measure
}) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography sx={{ fontWeight: 600, fontSize: hero ? { xs: 32, md: 44 } : 28, lineHeight: 1.2, mt: 0.5 }}>
          {value}
        </Typography>
        {profit && (
          <Typography
            variant="body2"
            sx={{ color: isLoss(profit) ? 'error.main' : 'text.secondary', fontVariantNumeric: 'tabular-nums', mt: 0.5 }}
          >
            {profitLine(profit)}
          </Typography>
        )}
        {hint && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {hint}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}

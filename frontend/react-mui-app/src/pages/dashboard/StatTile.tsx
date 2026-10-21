import { Card, CardContent, Typography } from '@mui/material'

/** A labelled headline number; `hero` is the one figure the current view leads with. */
export function StatTile({ label, value, hint, hero }: { label: string; value: string; hint?: string; hero?: boolean }) {
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

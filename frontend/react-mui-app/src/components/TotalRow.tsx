import { Stack, Typography } from '@mui/material'

export function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', fontVariantNumeric: 'tabular-nums' }}>
      <Typography sx={{ fontWeight: strong ? 700 : 400 }}>{label}</Typography>
      <Typography sx={{ fontWeight: strong ? 700 : 400 }}>{value}</Typography>
    </Stack>
  )
}

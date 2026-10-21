import { Chip, type ChipProps } from '@mui/material'
import type { QuoteStatus } from '../api/client'

const colors: Record<QuoteStatus, ChipProps['color']> = {
  draft: 'default',
  sent: 'info',
  viewed: 'primary',
  accepted: 'success',
  rejected: 'error',
  expired: 'warning',
}

export function StatusChip({ status }: { status: QuoteStatus }) {
  return <Chip size="small" label={status} color={colors[status]} sx={{ textTransform: 'capitalize' }} />
}

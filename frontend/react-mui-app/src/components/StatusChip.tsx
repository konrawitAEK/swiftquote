import { Chip, type ChipProps } from '@mui/material'
import type { QuoteStatus } from '../api/types'
import { STATUS_LABELS } from '../auth/roles'

const colors: Record<QuoteStatus, ChipProps['color']> = {
  draft: 'default',
  pending_approval: 'warning',
  approved: 'secondary',
  sent: 'info',
  viewed: 'primary',
  accepted: 'success',
  rejected: 'error',
  expired: 'default',
}

export function StatusChip({ status }: { status: QuoteStatus }) {
  return <Chip size="small" label={STATUS_LABELS[status]} color={colors[status]} />
}

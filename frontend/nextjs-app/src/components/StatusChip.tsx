'use client'

import { Chip, type ChipProps } from '@mui/material'
import { STATUS_LABELS } from '@/lib/auth/roles'
import type { QuoteStatus } from '@/models'

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

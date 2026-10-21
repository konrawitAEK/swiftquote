import type { QuoteStatus, Role } from '../api/client'

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  woc: 'WOC',
  wo: 'WO (Approver)',
  rm: 'RM',
  customer: 'Customer',
}

/** Where each role lands after login. */
export function homePath(role: Role | undefined): string {
  switch (role) {
    case 'admin':
      return '/admin'
    case 'woc':
      return '/dashboard'
    default:
      return '/quotes'
  }
}

export const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  sent: 'Sent',
  viewed: 'Viewed',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired: 'Expired',
}

/** Statuses from which the share link works. */
export const SENT_STATUSES: QuoteStatus[] = ['sent', 'viewed', 'accepted', 'rejected']

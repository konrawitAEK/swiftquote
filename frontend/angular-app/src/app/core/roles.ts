import type { QuoteStatus, Role } from '../models';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Back Office',
  woc: 'WOC',
  wo: 'WO (Approver)',
  rm: 'RM',
  customer: 'Customer',
};

export const ROLES = Object.keys(ROLE_LABELS) as Role[];

/** Where each role lands after login. */
export function homePath(role: Role | undefined): string {
  switch (role) {
    case 'admin':
      return '/settings';
    case 'woc':
      return '/dashboard';
    default:
      return '/quotes';
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
};

/** Statuses from which the share link works. */
export const SENT_STATUSES: QuoteStatus[] = ['sent', 'viewed', 'accepted', 'rejected'];

/** Statuses in which a quotation can be downloaded as a PDF. */
export const PDF_STATUSES: QuoteStatus[] = ['approved', 'sent', 'viewed', 'accepted', 'rejected'];

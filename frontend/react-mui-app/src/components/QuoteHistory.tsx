import { Box, Stack, Typography } from '@mui/material'
import type { Schemas } from '../api/client'

type Event = Schemas['QuoteEvent']

const LABELS: Record<Event['action'], string> = {
  created: 'Created',
  updated: 'Edited',
  submitted: 'Submitted for approval',
  approved: 'Approved',
  returned: 'Returned for changes',
  sent: 'Sent to customer',
  viewed: 'Viewed',
  accepted: 'Accepted',
  rejected: 'Declined',
}

const DOT: Partial<Record<Event['action'], string>> = {
  approved: 'success.main',
  accepted: 'success.main',
  returned: 'warning.main',
  rejected: 'error.main',
}

/** Oldest-first audit trail of a quotation. */
export function QuoteHistory({ events }: { events: Event[] }) {
  if (events.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No history yet.
      </Typography>
    )
  }
  return (
    <Stack component="ol" spacing={1.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {events.map((e, i) => (
        <Stack component="li" key={i} direction="row" spacing={1.5}>
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', mt: 0.75, flexShrink: 0, bgcolor: DOT[e.action] ?? 'primary.main' }} />
          <Box>
            <Typography variant="body2">
              <strong>{LABELS[e.action]}</strong>
              {e.actor ? ` by ${e.actor.name}` : e.action === 'viewed' || e.action === 'accepted' || e.action === 'rejected' ? ' via link' : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {new Date(e.at).toLocaleString()}
            </Typography>
            {e.comment && (
              <Typography variant="body2" sx={{ mt: 0.5, pl: 1.5, borderLeft: 2, borderColor: 'divider', whiteSpace: 'pre-wrap' }}>
                {e.comment}
              </Typography>
            )}
          </Box>
        </Stack>
      ))}
    </Stack>
  )
}

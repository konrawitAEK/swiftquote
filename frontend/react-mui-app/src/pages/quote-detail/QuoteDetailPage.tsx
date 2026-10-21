import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { api, errorText, type Role, type Schemas } from '../../api/client'
import { useAuth } from '../../auth/auth'
import { SENT_STATUSES } from '../../auth/roles'
import { AcceptCard } from './AcceptCard'
import { QuoteHistory } from './QuoteHistory'
import { ShareLink } from './ShareLink'
import { shareUrl } from './shareUrl'
import { StatusChip } from '../../components/StatusChip'
import { TotalRow } from '../../components/TotalRow'
import { formatMoney } from '../../pricing/pricing'

type Quote = Schemas['QuoteDetail']
type CommentAction = 'submit' | 'approve' | 'return' | 'reject'

interface DialogSpec {
  action: CommentAction
  title: string
  confirm: string
  commentRequired: boolean
  help: string
}

const DIALOGS: Record<CommentAction, DialogSpec> = {
  submit: { action: 'submit', title: 'Submit for approval', confirm: 'Submit', commentRequired: false, help: 'Optional note for your WO.' },
  approve: { action: 'approve', title: 'Approve quotation', confirm: 'Approve', commentRequired: false, help: 'Optional note for the RM.' },
  return: { action: 'return', title: 'Return for changes', confirm: 'Return to RM', commentRequired: true, help: 'Tell the RM what to change.' },
  reject: { action: 'reject', title: 'Decline quotation', confirm: 'Decline', commentRequired: false, help: 'Optional reason.' },
}

/** Which workflow actions a role may take on a quote in its current status. */
function availableActions(role: Role, q: Quote) {
  return {
    edit: role === 'rm' && q.status === 'draft',
    submit: role === 'rm' && q.status === 'draft',
    approve: role === 'wo' && q.status === 'pending_approval',
    return: role === 'wo' && q.status === 'pending_approval',
    send: role === 'rm' && q.status === 'approved',
    respond: role === 'customer' && (q.status === 'sent' || q.status === 'viewed'),
  }
}

export function QuoteDetailPage() {
  const { id = '' } = useParams()
  const role = useAuth().user?.role ?? 'rm'
  const [quote, setQuote] = useState<Quote | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<DialogSpec | null>(null)
  const [comment, setComment] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .GET('/quotes/{id}', { params: { path: { id } } })
      .then(({ data, error }) => {
        if (cancelled) return
        if (data) setQuote(data)
        else setError(errorText(error, 'Could not load quotation'))
      })
      .catch(() => !cancelled && setError('Cannot reach the API'))
    return () => {
      cancelled = true
    }
  }, [id])

  /** Runs a workflow call and shows the updated quote or the server's error. */
  const run = useCallback(async (call: () => Promise<{ data?: Quote; error?: Schemas['ErrorResponse'] }>) => {
    setBusy(true)
    setActionError(null)
    try {
      const { data, error } = await call()
      if (data) {
        setQuote(data)
        setDialog(null)
        setComment('')
      } else {
        setActionError(errorText(error, 'Action failed'))
      }
    } catch {
      setActionError('Cannot reach the API')
    } finally {
      setBusy(false)
    }
  }, [])

  const confirmDialog = () => {
    if (!dialog) return
    const body = { comment: comment.trim() || null }
    const path = { params: { path: { id } }, body }
    const calls = {
      submit: () => api.POST('/quotes/{id}/submit', path),
      approve: () => api.POST('/quotes/{id}/approve', path),
      return: () => api.POST('/quotes/{id}/return', path),
      reject: () => api.POST('/quotes/{id}/reject', path),
    }
    void run(calls[dialog.action])
  }

  if (error) return <Alert severity="error">{error}</Alert>
  if (!quote) return <LinearProgress />

  const can = availableActions(role, quote)
  const showLink = role !== 'customer' && SENT_STATUSES.includes(quote.status)

  return (
    <Stack spacing={3}>
      <Box>
        <Button component={RouterLink} to="/quotes" startIcon={<ArrowBackIcon />} sx={{ ml: -1 }}>
          Quotations
        </Button>
      </Box>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ justifyContent: 'space-between' }}>
        <Box>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
              {quote.quoteNumber}
            </Typography>
            <StatusChip status={quote.status} />
          </Stack>
          <Typography color="text.secondary">
            {quote.clientName}
            {quote.createdBy && ` · by ${quote.createdBy.name}`} · valid until {quote.expiryDate}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
          {can.edit && (
            <Button component={RouterLink} to={`/quotes/${id}/edit`} variant="outlined">
              Edit
            </Button>
          )}
          {can.submit && (
            <Button variant="contained" onClick={() => setDialog(DIALOGS.submit)}>
              Submit for approval
            </Button>
          )}
          {can.return && (
            <Button variant="outlined" color="warning" onClick={() => setDialog(DIALOGS.return)}>
              Return for changes
            </Button>
          )}
          {can.approve && (
            <Button variant="contained" color="success" onClick={() => setDialog(DIALOGS.approve)}>
              Approve
            </Button>
          )}
          {can.send && (
            <Button variant="contained" disabled={busy} onClick={() => run(() => api.POST('/quotes/{id}/send', { params: { path: { id } } }))}>
              Send to customer
            </Button>
          )}
          {can.respond && (
            <Button variant="outlined" color="error" onClick={() => setDialog(DIALOGS.reject)}>
              Decline
            </Button>
          )}
        </Stack>
      </Stack>

      {actionError && <Alert severity="error">{actionError}</Alert>}
      {quote.status === 'pending_approval' && role === 'rm' && (
        <Alert severity="info">Waiting for your WO to approve. You can send it once it is approved.</Alert>
      )}
      {quote.status === 'approved' && role === 'rm' && (
        <Alert severity="success">Approved. Send it to the customer when you are ready.</Alert>
      )}
      {quote.status === 'accepted' && quote.signedAt && (
        <Alert severity="success">
          Accepted by {quote.signedBy ?? 'the customer'} on {new Date(quote.signedAt).toLocaleString()}
        </Alert>
      )}

      {showLink && quote.accessToken && (
        <Card>
          <CardContent>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
              <ShareLink accessToken={quote.accessToken} />
              <Button href={shareUrl(quote.accessToken)} target="_blank" rel="noopener" endIcon={<OpenInNewIcon />} sx={{ flexShrink: 0 }}>
                Client view
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      <Card>
        <Box sx={{ overflowX: 'auto' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Item</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell align="right">Unit price</TableCell>
                <TableCell align="right">Discount</TableCell>
                <TableCell align="right">Amount (excl. VAT)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody sx={{ '& td': { fontVariantNumeric: 'tabular-nums' } }}>
              {quote.items.map((it, i) => (
                <TableRow key={i}>
                  <TableCell>
                    {it.title}
                    {it.description && (
                      <Typography variant="body2" color="text.secondary">
                        {it.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{it.quantity}</TableCell>
                  <TableCell align="right">{formatMoney(it.unitPrice)}</TableCell>
                  <TableCell align="right">{Number(it.discountPercent) ? `${it.discountPercent}%` : '—'}</TableCell>
                  <TableCell align="right">{formatMoney(it.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
        <Divider />
        <CardContent>
          <Stack spacing={1} sx={{ maxWidth: 340, ml: 'auto' }}>
            <TotalRow label="Subtotal" value={formatMoney(quote.subtotal)} />
            <TotalRow label="Discount" value={`− ${formatMoney(quote.discountAmount)}`} />
            <TotalRow label="VAT" value={formatMoney(quote.taxAmount)} />
            <Divider />
            <TotalRow label="Grand total" value={formatMoney(quote.grandTotal)} strong />
          </Stack>
        </CardContent>
      </Card>

      {can.respond && <AcceptCard busy={busy} onAccept={(body) => run(() => api.POST('/quotes/{id}/accept', { params: { path: { id } }, body }))} />}

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>
            History
          </Typography>
          <QuoteHistory events={quote.history} />
        </CardContent>
      </Card>

      <Dialog open={dialog !== null} onClose={() => !busy && setDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>{dialog?.title}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            label={dialog?.commentRequired ? 'Comment (required)' : 'Comment'}
            helperText={dialog?.help}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            sx={{ mt: 1 }}
          />
          {actionError && <Alert severity="error" sx={{ mt: 2 }}>{actionError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={confirmDialog}
            disabled={busy || (dialog?.commentRequired === true && comment.trim() === '')}
          >
            {dialog?.confirm}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

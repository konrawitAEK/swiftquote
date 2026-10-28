'use client'

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
import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { DownloadPdfButton } from '@/components/DownloadPdfButton'
import { StatusChip } from '@/components/StatusChip'
import { TotalRow } from '@/components/TotalRow'
import { errorText } from '@/lib/api/types'
import type { QuoteDetail as Quote, Role } from '@/models'
import { PDF_STATUSES, SENT_STATUSES } from '@/lib/auth/roles'
import { formatDiscount, formatMoney, formatOptionalMoney } from '@/lib/pricing/pricing'
import { AcceptCard } from './AcceptCard'
import { QuoteHistory } from './QuoteHistory'
import { quoteDetailService } from '@/services/quoteDetailService'
import { ShareLink } from './ShareLink'
import { shareUrl } from './shareUrl'

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

/**
 * Client Component over the server-fetched quote. Workflow actions call the API from the browser, then
 * router.refresh() re-renders the page on the server with the updated quote.
 */
export function QuoteDetail({ id, role, quote, error }: { id: string; role: Role; quote: Quote | null; error: string | null }) {
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()
  const [dialog, setDialog] = useState<DialogSpec | null>(null)
  const [comment, setComment] = useState('')
  const router = useRouter()

  /** Runs a workflow call, then shows the refreshed quote or the server's error; busy until the refresh lands. */
  const run = (call: () => Promise<Quote>) => {
    setActionError(null)
    startTransition(async () => {
      try {
        await call()
      } catch (e) {
        startTransition(() => setActionError(errorText(e, 'Action failed')))
        return
      }
      startTransition(() => {
        setDialog(null)
        setComment('')
        router.refresh()
      })
    })
  }

  const confirmDialog = () => {
    if (!dialog) return
    const { action } = dialog
    const text = comment.trim() || null
    run(() => quoteDetailService[action](id, text))
  }

  if (error) return <Alert severity="error">{error}</Alert>
  if (!quote) return <LinearProgress />

  const can = availableActions(role, quote)
  const showLink = role !== 'customer' && SENT_STATUSES.includes(quote.status)
  // The API omits cost fields for customers; render them only when present (null = unknown).
  const showCost = role !== 'customer' && quote.items.some((it) => it.unitCost !== undefined)
  const showCostTotals = role !== 'customer' && quote.costTotal !== undefined

  return (
    <Stack spacing={3}>
      <Box>
        <Button component={NextLink} href="/quotes" startIcon={<ArrowBackIcon />} sx={{ ml: -1 }}>
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
            <Button component={NextLink} href={`/quotes/${id}/edit`} variant="outlined">
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
            <Button variant="contained" disabled={busy} onClick={() => run(() => quoteDetailService.send(id))}>
              Send to customer
            </Button>
          )}
          {can.respond && (
            <Button variant="outlined" color="error" onClick={() => setDialog(DIALOGS.reject)}>
              Decline
            </Button>
          )}
          {PDF_STATUSES.includes(quote.status) && (
            <DownloadPdfButton
              download={() => quoteDetailService.downloadPdf(id, quote.quoteNumber)}
              onError={(e) => setActionError(errorText(e, 'Could not download the PDF'))}
            />
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
                {showCost && (
                  <>
                    <TableCell align="right">Unit cost</TableCell>
                    <TableCell align="right">Cost</TableCell>
                    <TableCell align="right">Profit</TableCell>
                  </>
                )}
              </TableRow>
            </TableHead>
            <TableBody sx={{ '& td': { fontVariantNumeric: 'tabular-nums' } }}>
              {quote.items.map((it, i) => (
                <TableRow key={i}>
                  <TableCell>
                    {it.title}
                    <Typography variant="body2" color="text.secondary">
                      {it.category?.name ?? 'Uncategorized'}
                    </Typography>
                    {it.description && (
                      <Typography variant="body2" color="text.secondary">
                        {it.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{it.quantity}</TableCell>
                  <TableCell align="right">{formatMoney(it.unitPrice)}</TableCell>
                  <TableCell align="right">{formatDiscount(it.discountType, it.discountValue)}</TableCell>
                  <TableCell align="right">{formatMoney(it.lineTotal)}</TableCell>
                  {showCost && (
                    <>
                      <TableCell align="right">{formatOptionalMoney(it.unitCost)}</TableCell>
                      <TableCell align="right">{formatOptionalMoney(it.costTotal)}</TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: it.profit != null && it.profit < 0 ? 'error.main' : undefined }}
                      >
                        {formatOptionalMoney(it.profit)}
                      </TableCell>
                    </>
                  )}
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
            {showCostTotals && (
              <>
                <Divider />
                <TotalRow label="Cost" value={formatOptionalMoney(quote.costTotal)} />
                <TotalRow label="Profit (before VAT)" value={formatOptionalMoney(quote.profit)} />
              </>
            )}
          </Stack>
        </CardContent>
      </Card>

      {can.respond && <AcceptCard busy={busy} onAccept={(body) => run(() => quoteDetailService.accept(id, body))} />}

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

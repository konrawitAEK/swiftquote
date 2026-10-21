'use client'

import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState, type FormEvent } from 'react'
import { SignaturePad } from '@/components/SignaturePad'
import { api, errorText, type Schemas } from '@/lib/api/client'
import { formatMoney } from '@/lib/pricing/pricing'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; quote: Schemas['PublicQuoteView'] }

/** Client portal: no login, addressed by the quote's access token. */
export function PublicQuote({ accessToken }: { accessToken: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [signerName, setSignerName] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null)
  const [declining, setDeclining] = useState(false)
  const [declineReason, setDeclineReason] = useState('')

  useEffect(() => {
    api
      .GET('/public/quotes/{accessToken}', { params: { path: { accessToken } } })
      .then(({ data, error }) =>
        setState(data ? { kind: 'ready', quote: data } : { kind: 'error', message: errorText(error) }),
      )
      .catch(() => setState({ kind: 'error', message: 'Cannot reach the server. Please try again later.' }))
  }, [accessToken])

  const decline = async () => {
    setBusy(true)
    setSubmitError(null)
    try {
      const { data, error } = await api.POST('/public/quotes/{accessToken}/reject', {
        params: { path: { accessToken } },
        body: { comment: declineReason.trim() || null },
      })
      if (data && state.kind === 'ready') setState({ kind: 'ready', quote: { ...state.quote, status: 'rejected' } })
      else setSubmitError(errorText(error, 'Could not decline this quotation'))
    } catch {
      setSubmitError('Cannot reach the server. Please try again.')
    } finally {
      setBusy(false)
      setDeclining(false)
    }
  }

  const accept = async (e: FormEvent) => {
    e.preventDefault()
    if (!signature) return setSubmitError('Please sign in the box above.')
    setBusy(true)
    setSubmitError(null)
    try {
      const { data, error } = await api.POST('/public/quotes/{accessToken}/accept', {
        params: { path: { accessToken } },
        body: { signerName, signatureDataUrl: signature },
      })
      if (data) setAcceptedAt(data.signedAt ?? new Date().toISOString())
      else setSubmitError(errorText(error, 'Could not accept this quotation'))
    } catch {
      setSubmitError('Cannot reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 2, sm: 6 } }}>
      <Container maxWidth="md">
        {state.kind === 'loading' && (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
            <CircularProgress />
          </Box>
        )}

        {state.kind === 'error' && (
          <Alert severity="warning">
            This quotation link is invalid or has expired. Please contact the sender for a new link.
          </Alert>
        )}

        {state.kind === 'ready' && (
          <Stack spacing={3}>
            <Box>
              <Typography variant="overline" color="text.secondary">
                Quotation from
              </Typography>
              <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
                {state.quote.vendorName}
              </Typography>
              <Typography color="text.secondary">
                No. {state.quote.quoteNumber} · Valid until {state.quote.expiryDate}
              </Typography>
            </Box>

            <Card>
              <Box sx={{ overflowX: 'auto' }}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Item</TableCell>
                      <TableCell align="right">Qty</TableCell>
                      <TableCell align="right">Unit price</TableCell>
                      <TableCell align="right">Amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody sx={{ '& td': { fontVariantNumeric: 'tabular-nums' } }}>
                    {state.quote.items.map((it, i) => (
                      <TableRow key={i}>
                        <TableCell>{it.title}</TableCell>
                        <TableCell align="right">{it.quantity}</TableCell>
                        <TableCell align="right">{formatMoney(it.unitPrice ?? 0)}</TableCell>
                        <TableCell align="right">{formatMoney(it.lineTotal ?? 0)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={3} align="right" sx={{ fontWeight: 700, borderBottom: 0 }}>
                        Grand total (incl. VAT)
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, borderBottom: 0 }}>
                        {formatMoney(state.quote.grandTotal)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Box>
            </Card>

            {acceptedAt ? (
              <Alert icon={<CheckCircleIcon />} severity="success">
                Thank you, {signerName}. This quotation was accepted on {new Date(acceptedAt).toLocaleString()}.
              </Alert>
            ) : state.quote.status === 'accepted' ? (
              <Alert icon={<CheckCircleIcon />} severity="success">
                This quotation was accepted
                {state.quote.signedBy && ` by ${state.quote.signedBy}`}
                {state.quote.signedAt && ` on ${new Date(state.quote.signedAt).toLocaleString()}`}.
              </Alert>
            ) : state.quote.status === 'rejected' ? (
              <Alert severity="info">This quotation was declined. Please contact the sender if this is a mistake.</Alert>
            ) : (
              <Card component="form" onSubmit={accept}>
                <CardContent>
                  <Stack spacing={2}>
                    <Typography variant="h6">Accept this quotation</Typography>
                    {submitError && <Alert severity="error">{submitError}</Alert>}
                    <TextField
                      label="Your full name"
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      required
                      fullWidth
                    />
                    <SignaturePad onChange={setSignature} disabled={busy} />
                    <Button type="submit" variant="contained" size="large" disabled={busy}>
                      {busy ? 'Submitting…' : 'Sign and accept'}
                    </Button>
                    {declining ? (
                      <Stack spacing={1}>
                        <TextField
                          label="Reason for declining (optional)"
                          value={declineReason}
                          onChange={(e) => setDeclineReason(e.target.value)}
                          multiline
                          minRows={2}
                          fullWidth
                        />
                        <Stack direction="row" spacing={1}>
                          <Button color="error" variant="outlined" disabled={busy} onClick={decline}>
                            Confirm decline
                          </Button>
                          <Button disabled={busy} onClick={() => setDeclining(false)}>
                            Cancel
                          </Button>
                        </Stack>
                      </Stack>
                    ) : (
                      <Button color="error" disabled={busy} onClick={() => setDeclining(true)}>
                        Decline this quotation
                      </Button>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            )}
          </Stack>
        )}
      </Container>
    </Box>
  )
}

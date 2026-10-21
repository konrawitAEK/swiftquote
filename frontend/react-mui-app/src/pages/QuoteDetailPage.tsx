import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { api, errorText, type Schemas } from '../api/client'
import { ShareLink } from '../components/ShareLink'
import { shareUrl } from '../components/shareUrl'
import { StatusChip } from '../components/StatusChip'
import { TotalRow } from '../components/TotalRow'
import { formatMoney } from '../pricing/pricing'

export function QuoteDetailPage() {
  const { id = '' } = useParams()
  const [quote, setQuote] = useState<Schemas['QuoteDetail'] | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <Stack spacing={3}>
      <Box>
        <Button component={RouterLink} to="/quotes" startIcon={<ArrowBackIcon />} sx={{ ml: -1 }}>
          Quotations
        </Button>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
      {!quote && !error && <LinearProgress />}

      {quote && (
        <>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
              {quote.quoteNumber}
            </Typography>
            <StatusChip status={quote.status} />
          </Stack>

          {quote.status === 'accepted' && quote.signedAt && (
            <Alert severity="success">
              Accepted by {quote.signedBy ?? 'the client'} on {new Date(quote.signedAt).toLocaleString()}
            </Alert>
          )}

          {quote.accessToken && (
            <Card>
              <CardContent>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                  <ShareLink accessToken={quote.accessToken} />
                  <Button
                    href={shareUrl(quote.accessToken)}
                    target="_blank"
                    rel="noopener"
                    endIcon={<OpenInNewIcon />}
                    sx={{ flexShrink: 0 }}
                  >
                    Client view
                  </Button>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Valid until {quote.expiryDate}
                </Typography>
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
                    <TableCell align="right">Amount (excl. VAT)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody sx={{ '& td': { fontVariantNumeric: 'tabular-nums' } }}>
                  {quote.items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell>{it.title}</TableCell>
                      <TableCell align="right">{it.quantity}</TableCell>
                      <TableCell align="right">{formatMoney(it.unitPrice ?? 0)}</TableCell>
                      <TableCell align="right">{formatMoney(it.lineTotal ?? 0)}</TableCell>
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
        </>
      )}
    </Stack>
  )
}

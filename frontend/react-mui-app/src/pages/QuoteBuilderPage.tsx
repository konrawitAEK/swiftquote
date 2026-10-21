import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
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
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { api, errorText, type Schemas } from '../api/client'
import { ShareLink } from '../components/ShareLink'
import { shareUrl } from '../components/shareUrl'
import { TotalRow } from '../components/TotalRow'
import { calculate, formatMoney, toDecimal } from '../pricing/pricing'

interface Line {
  key: number
  title: string
  quantity: string
  unitPrice: string
  discountPercent: string
  taxPercent: string
}

let nextKey = 1
const newLine = (): Line => ({
  key: nextKey++,
  title: '',
  quantity: '1',
  unitPrice: '',
  discountPercent: '0',
  taxPercent: '7',
})

/** YYYY-MM-DD in the user's local time zone. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function defaultQuoteNumber(): string {
  const stamp = isoDate(new Date()).replaceAll('-', '')
  return `Q-${stamp}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`
}

export function QuoteBuilderPage() {
  const [clients, setClients] = useState<Schemas['Client'][]>([])
  const [clientId, setClientId] = useState('')
  const [quoteNumber, setQuoteNumber] = useState(defaultQuoteNumber)
  const [today] = useState(() => isoDate(new Date()))
  const [expiryDate, setExpiryDate] = useState(() => isoDate(new Date(Date.now() + 30 * 864e5)))
  const [lines, setLines] = useState<Line[]>(() => [newLine()])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<Schemas['QuoteDetail'] | null>(null)

  useEffect(() => {
    api.GET('/clients').then(({ data, error }) => {
      if (!data) return setError(errorText(error, 'Could not load clients'))
      setClients(data)
      if (data.length === 1) setClientId(data[0].id)
    })
  }, [])

  const totals = useMemo(
    () =>
      calculate(
        lines.map((l) => ({
          quantity: toDecimal(l.quantity),
          unitPrice: toDecimal(l.unitPrice),
          discountPercent: toDecimal(l.discountPercent),
          taxPercent: toDecimal(l.taxPercent),
        })),
      ),
    [lines],
  )

  const update = (key: number, field: keyof Omit<Line, 'key'>, value: string) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data, error } = await api.POST('/quotes', {
        body: {
          clientId,
          quoteNumber,
          expiryDate,
          items: lines.map((l) => ({
            title: l.title,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
            discountPercent: Number(l.discountPercent || 0),
            taxPercent: Number(l.taxPercent || 0),
          })),
        },
      })
      if (data) setCreated(data)
      else setError(errorText(error, 'Could not create quote'))
    } catch {
      setError('Cannot reach the API')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box component="form" onSubmit={submit}>
      <Stack spacing={3}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          New quotation
        </Typography>

        {error && <Alert severity="error">{error}</Alert>}

        <Card>
          <CardContent>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField
                select
                label="Client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
                fullWidth
              >
                {clients.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Quote number"
                value={quoteNumber}
                onChange={(e) => setQuoteNumber(e.target.value)}
                required
                fullWidth
              />
              <TextField
                label="Expiry date"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: today } }}
                required
                fullWidth
              />
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Line items
            </Typography>
            <Stack spacing={2} divider={<Divider flexItem />}>
              {lines.map((l, i) => (
                <Stack key={l.key} direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}>
                  <TextField
                    label="Item"
                    value={l.title}
                    onChange={(e) => update(l.key, 'title', e.target.value)}
                    required
                    sx={{ flex: 3 }}
                    size="small"
                  />
                  <TextField
                    label="Qty"
                    type="number"
                    value={l.quantity}
                    onChange={(e) => update(l.key, 'quantity', e.target.value)}
                    slotProps={{ htmlInput: { min: 1, step: 'any' } }}
                    required
                    sx={{ flex: 1 }}
                    size="small"
                  />
                  <TextField
                    label="Unit price"
                    type="number"
                    value={l.unitPrice}
                    onChange={(e) => update(l.key, 'unitPrice', e.target.value)}
                    slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
                    required
                    sx={{ flex: 1.5 }}
                    size="small"
                  />
                  <TextField
                    label="Discount"
                    type="number"
                    value={l.discountPercent}
                    onChange={(e) => update(l.key, 'discountPercent', e.target.value)}
                    slotProps={{
                      htmlInput: { min: 0, max: 100, step: 'any' },
                      input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                    }}
                    sx={{ flex: 1 }}
                    size="small"
                  />
                  <TextField
                    label="VAT"
                    type="number"
                    value={l.taxPercent}
                    onChange={(e) => update(l.key, 'taxPercent', e.target.value)}
                    slotProps={{
                      htmlInput: { min: 0, max: 100, step: 'any' },
                      input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                    }}
                    sx={{ flex: 1 }}
                    size="small"
                  />
                  <Typography
                    sx={{ flex: 1.5, textAlign: { md: 'right' }, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}
                  >
                    {formatMoney(totals.lineTotals[i])}
                  </Typography>
                  <Tooltip title="Remove line">
                    <span>
                      <IconButton
                        aria-label="Remove line"
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        disabled={lines.length === 1}
                      >
                        <DeleteOutlineIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              ))}
            </Stack>
            <Button startIcon={<AddIcon />} onClick={() => setLines((ls) => [...ls, newLine()])} sx={{ mt: 2 }}>
              Add line
            </Button>
          </CardContent>
        </Card>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { md: 'flex-start' } }}>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
            Totals update as you type using the same rounding rules as the server. The server recalculates on save.
          </Typography>
          <Card sx={{ minWidth: { md: 340 } }}>
            <CardContent>
              <Stack spacing={1} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                <TotalRow label="Subtotal" value={formatMoney(totals.subtotal)} />
                <TotalRow label="Discount" value={`− ${formatMoney(totals.discountAmount)}`} />
                <TotalRow label="VAT" value={formatMoney(totals.taxAmount)} />
                <Divider />
                <TotalRow label="Grand total" value={formatMoney(totals.grandTotal)} strong />
              </Stack>
              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }} disabled={busy || !clientId}>
                {busy ? 'Saving…' : 'Create quotation'}
              </Button>
            </CardContent>
          </Card>
        </Stack>
      </Stack>

      <Dialog open={created !== null} fullWidth maxWidth="sm">
        <DialogTitle>Quotation {created?.quoteNumber} created</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Grand total {created && formatMoney(created.grandTotal)}. Share this link with your client so they can review
            and sign:
          </Typography>
          {created?.accessToken && <ShareLink accessToken={created.accessToken} />}
        </DialogContent>
        <DialogActions>
          {created?.accessToken && (
            <Button href={shareUrl(created.accessToken)} target="_blank" rel="noopener">
              Open client view
            </Button>
          )}
          <Button component={RouterLink} to={`/quotes/${created?.id ?? ''}`} variant="contained">
            View quotation
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { errorDetails, errorText } from '../../api/http'
import { TotalRow } from '../../components/TotalRow'
import { calculate, formatMoney, toDecimal } from '../../pricing/pricing'
import { quoteBuilderService } from '../../services/quoteBuilderService'
import type { Client, CreateQuoteRequest, DiscountType, Product } from '../../models'

interface Line {
  key: number
  productId: string
  description: string
  quantity: string
  unitPrice: string
  discountType: DiscountType
  discountValue: string
  taxPercent: string
}

let nextKey = 1
const newLine = (): Line => ({
  key: nextKey++,
  productId: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discountType: 'percent',
  discountValue: '0',
  taxPercent: '7',
})

const stockText = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

/** Picker text: name, price and (when tracked) stock. */
function productLabel(p: Product): string {
  const parts = [p.name, formatMoney(p.unitPrice)]
  if (p.stock !== null && p.stock !== undefined) parts.push(`${stockText(p.stock)} in stock`)
  if (!p.active) parts.push('retired')
  return parts.join(' · ')
}

/** Groups the API's "items[i]..." 400 details by line index, without the prefix. */
function lineErrorsFrom(details: string[]): Record<number, string[]> {
  const out: Record<number, string[]> = {}
  for (const d of details) {
    const m = /^items\[(\d+)\][.:]?\s*(.*)$/.exec(d)
    if (m) (out[Number(m[1])] ??= []).push(m[2])
  }
  return out
}

/** YYYY-MM-DD in the user's local time zone. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function defaultQuoteNumber(): string {
  const stamp = isoDate(new Date()).replaceAll('-', '')
  return `Q-${stamp}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`
}

/** Creates a draft (/quotes/new) or edits one (/quotes/:id/edit). Only RMs reach this page. */
export function QuoteBuilderPage() {
  const { id } = useParams()
  const editing = id !== undefined
  const navigate = useNavigate()
  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [clientId, setClientId] = useState('')
  const [quoteNumber, setQuoteNumber] = useState(defaultQuoteNumber)
  const [today] = useState(() => isoDate(new Date()))
  const [expiryDate, setExpiryDate] = useState(() => isoDate(new Date(Date.now() + 30 * 864e5)))
  const [lines, setLines] = useState<Line[]>(() => [newLine()])
  // Products already on the quote being edited, so a retired one still shows by name.
  const [savedProducts, setSavedProducts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [lineErrors, setLineErrors] = useState<Record<number, string[]>>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(editing)
  const [locked, setLocked] = useState<string | null>(null)

  useEffect(() => {
    quoteBuilderService
      .listProducts()
      .then(setProducts)
      .catch((err: unknown) => setError(errorText(err, 'Could not load products')))
    quoteBuilderService
      .listClients()
      .then((data) => {
        setClients(data)
        if (!editing && data.length === 1) setClientId(data[0].id)
      })
      .catch((err: unknown) => setError(errorText(err, 'Could not load clients')))
  }, [editing])

  useEffect(() => {
    if (!id) return
    quoteBuilderService
      .get(id)
      .then((data) => {
        setLoading(false)
        if (data.status !== 'draft') setLocked(`This quotation is ${data.status.replace('_', ' ')} and can no longer be edited.`)
        setClientId(data.clientId)
        setQuoteNumber(data.quoteNumber)
        setExpiryDate(data.expiryDate)
        setSavedProducts(Object.fromEntries(data.items.flatMap((it) => (it.product ? [[it.product.id, it.product.name]] : []))))
        setLines(
          data.items.map((it) => ({
            key: nextKey++,
            productId: it.product?.id ?? '',
            description: it.description ?? '',
            quantity: String(it.quantity),
            unitPrice: String(it.unitPrice),
            discountType: it.discountType ?? 'percent',
            discountValue: String(it.discountValue ?? 0),
            taxPercent: String(it.taxPercent),
          })),
        )
      })
      .catch((err: unknown) => {
        setLoading(false)
        setError(errorText(err, 'Could not load quotation'))
      })
  }, [id])

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const totals = useMemo(
    () =>
      calculate(
        lines.map((l) => ({
          quantity: toDecimal(l.quantity),
          unitPrice: toDecimal(l.unitPrice),
          discountType: l.discountType,
          discountValue: toDecimal(l.discountValue),
          taxPercent: toDecimal(l.taxPercent),
          // Saving snapshots the product's current cost, so the preview uses it too.
          unitCost: productById.get(l.productId)?.unitCost ?? null,
        })),
      ),
    [lines, productById],
  )

  // Quantity per tracked product across all lines; the API checks it against stock on submit and send.
  const overStock = useMemo(() => {
    const qty = new Map<string, number>()
    for (const l of lines) qty.set(l.productId, (qty.get(l.productId) ?? 0) + (Number(l.quantity) || 0))
    const over = new Set<string>()
    for (const [pid, q] of qty) {
      const stock = productById.get(pid)?.stock
      if (stock !== null && stock !== undefined && q > stock) over.add(pid)
    }
    return over
  }, [lines, productById])

  const update = (key: number, patch: Partial<Omit<Line, 'key'>>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  /** Picking a product fills in its price; the RM may change it afterwards. */
  const pickProduct = (key: number, p: Product | null) =>
    update(key, p ? { productId: p.id, unitPrice: String(p.unitPrice) } : { productId: '' })

  /**
   * Active products, plus the line's current one (it may have been retired since it was added), sorted by
   * category so the picker shows each category heading once.
   */
  const optionsFor = (l: Line): Product[] => {
    const current = productById.get(l.productId)
    return products
      .filter((p) => p.active || p.id === current?.id)
      .sort((a, b) => a.category.name.localeCompare(b.category.name) || a.name.localeCompare(b.name))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setLineErrors({})
    const body: CreateQuoteRequest = {
      clientId,
      quoteNumber,
      expiryDate,
      items: lines.map((l) => ({
        productId: l.productId,
        ...(l.description.trim() ? { description: l.description } : {}),
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discountType: l.discountType,
        discountValue: Number(l.discountValue || 0),
        taxPercent: Number(l.taxPercent || 0),
      })),
    }
    try {
      const data = id ? await quoteBuilderService.update(id, body) : await quoteBuilderService.create(body)
      navigate(`/quotes/${data.id}`)
    } catch (err) {
      setError(errorText(err, 'Could not save quotation'))
      setLineErrors(lineErrorsFrom(errorDetails(err)))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <LinearProgress />

  return (
    <Box component="form" onSubmit={submit}>
      <Stack spacing={3}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          {editing ? `Edit ${quoteNumber}` : 'New quotation'}
        </Typography>

        {locked && (
          <Alert severity="info" action={<Button component={RouterLink} to={`/quotes/${id}`}>View</Button>}>
            {locked}
          </Alert>
        )}
        {error && <Alert severity="error">{error}</Alert>}

        <Card>
          <CardContent>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField select label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)} required fullWidth>
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
              {lines.map((l, i) => {
                const product = productById.get(l.productId) ?? null
                const unknownProduct = l.productId !== '' && !product
                const tooMuchDiscount = totals.discountTooLarge[i]
                const cost = totals.lineCostTotals[i]
                const profit = totals.lineProfits[i]
                return (
                  <Stack key={l.key} spacing={1.5}>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                      <Autocomplete
                        options={optionsFor(l)}
                        value={product}
                        onChange={(_, p) => pickProduct(l.key, p)}
                        getOptionLabel={productLabel}
                        getOptionDisabled={(p) => !p.active}
                        isOptionEqualToValue={(a, b) => a.id === b.id}
                        groupBy={(p) => p.category.name}
                        size="small"
                        sx={{ flex: 3 }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Product"
                            required
                            placeholder={unknownProduct ? savedProducts[l.productId] : undefined}
                            helperText={
                              product
                                ? `${product.category.name}${product.active ? '' : ' · retired: pick an active product'}`
                                : l.productId === '' && editing
                                  ? 'Pick a product for this line'
                                  : undefined
                            }
                            error={product ? !product.active : false}
                          />
                        )}
                      />
                      <TextField
                        label="Description"
                        value={l.description}
                        onChange={(e) => update(l.key, { description: e.target.value })}
                        sx={{ flex: 3 }}
                        size="small"
                      />
                    </Stack>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'flex-start' } }}>
                      <TextField
                        label="Qty"
                        type="number"
                        value={l.quantity}
                        onChange={(e) => update(l.key, { quantity: e.target.value })}
                        slotProps={{ htmlInput: { min: 1, step: 'any' } }}
                        required
                        error={overStock.has(l.productId)}
                        helperText={overStock.has(l.productId) && product?.stock != null ? `Only ${stockText(product.stock)} in stock` : undefined}
                        sx={{ flex: 1 }}
                        size="small"
                      />
                      <TextField
                        label="Unit price"
                        type="number"
                        value={l.unitPrice}
                        onChange={(e) => update(l.key, { unitPrice: e.target.value })}
                        slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
                        required
                        sx={{ flex: 1.5 }}
                        size="small"
                      />
                      <Stack direction="row" spacing={0.5} sx={{ flex: 2 }}>
                        <ToggleButtonGroup
                          exclusive
                          size="small"
                          value={l.discountType}
                          onChange={(_, v: DiscountType | null) => v && update(l.key, { discountType: v })}
                          aria-label="Discount type"
                          sx={{ height: 40 }}
                        >
                          <ToggleButton value="percent" aria-label="Percent discount">
                            %
                          </ToggleButton>
                          <ToggleButton value="amount" aria-label="Amount discount">
                            ฿
                          </ToggleButton>
                        </ToggleButtonGroup>
                        <TextField
                          label="Discount"
                          type="number"
                          value={l.discountValue}
                          onChange={(e) => update(l.key, { discountValue: e.target.value })}
                          slotProps={{
                            htmlInput: l.discountType === 'percent' ? { min: 0, max: 100, step: 'any' } : { min: 0, step: '0.01' },
                            input:
                              l.discountType === 'percent'
                                ? { endAdornment: <InputAdornment position="end">%</InputAdornment> }
                                : { startAdornment: <InputAdornment position="start">฿</InputAdornment> },
                          }}
                          error={tooMuchDiscount}
                          helperText={tooMuchDiscount ? 'More than the line amount' : undefined}
                          fullWidth
                          size="small"
                        />
                      </Stack>
                      <TextField
                        label="VAT"
                        type="number"
                        value={l.taxPercent}
                        onChange={(e) => update(l.key, { taxPercent: e.target.value })}
                        slotProps={{
                          htmlInput: { min: 0, max: 100, step: 'any' },
                          input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                        }}
                        sx={{ flex: 1 }}
                        size="small"
                      />
                      <Box sx={{ flex: 2, textAlign: { md: 'right' }, fontVariantNumeric: 'tabular-nums', pt: { md: 1 } }}>
                        <Typography sx={{ fontWeight: 500 }}>{formatMoney(totals.lineTotals[i])}</Typography>
                        <Typography variant="caption" color="text.secondary" component="div">
                          Cost {cost ? formatMoney(cost) : '—'} · Profit{' '}
                          <Box component="span" sx={{ color: profit?.isNegative() ? 'error.main' : undefined }}>
                            {profit ? formatMoney(profit) : '—'}
                          </Box>
                        </Typography>
                      </Box>
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
                    {lineErrors[i]?.map((msg) => (
                      <Typography key={msg} variant="body2" color="error">
                        {msg}
                      </Typography>
                    ))}
                  </Stack>
                )
              })}
            </Stack>
            <Button startIcon={<AddIcon />} onClick={() => setLines((ls) => [...ls, newLine()])} sx={{ mt: 2 }}>
              Add line
            </Button>
          </CardContent>
        </Card>

        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { md: 'flex-start' } }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
            Totals update as you type using the same rounding rules as the server. Saving keeps the quotation as a draft;
            submit it for approval from its page. Cost and profit are never shown to the customer.
          </Typography>
          <Card sx={{ minWidth: { md: 340 } }}>
            <CardContent>
              <Stack spacing={1}>
                <TotalRow label="Subtotal" value={formatMoney(totals.subtotal)} />
                <TotalRow label="Discount" value={`− ${formatMoney(totals.discountAmount)}`} />
                <TotalRow label="VAT" value={formatMoney(totals.taxAmount)} />
                <Divider />
                <TotalRow label="Grand total" value={formatMoney(totals.grandTotal)} strong />
                <Divider />
                <TotalRow label="Cost total" value={totals.costTotal ? formatMoney(totals.costTotal) : '—'} />
                <TotalRow label="Profit (excl. VAT)" value={totals.profit ? formatMoney(totals.profit) : '—'} />
              </Stack>
              <Button
                type="submit"
                variant="contained"
                size="large"
                fullWidth
                sx={{ mt: 2 }}
                disabled={busy || !clientId || locked !== null}
              >
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Save draft'}
              </Button>
            </CardContent>
          </Card>
        </Stack>
      </Stack>
    </Box>
  )
}

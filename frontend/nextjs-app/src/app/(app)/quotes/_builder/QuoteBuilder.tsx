'use client'

import { Alert, Box, Button, Card, CardContent, Divider, LinearProgress, MenuItem, Stack, TextField, Typography } from '@mui/material'
import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useSyncExternalStore, type FormEvent } from 'react'
import { TotalRow } from '@/components/TotalRow'
import { calculate, formatMoney, formatOptionalMoney, toDecimal } from '@/lib/pricing/pricing'
import { LineItems, newLine, type Line } from './LineItems'
import { splitLineErrors } from './lineErrors'
import { quoteBuilderService } from '@/services/quoteBuilderService'
import type { Client, CreateQuoteRequest, Product, QuoteDetail } from '@/models'

/** YYYY-MM-DD in the user's local time zone. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function defaultQuoteNumber(): string {
  const stamp = isoDate(new Date()).replaceAll('-', '')
  return `Q-${stamp}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`
}

const noSubscribe = () => () => {}

/** What the page's Server Component fetched: quote is the draft when editing; error is the first failed read. */
export interface BuilderData {
  clients: Client[]
  products: Product[]
  quote: QuoteDetail | null
  error: string | null
}

/** The saved lines as editable form rows. */
function toLines(quote: QuoteDetail): Line[] {
  return quote.items.map((it) =>
    newLine({
      productId: it.product?.id ?? '',
      title: it.title,
      description: it.description ?? '',
      quantity: String(it.quantity),
      unitPrice: String(it.unitPrice),
      discountType: it.discountType,
      discountValue: String(it.discountValue),
      taxPercent: String(it.taxPercent),
    }),
  )
}

/**
 * Creates a draft (/quotes/new) or edits one (/quotes/[id]/edit). Only RMs reach this page.
 * The data comes from the server; the form renders in the browser only: the defaults depend on the user's clock and time zone.
 */
export function QuoteBuilder({ id, data }: { id?: string; data: BuilderData }) {
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false)
  return inBrowser ? <BuilderForm id={id} data={data} /> : <LinearProgress />
}

function BuilderForm({ id, data }: { id?: string; data: BuilderData }) {
  const editing = id !== undefined
  const { clients, products, quote } = data
  const router = useRouter()
  const [clientId, setClientId] = useState(() => quote?.clientId ?? (!editing && clients.length === 1 ? clients[0].id : ''))
  const [quoteNumber, setQuoteNumber] = useState(() => quote?.quoteNumber ?? defaultQuoteNumber())
  const [today] = useState(() => isoDate(new Date()))
  const [expiryDate, setExpiryDate] = useState(() => quote?.expiryDate ?? isoDate(new Date(Date.now() + 30 * 864e5)))
  const [lines, setLines] = useState<Line[]>(() => (quote ? toLines(quote) : [newLine()]))
  const [error, setError] = useState<string | null>(data.error)
  // Keyed by Line.key so the messages stay on the right row when lines are removed.
  const [lineErrors, setLineErrors] = useState<Record<number, string[]>>({})
  const [busy, setBusy] = useState(false)
  const locked = quote && quote.status !== 'draft' ? `This quotation is ${quote.status.replace('_', ' ')} and can no longer be edited.` : null

  // Live preview with the same rounding rules as the server (contracts/fixtures/pricing-cases.json).
  // Cost is the product's current cost, which the server stores on the line when the draft is saved.
  const totals = useMemo(() => {
    const costs = new Map(products.map((p) => [p.id, p.unitCost]))
    return calculate(
      lines.map((l) => ({
        quantity: toDecimal(l.quantity),
        unitPrice: toDecimal(l.unitPrice),
        discountType: l.discountType,
        discountValue: toDecimal(l.discountValue),
        taxPercent: toDecimal(l.taxPercent),
        unitCost: costs.get(l.productId) ?? null,
      })),
    )
  }, [lines, products])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setLineErrors({})
    const missing = Object.fromEntries(lines.flatMap((l) => (l.productId ? [] : [[l.key, ['pick a product']]])))
    if (Object.keys(missing).length) {
      setBusy(false)
      setLineErrors(missing)
      setError('Every line needs a product.')
      return
    }
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
      router.push(`/quotes/${data.id}`)
    } catch (e) {
      const errors = splitLineErrors(e, 'Could not save quotation')
      setError(errors.message)
      setLineErrors(
        Object.fromEntries(Object.entries(errors.lines).flatMap(([i, msgs]) => (lines[Number(i)] ? [[lines[Number(i)].key, msgs]] : []))),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box component="form" onSubmit={submit}>
      <Stack spacing={3}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          {editing ? `Edit ${quoteNumber}` : 'New quotation'}
        </Typography>

        {locked && (
          <Alert
            severity="info"
            action={
              <Button component={NextLink} href={`/quotes/${id}`}>
                View
              </Button>
            }
          >
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

        <LineItems lines={lines} setLines={setLines} products={products} totals={totals} lineErrors={lineErrors} />

        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { md: 'flex-start' } }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
            Totals update as you type using the same rounding rules as the server. Cost and profit are for your team only;
            the customer never sees them. Saving keeps the quotation as a draft; submit it for approval from its page.
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
                <TotalRow label="Cost" value={formatOptionalMoney(totals.costTotal)} />
                <TotalRow label="Profit (before VAT)" value={formatOptionalMoney(totals.profit)} />
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

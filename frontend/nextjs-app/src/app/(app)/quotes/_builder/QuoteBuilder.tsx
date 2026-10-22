'use client'

import { Alert, Box, Button, Card, CardContent, Divider, LinearProgress, MenuItem, Stack, TextField, Typography } from '@mui/material'
import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from 'react'
import { TotalRow } from '@/components/TotalRow'
import { errorText } from '@/lib/api/types'
import { calculate, formatMoney, toDecimal } from '@/lib/pricing/pricing'
import { LineItems, newLine, type Line } from './LineItems'
import { quoteBuilderService } from '@/services/quoteBuilderService'
import type { Client, CreateQuoteRequest, ProductCategory } from '@/models'

/** YYYY-MM-DD in the user's local time zone. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function defaultQuoteNumber(): string {
  const stamp = isoDate(new Date()).replaceAll('-', '')
  return `Q-${stamp}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`
}

const noSubscribe = () => () => {}

/**
 * Creates a draft (/quotes/new) or edits one (/quotes/[id]/edit). Only RMs reach this page.
 * Rendered in the browser only: the defaults depend on the user's clock and time zone.
 */
export function QuoteBuilder({ id }: { id?: string }) {
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false)
  return inBrowser ? <BuilderForm id={id} /> : <LinearProgress />
}

function BuilderForm({ id }: { id?: string }) {
  const editing = id !== undefined
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [clientId, setClientId] = useState('')
  const [quoteNumber, setQuoteNumber] = useState(defaultQuoteNumber)
  const [today] = useState(() => isoDate(new Date()))
  const [expiryDate, setExpiryDate] = useState(() => isoDate(new Date(Date.now() + 30 * 864e5)))
  const [lines, setLines] = useState<Line[]>(() => [newLine()])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(editing)
  const [locked, setLocked] = useState<string | null>(null)

  useEffect(() => {
    quoteBuilderService
      .listCategories()
      .then(setCategories)
      .catch((e: unknown) => setError(errorText(e, 'Could not load product categories')))
    quoteBuilderService
      .listClients()
      .then((data) => {
        setClients(data)
        if (!editing && data.length === 1) setClientId(data[0].id)
      })
      .catch((e: unknown) => setError(errorText(e, 'Could not load clients')))
  }, [editing])

  useEffect(() => {
    if (!id) return
    quoteBuilderService.get(id).then(
      (data) => {
        setLoading(false)
        if (data.status !== 'draft') setLocked(`This quotation is ${data.status.replace('_', ' ')} and can no longer be edited.`)
        setClientId(data.clientId)
        setQuoteNumber(data.quoteNumber)
        setExpiryDate(data.expiryDate)
        setLines(
          data.items.map((it) =>
            newLine({
              title: it.title,
              categoryId: it.category?.id ?? '',
              description: it.description ?? '',
              quantity: String(it.quantity),
              unitPrice: String(it.unitPrice),
              discountPercent: String(it.discountPercent),
              taxPercent: String(it.taxPercent),
            }),
          ),
        )
      },
      (e: unknown) => {
        setLoading(false)
        setError(errorText(e, 'Could not load quotation'))
      },
    )
  }, [id])

  // Live preview with the same rounding rules as the server (contracts/fixtures/pricing-cases.json).
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

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const body: CreateQuoteRequest = {
      clientId,
      quoteNumber,
      expiryDate,
      items: lines.map((l) => ({
        title: l.title,
        categoryId: l.categoryId,
        ...(l.description.trim() ? { description: l.description } : {}),
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discountPercent: Number(l.discountPercent || 0),
        taxPercent: Number(l.taxPercent || 0),
      })),
    }
    try {
      const data = id ? await quoteBuilderService.update(id, body) : await quoteBuilderService.create(body)
      router.push(`/quotes/${data.id}`)
    } catch (e) {
      setError(errorText(e, 'Could not save quotation'))
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

        <LineItems lines={lines} setLines={setLines} categories={categories} totals={totals} />

        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { md: 'flex-start' } }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
            Totals update as you type using the same rounding rules as the server. Saving keeps the quotation as a draft;
            submit it for approval from its page.
          </Typography>
          <Card sx={{ minWidth: { md: 340 } }}>
            <CardContent>
              <Stack spacing={1}>
                <TotalRow label="Subtotal" value={formatMoney(totals.subtotal)} />
                <TotalRow label="Discount" value={`− ${formatMoney(totals.discountAmount)}`} />
                <TotalRow label="VAT" value={formatMoney(totals.taxAmount)} />
                <Divider />
                <TotalRow label="Grand total" value={formatMoney(totals.grandTotal)} strong />
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

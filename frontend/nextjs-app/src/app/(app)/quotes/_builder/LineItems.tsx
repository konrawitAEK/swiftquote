'use client'

import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import type { Dispatch, SetStateAction } from 'react'
import { formatMoney, formatOptionalMoney, formatQuantity, toDecimal, type PricingResult } from '@/lib/pricing/pricing'
import type { DiscountType, Product } from '@/models'

export interface Line {
  key: number
  /** '' until the RM picks a product (or for lines saved before products existed) */
  productId: string
  /** the saved title, shown for lines whose product is gone */
  title: string
  description: string
  quantity: string
  unitPrice: string
  discountType: DiscountType
  discountValue: string
  taxPercent: string
}

let nextKey = 1
export const newLine = (init: Partial<Omit<Line, 'key'>> = {}): Line => ({
  productId: '',
  title: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discountType: 'percent',
  discountValue: '0',
  taxPercent: '7',
  ...init,
  key: nextKey++,
})

function productLabel(p: Product): string {
  const stock = p.stock === null ? 'stock not tracked' : `${formatQuantity(p.stock)} in stock`
  return `${p.name} · ${formatMoney(p.unitPrice)} · ${stock}`
}

/** The builder's dynamic line items: pick products, edit and remove rows with live line totals, cost and profit. */
export function LineItems(props: {
  lines: Line[]
  setLines: Dispatch<SetStateAction<Line[]>>
  products: Product[]
  totals: PricingResult
  /** the API's 400 messages per Line.key */
  lineErrors: Record<number, string[]>
}) {
  const { lines, setLines, products, totals, lineErrors } = props
  const byId = new Map(products.map((p) => [p.id, p]))

  const update = (key: number, patch: Partial<Omit<Line, 'key'>>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  // Total quantity per product across the quote, compared with tracked stock.
  const quantityByProduct = new Map<string, number>()
  for (const l of lines) {
    if (l.productId) quantityByProduct.set(l.productId, (quantityByProduct.get(l.productId) ?? 0) + toDecimal(l.quantity).toNumber())
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Line items
        </Typography>
        <Stack spacing={2} divider={<Divider flexItem />}>
          {lines.map((l, i) => {
            const product = byId.get(l.productId)
            const wanted = quantityByProduct.get(l.productId) ?? 0
            const short = product && product.stock !== null && wanted > Number(product.stock)
            const errors = lineErrors[l.key]
            return (
              <Stack key={l.key} spacing={1.5}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'flex-start' } }}>
                  <TextField
                    select
                    label="Product"
                    value={l.productId}
                    onChange={(e) => {
                      const picked = byId.get(e.target.value)
                      update(l.key, { productId: e.target.value, ...(picked ? { unitPrice: String(picked.unitPrice), title: picked.name } : {}) })
                    }}
                    required
                    error={!!short}
                    helperText={
                      short
                        ? `Only ${formatQuantity(product.stock ?? 0)} in stock`
                        : !l.productId && l.title
                          ? `Was "${l.title}"; pick a product`
                          : product
                            ? product.category.name
                            : ' '
                    }
                    sx={{ flex: 3, minWidth: 220 }}
                    size="small"
                  >
                    {products
                      .filter((p) => p.active || p.id === l.productId)
                      .map((p) => (
                        <MenuItem key={p.id} value={p.id} disabled={!p.active}>
                          {p.active ? productLabel(p) : `${p.name} (retired)`}
                        </MenuItem>
                      ))}
                  </TextField>
                  <TextField
                    label="Qty"
                    type="number"
                    value={l.quantity}
                    onChange={(e) => update(l.key, { quantity: e.target.value })}
                    slotProps={{ htmlInput: { min: 1, step: 'any' } }}
                    required
                    sx={{ flex: 1, minWidth: 80 }}
                    size="small"
                  />
                  <TextField
                    label="Unit price"
                    type="number"
                    value={l.unitPrice}
                    onChange={(e) => update(l.key, { unitPrice: e.target.value })}
                    slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
                    helperText={product && toDecimal(l.unitPrice).cmp(product.unitPrice) !== 0 ? `List ${formatMoney(product.unitPrice)}` : ' '}
                    required
                    sx={{ flex: 1.5, minWidth: 110 }}
                    size="small"
                  />
                  <Stack direction="row" spacing={0.5} sx={{ flex: 2, minWidth: 180 }}>
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
                      error={totals.discountTooLarge[i]}
                      helperText={totals.discountTooLarge[i] ? 'More than the line amount' : ' '}
                      slotProps={{
                        htmlInput: l.discountType === 'percent' ? { min: 0, max: 100, step: 'any' } : { min: 0, step: '0.01' },
                        input:
                          l.discountType === 'percent'
                            ? { endAdornment: <InputAdornment position="end">%</InputAdornment> }
                            : { startAdornment: <InputAdornment position="start">฿</InputAdornment> },
                      }}
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
                    sx={{ flex: 1, minWidth: 80 }}
                    size="small"
                  />
                  <Typography
                    sx={{ flex: 1.5, textAlign: { md: 'right' }, fontVariantNumeric: 'tabular-nums', fontWeight: 500, pt: { md: 1 } }}
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
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}>
                  <TextField
                    label="Description (optional)"
                    value={l.description}
                    onChange={(e) => update(l.key, { description: e.target.value })}
                    sx={{ flex: 1 }}
                    size="small"
                  />
                  <Box sx={{ fontVariantNumeric: 'tabular-nums', textAlign: { md: 'right' }, minWidth: 260 }}>
                    <Typography variant="body2" color="text.secondary">
                      Cost {formatOptionalMoney(totals.lineCostTotals[i])} · Profit {formatOptionalMoney(totals.lineProfits[i])}
                    </Typography>
                  </Box>
                </Stack>
                {errors && (
                  <Alert severity="error" sx={{ py: 0 }}>
                    {errors.join('; ')}
                  </Alert>
                )}
              </Stack>
            )
          })}
        </Stack>
        <Button startIcon={<AddIcon />} onClick={() => setLines((ls) => [...ls, newLine()])} sx={{ mt: 2 }}>
          Add line
        </Button>
      </CardContent>
    </Card>
  )
}

'use client'

import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { Button, Card, CardContent, Divider, IconButton, InputAdornment, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material'
import type { Dispatch, SetStateAction } from 'react'
import type { Schemas } from '@/lib/api/types'
import { formatMoney, type PricingResult } from '@/lib/pricing/pricing'

export interface Line {
  key: number
  title: string
  categoryId: string
  description: string
  quantity: string
  unitPrice: string
  discountPercent: string
  taxPercent: string
}

let nextKey = 1
export const newLine = (init: Partial<Omit<Line, 'key'>> = {}): Line => ({
  title: '',
  categoryId: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discountPercent: '0',
  taxPercent: '7',
  ...init,
  key: nextKey++,
})

/** The builder's dynamic line items: add, edit and remove rows with live line totals. */
export function LineItems(props: {
  lines: Line[]
  setLines: Dispatch<SetStateAction<Line[]>>
  categories: Schemas['ProductCategory'][]
  totals: PricingResult
}) {
  const { lines, setLines, categories, totals } = props

  const update = (key: number, field: keyof Omit<Line, 'key'>, value: string) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)))

  return (
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
                select
                label="Category"
                value={l.categoryId}
                onChange={(e) => update(l.key, 'categoryId', e.target.value)}
                required
                sx={{ flex: 2, minWidth: 140 }}
                size="small"
              >
                {categories
                  .filter((c) => c.active || c.id === l.categoryId)
                  .map((c) => (
                    <MenuItem key={c.id} value={c.id} disabled={!c.active}>
                      {c.active ? c.name : `${c.name} (retired)`}
                    </MenuItem>
                  ))}
              </TextField>
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
              <Typography sx={{ flex: 1.5, textAlign: { md: 'right' }, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
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
  )
}

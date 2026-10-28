'use client'

import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from '@mui/material'
import { useState } from 'react'
import { errorText } from '@/lib/api/types'
import type { ProductCategory as Category, Product } from '@/models'
import { settingsService } from '@/services/settingsService'

const baht = { input: { startAdornment: <InputAdornment position="start">฿</InputAdornment> }, htmlInput: { min: 0, step: '0.01' } }

/** Add a product, or change its name, category, price, cost, stock and active flag. */
export function ProductDialog(props: { product: Product | null; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const { product, categories, onClose, onSaved } = props
  const [name, setName] = useState(product?.name ?? '')
  const [categoryId, setCategoryId] = useState(product?.category.id ?? '')
  const [unitPrice, setUnitPrice] = useState(product ? String(product.unitPrice) : '')
  const [unitCost, setUnitCost] = useState(product ? String(product.unitCost) : '')
  const [trackStock, setTrackStock] = useState(product ? product.stock !== null : false)
  const [stock, setStock] = useState(product?.stock != null ? String(product.stock) : '0')
  const [active, setActive] = useState(product?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Active categories only; a product's current (retired) category stays visible so the field is not blank.
  const choices = categories.filter((c) => c.active || c.id === product?.category.id)

  const save = async () => {
    setBusy(true)
    setError(null)
    const body = {
      name,
      categoryId,
      unitPrice: Number(unitPrice),
      unitCost: Number(unitCost),
      stock: trackStock ? Number(stock) : null,
    }
    try {
      await (product ? settingsService.updateProduct(product.id, { ...body, active }) : settingsService.createProduct(body))
      onSaved()
    } catch (e) {
      setError(errorText(e, 'Could not save product'))
    } finally {
      setBusy(false)
    }
  }

  const incomplete = name.trim() === '' || !categoryId || unitPrice === '' || unitCost === '' || (trackStock && stock === '')

  return (
    <Dialog open onClose={() => !busy && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{product ? `Edit ${product.name}` : 'Add product'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          <TextField select label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            {choices.map((c) => (
              <MenuItem key={c.id} value={c.id} disabled={!c.active}>
                {c.active ? c.name : `${c.name} (retired)`}
              </MenuItem>
            ))}
          </TextField>
          {choices.length === 0 && <Alert severity="info">Add a product category first.</Alert>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Unit price"
              type="number"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              slotProps={baht}
              helperText="Default selling price"
              required
              fullWidth
            />
            <TextField
              label="Unit cost"
              type="number"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              slotProps={baht}
              helperText="Not shown to customers"
              required
              fullWidth
            />
          </Stack>
          <FormControlLabel
            control={<Checkbox checked={trackStock} onChange={(e) => setTrackStock(e.target.checked)} />}
            label="Track stock"
          />
          {trackStock && (
            <TextField
              label="Stock"
              type="number"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              slotProps={{ htmlInput: { min: 0, step: 'any' } }}
              helperText="Checked when an RM submits or sends a quote; deducted when the customer accepts"
              required
            />
          )}
          {product && (
            <FormControlLabel
              control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />}
              label={active ? 'Active' : 'Retired (kept on existing quotes, hidden from new lines)'}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={save} disabled={busy || incomplete}>
          {product ? 'Save' : 'Add product'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

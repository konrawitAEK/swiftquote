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
import { errorText } from '../../api/http'
import { settingsService } from '../../services/settingsService'
import type { Product, ProductCategory } from '../../models'

const baht = { input: { startAdornment: <InputAdornment position="start">฿</InputAdornment> } }

/** Add a product, or edit its name, category, price, cost, stock and active flag. */
export function ProductDialog(props: {
  product: Product | null
  categories: ProductCategory[]
  onClose: () => void
  onSaved: () => void
}) {
  const { product, categories, onClose, onSaved } = props
  const [name, setName] = useState(product?.name ?? '')
  const [categoryId, setCategoryId] = useState(product?.category.id ?? '')
  const [unitPrice, setUnitPrice] = useState(product ? String(product.unitPrice) : '')
  const [unitCost, setUnitCost] = useState(product ? String(product.unitCost) : '')
  const [trackStock, setTrackStock] = useState(product ? product.stock !== null && product.stock !== undefined : false)
  const [stock, setStock] = useState(product?.stock != null ? String(product.stock) : '0')
  const [active, setActive] = useState(product?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Active categories only, plus the product's current one so an edit doesn't silently move it.
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
      if (product) await settingsService.updateProduct(product.id, { ...body, active })
      else await settingsService.createProduct(body)
      onSaved()
    } catch (err) {
      setError(errorText(err, 'Could not save product'))
    } finally {
      setBusy(false)
    }
  }

  const blank = (v: string) => v.trim() === ''

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
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Unit price"
              type="number"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              slotProps={{ ...baht, htmlInput: { min: 0, step: '0.01' } }}
              helperText="Default selling price per unit"
              required
              fullWidth
            />
            <TextField
              label="Unit cost"
              type="number"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              slotProps={{ ...baht, htmlInput: { min: 0, step: '0.01' } }}
              helperText="Hidden from customers"
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
              helperText="Checked when a quote is submitted or sent; deducted when the customer accepts"
              required
            />
          )}
          {product && (
            <FormControlLabel
              control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />}
              label={active ? 'Active' : 'Retired (kept on existing quotes, RMs can no longer pick it)'}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={busy || blank(name) || !categoryId || blank(unitPrice) || blank(unitCost) || (trackStock && blank(stock))}
        >
          {product ? 'Save' : 'Add product'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

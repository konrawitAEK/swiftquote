import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Switch, TextField } from '@mui/material'
import { useState } from 'react'
import { errorText } from '../../api/http'
import type { Schemas } from '../../api/types'
import { adminService } from '../../services/adminService'

type Category = Schemas['ProductCategory']

/** Add a product category, or rename / retire one. Retired categories stay on existing quotes. */
export function CategoryDialog(props: { category: Category | null; onClose: () => void; onSaved: () => void }) {
  const { category, onClose, onSaved } = props
  const [name, setName] = useState(category?.name ?? '')
  const [active, setActive] = useState(category?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      if (category) await adminService.updateCategory(category.id, { name, active })
      else await adminService.createCategory({ name })
      onSaved()
    } catch (err) {
      setError(errorText(err, 'Could not save category'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={() => !busy && onClose()} fullWidth maxWidth="xs">
      <DialogTitle>{category ? `Edit ${category.name}` : 'Add product category'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          {category && (
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
        <Button variant="contained" onClick={save} disabled={busy || name.trim() === ''}>
          {category ? 'Save' : 'Add category'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

'use client'

import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack } from '@mui/material'
import { useState } from 'react'
import { errorText } from '@/lib/api/types'
import { adminService, type DeleteKind } from './adminService'

export type DeleteTarget = { kind: DeleteKind; id: string; name: string }

const EXPLANATIONS: Record<DeleteTarget['kind'], string> = {
  user: "This permanently removes the account. Users with quote history can't be deleted; deactivate them instead.",
  team: 'Only empty teams can be deleted.',
  category: "Categories used on quotes can't be deleted; retire them instead.",
}

/** Confirm a permanent delete of a user, team or category; API refusals stay in the dialog. */
export function DeleteDialog(props: { target: DeleteTarget; onClose: () => void; onDeleted: () => void }) {
  const { target, onClose, onDeleted } = props
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await adminService.remove(target.kind, target.id)
      onDeleted()
    } catch (e) {
      setError(errorText(e, `Could not delete ${target.name}`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={() => !busy && onClose()} fullWidth maxWidth="xs">
      <DialogTitle>{`Delete ${target.name}?`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <DialogContentText>{EXPLANATIONS[target.kind]}</DialogContentText>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color="error" onClick={confirm} disabled={busy}>
          {busy ? 'Deleting…' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

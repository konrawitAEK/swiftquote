'use client'

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material'
import { useState } from 'react'
import { errorText } from '@/lib/api/types'
import type { AdminUser as User, Team, TeamRequest } from '@/models'
import { settingsService } from '@/services/settingsService'

/** Add a team or change its name and WO. */
export function TeamDialog(props: { team: Team | null; wos: User[]; onClose: () => void; onSaved: () => void }) {
  const { team, wos, onClose, onSaved } = props
  const [name, setName] = useState(team?.name ?? '')
  const [woUserId, setWoUserId] = useState(team?.wo?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const body: TeamRequest = { name, woUserId }
      await (team ? settingsService.updateTeam(team.id, body) : settingsService.createTeam(body))
      onSaved()
    } catch (e) {
      setError(errorText(e, 'Could not save team'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={() => !busy && onClose()} fullWidth maxWidth="xs">
      <DialogTitle>{team ? `Edit ${team.name}` : 'Add team'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Team name" value={name} onChange={(e) => setName(e.target.value)} required />
          <TextField select label="WO (approver)" value={woUserId} onChange={(e) => setWoUserId(e.target.value)} required>
            {wos.map((w) => (
              <MenuItem key={w.id} value={w.id}>
                {w.name}
              </MenuItem>
            ))}
          </TextField>
          {wos.length === 0 && <Alert severity="info">Add a user with the WO role first.</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={save} disabled={busy || !woUserId}>
          {team ? 'Save' : 'Add team'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

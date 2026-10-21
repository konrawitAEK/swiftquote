import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { api, errorText, type Role, type Schemas } from '../../api/client'
import { useAuth } from '../../auth/auth'
import { ROLE_LABELS } from '../../auth/roles'

type User = Schemas['AdminUser']
type Team = Schemas['Team']
type Client = Schemas['Client']

const ROLES = Object.keys(ROLE_LABELS) as Role[]

/** Add a user, or edit name, role, placement, active flag and password. */
export function UserDialog(props: { user: User | null; teams: Team[]; clients: Client[]; onClose: () => void; onSaved: () => void }) {
  const { user, teams, clients, onClose, onSaved } = props
  const self = useAuth().user?.id === user?.id
  const [email, setEmail] = useState(user?.email ?? '')
  const [name, setName] = useState(user?.name ?? '')
  const [role, setRole] = useState<Role>(user?.role ?? 'rm')
  const [teamId, setTeamId] = useState(user?.team?.id ?? '')
  const [clientId, setClientId] = useState(user?.client?.id ?? '')
  const [active, setActive] = useState(user?.active ?? true)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    setError(null)
    const placement = {
      teamId: role === 'rm' && teamId ? teamId : null,
      clientId: role === 'customer' && clientId ? clientId : null,
    }
    try {
      const res = user
        ? await api.PUT('/admin/users/{id}', {
            params: { path: { id: user.id } },
            body: { name, role, active, ...placement, password: password || null },
          })
        : await api.POST('/admin/users', { body: { email, name, password, role, ...placement } })
      if (res.data) onSaved()
      else setError(errorText(res.error, 'Could not save user'))
    } catch {
      setError('Cannot reach the API')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={() => !busy && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{user ? `Edit ${user.name}` : 'Add user'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!user} required />
          <TextField label="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
          <TextField select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={self}>
            {ROLES.map((r) => (
              <MenuItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </MenuItem>
            ))}
          </TextField>
          {role === 'rm' && (
            <TextField select label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)} helperText="An RM needs a team with a WO to submit for approval">
              <MenuItem value="">
                <em>No team</em>
              </MenuItem>
              {teams.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {role === 'customer' && (
            <TextField select label="Client company" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
              {clients.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            label={user ? 'New password (leave blank to keep)' : 'Password'}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            helperText="At least 8 characters"
            required={!user}
          />
          {user && (
            <FormControlLabel
              control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} disabled={self} />}
              label={active ? 'Active' : 'Inactive (cannot sign in; history is kept)'}
            />
          )}
          {self && (
            <Typography variant="caption" color="text.secondary">
              You cannot change your own role or deactivate yourself.
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={save} disabled={busy}>
          {user ? 'Save' : 'Add user'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

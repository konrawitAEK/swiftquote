import AddIcon from '@mui/icons-material/Add'
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { api, errorText, type Role, type Schemas } from '../api/client'
import { useAuth } from '../auth/auth'
import { ROLE_LABELS } from '../auth/roles'

type User = Schemas['AdminUser']
type Team = Schemas['Team']
type Client = Schemas['Client']

const ROLES = Object.keys(ROLE_LABELS) as Role[]

/** Admin: people and team structure only. */
export function AdminPage() {
  const [tab, setTab] = useState(0)
  const [users, setUsers] = useState<User[] | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editingUser, setEditingUser] = useState<User | 'new' | null>(null)
  const [editingTeam, setEditingTeam] = useState<Team | 'new' | null>(null)

  // Bumped after every save to refetch.
  const [version, setVersion] = useState(0)
  const reload = () => setVersion((v) => v + 1)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.GET('/admin/users'), api.GET('/admin/teams'), api.GET('/clients')])
      .then(([u, t, c]) => {
        if (cancelled) return
        if (!u.data || !t.data || !c.data) return setError(errorText(u.error ?? t.error ?? c.error, 'Could not load'))
        setUsers(u.data)
        setTeams(t.data)
        setClients(c.data)
      })
      .catch(() => !cancelled && setError('Cannot reach the API'))
    return () => {
      cancelled = true
    }
  }, [version])

  const activeWOs = (users ?? []).filter((u) => u.role === 'wo' && u.active)

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          Users & teams
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => (tab === 0 ? setEditingUser('new') : setEditingTeam('new'))}>
          {tab === 0 ? 'Add user' : 'Add team'}
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Card>
        <Tabs value={tab} onChange={(_, v: number) => setTab(v)} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab label={`Users${users ? ` (${users.length})` : ''}`} />
          <Tab label={`Teams (${teams.length})`} />
        </Tabs>
        {!users && !error && <LinearProgress />}
        {users && tab === 0 && (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Team / client</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id} sx={{ opacity: u.active ? 1 : 0.55 }}>
                    <TableCell sx={{ fontWeight: 500 }}>{u.name}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>{ROLE_LABELS[u.role]}</TableCell>
                    <TableCell>{u.team?.name ?? u.client?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Chip size="small" label={u.active ? 'Active' : 'Inactive'} color={u.active ? 'success' : 'default'} variant="outlined" />
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => setEditingUser(u)}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {users && tab === 1 && (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Team</TableCell>
                  <TableCell>WO (approver)</TableCell>
                  <TableCell>RMs</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {teams.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell sx={{ fontWeight: 500 }}>{t.name}</TableCell>
                    <TableCell>{t.wo?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                        {t.members.length === 0 && (
                          <Typography variant="body2" color="text.secondary">
                            No RMs yet
                          </Typography>
                        )}
                        {t.members.map((m) => (
                          <Chip key={m.id} size="small" label={m.name} />
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => setEditingTeam(t)}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              Move an RM between teams from the Users tab.
            </Typography>
          </TableContainer>
        )}
      </Card>

      {editingUser && (
        <UserDialog
          user={editingUser === 'new' ? null : editingUser}
          teams={teams}
          clients={clients}
          onClose={() => setEditingUser(null)}
          onSaved={() => {
            setEditingUser(null)
            reload()
          }}
        />
      )}
      {editingTeam && (
        <TeamDialog
          team={editingTeam === 'new' ? null : editingTeam}
          wos={activeWOs}
          onClose={() => setEditingTeam(null)}
          onSaved={() => {
            setEditingTeam(null)
            reload()
          }}
        />
      )}
    </Stack>
  )
}

function UserDialog(props: { user: User | null; teams: Team[]; clients: Client[]; onClose: () => void; onSaved: () => void }) {
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

function TeamDialog(props: { team: Team | null; wos: User[]; onClose: () => void; onSaved: () => void }) {
  const { team, wos, onClose, onSaved } = props
  const [name, setName] = useState(team?.name ?? '')
  const [woUserId, setWoUserId] = useState(team?.wo?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const body = { name, woUserId }
      const res = team
        ? await api.PUT('/admin/teams/{id}', { params: { path: { id: team.id } }, body })
        : await api.POST('/admin/teams', { body })
      if (res.data) onSaved()
      else setError(errorText(res.error, 'Could not save team'))
    } catch {
      setError('Cannot reach the API')
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

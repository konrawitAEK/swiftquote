'use client'

import AddIcon from '@mui/icons-material/Add'
import {
  Alert,
  Button,
  Card,
  Chip,
  LinearProgress,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { api, errorText, type Schemas } from '@/lib/api/client'
import { ROLE_LABELS } from '@/lib/auth/roles'
import { CategoryDialog } from './CategoryDialog'
import { TeamDialog } from './TeamDialog'
import { UserDialog } from './UserDialog'

type User = Schemas['AdminUser']
type Team = Schemas['Team']
type Client = Schemas['Client']
type Category = Schemas['ProductCategory']

const ADD_LABELS = ['Add user', 'Add team', 'Add category']

/** Admin: people, team structure and product categories. */
export function AdminConsole() {
  const [tab, setTab] = useState(0)
  const [users, setUsers] = useState<User[] | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [editingCategory, setEditingCategory] = useState<Category | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingUser, setEditingUser] = useState<User | 'new' | null>(null)
  const [editingTeam, setEditingTeam] = useState<Team | 'new' | null>(null)

  // Bumped after every save to refetch.
  const [version, setVersion] = useState(0)
  const reload = () => setVersion((v) => v + 1)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.GET('/admin/users'), api.GET('/admin/teams'), api.GET('/clients'), api.GET('/categories')])
      .then(([u, t, c, cat]) => {
        if (cancelled) return
        if (!u.data || !t.data || !c.data || !cat.data) {
          return setError(errorText(u.error ?? t.error ?? c.error ?? cat.error, 'Could not load'))
        }
        setUsers(u.data)
        setTeams(t.data)
        setClients(c.data)
        setCategories(cat.data)
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
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => [setEditingUser, setEditingTeam, setEditingCategory][tab]('new')}
        >
          {ADD_LABELS[tab]}
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Card>
        <Tabs value={tab} onChange={(_, v: number) => setTab(v)} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab label={`Users${users ? ` (${users.length})` : ''}`} />
          <Tab label={`Teams (${teams.length})`} />
          <Tab label={`Product categories (${categories.length})`} />
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
        {users && tab === 2 && (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Category</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {categories.map((c) => (
                  <TableRow key={c.id} sx={{ opacity: c.active ? 1 : 0.55 }}>
                    <TableCell sx={{ fontWeight: 500 }}>{c.name}</TableCell>
                    <TableCell>
                      <Chip size="small" label={c.active ? 'Active' : 'Retired'} color={c.active ? 'success' : 'default'} variant="outlined" />
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => setEditingCategory(c)}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              RMs pick a category for every quote line; the WOC dashboard can break sales down by category.
            </Typography>
          </TableContainer>
        )}
      </Card>

      {editingCategory && (
        <CategoryDialog
          category={editingCategory === 'new' ? null : editingCategory}
          onClose={() => setEditingCategory(null)}
          onSaved={() => {
            setEditingCategory(null)
            reload()
          }}
        />
      )}
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

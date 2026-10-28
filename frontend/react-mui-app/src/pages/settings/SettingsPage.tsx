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
import { errorText } from '../../api/http'
import { useAuth } from '../../auth/auth'
import { ROLE_LABELS } from '../../auth/roles'
import { formatMoney } from '../../pricing/pricing'
import { settingsService } from '../../services/settingsService'
import { CategoryDialog } from './CategoryDialog'
import { DeleteDialog, type DeleteTarget } from './DeleteDialog'
import { ProductDialog } from './ProductDialog'
import { TeamDialog } from './TeamDialog'
import { UserDialog } from './UserDialog'
import type { AdminUser, Client, Product, ProductCategory, Team } from '../../models'

type User = AdminUser
type Category = ProductCategory

const ADD_LABELS = ['Add user', 'Add team', 'Add category', 'Add product']

const stockText = (stock: number | null | undefined) =>
  stock === null || stock === undefined ? 'not tracked' : stock.toLocaleString('en-US', { maximumFractionDigits: 2 })

/** Settings (Back Office): people, team structure, product categories and products. */
export function SettingsPage() {
  const [tab, setTab] = useState(0)
  const [users, setUsers] = useState<User[] | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [editingCategory, setEditingCategory] = useState<Category | 'new' | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [editingProduct, setEditingProduct] = useState<Product | 'new' | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingUser, setEditingUser] = useState<User | 'new' | null>(null)
  const [editingTeam, setEditingTeam] = useState<Team | 'new' | null>(null)
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null)
  const meId = useAuth().user?.id

  // Bumped after every save to refetch.
  const [version, setVersion] = useState(0)
  const reload = () => setVersion((v) => v + 1)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      settingsService.listUsers(),
      settingsService.listTeams(),
      settingsService.listClients(),
      settingsService.listCategories(),
      settingsService.listProducts(),
    ])
      .then(([u, t, c, cat, p]) => {
        if (cancelled) return
        setUsers(u)
        setTeams(t)
        setClients(c)
        setCategories(cat)
        setProducts(p)
      })
      .catch((err: unknown) => !cancelled && setError(errorText(err, 'Could not load')))
    return () => {
      cancelled = true
    }
  }, [version])

  /** Retire or reactivate a product: a full update with only the active flag flipped. */
  const toggleProduct = async (p: Product) => {
    setToggling(p.id)
    setError(null)
    try {
      await settingsService.updateProduct(p.id, {
        name: p.name,
        categoryId: p.category.id,
        unitPrice: p.unitPrice,
        unitCost: p.unitCost,
        stock: p.stock ?? null,
        active: !p.active,
      })
      reload()
    } catch (err) {
      setError(errorText(err, `Could not update ${p.name}`))
    } finally {
      setToggling(null)
    }
  }

  const activeWOs = (users ?? []).filter((u) => u.role === 'wo' && u.active)

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          Settings
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => [setEditingUser, setEditingTeam, setEditingCategory, setEditingProduct][tab]('new')}
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
          <Tab label={`Products (${products.length})`} />
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
                      {u.id !== meId && (
                        <Button
                          size="small"
                          color="error"
                          aria-label={`Delete ${u.name}`}
                          onClick={() => setDeleting({ kind: 'user', id: u.id, name: u.name })}
                        >
                          Delete
                        </Button>
                      )}
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
                      <Button
                        size="small"
                        color="error"
                        aria-label={`Delete ${t.name}`}
                        onClick={() => setDeleting({ kind: 'team', id: t.id, name: t.name })}
                      >
                        Delete
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
                      <Button
                        size="small"
                        color="error"
                        aria-label={`Delete ${c.name}`}
                        onClick={() => setDeleting({ kind: 'category', id: c.id, name: c.name })}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              Every product belongs to a category; the WOC dashboard can break sales down by category.
            </Typography>
          </TableContainer>
        )}
        {users && tab === 3 && (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Product</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell align="right">Selling price</TableCell>
                  <TableCell align="right">Cost</TableCell>
                  <TableCell align="right">Stock</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody sx={{ '& td': { fontVariantNumeric: 'tabular-nums' } }}>
                {products.map((p) => (
                  <TableRow key={p.id} sx={{ opacity: p.active ? 1 : 0.55 }}>
                    <TableCell sx={{ fontWeight: 500 }}>{p.name}</TableCell>
                    <TableCell>{p.category.name}</TableCell>
                    <TableCell align="right">{formatMoney(p.unitPrice)}</TableCell>
                    <TableCell align="right">{formatMoney(p.unitCost)}</TableCell>
                    <TableCell align="right" sx={{ color: p.stock == null ? 'text.secondary' : undefined }}>
                      {stockText(p.stock)}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={p.active ? 'Active' : 'Retired'} color={p.active ? 'success' : 'default'} variant="outlined" />
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Button size="small" onClick={() => setEditingProduct(p)}>
                        Edit
                      </Button>
                      <Button size="small" disabled={toggling === p.id} onClick={() => toggleProduct(p)}>
                        {p.active ? 'Retire' : 'Reactivate'}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        aria-label={`Delete ${p.name}`}
                        onClick={() => setDeleting({ kind: 'product', id: p.id, name: p.name })}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              RMs pick an active product for every quote line. Cost and profit are shown to staff, never to customers.
              Tracked stock is checked when a quote is submitted or sent and deducted when the customer accepts.
            </Typography>
          </TableContainer>
        )}
      </Card>

      {deleting && (
        <DeleteDialog
          target={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null)
            reload()
          }}
        />
      )}
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
      {editingProduct && (
        <ProductDialog
          product={editingProduct === 'new' ? null : editingProduct}
          categories={categories}
          onClose={() => setEditingProduct(null)}
          onSaved={() => {
            setEditingProduct(null)
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

import { Alert, Box, Button, Card, CardContent, Chip, Stack, TextField, Typography } from '@mui/material'
import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../auth/auth'
import { homePath } from '../../auth/roles'

// Seeded by db/migrations/V6__seed_dev_roles.sql; all use the password "password".
const DEV_ACCOUNTS = [
  { label: 'Admin', email: 'demo@swiftquote.dev' },
  { label: 'WOC', email: 'woc@swiftquote.dev' },
  { label: 'WO', email: 'wo@swiftquote.dev' },
  { label: 'RM', email: 'rm1@swiftquote.dev' },
  { label: 'Customer', email: 'buyer@acme.example' },
]

export function LoginPage() {
  const { isAuthenticated, user, login } = useAuth()
  const [email, setEmail] = useState('rm1@swiftquote.dev')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Always start on the role's home page, never on the page that was open before.
  if (isAuthenticated && user) return <Navigate to={homePath(user.role)} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const err = await login(email, password)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, bgcolor: 'background.default' }}>
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            SwiftQuote
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Sign in to manage your quotations
          </Typography>
          <Stack component="form" spacing={2} onSubmit={submit}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              fullWidth
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              fullWidth
              autoFocus
            />
            <Button type="submit" variant="contained" size="large" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 3, mb: 1 }}>
            Dev accounts (password: password)
          </Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {DEV_ACCOUNTS.map((a) => (
              <Chip
                key={a.email}
                label={a.label}
                variant={email === a.email ? 'filled' : 'outlined'}
                color={email === a.email ? 'primary' : 'default'}
                onClick={() => setEmail(a.email)}
              />
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}

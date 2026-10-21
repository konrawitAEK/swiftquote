import { AppBar, Box, Button, Chip, Container, Stack, Toolbar, Typography } from '@mui/material'
import { Navigate, NavLink, Outlet, Link as RouterLink } from 'react-router-dom'
import type { Role } from '../api/client'
import { useAuth } from '../auth/auth'
import { homePath, ROLE_LABELS } from '../auth/roles'

const NAV: Record<Role, { to: string; label: string }[]> = {
  admin: [{ to: '/admin', label: 'Users & teams' }],
  woc: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/quotes', label: 'All quotations' },
  ],
  wo: [{ to: '/quotes', label: 'Team quotations' }],
  rm: [
    { to: '/quotes', label: 'My quotations' },
    { to: '/quotes/new', label: 'New quote' },
  ],
  customer: [{ to: '/quotes', label: 'My quotations' }],
}

/** Shell for signed-in pages; redirects to /login without a session and home when the role may not open the page. */
export function AppLayout({ roles }: { roles?: Role[] }) {
  const { isAuthenticated, user, logout } = useAuth()

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={homePath(user.role)} replace />
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" elevation={0}>
        <Toolbar sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Typography
            variant="h6"
            component={RouterLink}
            to={homePath(user.role)}
            sx={{ color: 'inherit', textDecoration: 'none', fontWeight: 700, mr: 2 }}
          >
            SwiftQuote
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ flexGrow: 1 }}>
            {NAV[user.role].map((item) => (
              <Button
                key={item.to}
                component={NavLink}
                to={item.to}
                end
                color="inherit"
                sx={{ '&.active': { bgcolor: 'rgba(255,255,255,0.16)' } }}
              >
                {item.label}
              </Button>
            ))}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', display: { xs: 'none', sm: 'flex' } }}>
            <Typography variant="body2">{user.name}</Typography>
            <Chip size="small" label={ROLE_LABELS[user.role]} sx={{ color: 'inherit', borderColor: 'currentcolor' }} variant="outlined" />
          </Stack>
          <Button color="inherit" onClick={logout}>
            Log out
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: { xs: 2, sm: 4 } }}>
        <Outlet />
      </Container>
    </Box>
  )
}

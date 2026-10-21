import { AppBar, Box, Button, Container, Toolbar, Typography } from '@mui/material'
import { Navigate, Outlet, Link as RouterLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/auth'

/** Shell for signed-in pages; redirects to /login when there is no session. */
export function AppLayout() {
  const { isAuthenticated, user, logout } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" elevation={0}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography
            variant="h6"
            component={RouterLink}
            to="/quotes"
            sx={{ color: 'inherit', textDecoration: 'none', fontWeight: 700, flexGrow: 1 }}
          >
            SwiftQuote
          </Typography>
          {user && (
            <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' } }}>
              {user.name}
            </Typography>
          )}
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

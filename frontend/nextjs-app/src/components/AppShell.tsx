'use client'

import { AppBar, Box, Button, Chip, Container, Stack, Toolbar, Typography } from '@mui/material'
import NextLink from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import type { Role } from '@/lib/api/types'
import { homePath, ROLE_LABELS } from '@/lib/auth/roles'
import { useAuth } from './AuthProvider'

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

/** Shell for signed-in pages. The server layout has already checked the session. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const pathname = usePathname()
  if (!user) return null

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" elevation={0}>
        <Toolbar sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Typography
            variant="h6"
            component={NextLink}
            href={homePath(user.role)}
            sx={{ color: 'inherit', textDecoration: 'none', fontWeight: 700, mr: 2 }}
          >
            SwiftQuote
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ flexGrow: 1 }}>
            {NAV[user.role].map((item) => (
              <Button
                key={item.to}
                component={NextLink}
                href={item.to}
                color="inherit"
                className={pathname === item.to ? 'active' : undefined}
                aria-current={pathname === item.to ? 'page' : undefined}
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
        {children}
      </Container>
    </Box>
  )
}

'use client'

import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/components/AuthProvider'
import type { AuthUser } from '@/lib/auth/session'

// CSS variables + the prefers-color-scheme media query: the server renders the right mode, no flash.
const theme = createTheme({
  cssVariables: true,
  colorSchemes: { light: true, dark: true },
  palette: { primary: { main: '#2f5bd3' } },
  shape: { borderRadius: 10 },
  typography: { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
})

/** Theme and session for every page; the initial user comes from the request cookies. */
export function Providers({ initialUser, children }: { initialUser: AuthUser | null; children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider initialUser={initialUser}>{children}</AuthProvider>
    </ThemeProvider>
  )
}

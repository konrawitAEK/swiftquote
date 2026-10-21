import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter'
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Providers } from '@/components/Providers'
import { getSession } from '@/lib/auth/guard'

export const metadata: Metadata = {
  title: 'SwiftQuote',
  description: 'Quotations with approval workflow and e-signature',
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getSession()
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider>
          <Providers initialUser={user}>{children}</Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  )
}

import type { ReactNode } from 'react'
import { AppShell } from '@/components/AppShell'
import { requireRole } from '@/lib/auth/guard'

/** Signed-in area: no session → /login. Each page narrows the allowed roles further. */
export default async function SignedInLayout({ children }: { children: ReactNode }) {
  await requireRole(['admin', 'woc', 'wo', 'rm', 'customer'])
  return <AppShell>{children}</AppShell>
}

import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/guard'
import { homePath } from '@/lib/auth/roles'
import { LoginForm } from './LoginForm'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  // ?expired=1: the API rejected a token that still verifies (e.g. deactivated account), so stay here instead of
  // bouncing back to the home page that just failed.
  const expired = (await searchParams).expired === '1'
  // Always start on the role's home page, never on the page that was open before.
  const user = expired ? null : await getSession()
  if (user) redirect(homePath(user.role))
  return <LoginForm expired={expired} />
}

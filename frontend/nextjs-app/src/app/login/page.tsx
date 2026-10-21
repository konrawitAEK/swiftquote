import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/guard'
import { homePath } from '@/lib/auth/roles'
import { LoginForm } from './LoginForm'

export default async function LoginPage() {
  // Always start on the role's home page, never on the page that was open before.
  const user = await getSession()
  if (user) redirect(homePath(user.role))
  return <LoginForm />
}

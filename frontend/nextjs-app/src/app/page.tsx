import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/guard'
import { homePath } from '@/lib/auth/roles'

/** The root goes to the role's landing page, or to login. */
export default async function Home() {
  const user = await getSession()
  redirect(user ? homePath(user.role) : '/login')
}

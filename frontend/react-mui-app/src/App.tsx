import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/auth'
import { homePath } from './auth/roles'
import { AppLayout } from './components/AppLayout'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { LoginPage } from './pages/login/LoginPage'
import { PublicQuotePage } from './pages/public-quote/PublicQuotePage'
import { QuoteBuilderPage } from './pages/quote-builder/QuoteBuilderPage'
import { QuoteDetailPage } from './pages/quote-detail/QuoteDetailPage'
import { QuotesPage } from './pages/quotes/QuotesPage'
import { SettingsPage } from './pages/settings/SettingsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/p/:accessToken" element={<PublicQuotePage />} />
      <Route element={<AppLayout roles={['rm', 'wo', 'woc', 'customer']} />}>
        <Route path="/quotes" element={<QuotesPage />} />
        <Route path="/quotes/:id" element={<QuoteDetailPage />} />
      </Route>
      <Route element={<AppLayout roles={['rm']} />}>
        <Route path="/quotes/new" element={<QuoteBuilderPage />} />
        <Route path="/quotes/:id/edit" element={<QuoteBuilderPage />} />
      </Route>
      <Route element={<AppLayout roles={['woc']} />}>
        <Route path="/dashboard" element={<DashboardPage />} />
      </Route>
      <Route element={<AppLayout roles={['admin']} />}>
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="/admin" element={<Navigate to="/settings" replace />} />
      <Route path="*" element={<Home />} />
    </Routes>
  )
}

/** Unknown paths go to the role's landing page, or to login. */
function Home() {
  const { user } = useAuth()
  return <Navigate to={user ? homePath(user.role) : '/login'} replace />
}

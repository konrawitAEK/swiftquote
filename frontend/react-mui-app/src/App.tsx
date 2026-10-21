import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { LoginPage } from './pages/LoginPage'
import { PublicQuotePage } from './pages/PublicQuotePage'
import { QuoteBuilderPage } from './pages/QuoteBuilderPage'
import { QuotesPage } from './pages/QuotesPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/p/:accessToken" element={<PublicQuotePage />} />
      <Route element={<AppLayout />}>
        <Route path="/quotes" element={<QuotesPage />} />
        <Route path="/quotes/new" element={<QuoteBuilderPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/quotes" replace />} />
    </Routes>
  )
}

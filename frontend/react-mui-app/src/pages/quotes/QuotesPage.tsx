import AddIcon from '@mui/icons-material/Add'
import {
  Alert,
  Box,
  Button,
  Card,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { errorText } from '../../api/http'
import type { QuoteStatus, Role, Schemas } from '../../api/types'
import { useAuth } from '../../auth/auth'
import { STATUS_LABELS } from '../../auth/roles'
import { StatusChip } from '../../components/StatusChip'
import { formatMoney } from '../../pricing/pricing'
import { quotesService } from '../../services/quotesService'

const STATUSES: QuoteStatus[] = ['draft', 'pending_approval', 'approved', 'sent', 'viewed', 'accepted', 'rejected']
const CUSTOMER_STATUSES: QuoteStatus[] = ['sent', 'viewed', 'accepted', 'rejected']

const TITLES: Record<Role, string> = {
  rm: 'My quotations',
  wo: 'Team quotations',
  woc: 'All quotations',
  customer: 'My quotations',
  admin: 'Quotations',
}

export function QuotesPage() {
  const role = useAuth().user?.role ?? 'rm'
  const showCreator = role === 'wo' || role === 'woc'
  const [status, setStatus] = useState<QuoteStatus | ''>('')
  const [quotes, setQuotes] = useState<Schemas['QuoteSummary'][] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    quotesService
      .list(status || undefined)
      .then((data) => {
        if (cancelled) return
        setQuotes(data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setQuotes([])
        setError(errorText(err, 'Could not load quotes'))
      })
    return () => {
      cancelled = true
    }
  }, [status])

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between' }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          {TITLES[role]}
        </Typography>
        <Stack direction="row" spacing={2}>
          <TextField
            select
            size="small"
            label="Status"
            value={status}
            onChange={(e) => {
              setQuotes(null)
              setStatus(e.target.value as QuoteStatus | '')
            }}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="">All</MenuItem>
            {(role === 'customer' ? CUSTOMER_STATUSES : STATUSES).map((s) => (
              <MenuItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </MenuItem>
            ))}
          </TextField>
          {role === 'rm' && (
            <Button component={RouterLink} to="/quotes/new" variant="contained" startIcon={<AddIcon />}>
              New quote
            </Button>
          )}
        </Stack>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Card>
        {quotes === null && !error && <LinearProgress />}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Number</TableCell>
                <TableCell>Client</TableCell>
                {showCreator && <TableCell>Created by</TableCell>}
                <TableCell>Status</TableCell>
                <TableCell>Expires</TableCell>
                <TableCell align="right">Grand total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {quotes?.map((q) => (
                <TableRow key={q.id} hover onClick={() => navigate(`/quotes/${q.id}`)} sx={{ cursor: 'pointer' }}>
                  <TableCell sx={{ fontWeight: 500 }}>
                    <Box
                      component={RouterLink}
                      to={`/quotes/${q.id}`}
                      onClick={(e) => e.stopPropagation()}
                      sx={{ color: 'inherit', textDecoration: 'none' }}
                    >
                      {q.quoteNumber}
                    </Box>
                  </TableCell>
                  <TableCell>{q.clientName}</TableCell>
                  {showCreator && <TableCell>{q.createdBy?.name ?? '—'}</TableCell>}
                  <TableCell>
                    <StatusChip status={q.status} />
                  </TableCell>
                  <TableCell>{q.expiryDate}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(q.grandTotal)}
                  </TableCell>
                </TableRow>
              ))}
              {quotes?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={showCreator ? 6 : 5}>
                    <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                      {role === 'rm' ? 'No quotations yet. Create one to get started.' : 'No quotations to show.'}
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Stack>
  )
}

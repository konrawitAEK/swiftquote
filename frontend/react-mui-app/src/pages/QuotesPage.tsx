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
import { api, errorText, type QuoteStatus, type Schemas } from '../api/client'
import { StatusChip } from '../components/StatusChip'
import { formatMoney } from '../pricing/pricing'

const STATUSES: QuoteStatus[] = ['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired']

export function QuotesPage() {
  const [status, setStatus] = useState<QuoteStatus | ''>('')
  const [quotes, setQuotes] = useState<Schemas['QuoteSummary'][] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    api
      .GET('/quotes', { params: { query: status ? { status } : {} } })
      .then(({ data, error }) => {
        if (cancelled) return
        setQuotes(data ?? [])
        setError(data ? null : errorText(error, 'Could not load quotes'))
      })
      .catch(() => !cancelled && setError('Cannot reach the API'))
    return () => {
      cancelled = true
    }
  }, [status])

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between' }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          Quotations
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
            {STATUSES.map((s) => (
              <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>
                {s}
              </MenuItem>
            ))}
          </TextField>
          <Button component={RouterLink} to="/quotes/new" variant="contained" startIcon={<AddIcon />}>
            New quote
          </Button>
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
                  <TableCell colSpan={5}>
                    <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                      No quotations yet. Create one to get started.
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

import { Box, Card, CardContent, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { InlineBar } from './InlineBar'
import { byAmount, maxAmount, MEASURE_LABELS, type MeasureKey, type Summary } from './measures'

function EmptyRow({ cols }: { cols: number }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} sx={{ color: 'text.secondary', textAlign: 'center' }}>
        Nothing in this period.
      </TableCell>
    </TableRow>
  )
}

/** RM and team rankings for the selected measure. */
export function RankTables({ data, measure }: { data: Summary; measure: MeasureKey }) {
  const rms = byAmount(data.byRm, measure)
  const teams = byAmount(data.byTeam, measure)
  const rmMax = maxAmount(rms.map((r) => r[measure]))
  const teamMax = maxAmount(teams.map((t) => t[measure]))
  const label = MEASURE_LABELS[measure]
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' } }}>
      <Card>
        <CardContent>
          <Typography variant="h6">By RM</Typography>
        </CardContent>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>RM</TableCell>
                <TableCell>Team</TableCell>
                <TableCell align="right">Quotes</TableCell>
                <TableCell align="right">Sent</TableCell>
                <TableCell align="right">{measure === 'won' ? 'Won' : 'Waiting'}</TableCell>
                <TableCell>{label}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody sx={{ '& td': { fontVariantNumeric: 'tabular-nums' } }}>
              {rms.map((r) => (
                <TableRow key={r.user.id}>
                  <TableCell>{r.user.name}</TableCell>
                  <TableCell>{r.team ?? '—'}</TableCell>
                  <TableCell align="right">{r.quoteCount}</TableCell>
                  <TableCell align="right">{r.sentCount}</TableCell>
                  <TableCell align="right">{r[measure].count}</TableCell>
                  <TableCell sx={{ minWidth: 200 }}>
                    <InlineBar value={r[measure].amount} max={rmMax} />
                  </TableCell>
                </TableRow>
              ))}
              {rms.length === 0 && <EmptyRow cols={6} />}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
      <Card>
        <CardContent>
          <Typography variant="h6">By team</Typography>
        </CardContent>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Team</TableCell>
                <TableCell align="right">Quotes</TableCell>
                <TableCell>{label}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody sx={{ '& td': { fontVariantNumeric: 'tabular-nums' } }}>
              {teams.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.name}</TableCell>
                  <TableCell align="right">{t[measure].count}</TableCell>
                  <TableCell sx={{ minWidth: 180 }}>
                    <InlineBar value={t[measure].amount} max={teamMax} />
                  </TableCell>
                </TableRow>
              ))}
              {teams.length === 0 && <EmptyRow cols={3} />}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  )
}

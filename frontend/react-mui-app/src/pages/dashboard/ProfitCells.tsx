import { TableCell } from '@mui/material'
import { formatMoney } from '../../pricing/pricing'
import { formatMargin, formatSignedMoney, isLoss, type Measure } from './measures'

/** Cost is the first column to go at phone width; profit and margin stay. */
const hideOnPhone = { display: { xs: 'none', sm: 'table-cell' } }

/** Cost, Profit and Margin headers, placed after a table's amount column. */
export function ProfitHeadCells() {
  return (
    <>
      <TableCell align="right" sx={hideOnPhone}>
        Cost
      </TableCell>
      <TableCell align="right">Profit</TableCell>
      <TableCell align="right">Margin</TableCell>
    </>
  )
}

/** A row's cost, profit and margin (before VAT, over the lines that have a cost); losses in red. */
export function ProfitCells({ m }: { m: Measure }) {
  const color = isLoss(m) ? 'error.main' : undefined
  return (
    <>
      <TableCell align="right" sx={{ ...hideOnPhone, whiteSpace: 'nowrap' }}>
        {formatMoney(m.cost)}
      </TableCell>
      <TableCell align="right" sx={{ whiteSpace: 'nowrap', color }}>
        {formatSignedMoney(m.profit)}
      </TableCell>
      <TableCell align="right" sx={{ whiteSpace: 'nowrap', color }}>
        {formatMargin(m)}
      </TableCell>
    </>
  )
}

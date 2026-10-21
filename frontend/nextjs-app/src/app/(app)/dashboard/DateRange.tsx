'use client'

import { Button, Stack, TextField } from '@mui/material'

/** The period filter; changes go to the URL (?from=&to=) so the server refetches the summary. */
export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
      <TextField
        size="small"
        type="date"
        label="From"
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        size="small"
        type="date"
        label="To"
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      {(from || to) && <Button onClick={() => onChange('', '')}>All time</Button>}
    </Stack>
  )
}

import { Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import type { Schemas } from '../../api/client'
import { SignaturePad } from '../../components/SignaturePad'

/** Customer's signature form on a sent quote. */
export function AcceptCard({ busy, onAccept }: { busy: boolean; onAccept: (body: Schemas['AcceptQuoteRequest']) => void }) {
  const [signerName, setSignerName] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Accept this quotation</Typography>
          <TextField label="Your full name" value={signerName} onChange={(e) => setSignerName(e.target.value)} required fullWidth />
          <SignaturePad onChange={setSignature} disabled={busy} />
          <Button
            variant="contained"
            size="large"
            disabled={busy || !signature || signerName.trim() === ''}
            onClick={() => signature && onAccept({ signerName, signatureDataUrl: signature })}
          >
            {busy ? 'Submitting…' : 'Sign and accept'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  )
}

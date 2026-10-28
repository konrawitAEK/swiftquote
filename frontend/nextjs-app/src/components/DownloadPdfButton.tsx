'use client'

import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined'
import { Button } from '@mui/material'
import { useState } from 'react'
import { saveFile, type PdfFile } from '@/lib/api/pdf'

/** Fetches a PDF through the given service call and saves it; failures go to onError. */
export function DownloadPdfButton({ download, onError }: { download: () => Promise<PdfFile>; onError: (err: unknown) => void }) {
  const [busy, setBusy] = useState(false)

  const click = async () => {
    setBusy(true)
    try {
      saveFile(await download())
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="outlined" startIcon={<PictureAsPdfOutlinedIcon />} onClick={click} disabled={busy}>
      {busy ? 'Preparing PDF…' : 'Download PDF'}
    </Button>
  )
}

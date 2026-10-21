'use client'

import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { IconButton, InputAdornment, TextField, Tooltip } from '@mui/material'
import { useState, type FocusEvent } from 'react'
import { shareUrl } from './shareUrl'

/** Read-only client portal link with a copy button. */
export function ShareLink({ accessToken }: { accessToken: string }) {
  const url = shareUrl(accessToken)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked (e.g. insecure context): the field stays selectable
    }
  }

  return (
    <TextField
      value={url}
      fullWidth
      size="small"
      label="Client link"
      slotProps={{
        htmlInput: { readOnly: true, onFocus: (e: FocusEvent<HTMLInputElement>) => e.target.select() },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={copied ? 'Copied' : 'Copy link'}>
                <IconButton aria-label="Copy link" onClick={copy}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  )
}

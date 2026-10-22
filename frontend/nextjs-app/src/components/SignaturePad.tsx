'use client'

import { Box, Button, Stack, Typography } from '@mui/material'
import { useEffect, useRef, useState, type PointerEvent } from 'react'

interface Props {
  /** Called with a PNG data URL after each stroke, or null when cleared. */
  onChange: (dataUrl: string | null) => void
  disabled?: boolean
}

/** Pointer-based signature canvas (mouse, touch and pen). */
export function SignaturePad({ onChange, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const moved = useRef(false)
  const [empty, setEmpty] = useState(true)

  // Match the backing store to the displayed size so strokes are crisp and under the pointer.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const { width, height } = canvas.getBoundingClientRect()
    canvas.width = width * ratio
    canvas.height = height * ratio
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111'
  }, [])

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    const ctx = e.currentTarget.getContext('2d')
    if (!ctx) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    moved.current = false
    const { x, y } = point(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const ctx = e.currentTarget.getContext('2d')
    if (!ctx) return
    const { x, y } = point(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    moved.current = true
  }

  const end = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    drawing.current = false
    if (!moved.current) return // a tap draws nothing, so it is not a signature
    setEmpty(false)
    onChange(e.currentTarget.toDataURL('image/png'))
  }

  const clear = () => {
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setEmpty(true)
    onChange(null)
  }

  return (
    <Stack spacing={1}>
      <Box
        sx={{
          position: 'relative',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: '#fff',
          height: 160,
        }}
      >
        <canvas
          ref={canvasRef}
          aria-label="Signature pad"
          style={{ width: '100%', height: '100%', touchAction: 'none', cursor: disabled ? 'default' : 'crosshair' }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
        {empty && (
          <Typography
            variant="body2"
            sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'grey.500', pointerEvents: 'none' }}
          >
            Sign here
          </Typography>
        )}
      </Box>
      <Box>
        <Button size="small" onClick={clear} disabled={disabled || empty}>
          Clear
        </Button>
      </Box>
    </Stack>
  )
}

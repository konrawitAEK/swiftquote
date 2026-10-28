import { isAxiosError } from 'axios'
import { errorText } from '@/lib/api/types'
import type { ErrorResponse } from '@/models'

export interface SaveErrors {
  /** Shown above the form: the message plus any details that are not about one line. */
  message: string
  /** Messages per line index, e.g. "items[1]: quantity must be at least 1" → {1: ["quantity must be at least 1"]}. */
  lines: Record<number, string[]>
}

const LINE_DETAIL = /^items\[(\d+)\][.:]?\s*(.*)$/

/** Splits a failed save into a general message and the API's per-line 400 details. */
export function splitLineErrors(err: unknown, fallback: string): SaveErrors {
  const body = isAxiosError(err) ? (err.response?.data as Partial<ErrorResponse> | undefined) : undefined
  if (!body || typeof body.message !== 'string' || !body.details?.length) return { message: errorText(err, fallback), lines: {} }
  const lines: Record<number, string[]> = {}
  const other: string[] = []
  for (const d of body.details) {
    const m = LINE_DETAIL.exec(d)
    if (m) (lines[Number(m[1])] ??= []).push(m[2])
    else other.push(d)
  }
  const perLine = Object.keys(lines).length
  const message = other.length
    ? `${body.message}: ${other.join('; ')}`
    : perLine
      ? `${body.message}: see the highlighted line${perLine > 1 ? 's' : ''}`
      : body.message
  return { message, lines }
}

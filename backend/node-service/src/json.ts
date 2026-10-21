// JSON handling that keeps decimals exact in both directions, matching the Go and Spring services.
import { randomBytes } from 'node:crypto'
import type { Decimal } from 'decimal.js'

/** A JSON number kept as its source text, so 33.33 never passes through a float. */
export class JsonNumber {
  constructor(readonly text: string) {}
}

/** Parses JSON, turning every number into a JsonNumber (Node 22 reviver source-text access). */
export function parseJson(text: string): unknown {
  return JSON.parse(text, function (_key, value, context?: { source?: string }) {
    return typeof value === 'number' && context?.source !== undefined ? new JsonNumber(context.source) : value
  })
}

// Money must render as a JSON number with exactly two decimals (201.50, not 201.5), which JSON.stringify
// cannot do. Values are emitted as a nonce-tagged string and unquoted afterwards; the per-process nonce
// stops user-supplied text from ever matching.
const TAG = `sq${randomBytes(6).toString('hex')}:`
const TAGGED = new RegExp(`"${TAG}(-?\\d+\\.\\d{2})"`, 'g')

class RawNumber {
  constructor(private readonly text: string) {}

  toJSON(): string {
    return TAG + this.text
  }
}

/** A decimal rendered with exactly 2 places. */
export function money(d: Decimal): RawNumber {
  return new RawNumber(d.toFixed(2))
}

export function stringify(payload: unknown): string {
  return JSON.stringify(payload).replace(TAGGED, '$1')
}

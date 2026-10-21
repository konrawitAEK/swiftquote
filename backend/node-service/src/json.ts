// JSON rendering that keeps decimals exact, matching the Go and Spring services.
import { randomBytes } from 'node:crypto'
import type { Decimal } from 'decimal.js'

// Money must render as a JSON number with exactly two decimals (201.50, not 201.5), which JSON.stringify
// cannot do. Values are emitted as a nonce-tagged string and unquoted afterwards; the per-process nonce
// stops user-supplied text from ever matching.
const TAG = `sq${randomBytes(6).toString('hex')}:`
const TAGGED = new RegExp(`"${TAG}(-?\\d+\\.\\d+)"`, 'g')

class RawNumber {
  constructor(private readonly text: string) {}

  toJSON(): string {
    return TAG + this.text
  }
}

/** A decimal rendered as a JSON number with exactly `places` decimals. */
export function fixed(d: Decimal, places: number): RawNumber {
  return new RawNumber(d.toFixed(places))
}

/** A decimal rendered with exactly 2 places. */
export function money(d: Decimal): RawNumber {
  return fixed(d, 2)
}

export function stringify(payload: unknown): string {
  return JSON.stringify(payload).replace(TAGGED, '$1')
}

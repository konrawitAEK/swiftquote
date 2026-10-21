import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calculate } from './pricing'

interface FixtureCase {
  name: string
  items: { quantity: string; unitPrice: string; discountPercent: string; taxPercent: string }[]
  expected: {
    lineTotals: string[]
    subtotal: string
    discountAmount: string
    taxAmount: string
    grandTotal: string
  }
}

const fixtures: { cases: FixtureCase[] } = JSON.parse(
  readFileSync(new URL('../../../../../contracts/fixtures/pricing-cases.json', import.meta.url), 'utf8'),
)

// Same cases the Go (and later Spring) backends must pass.
describe('calculate matches shared pricing fixtures', () => {
  it('has cases', () => expect(fixtures.cases.length).toBeGreaterThan(0))

  for (const tc of fixtures.cases) {
    it(tc.name, () => {
      const got = calculate(tc.items)
      expect(got.lineTotals.map((d) => d.toFixed(2))).toEqual(tc.expected.lineTotals)
      expect(got.subtotal.toFixed(2)).toBe(tc.expected.subtotal)
      expect(got.discountAmount.toFixed(2)).toBe(tc.expected.discountAmount)
      expect(got.taxAmount.toFixed(2)).toBe(tc.expected.taxAmount)
      expect(got.grandTotal.toFixed(2)).toBe(tc.expected.grandTotal)
    })
  }
})

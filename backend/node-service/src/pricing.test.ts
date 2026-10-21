import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calculate, Money, NO_ITEMS } from './pricing.js'

interface FixtureCase {
  name: string
  items: { quantity: string; unitPrice: string; discountPercent: string; taxPercent: string }[]
  expected: { lineTotals: string[]; subtotal: string; discountAmount: string; taxAmount: string; grandTotal: string }
}

const fixtures: { cases: FixtureCase[] } = JSON.parse(
  readFileSync(new URL('../../../contracts/fixtures/pricing-cases.json', import.meta.url), 'utf8'),
)

const item = (q: string, p: string, d: string, t: string) => ({
  quantity: new Money(q),
  unitPrice: new Money(p),
  discountPercent: new Money(d),
  taxPercent: new Money(t),
})

// Same cases the Go and Spring backends and the React preview pass.
describe('calculate matches shared pricing fixtures', () => {
  it('has cases', () => expect(fixtures.cases.length).toBeGreaterThan(0))

  for (const tc of fixtures.cases) {
    it(tc.name, () => {
      const got = calculate(tc.items.map((i) => item(i.quantity, i.unitPrice, i.discountPercent, i.taxPercent)))
      expect(got.lineTotals.map((d) => d.toFixed(2))).toEqual(tc.expected.lineTotals)
      expect(got.subtotal.toFixed(2)).toBe(tc.expected.subtotal)
      expect(got.discountAmount.toFixed(2)).toBe(tc.expected.discountAmount)
      expect(got.taxAmount.toFixed(2)).toBe(tc.expected.taxAmount)
      expect(got.grandTotal.toFixed(2)).toBe(tc.expected.grandTotal)
    })
  }
})

describe('calculate rejects invalid items', () => {
  it.each([
    ['quantity below 1', item('0.5', '10', '0', '7')],
    ['negative unit price', item('1', '-1', '0', '7')],
    ['discount above 100', item('1', '10', '101', '7')],
    ['negative discount', item('1', '10', '-1', '7')],
    ['tax above 100', item('1', '10', '0', '101')],
  ])('%s', (_, it) => {
    expect(() => calculate([it])).toThrow(/^items\[0\]: /)
  })

  it('no items', () => expect(() => calculate([])).toThrow(NO_ITEMS))
})

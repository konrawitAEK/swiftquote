import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calculate, type DiscountType } from './pricing'

interface FixtureCase {
  name: string
  items: {
    quantity: string
    unitPrice: string
    unitCost?: string
    discountType?: DiscountType
    discountValue?: string
    taxPercent: string
  }[]
  expected: {
    lineTotals: string[]
    subtotal: string
    discountAmount: string
    taxAmount: string
    grandTotal: string
    costTotal?: string
    profit?: string
  }
}

const fixtures: { cases: FixtureCase[] } = JSON.parse(
  readFileSync(new URL('../../../../contracts/fixtures/pricing-cases.json', import.meta.url), 'utf8'),
)

// Same cases the Go, Spring and Node backends must pass.
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
      if (tc.expected.costTotal !== undefined) expect(got.costTotal?.toFixed(2)).toBe(tc.expected.costTotal)
      if (tc.expected.profit !== undefined) expect(got.profit?.toFixed(2)).toBe(tc.expected.profit)
    })
  }
})

describe('calculate edge cases', () => {
  it('caps an amount discount at the line amount and flags it', () => {
    const got = calculate([{ quantity: 1, unitPrice: 100, discountType: 'amount', discountValue: 150, taxPercent: 7 }])
    expect(got.discountTooLarge).toEqual([true])
    expect(got.lineTotals[0].toFixed(2)).toBe('0.00')
  })

  it('leaves cost and profit null when a line has no cost', () => {
    const got = calculate([
      { quantity: 1, unitPrice: 100, unitCost: 50, taxPercent: 7 },
      { quantity: 1, unitPrice: 100, taxPercent: 7 },
    ])
    expect(got.lineProfits[0]?.toFixed(2)).toBe('50.00')
    expect(got.lineProfits[1]).toBeNull()
    expect(got.costTotal).toBeNull()
    expect(got.profit).toBeNull()
  })
})

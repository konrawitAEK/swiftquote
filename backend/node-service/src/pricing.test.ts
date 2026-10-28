import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calculate, lineCost, Money, NO_ITEMS, quoteCost } from './pricing.js'

interface FixtureItem {
  quantity: string
  unitPrice: string
  taxPercent: string
  discountType?: 'percent' | 'amount'
  discountValue?: string
  unitCost?: string
}

interface FixtureCase {
  name: string
  items: FixtureItem[]
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
  readFileSync(new URL('../../../contracts/fixtures/pricing-cases.json', import.meta.url), 'utf8'),
)

const toItem = (i: FixtureItem) => ({
  quantity: new Money(i.quantity),
  unitPrice: new Money(i.unitPrice),
  discountType: i.discountType,
  discountValue: new Money(i.discountValue ?? '0'),
  taxPercent: new Money(i.taxPercent),
  unitCost: i.unitCost === undefined ? null : new Money(i.unitCost),
})

const item = (q: string, p: string, d: string, t: string, type: 'percent' | 'amount' = 'percent') =>
  toItem({ quantity: q, unitPrice: p, discountValue: d, taxPercent: t, discountType: type })

// Same cases the Go and Spring backends and the React preview pass.
describe('calculate matches shared pricing fixtures', () => {
  it('has cases', () => expect(fixtures.cases.length).toBeGreaterThan(0))

  for (const tc of fixtures.cases) {
    it(tc.name, () => {
      const items = tc.items.map(toItem)
      const got = calculate(items)
      expect(got.lineTotals.map((d) => d.toFixed(2))).toEqual(tc.expected.lineTotals)
      expect(got.subtotal.toFixed(2)).toBe(tc.expected.subtotal)
      expect(got.discountAmount.toFixed(2)).toBe(tc.expected.discountAmount)
      expect(got.taxAmount.toFixed(2)).toBe(tc.expected.taxAmount)
      expect(got.grandTotal.toFixed(2)).toBe(tc.expected.grandTotal)
      if (tc.expected.costTotal !== undefined) {
        const cost = quoteCost(items.map((it, i) => lineCost(it.quantity, it.unitCost, got.lineTotals[i]!)))
        expect(cost.costTotal?.toFixed(2)).toBe(tc.expected.costTotal)
        expect(cost.profit?.toFixed(2)).toBe(tc.expected.profit)
        expect(cost.profit!.equals(got.subtotal.sub(got.discountAmount).sub(cost.costTotal!))).toBe(true)
      }
    })
  }
})

describe('calculate rejects invalid items', () => {
  it.each([
    ['quantity below 1', item('0.5', '10', '0', '7'), 'quantity must be at least 1'],
    ['negative unit price', item('1', '-1', '0', '7'), 'unitPrice must not be negative'],
    ['discount above 100', item('1', '10', '101', '7'), 'discountValue must be between 0 and 100'],
    ['negative discount', item('1', '10', '-1', '7'), 'discountValue must not be negative'],
    ['negative amount', item('1', '10', '-1', '7', 'amount'), 'discountValue must not be negative'],
    ['amount above the line', item('2', '50', '100.01', '7', 'amount'), 'discountValue must not exceed the line amount'],
    ['tax above 100', item('1', '10', '0', '101'), 'taxPercent must be between 0 and 100'],
  ])('%s', (_, it, msg) => {
    expect(() => calculate([it])).toThrow(`items[0]: ${msg}`)
  })

  it('compares an amount after rounding', () => {
    expect(calculate([item('1', '100', '100.004', '7', 'amount')]).lineTotals[0]!.toFixed(2)).toBe('0.00')
  })

  it('no items', () => expect(() => calculate([])).toThrow(NO_ITEMS))
})

describe('cost', () => {
  it('is null when any line has no cost', () => {
    const lines = [lineCost(new Money(1), new Money(5), new Money(10)), lineCost(new Money(1), null, new Money(10))]
    expect(quoteCost(lines)).toEqual({ costTotal: null, profit: null })
  })
})

// Quote pricing, identical to the Go and Spring services and pinned by contracts/fixtures/pricing-cases.json.
// Change all backends together.
import { Decimal } from 'decimal.js'

export const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_UP, precision: 40 })
export type Money = InstanceType<typeof Money>

const HUNDRED = new Money(100)
const ONE = new Money(1)

export const NO_ITEMS = 'quote must have at least one item'

export interface PricingItem {
  quantity: Decimal
  unitPrice: Decimal
  /** default percent */
  discountType?: 'percent' | 'amount'
  discountValue: Decimal
  taxPercent: Decimal
  /** null or absent when the line has no cost */
  unitCost?: Decimal | null
}

export interface PricingResult {
  lineTotals: Money[]
  /** the discount in money per line */
  lineDiscounts: Money[]
  subtotal: Money
  discountAmount: Money
  taxAmount: Money
  grandTotal: Money
}

/** A line's cost and profit; both null when it has no unit cost. */
export interface LineCost {
  costTotal: Money | null
  profit: Money | null
}

/** Half away from zero (Java HALF_UP) to 2 places, applied per line. */
export const round = (d: Decimal) => new Money(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)

/** round(quantity * unitPrice) */
export const grossOf = (quantity: Decimal, unitPrice: Decimal) => round(new Money(quantity).mul(unitPrice))

/** The line's discount in money. */
export function discountOf(gross: Decimal, type: 'percent' | 'amount' | undefined, value: Decimal): Money {
  return type === 'amount' ? round(value) : round(new Money(gross).mul(value).div(HUNDRED))
}

/** costTotal = round(quantity * unitCost); profit = lineTotal - costTotal. */
export function lineCost(quantity: Decimal, unitCost: Decimal | null | undefined, lineTotal: Decimal): LineCost {
  if (unitCost === null || unitCost === undefined) return { costTotal: null, profit: null }
  const costTotal = round(new Money(quantity).mul(unitCost))
  return { costTotal, profit: new Money(lineTotal).sub(costTotal) }
}

/** Sums of the lines' cost and profit (subtotal - discount - cost, before VAT); null if any line has no cost. */
export function quoteCost(lines: LineCost[]): LineCost {
  let costTotal = new Money(0)
  let profit = new Money(0)
  for (const l of lines) {
    if (l.costTotal === null || l.profit === null) return { costTotal: null, profit: null }
    costTotal = costTotal.add(l.costTotal)
    profit = profit.add(l.profit)
  }
  return { costTotal, profit }
}

/** Validates and prices items; throws an Error with a contract-style message on invalid input. */
export function calculate(items: PricingItem[]): PricingResult {
  if (items.length === 0) throw new Error(NO_ITEMS)

  let subtotal = new Money(0)
  let discountAmount = new Money(0)
  let taxAmount = new Money(0)
  const lineDiscounts: Money[] = []
  const lineTotals = items.map((it, i) => {
    const gross = grossOf(it.quantity, it.unitPrice)
    const discount = discountOf(gross, it.discountType, it.discountValue)
    const problem = validate(it, gross, discount)
    if (problem) throw new Error(`items[${i}]: ${problem}`)
    const lineTotal = gross.sub(discount)
    const tax = round(lineTotal.mul(it.taxPercent).div(HUNDRED))
    subtotal = subtotal.add(gross)
    discountAmount = discountAmount.add(discount)
    taxAmount = taxAmount.add(tax)
    lineDiscounts.push(discount)
    return lineTotal
  })
  return {
    lineTotals, lineDiscounts, subtotal, discountAmount, taxAmount,
    grandTotal: subtotal.sub(discountAmount).add(taxAmount),
  }
}

/** Enforces the QuoteItemInput constraints from contracts/openapi.yaml. */
function validate(it: PricingItem, gross: Money, discount: Money): string | null {
  if (it.quantity.lessThan(ONE)) return 'quantity must be at least 1'
  if (it.unitPrice.isNegative()) return 'unitPrice must not be negative'
  if (it.discountValue.isNegative()) return 'discountValue must not be negative'
  if (it.discountType === 'amount') {
    // Compared after rounding, so 100.004 on a 100.00 line is allowed.
    if (discount.greaterThan(gross)) return 'discountValue must not exceed the line amount'
  } else if (!inPercentRange(it.discountValue)) {
    return 'discountValue must be between 0 and 100'
  }
  if (!inPercentRange(it.taxPercent)) return 'taxPercent must be between 0 and 100'
  return null
}

function inPercentRange(d: Decimal): boolean {
  return !d.isNegative() && d.lessThanOrEqualTo(HUNDRED)
}

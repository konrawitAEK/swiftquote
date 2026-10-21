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
  discountPercent: Decimal
  taxPercent: Decimal
}

export interface PricingResult {
  lineTotals: Money[]
  subtotal: Money
  discountAmount: Money
  taxAmount: Money
  grandTotal: Money
}

/** Half away from zero (Java HALF_UP) to 2 places, applied per line. */
const round = (d: Decimal) => new Money(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)

/** Validates and prices items; throws an Error with a contract-style message on invalid input. */
export function calculate(items: PricingItem[]): PricingResult {
  if (items.length === 0) throw new Error(NO_ITEMS)

  let subtotal = new Money(0)
  let discountAmount = new Money(0)
  let taxAmount = new Money(0)
  const lineTotals = items.map((it, i) => {
    const problem = validate(it)
    if (problem) throw new Error(`items[${i}]: ${problem}`)
    const gross = round(new Money(it.quantity).mul(it.unitPrice))
    const discount = round(gross.mul(it.discountPercent).div(HUNDRED))
    const lineTotal = gross.sub(discount)
    const tax = round(lineTotal.mul(it.taxPercent).div(HUNDRED))
    subtotal = subtotal.add(gross)
    discountAmount = discountAmount.add(discount)
    taxAmount = taxAmount.add(tax)
    return lineTotal
  })
  return { lineTotals, subtotal, discountAmount, taxAmount, grandTotal: subtotal.sub(discountAmount).add(taxAmount) }
}

/** Enforces the QuoteItemInput constraints from contracts/openapi.yaml. */
function validate(it: PricingItem): string | null {
  if (it.quantity.lessThan(ONE)) return 'quantity must be at least 1'
  if (it.unitPrice.isNegative()) return 'unitPrice must not be negative'
  if (!inPercentRange(it.discountPercent)) return 'discountPercent must be between 0 and 100'
  if (!inPercentRange(it.taxPercent)) return 'taxPercent must be between 0 and 100'
  return null
}

function inPercentRange(d: Decimal): boolean {
  return !d.isNegative() && d.lessThanOrEqualTo(HUNDRED)
}

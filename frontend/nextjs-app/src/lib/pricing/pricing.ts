import Decimal from 'decimal.js'

// Client-side preview of the backend pricing rules, pinned by contracts/fixtures/pricing-cases.json.
// The backend result is authoritative; this only drives the live totals in the Quote Builder.

const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_UP })
type Money = InstanceType<typeof Money>

export interface PricingItem {
  quantity: Decimal.Value
  unitPrice: Decimal.Value
  discountPercent: Decimal.Value
  taxPercent: Decimal.Value
}

export interface PricingResult {
  lineTotals: Money[]
  subtotal: Money
  discountAmount: Money
  taxAmount: Money
  grandTotal: Money
}

const round = (d: Money) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)

export function calculate(items: PricingItem[]): PricingResult {
  let subtotal = new Money(0)
  let discountAmount = new Money(0)
  let taxAmount = new Money(0)
  const lineTotals = items.map((it) => {
    const gross = round(new Money(it.quantity).mul(it.unitPrice))
    const discount = round(gross.mul(it.discountPercent).div(100))
    const lineTotal = gross.sub(discount)
    const tax = round(lineTotal.mul(it.taxPercent).div(100))
    subtotal = subtotal.add(gross)
    discountAmount = discountAmount.add(discount)
    taxAmount = taxAmount.add(tax)
    return lineTotal
  })
  return {
    lineTotals,
    subtotal,
    discountAmount,
    taxAmount,
    grandTotal: subtotal.sub(discountAmount).add(taxAmount),
  }
}

/** Parses user input as a decimal, treating blank or invalid text as 0 for previews. */
export function toDecimal(input: string): Money {
  try {
    return input.trim() === '' ? new Money(0) : new Money(input)
  } catch {
    return new Money(0)
  }
}

const thb = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' })

export function formatMoney(value: Decimal.Value): string {
  return thb.format(new Money(value).toNumber())
}

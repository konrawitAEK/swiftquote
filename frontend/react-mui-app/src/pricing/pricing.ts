import Decimal from 'decimal.js'
import type { DiscountType } from '../models'

// Client-side preview of the backend pricing rules, pinned by contracts/fixtures/pricing-cases.json.
// The backend result is authoritative; this only drives the live totals in the Quote Builder.

const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_UP })
type Money = InstanceType<typeof Money>

export type { DiscountType }

export interface PricingItem {
  quantity: Decimal.Value
  unitPrice: Decimal.Value
  /** percent (the default) or amount for the whole line */
  discountType?: DiscountType
  discountValue?: Decimal.Value
  taxPercent: Decimal.Value
  /** Product cost per unit; omit when unknown. */
  unitCost?: Decimal.Value | null
}

export interface PricingResult {
  lineTotals: Money[]
  lineDiscounts: Money[]
  /** True where an amount discount is larger than the line amount (the server rejects it; the preview caps it). */
  discountTooLarge: boolean[]
  /** null where the line has no unitCost */
  lineCostTotals: (Money | null)[]
  lineProfits: (Money | null)[]
  subtotal: Money
  discountAmount: Money
  taxAmount: Money
  grandTotal: Money
  /** null unless every line has a unitCost */
  costTotal: Money | null
  profit: Money | null
}

const round = (d: Money) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)

const isSet = (v: Decimal.Value | null | undefined): v is Decimal.Value => v !== undefined && v !== null && v !== ''

export function calculate(items: PricingItem[]): PricingResult {
  let subtotal = new Money(0)
  let discountAmount = new Money(0)
  let taxAmount = new Money(0)
  let costTotal: Money | null = new Money(0)
  const lineTotals: Money[] = []
  const lineDiscounts: Money[] = []
  const discountTooLarge: boolean[] = []
  const lineCostTotals: (Money | null)[] = []
  const lineProfits: (Money | null)[] = []
  for (const it of items) {
    const gross = round(new Money(it.quantity).mul(it.unitPrice))
    const value = new Money(isSet(it.discountValue) ? it.discountValue : 0)
    let discount = it.discountType === 'amount' ? round(value) : round(gross.mul(value).div(100))
    const tooLarge = it.discountType === 'amount' && discount.gt(gross)
    if (tooLarge) discount = gross
    const lineTotal = gross.sub(discount)
    const tax = round(lineTotal.mul(it.taxPercent).div(100))
    subtotal = subtotal.add(gross)
    discountAmount = discountAmount.add(discount)
    taxAmount = taxAmount.add(tax)
    lineTotals.push(lineTotal)
    lineDiscounts.push(discount)
    discountTooLarge.push(tooLarge)
    if (isSet(it.unitCost)) {
      const cost = round(new Money(it.quantity).mul(it.unitCost))
      lineCostTotals.push(cost)
      lineProfits.push(lineTotal.sub(cost))
      costTotal = costTotal?.add(cost) ?? null
    } else {
      lineCostTotals.push(null)
      lineProfits.push(null)
      costTotal = null
    }
  }
  const net = subtotal.sub(discountAmount)
  return {
    lineTotals,
    lineDiscounts,
    discountTooLarge,
    lineCostTotals,
    lineProfits,
    subtotal,
    discountAmount,
    taxAmount,
    grandTotal: net.add(taxAmount),
    costTotal: items.length ? costTotal : null,
    profit: items.length && costTotal ? net.sub(costTotal) : null,
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

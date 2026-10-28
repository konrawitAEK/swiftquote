import Decimal from 'decimal.js'
import type { DiscountType } from '@/models'

// Client-side preview of the backend pricing rules, pinned by contracts/fixtures/pricing-cases.json.
// The backend result is authoritative; this only drives the live totals in the Quote Builder.

const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_UP })
type Money = InstanceType<typeof Money>

export interface PricingItem {
  quantity: Decimal.Value
  unitPrice: Decimal.Value
  /** percent (the default) or a fixed amount for the whole line */
  discountType?: DiscountType
  discountValue: Decimal.Value
  taxPercent: Decimal.Value
  /** null or omitted when the cost is unknown */
  unitCost?: Decimal.Value | null
}

export interface PricingResult {
  lineTotals: Money[]
  lineDiscounts: Money[]
  /** round(quantity * unitCost) per line; null when the line has no cost */
  lineCostTotals: (Money | null)[]
  /** lineTotal - costTotal per line; null when the line has no cost */
  lineProfits: (Money | null)[]
  /** true when an amount discount is larger than the line amount (the server rejects it; the preview caps it) */
  discountTooLarge: boolean[]
  subtotal: Money
  discountAmount: Money
  taxAmount: Money
  grandTotal: Money
  /** sum of line costs; null if any line has no cost */
  costTotal: Money | null
  /** subtotal - discountAmount - costTotal; null if any line has no cost */
  profit: Money | null
}

/** 2 decimal places, half away from zero (Java RoundingMode.HALF_UP). */
const round = (d: Money) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)

export function calculate(items: PricingItem[]): PricingResult {
  let subtotal = new Money(0)
  let discountAmount = new Money(0)
  let taxAmount = new Money(0)
  let costTotal: Money | null = new Money(0)
  const lineTotals: Money[] = []
  const lineDiscounts: Money[] = []
  const lineCostTotals: (Money | null)[] = []
  const lineProfits: (Money | null)[] = []
  const discountTooLarge: boolean[] = []

  for (const it of items) {
    const gross = round(new Money(it.quantity).mul(it.unitPrice))
    const requested =
      it.discountType === 'amount' ? round(new Money(it.discountValue)) : round(gross.mul(it.discountValue).div(100))
    const tooLarge = it.discountType === 'amount' && requested.gt(gross)
    const discount = tooLarge ? gross : requested
    const lineTotal = gross.sub(discount)
    const tax = round(lineTotal.mul(it.taxPercent).div(100))
    const lineCost = it.unitCost === null || it.unitCost === undefined ? null : round(new Money(it.quantity).mul(it.unitCost))

    subtotal = subtotal.add(gross)
    discountAmount = discountAmount.add(discount)
    taxAmount = taxAmount.add(tax)
    costTotal = costTotal && lineCost ? costTotal.add(lineCost) : null

    lineTotals.push(lineTotal)
    lineDiscounts.push(discount)
    lineCostTotals.push(lineCost)
    lineProfits.push(lineCost ? lineTotal.sub(lineCost) : null)
    discountTooLarge.push(tooLarge)
  }

  return {
    lineTotals,
    lineDiscounts,
    lineCostTotals,
    lineProfits,
    discountTooLarge,
    subtotal,
    discountAmount,
    taxAmount,
    grandTotal: subtotal.sub(discountAmount).add(taxAmount),
    costTotal,
    profit: costTotal ? subtotal.sub(discountAmount).sub(costTotal) : null,
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

/** Money, or "—" when the value is unknown (null or absent). */
export function formatOptionalMoney(value: Decimal.Value | null | undefined): string {
  return value === null || value === undefined ? '—' : formatMoney(value)
}

/** A line's discount as entered: "10%" or "฿2,250.00"; "—" when there is none. */
export function formatDiscount(type: DiscountType, value: Decimal.Value): string {
  if (new Money(value).isZero()) return '—'
  return type === 'amount' ? formatMoney(value) : `${new Money(value).toString()}%`
}

const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

/** Quantities and stock without trailing zeros (25, 2.5). */
export function formatQuantity(value: Decimal.Value): string {
  return plain.format(new Money(value).toNumber())
}

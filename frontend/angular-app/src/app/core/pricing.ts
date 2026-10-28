import Decimal from 'decimal.js';
import type { DiscountType } from '../models';

// Client-side preview of the backend pricing rules, pinned by contracts/fixtures/pricing-cases.json.
// The backend result is authoritative; this only drives the live totals in the Quote Builder.

const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_UP });
type Money = InstanceType<typeof Money>;

export interface PricingItem {
  quantity: Decimal.Value;
  unitPrice: Decimal.Value;
  /** percent (the default) or a fixed amount for the whole line */
  discountType?: DiscountType;
  /** A percent (0..100) or an amount (0..gross), per discountType; 0 when omitted. */
  discountValue?: Decimal.Value;
  taxPercent: Decimal.Value;
  /** Product cost per unit; null or omitted when unknown. */
  unitCost?: Decimal.Value | null;
}

export interface PricingLine {
  /** round(quantity * unitPrice) */
  gross: Money;
  discount: Money;
  /** gross - discount, before VAT */
  lineTotal: Money;
  tax: Money;
  /** round(quantity * unitCost); null when the cost is unknown. */
  costTotal: Money | null;
  /** lineTotal - costTotal; null when the cost is unknown. */
  profit: Money | null;
}

export interface PricingResult {
  lines: PricingLine[];
  lineTotals: Money[];
  subtotal: Money;
  discountAmount: Money;
  taxAmount: Money;
  grandTotal: Money;
  /** Sum of the line costs; null if any line has no cost. */
  costTotal: Money | null;
  /** subtotal - discountAmount - costTotal (before VAT); null if any line has no cost. */
  profit: Money | null;
}

/** 2 decimal places, half away from zero (Java RoundingMode.HALF_UP). */
const round = (d: Money) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

function priceLine(it: PricingItem): PricingLine {
  const quantity = new Money(it.quantity);
  const gross = round(quantity.mul(it.unitPrice));
  const value = new Money(it.discountValue ?? 0);
  const discount = it.discountType === 'amount' ? round(value) : round(gross.mul(value).div(100));
  const lineTotal = gross.sub(discount);
  const tax = round(lineTotal.mul(it.taxPercent).div(100));
  const hasCost = it.unitCost !== undefined && it.unitCost !== null;
  const costTotal = hasCost ? round(quantity.mul(it.unitCost as Decimal.Value)) : null;
  return { gross, discount, lineTotal, tax, costTotal, profit: costTotal !== null ? lineTotal.sub(costTotal) : null };
}

export function calculate(items: PricingItem[]): PricingResult {
  const lines = items.map(priceLine);
  const sum = (pick: (l: PricingLine) => Money) => lines.reduce((acc, l) => acc.add(pick(l)), new Money(0));
  const subtotal = sum((l) => l.gross);
  const discountAmount = sum((l) => l.discount);
  const taxAmount = sum((l) => l.tax);
  const costKnown = lines.every((l) => l.costTotal !== null);
  const costTotal = costKnown ? sum((l) => l.costTotal as Money) : null;
  return {
    lines,
    lineTotals: lines.map((l) => l.lineTotal),
    subtotal,
    discountAmount,
    taxAmount,
    grandTotal: subtotal.sub(discountAmount).add(taxAmount),
    costTotal,
    profit: costTotal !== null ? subtotal.sub(discountAmount).sub(costTotal) : null,
  };
}

/**
 * The server's pricing message for a line's discount (without the "items[i]: " prefix), or null when valid.
 * An amount discount is rounded first and must not exceed the line's gross amount.
 */
export function discountError(it: PricingItem): string | null {
  const value = new Money(it.discountValue ?? 0);
  if (value.isNegative() && !value.isZero()) return 'discountValue must not be negative';
  if (it.discountType === 'amount') {
    const gross = round(new Money(it.quantity).mul(it.unitPrice));
    return round(value).greaterThan(gross) ? 'discountValue must not exceed the line amount' : null;
  }
  return value.greaterThan(100) ? 'discountValue must be between 0 and 100' : null;
}

/** Parses user input as a decimal, treating blank or invalid text as 0 for previews. */
export function toDecimal(input: string): Money {
  try {
    return input.trim() === '' ? new Money(0) : new Money(input);
  } catch {
    return new Money(0);
  }
}

const thb = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' });

export function formatMoney(value: Decimal.Value): string {
  return thb.format(new Money(value).toNumber());
}

/** Money, or "—" when the value is unknown (null or undefined). */
export function formatOptionalMoney(value: Decimal.Value | null | undefined): string {
  return value === null || value === undefined ? '—' : formatMoney(value);
}

/** A line's discount as entered: "10%", "฿2,250.00", or "—" when there is none. */
export function formatDiscount(type: DiscountType, value: number): string {
  if (!Number(value)) return '—';
  return type === 'amount' ? formatMoney(value) : `${value}%`;
}

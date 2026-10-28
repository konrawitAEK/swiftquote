import fixtures from '../../../../../contracts/fixtures/pricing-cases.json';
import { calculate, discountError, formatDiscount, type PricingItem } from './pricing';

interface FixtureCase {
  name: string;
  items: {
    quantity: string;
    unitPrice: string;
    unitCost?: string;
    discountType?: string;
    discountValue?: string;
    taxPercent: string;
  }[];
  expected: {
    lineTotals: string[];
    subtotal: string;
    discountAmount: string;
    taxAmount: string;
    grandTotal: string;
    costTotal?: string;
    profit?: string;
  };
}

const cases: FixtureCase[] = fixtures.cases;

const toItem = (it: FixtureCase['items'][number]): PricingItem => {
  if (it.discountType !== undefined && it.discountType !== 'percent' && it.discountType !== 'amount') {
    throw new Error(`unknown discountType ${it.discountType}`);
  }
  return { ...it, discountType: it.discountType };
};

// Same cases the Go, Spring and Node backends must pass.
describe('calculate matches shared pricing fixtures', () => {
  it('has cases', () => expect(cases.length).toBeGreaterThan(0));

  for (const tc of cases) {
    it(tc.name, () => {
      const got = calculate(tc.items.map(toItem));
      expect(got.lineTotals.map((d) => d.toFixed(2))).toEqual(tc.expected.lineTotals);
      expect(got.subtotal.toFixed(2)).toBe(tc.expected.subtotal);
      expect(got.discountAmount.toFixed(2)).toBe(tc.expected.discountAmount);
      expect(got.taxAmount.toFixed(2)).toBe(tc.expected.taxAmount);
      expect(got.grandTotal.toFixed(2)).toBe(tc.expected.grandTotal);
      // Cost and profit are only checked when every item has unitCost.
      if (tc.items.every((it) => it.unitCost !== undefined)) {
        expect(got.costTotal?.toFixed(2)).toBe(tc.expected.costTotal);
        expect(got.profit?.toFixed(2)).toBe(tc.expected.profit);
        const lineProfits = got.lines.reduce((acc, l) => acc + Number(l.profit), 0);
        expect(lineProfits.toFixed(2)).toBe(tc.expected.profit);
      } else {
        expect(got.costTotal).toBeNull();
        expect(got.profit).toBeNull();
      }
    });
  }
});

describe('discountError', () => {
  const line = { quantity: '2', unitPrice: '50.00', taxPercent: '7' } as const;

  it('accepts an amount equal to the whole line', () => {
    expect(discountError({ ...line, discountType: 'amount', discountValue: '100' })).toBeNull();
  });

  it('rounds an amount before comparing it with the line', () => {
    expect(discountError({ ...line, discountType: 'amount', discountValue: '100.004' })).toBeNull();
    expect(discountError({ ...line, discountType: 'amount', discountValue: '100.005' })).toBe(
      'discountValue must not exceed the line amount',
    );
  });

  it('limits percent discounts to 0..100', () => {
    expect(discountError({ ...line, discountType: 'percent', discountValue: '100' })).toBeNull();
    expect(discountError({ ...line, discountValue: '100.5' })).toBe('discountValue must be between 0 and 100');
    expect(discountError({ ...line, discountValue: '-1' })).toBe('discountValue must not be negative');
  });
});

describe('formatDiscount', () => {
  it('shows percent and amount discounts', () => {
    expect(formatDiscount('percent', 10)).toBe('10%');
    expect(formatDiscount('amount', 2250)).toBe(new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(2250));
    expect(formatDiscount('amount', 0)).toBe('—');
  });
});

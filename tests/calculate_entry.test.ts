import { describe, expect, it } from 'vitest';
import { calculate } from '@/lib/api/calculate';

describe('calculate() browser entry point', () => {
  it('accepts a province name and returns a result', () => {
    const out = calculate({
      year: 2026,
      province: 'British Columbia',
      household: { maritalStatus: 'single' },
      taxpayer: { age: 30, income: { employment: 60000 }, deductions: {}, credits: {}, benefits: {} },
    });
    expect(out).toBeTruthy();
  });

  it('throws a readable error on invalid input', () => {
    expect(() => calculate({ year: 1999, province: 'ZZ' })).toThrow(/Invalid input/);
  });
});

import { describe, it, expect } from 'vitest';
import { taxFromBrackets } from '@/lib/tax/brackets';
import { getConfig as _gc } from '@/lib/tax/config';
const taxConfig = _gc(2025);

describe('bracket calculation', () => {
  it('computes federal tax for income spanning multiple brackets', () => {
    const income = 200000;
    const tax = taxFromBrackets(income, taxConfig.federal.brackets);
    // manual calc
    const b = taxConfig.federal.brackets;
    const expected =
      (b[0].upTo! - 0) * b[0].rate +
      (b[1].upTo! - b[0].upTo!) * b[1].rate +
      (b[2].upTo! - b[1].upTo!) * b[2].rate +
      (income - b[2].upTo!) * b[3].rate;
    expect(tax).toBeCloseTo(Math.round(expected * 100) / 100, 2);
  });

  it('computes ontario tax for income in first bracket', () => {
    const income = 40000;
    const tax = taxFromBrackets(income, taxConfig.provinces.ON.brackets);
    expect(tax).toBeCloseTo(income * taxConfig.provinces.ON.brackets[0].rate, 2);
  });
});

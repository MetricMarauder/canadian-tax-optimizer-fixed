import { describe, it, expect } from 'vitest';
import { getConfig, getProvince, PROVINCES, type ProvinceCode } from '@/lib/tax/config';
import { taxFromBrackets } from '@/lib/tax/brackets';
import { provincialBpa, provincialSpouseAmountBase } from '@/lib/tax/provincial';
import { provincialSurtax } from '@/lib/tax/income';
import { calculateFromItems } from '@/lib/tax/calculate';
import { calculateOptimizedHouseholdFromItems } from '@/lib/tax/household';
import { loadRuleItems } from '@/lib/excel/loadCredits';
import { CalculateRequestSchema } from '@/lib/api/schema';
import type { IndividualRequest, PersonInput } from '@/lib/api/types';

const items = loadRuleItems('ontario_federal_tax_credits_2025.xlsx').items;

const zeroDeductions = {
  rrspContributions: 0,
  rrspDeductionLimit: 0,
  fhsaContributions: 0,
  rppContributions: 0,
  unionDues: 0,
  childCareExpenses: 0,
  numChildrenUnder7: 0,
  numChildren7to16: 0,
  numChildrenDTCEligible: 0,
};

function person(province: ProvinceCode, employment: number, overrides: Partial<PersonInput> = {}): PersonInput {
  return {
    age: 35,
    province,
    income: { employment, other: 0, capitalGains: 0, eligibleDividends: 0 },
    deductions: { ...zeroDeductions },
    credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 0 },
    benefits: { cwbEligible: true, cwbDisabilityEligible: false, includeBenefitsEstimates: true },
    taxesWithheld: 0,
    ...overrides,
  };
}

function single(p: PersonInput, year = 2025): IndividualRequest {
  return { ...p, year, maritalStatus: 'single' };
}

/** Basic tax with only the basic personal credit — the convention used by published tax tables. */
function bpaOnly(year: number, code: ProvinceCode, taxable: number) {
  const cfg = getConfig(year);
  const prov = getProvince(cfg, code);
  const f = cfg.federal;
  const fedBpa =
    taxable <= f.basicPersonalAmount.phaseoutStart
      ? f.basicPersonalAmount.base
      : taxable >= f.basicPersonalAmount.phaseoutEnd
        ? f.basicPersonalAmount.min
        : f.basicPersonalAmount.base -
          ((taxable - f.basicPersonalAmount.phaseoutStart) /
            (f.basicPersonalAmount.phaseoutEnd - f.basicPersonalAmount.phaseoutStart)) *
            (f.basicPersonalAmount.base - f.basicPersonalAmount.min);
  let federal = Math.max(0, taxFromBrackets(taxable, f.brackets) - fedBpa * f.lowestRate);
  if (code === 'QC') federal *= 1 - f.quebecAbatement;
  const basic = Math.max(0, taxFromBrackets(taxable, prov.brackets) - provincialBpa(cfg, prov, taxable) * prov.lowestRate);
  return { federal, provincial: basic + provincialSurtax(prov, basic) };
}

// Published 2026 tax tables (Raymond Chabot Grant Thornton, "Individual taxation 2026", April 30 2026):
// basic personal credit only, no low-income reduction or health premium.
const PUBLISHED_2026: Record<string, [number, number, number][]> = {
  ON: [
    [20000, 497, 354],
    [50000, 4697, 1869],
    [100000, 14393, 6378],
    [150000, 26455, 14420],
    [250000, 54714, 33858],
  ],
  NB: [
    [20000, 497, 596],
    [50000, 4697, 3416],
    [100000, 14393, 10308],
    [150000, 26455, 18215],
    [250000, 54714, 36180],
  ],
  QC: [
    [20000, 415, 147],
    [50000, 3922, 4347],
    [100000, 12018, 13629],
    [150000, 22090, 25506],
    [250000, 45686, 51256],
  ],
};

describe('2026 parameters match published tax tables', () => {
  for (const [code, rows] of Object.entries(PUBLISHED_2026)) {
    for (const [taxable, fed, prov] of rows) {
      it(`${code} at $${taxable}`, () => {
        const r = bpaOnly(2026, code as ProvinceCode, taxable);
        expect(Math.abs(r.federal - fed)).toBeLessThanOrEqual(2);
        expect(Math.abs(r.provincial - prov)).toBeLessThanOrEqual(2);
      });
    }
  }
});

describe('every province and territory', () => {
  for (const year of [2025, 2026]) {
    for (const { code, name } of PROVINCES) {
      it(`${year} ${code}: single $60k employee produces a sane return`, () => {
        const res = calculateFromItems(single(person(code, 60000, { taxesWithheld: 9000 }), year), items);
        expect(res.provincial.name).toBe(name);
        expect(res.provincial.taxAfterCredits).toBeGreaterThan(0);
        expect(res.federal.taxAfterCredits).toBeGreaterThan(0);
        // Combined average rate on $60k of employment income should be roughly 10–25%.
        const rate = res.taxPayableTotal / 60000;
        expect(rate).toBeGreaterThan(0.08);
        expect(rate).toBeLessThan(0.25);
      });

      it(`${year} ${code}: household with children runs the optimizer`, () => {
        const res = calculateOptimizedHouseholdFromItems(
          {
            year,
            province: code,
            household: { maritalStatus: 'married', claimant: 'taxpayer' },
            taxpayer: person(code, 70000, {
              deductions: { ...zeroDeductions, childCareExpenses: 6000, numChildrenUnder7: 1, numChildren7to16: 1 },
            }),
            spouse: person(code, 15000),
          },
          items
        );
        expect(res.province).toBe(code);
        expect(res.year).toBe(year);
        expect(res.transferSummary?.childCareClaimant).toBe('spouse');
        expect(Number.isFinite(res.household.refundOrOwing)).toBe(true);
        expect(res.household.benefitsPaidSeparatelyTotal).toBeGreaterThan(0); // at least the CCB
      });
    }
  }
});

describe('province-specific rules', () => {
  it('Quebec: federal abatement, QPP/QPIP and the reduced EI rate', () => {
    const res = calculateFromItems(single(person('QC', 60000)), items);
    expect(res.federal.quebecAbatement).toBeGreaterThan(0);
    expect(res.payroll.qpipPremiums).toBeCloseTo(60000 * 0.00494, 2);
    expect(res.payroll.eiPremiums).toBeCloseTo(60000 * 0.0131, 2);
    expect(res.payroll.cppContributions).toBeCloseTo((60000 - 3500) * 0.064, 2);
    // Quebec taxable income is reduced by the deduction for workers (max $1,420 in 2025).
    expect(res.provincial.taxableIncome).toBeCloseTo(res.federal.taxableIncome - 1420, 2);
  });

  it('Quebec: solidarity credit and work premium for a low-income worker', () => {
    const res = calculateFromItems(single(person('QC', 9000)), items);
    expect(res.benefitsPaidSeparately.some((b) => /solidarity/i.test(b.name))).toBe(true);
    expect(res.refundableCreditsAndBenefitsApplied.some((b) => /work premium/i.test(b.name))).toBe(true);
  });

  it('BC tax reduction eliminates BC tax at low income', () => {
    const res = calculateFromItems(single(person('BC', 20000)), items);
    expect(res.provincial.taxReduction).toBeGreaterThan(0);
    expect(res.provincial.taxAfterCredits).toBe(0);
  });

  it('Manitoba BPA is clawed back between $200k and $400k', () => {
    const cfg = getConfig(2025);
    const mb = getProvince(cfg, 'MB');
    expect(provincialBpa(cfg, mb, 150000)).toBe(15780);
    expect(provincialBpa(cfg, mb, 300000)).toBeCloseTo(7890, 0);
    expect(provincialBpa(cfg, mb, 450000)).toBe(0);
  });

  it('Yukon follows the federal BPA and has its own Canada employment amount', () => {
    const res = calculateFromItems(single(person('YT', 60000)), items);
    expect(res.provincial.creditsApplied.some((c) => /Canada employment amount/.test(c.name))).toBe(true);
    const bpa = res.provincial.creditsApplied.find((c) => /Basic personal amount/.test(c.name));
    expect(bpa?.amount).toBeCloseTo(16129 * 0.064, 2);
  });

  it('provincial spouse amounts use each province’s threshold', () => {
    const cfg = getConfig(2025);
    // Saskatchewan: max 19,491, reduced by spouse income over 1,949.
    expect(provincialSpouseAmountBase(cfg, getProvince(cfg, 'SK'), 50000, 5000)).toBe(19491 + 1949 - 5000);
    // Alberta: reduced dollar for dollar from $0.
    expect(provincialSpouseAmountBase(cfg, getProvince(cfg, 'AB'), 50000, 5000)).toBe(22323 - 5000);
    // Quebec: no spouse amount (transfer of unused credits is not modelled).
    expect(provincialSpouseAmountBase(cfg, getProvince(cfg, 'QC'), 50000, 0)).toBe(0);
  });

  it('Alberta 60% donation credit on the first $200', () => {
    const res = calculateFromItems(
      single(person('AB', 80000, { credits: { hasDisabilityDTC: false, donations: 200, tuitionFees: 0 } })),
      items
    );
    const d = res.provincial.creditsApplied.find((c) => /Donations/.test(c.name));
    expect(d?.amount).toBeCloseTo(120, 2);
  });

  it('Ontario-only catalog rows are marked not applicable elsewhere', () => {
    const res = calculateFromItems(single(person('NS', 50000)), items);
    const row = res.explanation.find((e) => /Ontario Sales Tax Credit/i.test(e.name));
    expect(row?.applied).toBe(false);
    expect(row?.reason).toMatch(/not applicable for Nova Scotia/);
  });
});

describe('API schema', () => {
  it('accepts province names or codes and defaults the year', () => {
    const base = {
      household: { maritalStatus: 'single' },
      taxpayer: { age: 30, income: {}, deductions: {}, credits: {}, benefits: {} },
    };
    expect(CalculateRequestSchema.parse({ ...base, province: 'Ontario' }).province).toBe('ON');
    expect(CalculateRequestSchema.parse({ ...base, province: 'bc' }).province).toBe('BC');
    expect(CalculateRequestSchema.parse({ ...base, province: 'QC' }).year).toBe(2025);
    expect(CalculateRequestSchema.parse({ ...base, province: 'QC', year: 2026 }).year).toBe(2026);
    expect(() => CalculateRequestSchema.parse({ ...base, province: 'XX' })).toThrow();
    expect(() => CalculateRequestSchema.parse({ ...base, province: 'ON', year: 2019 })).toThrow();
  });
});

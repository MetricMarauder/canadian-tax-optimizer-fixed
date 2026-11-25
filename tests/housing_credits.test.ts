import { describe, it, expect } from 'vitest';
import { calculateFromItems } from '@/lib/tax/calculate';
import { calculateOptimizedHouseholdFromItems } from '@/lib/tax/household';
import { loadRuleItems } from '@/lib/excel/loadCredits';
import type { IndividualRequest, PersonInput } from '@/lib/api/types';
import type { ProvinceCode } from '@/lib/tax/config';

const items = loadRuleItems('ontario_federal_tax_credits_2025.xlsx').items;

const zero = {
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

function person(province: ProvinceCode, employment: number, extra: Partial<PersonInput> = {}): PersonInput {
  return {
    age: 35,
    province,
    income: { employment, other: 0, capitalGains: 0, eligibleDividends: 0 },
    deductions: { ...zero },
    credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 0 },
    benefits: { cwbEligible: false, cwbDisabilityEligible: false, includeBenefitsEstimates: true },
    taxesWithheld: 0,
    ...extra,
  };
}

function single(p: PersonInput, housing = { rentPaid: 0, propertyTaxPaid: 0, northernOntario: false }, year = 2025): IndividualRequest {
  return { ...p, year, maritalStatus: 'single', housing };
}

const find = (list: { name: string; amount: number }[], re: RegExp) => list.find((b) => re.test(b.name))?.amount ?? 0;

describe('Ontario LIFT credit', () => {
  it('wipes out Ontario income tax (not the Health Premium) for a $30k worker', () => {
    const res = calculateFromItems(single(person('ON', 30000)), items);
    expect(res.provincial.lift).toBeGreaterThan(0);
    expect(res.provincial.lift).toBeLessThanOrEqual(875);
    expect(res.provincial.taxAfterCredits).toBeCloseTo(res.provincial.healthPremium ?? 0, 2);
  });

  it('phases out at 5% of income over $32,500', () => {
    // $50,000 net income → 875 − 5% × 17,500 = 0
    const res = calculateFromItems(single(person('ON', 51000)), items);
    expect(res.provincial.lift).toBe(0);
  });
});

describe('Ontario energy and property tax credit', () => {
  it('worked example: single renter, $12,000 rent, low income', () => {
    // occupancy 2,400; energy min(2,400, 290) = 290; property min(2,400, min(240, 944) + 73) = 313
    const res = calculateFromItems(single(person('ON', 25000), { rentPaid: 12000, propertyTaxPaid: 0, northernOntario: false }), items);
    expect(find(res.benefitsPaidSeparately, /energy and property/)).toBeCloseTo(603, 2);
  });

  it('is reduced by 2% of income over the threshold', () => {
    const res = calculateFromItems(single(person('ON', 45000), { rentPaid: 20000, propertyTaxPaid: 0, northernOntario: false }), items);
    const oeptc = find(res.benefitsPaidSeparately, /energy and property/);
    expect(oeptc).toBeGreaterThan(0);
    expect(oeptc).toBeLessThan(763);
  });

  it('is zero without rent or property tax', () => {
    const res = calculateFromItems(single(person('ON', 25000)), items);
    expect(find(res.benefitsPaidSeparately, /energy and property/)).toBe(0);
  });

  it('Northern Ontario energy credit only for northern residents who pay rent/property tax', () => {
    const north = calculateFromItems(single(person('ON', 30000), { rentPaid: 9000, propertyTaxPaid: 0, northernOntario: true }), items);
    expect(find(north.benefitsPaidSeparately, /Northern Ontario/)).toBeCloseTo(189, 2);
    const south = calculateFromItems(single(person('ON', 30000), { rentPaid: 9000, propertyTaxPaid: 0, northernOntario: false }), items);
    expect(find(south.benefitsPaidSeparately, /Northern Ontario/)).toBe(0);
  });

  it('household: claimed once, by the benefit claimant', () => {
    const res = calculateOptimizedHouseholdFromItems(
      {
        year: 2025,
        province: 'ON',
        household: { maritalStatus: 'married', claimant: 'taxpayer', rentPaid: 15000, propertyTaxPaid: 0, northernOntario: false },
        taxpayer: person('ON', 20000),
        spouse: person('ON', 10000),
      },
      items
    );
    const all = [...res.taxpayer.benefitsPaidSeparately, ...(res.spouse?.benefitsPaidSeparately ?? [])];
    expect(all.filter((b) => /energy and property/.test(b.name))).toHaveLength(1);
  });
});

describe('other provinces', () => {
  it('B.C. renter’s tax credit is refundable on the return', () => {
    const res = calculateFromItems(single(person('BC', 50000), { rentPaid: 18000, propertyTaxPaid: 0, northernOntario: false }), items);
    expect(find(res.refundableCreditsAndBenefitsApplied, /renter/)).toBe(400);
  });

  it('Manitoba renters affordability credit: 20% of rent up to the maximum ($575 in 2025, $625 in 2026)', () => {
    const h = { rentPaid: 10000, propertyTaxPaid: 0, northernOntario: false };
    expect(find(calculateFromItems(single(person('MB', 40000), h), items).refundableCreditsAndBenefitsApplied, /renters/)).toBe(575);
    expect(find(calculateFromItems(single(person('MB', 40000), h, 2026), items).refundableCreditsAndBenefitsApplied, /renters/)).toBe(625);
    const low = { rentPaid: 2000, propertyTaxPaid: 0, northernOntario: false };
    expect(find(calculateFromItems(single(person('MB', 40000), low), items).refundableCreditsAndBenefitsApplied, /renters/)).toBe(400);
  });

  it('New Brunswick child tax benefit with working income supplement', () => {
    const res = calculateFromItems(
      single(person('NB', 15000, { deductions: { ...zero, numChildren7to16: 1 } })),
      items
    );
    expect(find(res.benefitsPaidSeparately, /New Brunswick child/)).toBeCloseTo(500, 2);
  });

  it('Nunavut child benefit (doubled 2026 amount) with worker supplement', () => {
    const res = calculateFromItems(
      single(person('NU', 20000, { deductions: { ...zero, numChildren7to16: 2 } })),
      items
    );
    expect(find(res.benefitsPaidSeparately, /Nunavut child/)).toBeCloseTo(696 * 2 + 369, 2);
  });

  it('NL seniors’ benefit requires age 64+', () => {
    const senior = person('NL', 0, { age: 70, income: { employment: 0, other: 25000, capitalGains: 0, eligibleDividends: 0 } });
    expect(find(calculateFromItems(single(senior), items).benefitsPaidSeparately, /seniors/)).toBe(1882);
    const younger = { ...senior, age: 50 };
    expect(find(calculateFromItems(single(younger), items).benefitsPaidSeparately, /seniors/)).toBe(0);
  });
});

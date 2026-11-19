import { describe, it, expect } from 'vitest';
import { loadRuleItems } from '@/lib/excel/loadCredits';
import { calculateFromItems } from '@/lib/tax/calculate';
import { calculateOptimizedHouseholdFromItems } from '@/lib/tax/household';
import { IMPLEMENTED_RULES, computeDonationCredits } from '@/lib/rules/implemented';
import { taxFromBrackets } from '@/lib/tax/brackets';
import { computePayroll, ontarioHealthPremium, ontarioTaxReduction } from '@/lib/tax/income';
import taxConfig from '@/lib/tax/config/2025.json';
import type { CalculateRequest, IndividualRequest, PersonInput } from '@/lib/api/types';
import type { UserContext } from '@/lib/rules/types';

const EXCEL = 'ontario_federal_tax_credits_2025.xlsx';

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

function person(overrides: Partial<PersonInput> = {}): PersonInput {
  return {
    age: 35,
    province: 'Ontario',
    income: { employment: 0, other: 0, capitalGains: 0, eligibleDividends: 0 },
    deductions: { ...zeroDeductions },
    credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 0 },
    benefits: { cwbEligible: false, cwbDisabilityEligible: false, includeBenefitsEstimates: false },
    taxesWithheld: 0,
    ...overrides,
  };
}

function ctx(overrides: Partial<UserContext> = {}): UserContext {
  const p = person();
  return {
    age: p.age,
    maritalStatus: 'single',
    spouseNetIncome: 0,
    income: p.income,
    deductions: { ...zeroDeductions },
    credits: p.credits,
    benefits: p.benefits,
    ...overrides,
  };
}

function single(p: PersonInput): IndividualRequest {
  return { ...p, maritalStatus: 'single' };
}

describe('Excel catalog loading', () => {
  it('reads the real workbook instead of silently falling back', () => {
    const { items } = loadRuleItems(EXCEL);
    expect(items.length).toBeGreaterThan(90);
    expect(items[0].id).toBe('row_2');
  });

  it('does not double-count donations when both Federal and Ontario rows exist', () => {
    const { items } = loadRuleItems(EXCEL);
    const p = person({
      income: { employment: 80000, other: 0, capitalGains: 0, eligibleDividends: 0 },
      credits: { hasDisabilityDTC: false, donations: 1000, tuitionFees: 0 },
    });
    const res = calculateFromItems(single(p), items);
    const fedDonation = res.federal.creditsApplied.filter((c) => /donation/i.test(c.name));
    const onDonation = res.ontario.creditsApplied.filter((c) => /donation/i.test(c.name));
    const expected = computeDonationCredits(ctx({ income: p.income, credits: p.credits }));
    expect(fedDonation).toHaveLength(1);
    expect(onDonation).toHaveLength(1);
    expect(fedDonation[0].amount).toBeCloseTo(expected.federal, 2);
    expect(onDonation[0].amount).toBeCloseTo(expected.ontario, 2);
  });
});

describe('2025 parameters', () => {
  it('uses 2025 Ontario bracket thresholds', () => {
    expect(taxFromBrackets(52886, taxConfig.ontario.brackets)).toBeCloseTo(52886 * 0.0505, 2);
    expect(taxFromBrackets(105775, taxConfig.ontario.brackets)).toBeCloseTo(
      52886 * 0.0505 + (105775 - 52886) * 0.0915,
      2
    );
  });

  it('computes maximum 2025 CPP, CPP2 and EI', () => {
    const p = computePayroll(100000);
    expect(p.cppBase + p.cppEnhanced - 396).toBeCloseTo(4034.1, 2);
    expect(p.cppTotal).toBeCloseTo(4430.1, 2);
    expect(p.ei).toBeCloseTo(1077.48, 2);
  });
});

describe('Ontario-specific amounts', () => {
  it('Ontario Health Premium tiers', () => {
    expect(ontarioHealthPremium(20000)).toBe(0);
    expect(ontarioHealthPremium(22000)).toBeCloseTo(120, 2);
    expect(ontarioHealthPremium(30000)).toBe(300);
    expect(ontarioHealthPremium(48300)).toBeCloseTo(525, 2);
    expect(ontarioHealthPremium(100000)).toBe(750);
    expect(ontarioHealthPremium(250000)).toBe(900);
  });

  it('Ontario tax reduction', () => {
    expect(ontarioTaxReduction(200, 0)).toBe(200); // fully eliminated
    expect(ontarioTaxReduction(500, 0)).toBe(88); // 2×294 − 500
    expect(ontarioTaxReduction(1000, 1)).toBe(676); // 2×(294+544) − 1000
    expect(ontarioTaxReduction(2000, 0)).toBe(0);
  });

  it('does not apply an Ontario tuition credit to current-year fees', () => {
    const res = IMPLEMENTED_RULES['ontario tuition amount'](ctx({ credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 6000 } }));
    expect(res.applied).toBe(false);
    expect(res.amount).toBe(0);
  });

  it('caps the Ontario spouse amount at the 2025 maximum', () => {
    const items = loadRuleItems(EXCEL).items;
    const req: CalculateRequest = {
      province: 'Ontario',
      household: { maritalStatus: 'married', claimant: 'taxpayer' },
      taxpayer: person({ income: { employment: 90000, other: 0, capitalGains: 0, eligibleDividends: 0 } }),
      spouse: person(),
    };
    const res = calculateOptimizedHouseholdFromItems(req, items);
    expect(res.transferSummary?.personalAmountOntarioCredit).toBeCloseTo(
      Math.round(taxConfig.ontario.spouseAmount.max * 0.0505 * 100) / 100,
      2
    );
    expect(res.transferSummary?.personalAmountFederalCredit).toBeCloseTo(
      Math.round(16129 * 0.145 * 100) / 100,
      2
    );
  });
});

describe('income & deductions', () => {
  it('grosses up eligible dividends and applies dividend tax credits', () => {
    const res = calculateFromItems(
      single(person({ income: { employment: 0, other: 0, capitalGains: 0, eligibleDividends: 10000 } })),
      []
    );
    expect(res.federal.taxableIncome).toBeCloseTo(13800, 2);
    expect(res.federal.dividendTaxCredit).toBeCloseTo(13800 * 0.150198, 2);
    expect(res.ontario.dividendTaxCredit).toBeCloseTo(1380, 2);
  });

  it('limits child care to 2/3 of earned income and requires eligible children', () => {
    const base = ctx({
      income: { employment: 9000, other: 0, capitalGains: 0, eligibleDividends: 0 },
      deductions: { ...zeroDeductions, childCareExpenses: 8000, numChildrenUnder7: 1 },
    });
    expect(IMPLEMENTED_RULES['child care expenses'](base).amount).toBeCloseTo(6000, 2);

    const noKids = ctx({ income: base.income, deductions: { ...zeroDeductions, childCareExpenses: 8000 } });
    expect(IMPLEMENTED_RULES['child care expenses'](noKids).amount).toBe(0);
  });

  it('household: child care is claimed by the lower-income spouse', () => {
    const items = loadRuleItems(EXCEL).items;
    const req: CalculateRequest = {
      province: 'Ontario',
      household: { maritalStatus: 'married', claimant: 'taxpayer' },
      taxpayer: person({
        income: { employment: 120000, other: 0, capitalGains: 0, eligibleDividends: 0 },
        deductions: { ...zeroDeductions, childCareExpenses: 8000, numChildrenUnder7: 1 },
      }),
      spouse: person({ income: { employment: 40000, other: 0, capitalGains: 0, eligibleDividends: 0 } }),
    };
    const res = calculateOptimizedHouseholdFromItems(req, items);
    expect(res.transferSummary?.childCareClaimant).toBe('spouse');
    expect(res.spouse?.deductionsApplied.some((d) => /child care/i.test(d.name) && d.amount === 8000)).toBe(true);
  });

  it('federal donation credit uses 33% only on income above the top bracket threshold', () => {
    const c = ctx({
      income: { employment: 256000, other: 0, capitalGains: 0, eligibleDividends: 0 },
      credits: { hasDisabilityDTC: false, donations: 5200, tuitionFees: 0 },
    });
    const { federal } = computeDonationCredits(c);
    const cppEnhanced = computePayroll(256000).cppEnhanced;
    const atTop = 256000 - cppEnhanced - 253414;
    expect(atTop).toBeGreaterThan(0);
    expect(atTop).toBeLessThan(5000);
    expect(federal).toBeCloseTo(200 * 0.145 + atTop * 0.33 + (5000 - atTop) * 0.29, 1);
  });
});

describe('Canada workers benefit', () => {
  it('phases in at 27% of working income above $3,000', () => {
    const c = ctx({
      income: { employment: 5000, other: 0, capitalGains: 0, eligibleDividends: 0 },
      benefits: { cwbEligible: true, cwbDisabilityEligible: false, includeBenefitsEstimates: false },
    });
    expect(IMPLEMENTED_RULES['canada workers benefit'](c).amount).toBeCloseTo(540, 2);
  });

  it('pays nothing without working income', () => {
    const c = ctx({
      income: { employment: 0, other: 15000, capitalGains: 0, eligibleDividends: 0 },
      benefits: { cwbEligible: true, cwbDisabilityEligible: false, includeBenefitsEstimates: false },
    });
    expect(IMPLEMENTED_RULES['canada workers benefit'](c).amount).toBe(0);
  });
});

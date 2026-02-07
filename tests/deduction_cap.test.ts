import { describe, it, expect } from 'vitest';
import { IMPLEMENTED_RULES } from '@/lib/rules/implemented';
import type { UserContext } from '@/lib/rules/types';

function baseCtx(): UserContext {
  return {
    age: 30,
    maritalStatus: 'single',
    spouseNetIncome: 0,
    income: { employment: 50000, other: 0, capitalGains: 0, eligibleDividends: 0 },
    deductions: {
      rrspContributions: 0,
      rrspDeductionLimit: 0,
      fhsaContributions: 0,
      rppContributions: 0,
      unionDues: 0,
      childCareExpenses: 0,
      numChildrenUnder7: 0,
      numChildren7to16: 0,
      numChildrenDTCEligible: 0
    },
    credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 0 },
    benefits: { cwbEligible: false, cwbDisabilityEligible: false, includeBenefitsEstimates: false }
  };
}

describe('deduction with cap', () => {
  it('caps child care deduction based on child counts', () => {
    const ctx = baseCtx();
    ctx.deductions.childCareExpenses = 30000;
    ctx.deductions.numChildrenUnder7 = 1; // cap 8000
    ctx.deductions.numChildren7to16 = 1; // cap 5000
    const res = IMPLEMENTED_RULES['child care expenses'](ctx);
    expect(res.applied).toBe(true);
    expect(res.amount).toBe(13000);
  });
});

import { describe, it, expect } from 'vitest';
import { IMPLEMENTED_RULES, estimateNetIncome } from '@/lib/rules/implemented';
import taxConfig from '@/lib/tax/config/2025.json';
import type { UserContext } from '@/lib/rules/types';

function baseCtx(income: number): UserContext {
  return {
    age: 25,
    maritalStatus: 'single',
    spouseNetIncome: 0,
    income: { employment: income, other: 0, capitalGains: 0, eligibleDividends: 0 },
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
    benefits: { cwbEligible: true, cwbDisabilityEligible: false, includeBenefitsEstimates: false }
  };
}

describe('refundable benefit calculation', () => {
  it('phases out CWB for single person', () => {
    const cfg = taxConfig.benefits.cwb;
    const income = (cfg.singlePhaseoutStart + cfg.singlePhaseoutEnd) / 2;
    const ctx = baseCtx(income);
    const res = IMPLEMENTED_RULES['canada workers benefit'](ctx);

    const netIncome = estimateNetIncome(ctx);
    const frac = (netIncome - cfg.singlePhaseoutStart) / (cfg.singlePhaseoutEnd - cfg.singlePhaseoutStart);
    const expected = Math.round(cfg.singleMax * (1 - frac) * 100) / 100;

    expect(res.applied).toBe(true);
    expect(res.amount).toBeCloseTo(expected, 2);
  });
});

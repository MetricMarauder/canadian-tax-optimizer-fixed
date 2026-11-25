import { getConfig } from '@/lib/tax/config';
import { describe, it, expect } from 'vitest';
import { IMPLEMENTED_RULES, estimateNetIncome } from '@/lib/rules/implemented';
import { getConfig as _gc } from '@/lib/tax/config';
const taxConfig = _gc(2025);
import type { UserContext } from '@/lib/rules/types';

function ctxWithIncome(income: number): UserContext {
  return {
    config: getConfig(2025),
    province: 'ON',
    age: 40,
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
    benefits: { cwbEligible: false, cwbDisabilityEligible: false, includeBenefitsEstimates: false }
  };
}

describe('non-refundable credit with phaseout', () => {
  it('reduces federal BPA between start and end thresholds', () => {
    const cfg = taxConfig.federal.basicPersonalAmount;
    const midIncome = (cfg.phaseoutStart + cfg.phaseoutEnd) / 2;
    const ctx = ctxWithIncome(midIncome);
    const res = IMPLEMENTED_RULES['basic personal amount'](ctx);

    // Phase-out is based on net income (employment income less the enhanced CPP deduction).
    const netIncome = estimateNetIncome(ctx);
    const frac = (netIncome - cfg.phaseoutStart) / (cfg.phaseoutEnd - cfg.phaseoutStart);
    const bpa = cfg.base - frac * (cfg.base - cfg.min);
    const expected = Math.round(bpa * taxConfig.federal.lowestRate * 100) / 100;

    expect(res.applied).toBe(true);
    expect(res.amount).toBeCloseTo(expected, 2);
  });
});

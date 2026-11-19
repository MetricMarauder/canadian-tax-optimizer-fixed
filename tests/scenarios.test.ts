import { describe, it, expect } from 'vitest';
import { calculateFromItems } from '@/lib/tax/calculate';
import type { IndividualRequest } from '@/lib/api/types';
import type { RuleItem } from '@/lib/rules/types';

const items: RuleItem[] = [
  mk('1', 'RRSP deduction', 'Federal', 'Deduction'),
  mk('2', 'RPP deduction', 'Federal', 'Deduction'),
  mk('3', 'Union or professional dues', 'Federal', 'Deduction'),
  mk('4', 'Child care expenses', 'Federal', 'Deduction'),
  mk('5', 'Basic personal amount', 'Federal', 'Non-refundable credit'),
  mk('6', 'Canada employment amount', 'Federal', 'Non-refundable credit'),
  mk('7', 'Disability amount', 'Federal', 'Non-refundable credit'),
  mk('8', 'Ontario basic personal amount', 'Ontario', 'Non-refundable credit'),
  mk('9', 'Ontario disability amount', 'Ontario', 'Non-refundable credit'),
  mk('10', 'Donations and gifts', 'Federal', 'Non-refundable credit'),
  mk('11', 'Canada workers benefit', 'Federal', 'Refundable credit'),
  mk('12', 'Ontario CARE child care tax credit', 'Ontario', 'Refundable credit'),
  mk('13', 'GST/HST credit', 'Federal', 'Benefit'),
  mk('14', 'Ontario sales tax credit', 'Ontario', 'Benefit')
];

function mk(id: string, name: string, jurisdiction: 'Federal' | 'Ontario', mechanism: string): RuleItem {
  return {
    id,
    name,
    jurisdiction,
    mechanism,
    impact: '',
    refundableFlag: /Refundable|Benefit/i.test(mechanism),
    lineForm: '',
    eligibilitySummary: '',
    calcSummary: '',
    spousalTransfer: '',
    carryforward: '',
    notes: '',
    sourceUrls: []
  };
}

describe('seed scenarios (deterministic expected outputs)', () => {
  it('Scenario A: low income single, eligible CWB', () => {
    const req: IndividualRequest = {
      province: 'Ontario',
      age: 25,
      maritalStatus: 'single',
      income: { employment: 20000, other: 0, capitalGains: 0, eligibleDividends: 0 },
      deductions: {
        rrspContributions: 0,
        rrspDeductionLimit: 0,
        rppContributions: 0,
        unionDues: 0,
        childCareExpenses: 0,
        numChildrenUnder7: 0,
        numChildren7to16: 0,
        numChildrenDTCEligible: 0
      },
      credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 0 },
      benefits: { cwbEligible: true, cwbDisabilityEligible: false, includeBenefitsEstimates: true },
      taxesWithheld: 1500
    };
    const res = calculateFromItems(req, items);
    // Values cross-checked against an independent re-implementation (within $0.01 rounding).
    expect(res.refundOrOwing).toBeCloseTo(2962.64, 2);
    expect(res.taxPayableTotal).toBeCloseTo(170.36, 2);
    // CWB is on the return; the GST/HST credit (CGEB, (356 + 165.42) × 1.25 = 651.78) and OSTC (378)
    // are paid separately and are not in the refund.
    expect(res.refundableCreditsAndBenefitsTotal).toBeCloseTo(1633.0, 2);
    expect(res.benefitsPaidSeparatelyTotal).toBeCloseTo(1029.78, 2);
  });

  it('Scenario B: mid income single with RRSP + donations', () => {
    const req: IndividualRequest = {
      province: 'Ontario',
      age: 35,
      maritalStatus: 'single',
      income: { employment: 90000, other: 1000, capitalGains: 5000, eligibleDividends: 0 },
      deductions: {
        rrspContributions: 12000,
        rrspDeductionLimit: 10000,
        rppContributions: 0,
        unionDues: 800,
        childCareExpenses: 0,
        numChildrenUnder7: 0,
        numChildren7to16: 0,
        numChildrenDTCEligible: 0
      },
      credits: { hasDisabilityDTC: false, donations: 1200, tuitionFees: 0 },
      benefits: { cwbEligible: false, cwbDisabilityEligible: false, includeBenefitsEstimates: false },
      taxesWithheld: 22000
    };
    const res = calculateFromItems(req, items);
    expect(res.refundOrOwing).toBeCloseTo(7161.9, 2);
    expect(res.taxPayableTotal).toBeCloseTo(14838.1, 2);
    expect(res.ontario.healthPremium).toBeCloseTo(750, 2);
  });

  it('Scenario C: family with child care, uses Ontario CARE', () => {
    const req: IndividualRequest = {
      province: 'Ontario',
      age: 32,
      maritalStatus: 'married',
      spouseNetIncome: 25000,
      income: { employment: 55000, other: 0, capitalGains: 0, eligibleDividends: 0 },
      deductions: {
        rrspContributions: 0,
        rrspDeductionLimit: 0,
        rppContributions: 0,
        unionDues: 0,
        childCareExpenses: 12000,
        numChildrenUnder7: 1,
        numChildren7to16: 0,
        numChildrenDTCEligible: 0
      },
      credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 0 },
      benefits: { cwbEligible: false, cwbDisabilityEligible: false, includeBenefitsEstimates: true },
      taxesWithheld: 12000
    };
    const res = calculateFromItems(req, items);
    expect(res.refundOrOwing).toBeCloseTo(9919.15, 2);
    expect(res.refundableCreditsAndBenefitsTotal).toBeCloseTo(3440.0, 2);
  });
});

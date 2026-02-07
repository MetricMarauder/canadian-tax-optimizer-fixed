import { describe, it, expect } from 'vitest';
import type { CalculateRequest } from '@/lib/api/types';
import type { RuleItem } from '@/lib/rules/types';
import taxConfig from '@/lib/tax/config/2025.json';
import { calculateOptimizedHouseholdFromItems } from '@/lib/tax/household';

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
    sourceUrls: [],
  };
}

describe('household optimizer', () => {
  it('reassigns donations to the spouse that maximizes household result', () => {
    const items: RuleItem[] = [
      mk('1', 'Basic personal amount', 'Federal', 'Non-refundable credit'),
      mk('2', 'Ontario basic personal amount', 'Ontario', 'Non-refundable credit'),
      mk('3', 'Donations and gifts', 'Federal', 'Non-refundable credit'),
    ];

    const req: CalculateRequest = {
      province: 'Ontario',
      household: { maritalStatus: 'married', claimant: 'taxpayer' },
      taxpayer: {
        age: 40,
        province: 'Ontario',
        income: { employment: 95000, other: 0, capitalGains: 0, eligibleDividends: 0 },
        deductions: {
          rrspContributions: 0,
          rrspDeductionLimit: 0,
          fhsaContributions: 0,
          rppContributions: 0,
          unionDues: 0,
          childCareExpenses: 0,
          numChildrenUnder7: 0,
          numChildren7to16: 0,
          numChildrenDTCEligible: 0,
        },
        credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 0 },
        benefits: { cwbEligible: false, cwbDisabilityEligible: false, includeBenefitsEstimates: false },
        taxesWithheld: 0,
      },
      spouse: {
        age: 38,
        province: 'Ontario',
        income: { employment: 0, other: 0, capitalGains: 0, eligibleDividends: 0 },
        deductions: {
          rrspContributions: 0,
          rrspDeductionLimit: 0,
          fhsaContributions: 0,
          rppContributions: 0,
          unionDues: 0,
          childCareExpenses: 0,
          numChildrenUnder7: 0,
          numChildren7to16: 0,
          numChildrenDTCEligible: 0,
        },
        credits: { hasDisabilityDTC: false, donations: 2000, tuitionFees: 0 },
        benefits: { cwbEligible: false, cwbDisabilityEligible: false, includeBenefitsEstimates: false },
        taxesWithheld: 0,
      },
    };

    const res = calculateOptimizedHouseholdFromItems(req, items);
    expect(res.transferSummary?.donationsClaimant).toBe('taxpayer');
    expect(res.taxpayer.federal.nonRefundableCreditsTotal).toBeGreaterThan(0);
  });

  it('chooses a single CWB claimant to avoid double-claiming family CWB', () => {
    const items: RuleItem[] = [mk('1', 'Canada workers benefit', 'Federal', 'Refundable credit')];

    const req: CalculateRequest = {
      province: 'Ontario',
      household: { maritalStatus: 'married', claimant: 'taxpayer' },
      taxpayer: {
        age: 30,
        province: 'Ontario',
        income: { employment: 10000, other: 0, capitalGains: 0, eligibleDividends: 0 },
        deductions: {
          rrspContributions: 0,
          rrspDeductionLimit: 0,
          fhsaContributions: 0,
          rppContributions: 0,
          unionDues: 0,
          childCareExpenses: 0,
          numChildrenUnder7: 0,
          numChildren7to16: 0,
          numChildrenDTCEligible: 0,
        },
        credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 0 },
        benefits: { cwbEligible: true, cwbDisabilityEligible: false, includeBenefitsEstimates: false },
        taxesWithheld: 0,
      },
      spouse: {
        age: 29,
        province: 'Ontario',
        income: { employment: 10000, other: 0, capitalGains: 0, eligibleDividends: 0 },
        deductions: {
          rrspContributions: 0,
          rrspDeductionLimit: 0,
          fhsaContributions: 0,
          rppContributions: 0,
          unionDues: 0,
          childCareExpenses: 0,
          numChildrenUnder7: 0,
          numChildren7to16: 0,
          numChildrenDTCEligible: 0,
        },
        credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 0 },
        benefits: { cwbEligible: true, cwbDisabilityEligible: false, includeBenefitsEstimates: false },
        taxesWithheld: 0,
      },
    };

    const res = calculateOptimizedHouseholdFromItems(req, items);
    expect(res.transferSummary?.cwbClaimant).toBeTruthy();

    const taxpayerHasCwb = res.taxpayer.refundableCreditsAndBenefitsTotal > 0;
    const spouseHasCwb = (res.spouse?.refundableCreditsAndBenefitsTotal ?? 0) > 0;
    expect(taxpayerHasCwb).not.toBe(spouseHasCwb);
  });

  it('caps tuition transfer amount at 5000 and reports transferred credits', () => {
    const items: RuleItem[] = [
      mk('1', 'Basic personal amount', 'Federal', 'Non-refundable credit'),
      mk('2', 'Ontario basic personal amount', 'Ontario', 'Non-refundable credit'),
      mk('3', 'Tuition amount', 'Federal', 'Non-refundable credit'),
      mk('4', 'Ontario tuition amount', 'Ontario', 'Non-refundable credit'),
    ];

    const req: CalculateRequest = {
      province: 'Ontario',
      household: { maritalStatus: 'married', claimant: 'taxpayer' },
      taxpayer: {
        age: 45,
        province: 'Ontario',
        income: { employment: 120000, other: 0, capitalGains: 0, eligibleDividends: 0 },
        deductions: {
          rrspContributions: 0,
          rrspDeductionLimit: 0,
          fhsaContributions: 0,
          rppContributions: 0,
          unionDues: 0,
          childCareExpenses: 0,
          numChildrenUnder7: 0,
          numChildren7to16: 0,
          numChildrenDTCEligible: 0,
        },
        credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 0 },
        benefits: { cwbEligible: false, cwbDisabilityEligible: false, includeBenefitsEstimates: false },
        taxesWithheld: 0,
      },
      spouse: {
        age: 23,
        province: 'Ontario',
        income: { employment: 0, other: 0, capitalGains: 0, eligibleDividends: 0 },
        deductions: {
          rrspContributions: 0,
          rrspDeductionLimit: 0,
          fhsaContributions: 0,
          rppContributions: 0,
          unionDues: 0,
          childCareExpenses: 0,
          numChildrenUnder7: 0,
          numChildren7to16: 0,
          numChildrenDTCEligible: 0,
        },
        credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 25000 },
        benefits: { cwbEligible: false, cwbDisabilityEligible: false, includeBenefitsEstimates: false },
        taxesWithheld: 0,
      },
    };

    const res = calculateOptimizedHouseholdFromItems(req, items);
    expect(res.transferSummary?.tuitionTransferAmount).toBe(5000);
    expect(res.transferSummary?.tuitionFederalCreditTransferred).toBe(
      Math.round(5000 * taxConfig.federal.lowestRate * 100) / 100
    );
    expect(res.transferSummary?.tuitionOntarioCreditTransferred).toBe(
      Math.round(5000 * taxConfig.ontario.lowestRate * 100) / 100
    );
  });

  it('limits tuition transfer to the donor’s unused credit amount', () => {
    const items: RuleItem[] = [
      mk('1', 'Basic personal amount', 'Federal', 'Non-refundable credit'),
      mk('2', 'Ontario basic personal amount', 'Ontario', 'Non-refundable credit'),
      mk('3', 'Canada employment amount', 'Federal', 'Non-refundable credit'),
      mk('4', 'Tuition amount', 'Federal', 'Non-refundable credit'),
      mk('5', 'Ontario tuition amount', 'Ontario', 'Non-refundable credit'),
    ];

    const req: CalculateRequest = {
      province: 'Ontario',
      household: { maritalStatus: 'married', claimant: 'taxpayer' },
      taxpayer: {
        age: 45,
        province: 'Ontario',
        income: { employment: 120000, other: 0, capitalGains: 0, eligibleDividends: 0 },
        deductions: {
          rrspContributions: 0,
          rrspDeductionLimit: 0,
          fhsaContributions: 0,
          rppContributions: 0,
          unionDues: 0,
          childCareExpenses: 0,
          numChildrenUnder7: 0,
          numChildren7to16: 0,
          numChildrenDTCEligible: 0,
        },
        credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 0 },
        benefits: { cwbEligible: false, cwbDisabilityEligible: false, includeBenefitsEstimates: false },
        taxesWithheld: 0,
      },
      spouse: {
        age: 23,
        province: 'Ontario',
        income: { employment: 14000, other: 0, capitalGains: 0, eligibleDividends: 0 },
        deductions: {
          rrspContributions: 0,
          rrspDeductionLimit: 0,
          fhsaContributions: 0,
          rppContributions: 0,
          unionDues: 0,
          childCareExpenses: 0,
          numChildrenUnder7: 0,
          numChildren7to16: 0,
          numChildrenDTCEligible: 0,
        },
        credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 5000 },
        benefits: { cwbEligible: false, cwbDisabilityEligible: false, includeBenefitsEstimates: false },
        taxesWithheld: 0,
      },
    };

    const res = calculateOptimizedHouseholdFromItems(req, items);
    expect(res.transferSummary?.tuitionTransferAmount).toBeGreaterThan(0);
    expect(res.transferSummary?.tuitionTransferAmount).toBeLessThan(5000);
  });

  it('limits disability transfer to the donor’s unused disability amount', () => {
    const items: RuleItem[] = [
      mk('1', 'Basic personal amount', 'Federal', 'Non-refundable credit'),
      mk('2', 'Ontario basic personal amount', 'Ontario', 'Non-refundable credit'),
      mk('3', 'Canada employment amount', 'Federal', 'Non-refundable credit'),
      mk('4', 'Disability amount', 'Federal', 'Non-refundable credit'),
      mk('5', 'Ontario disability amount', 'Ontario', 'Non-refundable credit'),
    ];

    const req: CalculateRequest = {
      province: 'Ontario',
      household: { maritalStatus: 'married', claimant: 'taxpayer' },
      taxpayer: {
        age: 45,
        province: 'Ontario',
        income: { employment: 120000, other: 0, capitalGains: 0, eligibleDividends: 0 },
        deductions: {
          rrspContributions: 0,
          rrspDeductionLimit: 0,
          fhsaContributions: 0,
          rppContributions: 0,
          unionDues: 0,
          childCareExpenses: 0,
          numChildrenUnder7: 0,
          numChildren7to16: 0,
          numChildrenDTCEligible: 0,
        },
        credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 0 },
        benefits: { cwbEligible: false, cwbDisabilityEligible: false, includeBenefitsEstimates: false },
        taxesWithheld: 0,
      },
      spouse: {
        age: 42,
        province: 'Ontario',
        income: { employment: 22000, other: 0, capitalGains: 0, eligibleDividends: 0 },
        deductions: {
          rrspContributions: 0,
          rrspDeductionLimit: 0,
          fhsaContributions: 0,
          rppContributions: 0,
          unionDues: 0,
          childCareExpenses: 0,
          numChildrenUnder7: 0,
          numChildren7to16: 0,
          numChildrenDTCEligible: 0,
        },
        credits: { hasDisabilityDTC: true, donations: 0, tuitionFees: 0 },
        benefits: { cwbEligible: false, cwbDisabilityEligible: false, includeBenefitsEstimates: false },
        taxesWithheld: 0,
      },
    };

    const res = calculateOptimizedHouseholdFromItems(req, items);
    expect(res.transferSummary?.disabilityTransferFrom).toBe('spouse');
    expect(res.transferSummary?.disabilityTransferFederalBase).toBeGreaterThan(0);
    expect(res.transferSummary?.disabilityTransferFederalBase).toBeLessThan(taxConfig.federal.disabilityAmount);
    expect(res.transferSummary?.disabilityTransferOntarioBase).toBeGreaterThan(0);
    expect(res.transferSummary?.disabilityTransferOntarioBase).toBeLessThan(taxConfig.ontario.disabilityAmount);
  });

  it('claims unused spousal personal amount on the better-earning spouse return', () => {
    const items: RuleItem[] = [
      mk('1', 'Basic personal amount', 'Federal', 'Non-refundable credit'),
      mk('2', 'Ontario basic personal amount', 'Ontario', 'Non-refundable credit'),
    ];

    const req: CalculateRequest = {
      province: 'Ontario',
      household: { maritalStatus: 'married', claimant: 'taxpayer' },
      taxpayer: {
        age: 44,
        province: 'Ontario',
        income: { employment: 90000, other: 0, capitalGains: 0, eligibleDividends: 0 },
        deductions: {
          rrspContributions: 0,
          rrspDeductionLimit: 0,
          fhsaContributions: 0,
          rppContributions: 0,
          unionDues: 0,
          childCareExpenses: 0,
          numChildrenUnder7: 0,
          numChildren7to16: 0,
          numChildrenDTCEligible: 0,
        },
        credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 0 },
        benefits: { cwbEligible: false, cwbDisabilityEligible: false, includeBenefitsEstimates: false },
        taxesWithheld: 0,
      },
      spouse: {
        age: 41,
        province: 'Ontario',
        income: { employment: 0, other: 0, capitalGains: 0, eligibleDividends: 0 },
        deductions: {
          rrspContributions: 0,
          rrspDeductionLimit: 0,
          fhsaContributions: 0,
          rppContributions: 0,
          unionDues: 0,
          childCareExpenses: 0,
          numChildrenUnder7: 0,
          numChildren7to16: 0,
          numChildrenDTCEligible: 0,
        },
        credits: { hasDisabilityDTC: false, donations: 0, tuitionFees: 0 },
        benefits: { cwbEligible: false, cwbDisabilityEligible: false, includeBenefitsEstimates: false },
        taxesWithheld: 0,
      },
    };

    const res = calculateOptimizedHouseholdFromItems(req, items);
    expect(res.transferSummary?.personalAmountClaimant).toBe('taxpayer');
    expect(res.transferSummary?.personalAmountFederalCredit).toBeGreaterThan(0);
    expect(res.transferSummary?.personalAmountOntarioCredit).toBeGreaterThan(0);
    expect(
      res.taxpayer.federal.creditsApplied.some((c) => c.name.includes('Spouse or common-law partner amount'))
    ).toBe(true);
    expect(
      res.taxpayer.ontario.creditsApplied.some((c) => c.name.includes('Ontario spouse or common-law partner amount'))
    ).toBe(true);
  });
});

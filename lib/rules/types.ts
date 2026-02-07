import type { Jurisdiction } from '@/lib/api/types';

export type RuleItem = {
  id: string;
  name: string;
  jurisdiction: Jurisdiction;
  mechanism: string;
  impact: string;
  refundableFlag: boolean;
  lineForm?: string;
  eligibilitySummary: string;
  calcSummary: string;
  spousalTransfer: string;
  carryforward: string;
  notes: string;
  sourceUrls: string[];
};

export type UserContext = {
  age: number;
  maritalStatus: 'single' | 'married' | 'commonlaw';
  spouseNetIncome: number;
  income: {
    employment: number;
    other: number;
    capitalGains: number;
    eligibleDividends: number;
  };
  deductions: {
    rrspContributions: number;
    rrspDeductionLimit: number;
    fhsaContributions: number;
    rppContributions: number;
    unionDues: number;
    childCareExpenses: number;
    numChildrenUnder7: number;
    numChildren7to16: number;
    numChildrenDTCEligible: number;
  };
  credits: {
    hasDisabilityDTC: boolean;
    donations: number;
    tuitionFees: number;
    disabilityTransferInFederalBase?: number;
    disabilityTransferOutFederalBase?: number;
    disabilityTransferInOntarioBase?: number;
    disabilityTransferOutOntarioBase?: number;
  };
  benefits: {
    cwbEligible: boolean;
    cwbDisabilityEligible: boolean;
    includeBenefitsEstimates: boolean;
    cwbClaimBasic?: boolean;
    cwbClaimDisability?: boolean;
    cwbDisabilityBothEligible?: boolean;
    claimGstHstCredit?: boolean;
    claimOstc?: boolean;
    claimCareCredit?: boolean;
  };
};

export type RuleResult = {
  applied: boolean;
  amount: number;
  reason: string;
  // A: deduction, B: credit, C: benefit/transfer
  prong: 'A' | 'B' | 'C';
  kind: 'deduction' | 'nonRefundableCredit' | 'refundableCreditOrBenefit';
};

export type MappingFn = (ctx: UserContext, params?: any) => RuleResult;

export type RuleMapping = {
  name: string;
  prong: 'A' | 'B' | 'C';
  kind: 'deduction' | 'nonRefundableCredit' | 'refundableCreditOrBenefit';
  jurisdiction: 'Federal' | 'Ontario' | 'Both';
  requiredInputs: string[];
  params: Record<string, any>;
};

export type Province = 'Ontario';

export type MaritalStatus = 'single' | 'married' | 'commonlaw';

export type Jurisdiction = 'Federal' | 'Ontario';

export type PersonIncome = {
  employment: number;
  other: number;
  capitalGains: number;
  eligibleDividends: number;
};

export type PersonDeductions = {
  rrspContributions: number;
  rrspDeductionLimit: number;
  fhsaContributions?: number; // add FHSA
  rppContributions: number;
  unionDues: number;
  childCareExpenses: number;
  numChildrenUnder7: number;
  numChildren7to16: number;
  numChildrenDTCEligible: number;
};

export type PersonCredits = {
  hasDisabilityDTC: boolean;
  donations: number;
  tuitionFees: number;
};

export type PersonBenefits = {
  cwbEligible: boolean;
  cwbDisabilityEligible: boolean;
  includeBenefitsEstimates: boolean;
};

export type PersonInput = {
  age: number;
  province: Province;
  income: PersonIncome;
  deductions: PersonDeductions;
  credits: PersonCredits;
  benefits: PersonBenefits;
  taxesWithheld: number;
};

export type IndividualRequest = {
  province: Province;
  age: number;
  maritalStatus: MaritalStatus;
  spouseNetIncome?: number;
  income: PersonIncome;
  deductions: PersonDeductions;
  credits: PersonCredits;
  benefits: PersonBenefits;
  taxesWithheld: number;
};

export type HouseholdSettings = {
  maritalStatus: MaritalStatus;
  /**
   * Who will claim spouse amount + transfers (MVP: affects only explanations + future logic)
   * Keep this now so we don’t paint ourselves into a corner.
   */
  claimant: 'taxpayer' | 'spouse';
  /**
   * Optional: if you later implement tuition transfer / pension splitting, etc.
   * For now this is informational / placeholder.
   */
  tuitionTransferAmount?: number;
};

export type CalculateRequest = {
  province: Province;
  household: HouseholdSettings;
  taxpayer: PersonInput;
  spouse?: PersonInput;
};

export type AppliedItem = {
  id?: string;
  name: string;
  amount: number;
  lineForm?: string;
  jurisdiction: Jurisdiction;
  mechanism?: string;
  prong?: 'A' | 'B' | 'C';
};

export type JurisdictionBreakdown = {
  taxableIncome: number;
  taxBeforeCredits: number;
  nonRefundableCreditsTotal: number;
  creditsApplied: AppliedItem[];
  /**
   * Final tax for the jurisdiction. For Ontario this includes the surtax and Ontario Health
   * Premium and is net of the Ontario tax reduction.
   */
  taxAfterCredits: number;
  /** Dividend tax credit (included in creditsApplied / nonRefundableCreditsTotal). */
  dividendTaxCredit?: number;
  /** Ontario only. */
  surtax?: number;
  /** Ontario only (ON428 line 80). */
  ontarioTaxReduction?: number;
  /** Ontario only. */
  healthPremium?: number;
};

export type TaxBreakdown = JurisdictionBreakdown;

export type ExplanationRow = {
  id: string;
  name: string;
  jurisdiction: Jurisdiction;
  mechanism: string;
  refundable?: boolean;
  lineForm?: string;
  applied: boolean;
  amountApplied?: number;
  reason: string;
};

export type ExplanationItem = ExplanationRow;

export type PayrollSummary = {
  cppContributions: number;
  cppEnhancedDeduction: number;
  eiPremiums: number;
};

export type ReturnResult = {
  /** Refund (+) or balance owing (−) on the return itself. Excludes benefits paid separately. */
  refundOrOwing: number;
  taxesWithheld: number;
  taxPayableTotal: number;
  refundableCreditsAndBenefitsTotal: number;
  deductionsApplied: AppliedItem[];
  refundableCreditsAndBenefitsApplied: AppliedItem[];
  /** Estimated benefits paid separately after assessment (GST/HST credit, OSTC). */
  benefitsPaidSeparatelyTotal: number;
  benefitsPaidSeparately: AppliedItem[];
  /** Employee CPP/EI estimated from employment income. */
  payroll: PayrollSummary;
  federal: JurisdictionBreakdown;
  ontario: JurisdictionBreakdown;
  explanation: ExplanationRow[];
};

export type CalculateResponse = {
  household: {
    refundOrOwing: number;
    taxesWithheldTotal: number;
    taxPayableTotal: number;
    refundableCreditsAndBenefitsTotal: number;
    benefitsPaidSeparatelyTotal: number;
  };
  taxpayer: ReturnResult;
  spouse?: ReturnResult;
  transferSummary?: {
    tuitionTransferAmount: number;
    tuitionFederalCreditTransferred: number;
    tuitionOntarioCreditTransferred: number;
    tuitionTransferFromTaxpayer: number;
    tuitionTransferFromSpouse: number;
    tuitionNetTo: 'taxpayer' | 'spouse' | null;
    tuitionNetAmount: number;
    personalAmountClaimant: 'taxpayer' | 'spouse' | null;
    personalAmountFederalCredit: number;
    personalAmountOntarioCredit: number;
    donationsClaimant: 'taxpayer' | 'spouse' | null;
    childCareClaimant: 'taxpayer' | 'spouse' | null;
    disabilityTransferFrom: 'taxpayer' | 'spouse' | null;
    disabilityTransferFederalBase: number;
    disabilityTransferOntarioBase: number;
    benefitClaimant: 'taxpayer' | 'spouse' | null;
    cwbClaimant: 'taxpayer' | 'spouse' | null;
  };
};

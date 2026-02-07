import taxConfig from '@/lib/tax/config/2025.json';
import { taxFromBrackets } from '@/lib/tax/brackets';
import type {
  IndividualRequest,
  MaritalStatus,
  PersonInput,
  ReturnResult,
  TaxBreakdown,
} from '@/lib/api/types';
import type { RuleItem, UserContext } from '@/lib/rules/types';
import { loadRuleItems } from '@/lib/excel/loadCredits';
import { runRules } from '@/lib/rules/engine';

const EXCEL_PATH = 'ontario_federal_tax_credits_2025.xlsx';

export type CalculationOverrides = {
  credits?: Pick<
    UserContext['credits'],
    | 'disabilityTransferInFederalBase'
    | 'disabilityTransferOutFederalBase'
    | 'disabilityTransferInOntarioBase'
    | 'disabilityTransferOutOntarioBase'
  >;
  benefits?: Pick<
    UserContext['benefits'],
    | 'cwbClaimBasic'
    | 'cwbClaimDisability'
    | 'cwbDisabilityBothEligible'
    | 'claimGstHstCredit'
    | 'claimOstc'
    | 'claimCareCredit'
  >;
};

export function calculate(req: IndividualRequest): ReturnResult {
  const { items } = loadRuleItems(EXCEL_PATH);
  return calculateFromItems(req, items);
}

export function calculateFromItems(req: IndividualRequest, items: RuleItem[]): ReturnResult {
  const person: PersonInput = {
    age: req.age,
    province: req.province,
    income: req.income,
    deductions: req.deductions,
    credits: req.credits,
    benefits: req.benefits,
    taxesWithheld: req.taxesWithheld,
  };

  return calculateTaxFromItems(person, req.maritalStatus, req.spouseNetIncome ?? 0, items);
}

export function calculateTax(
  person: PersonInput,
  maritalStatus: MaritalStatus,
  spouseNetIncome = 0,
  overrides?: CalculationOverrides
): ReturnResult {
  const { items } = loadRuleItems(EXCEL_PATH);
  return calculateTaxFromItems(person, maritalStatus, spouseNetIncome, items, overrides);
}

export function calculateTaxFromItems(
  person: PersonInput,
  maritalStatus: MaritalStatus,
  spouseNetIncome: number,
  items: RuleItem[],
  overrides?: CalculationOverrides
): ReturnResult {
  const ctx: UserContext = {
    age: person.age,
    maritalStatus,
    spouseNetIncome,
    income: person.income,
    deductions: {
      ...person.deductions,
      fhsaContributions: person.deductions.fhsaContributions ?? 0,
    },
    credits: {
      ...person.credits,
      ...overrides?.credits,
    },
    benefits: {
      ...person.benefits,
      ...overrides?.benefits,
    },
  };

  const engine = runRules(items, ctx);

  const deductionsTotal = sum(engine.deductionsApplied.map((d) => d.amount));

  const grossIncome =
    person.income.employment +
    person.income.other +
    0.5 * person.income.capitalGains +
    person.income.eligibleDividends;

  const taxableIncome = Math.max(0, grossIncome - deductionsTotal);

  const fedBefore = taxFromBrackets(taxableIncome, taxConfig.federal.brackets);
  const fedCreditsTotal = sum(engine.federalNonRefundableCredits.map((c) => c.amount));
  const fedAfter = Math.max(0, round2(fedBefore - fedCreditsTotal));

  const onBefore = taxFromBrackets(taxableIncome, taxConfig.ontario.brackets);
  const onCreditsTotal = sum(engine.ontarioNonRefundableCredits.map((c) => c.amount));
  let onAfter = Math.max(0, round2(onBefore - onCreditsTotal));
  const surtax = computeOntarioSurtax(onAfter);
  onAfter = round2(onAfter + surtax);

  const refundableTotal = round2(sum(engine.refundableCreditsAndBenefitsApplied.map((r) => r.amount)));
  const taxPayableTotal = round2(fedAfter + onAfter);
  const refundOrOwing = round2(person.taxesWithheld - taxPayableTotal + refundableTotal);

  const federal: TaxBreakdown = {
    taxableIncome,
    taxBeforeCredits: fedBefore,
    creditsApplied: engine.federalNonRefundableCredits.map((c) => ({
      name: c.name,
      amount: c.amount,
      lineForm: c.lineForm,
      jurisdiction: 'Federal',
    })),
    nonRefundableCreditsTotal: round2(fedCreditsTotal),
    taxAfterCredits: fedAfter,
  };

  const ontario: TaxBreakdown = {
    taxableIncome,
    taxBeforeCredits: onBefore,
    creditsApplied: engine.ontarioNonRefundableCredits.map((c) => ({
      name: c.name,
      amount: c.amount,
      lineForm: c.lineForm,
      jurisdiction: 'Ontario',
    })),
    nonRefundableCreditsTotal: round2(onCreditsTotal),
    taxAfterCredits: onAfter,
  };

  return {
    refundOrOwing,
    taxesWithheld: person.taxesWithheld,
    taxPayableTotal,
    refundableCreditsAndBenefitsTotal: refundableTotal,
    federal,
    ontario,
    deductionsApplied: engine.deductionsApplied,
    refundableCreditsAndBenefitsApplied: engine.refundableCreditsAndBenefitsApplied,
    explanation: engine.explanation,
  };
}

function computeOntarioSurtax(ontarioTaxAfterCredits: number): number {
  const { threshold1Tax, rate1, threshold2Tax, rate2 } = taxConfig.ontario.surtax;
  const s1 = Math.max(0, (ontarioTaxAfterCredits - threshold1Tax) * rate1);
  const s2 = Math.max(0, (ontarioTaxAfterCredits - threshold2Tax) * rate2);
  return round2(s1 + s2);
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

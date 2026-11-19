import taxConfig from '@/lib/tax/config/2025.json';
import { taxFromBrackets } from '@/lib/tax/brackets';
import {
  computePayroll,
  formatPct,
  grossedUpEligibleDividends,
  ontarioHealthPremium,
  ontarioSurtax,
  ontarioTaxReduction,
  round2,
  totalIncome,
} from '@/lib/tax/income';
import type {
  AppliedItem,
  ExplanationItem,
  IndividualRequest,
  MaritalStatus,
  PersonInput,
  ReturnResult,
  TaxBreakdown,
} from '@/lib/api/types';
import type { RuleItem, UserContext } from '@/lib/rules/types';
import { loadRuleItems } from '@/lib/excel/loadCredits';
import { runRules } from '@/lib/rules/engine';
import { estimateChildrenCount, normalizeKey } from '@/lib/rules/implemented';

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
  /** Credits computed outside the rules engine (e.g. the household spouse amount). */
  extraCredits?: {
    federal?: AppliedItem[];
    ontario?: AppliedItem[];
  };
  /**
   * Number of dependants claimed for the Ontario tax reduction. Defaults to the person's own
   * child counts; the household optimizer gives them to the higher-income spouse.
   */
  ontarioTaxReductionDependants?: number;
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
  const explanation = engine.explanation;
  const fedRate = taxConfig.federal.lowestRate;
  const onRate = taxConfig.ontario.lowestRate;

  // --- Income & deductions ---------------------------------------------------------------
  const payroll = computePayroll(person.income.employment);
  const deductionsApplied: AppliedItem[] = [...engine.deductionsApplied];
  if (payroll.cppEnhanced > 0) {
    deductionsApplied.push({
      name: 'Deduction for CPP enhanced contributions on employment income (estimated)',
      amount: payroll.cppEnhanced,
      lineForm: 'Line 22215',
      jurisdiction: 'Federal',
      mechanism: 'Deduction',
    });
  }
  annotate(
    explanation,
    'deduction for cpp qpp enhanced contributions on employment income',
    undefined,
    payroll.cppEnhanced,
    'Estimated from employment income (1% enhanced CPP + CPP2).'
  );

  const deductionsTotal = sum(deductionsApplied.map((d) => d.amount));
  const taxableIncome = round2(Math.max(0, totalIncome(person.income) - deductionsTotal));
  const grossedUpDividends = grossedUpEligibleDividends(person.income);

  // --- Federal -----------------------------------------------------------------------------
  const federalCredits: AppliedItem[] = engine.federalNonRefundableCredits
    .filter((c) => c.amount > 0)
    .map((c) => ({
    name: c.name,
    amount: c.amount,
    lineForm: c.lineForm,
    jurisdiction: 'Federal' as const,
  }));
  pushCredit(federalCredits, 'CPP contributions through employment (estimated)', 'Line 30800', 'Federal', payroll.cppBase * fedRate);
  pushCredit(federalCredits, 'Employment insurance premiums through employment (estimated)', 'Line 31200', 'Federal', payroll.ei * fedRate);
  annotate(explanation, 'cpp qpp contributions through employment', 'Federal', payroll.cppBase * fedRate,
    `Base CPP $${payroll.cppBase} × ${formatPct(fedRate)} (estimated from employment income).`);
  annotate(explanation, 'employment insurance premiums through employment', 'Federal', payroll.ei * fedRate,
    `EI premiums $${payroll.ei} × ${formatPct(fedRate)} (estimated from employment income).`);
  for (const extra of overrides?.extraCredits?.federal ?? []) federalCredits.push(extra);

  const federalDtc = round2(grossedUpDividends * taxConfig.federal.dividendTaxCredit.eligibleRate);
  pushCredit(federalCredits, 'Federal dividend tax credit (eligible dividends)', 'Line 40425', 'Federal', federalDtc);
  annotate(explanation, 'federal dividend tax credit', 'Federal', federalDtc,
    `Grossed-up eligible dividends $${grossedUpDividends} × ${formatPct(taxConfig.federal.dividendTaxCredit.eligibleRate)}.`);

  const fedBefore = taxFromBrackets(taxableIncome, taxConfig.federal.brackets);
  const fedCreditsTotal = round2(sum(federalCredits.map((c) => c.amount)));
  const fedAfter = Math.max(0, round2(fedBefore - fedCreditsTotal));

  // --- Ontario -----------------------------------------------------------------------------
  const ontarioCredits: AppliedItem[] = engine.ontarioNonRefundableCredits
    .filter((c) => c.amount > 0)
    .map((c) => ({
    name: c.name,
    amount: c.amount,
    lineForm: c.lineForm,
    jurisdiction: 'Ontario' as const,
  }));
  pushCredit(ontarioCredits, 'Ontario CPP contributions credit (estimated)', 'ON428 line 58240', 'Ontario', payroll.cppBase * onRate);
  pushCredit(ontarioCredits, 'Ontario EI premiums credit (estimated)', 'ON428 line 58300', 'Ontario', payroll.ei * onRate);
  annotate(explanation, 'cpp qpp contributions', 'Ontario', payroll.cppBase * onRate,
    `Base CPP $${payroll.cppBase} × ${formatPct(onRate)} (estimated from employment income).`);
  annotate(explanation, 'employment insurance premiums', 'Ontario', payroll.ei * onRate,
    `EI premiums $${payroll.ei} × ${formatPct(onRate)} (estimated from employment income).`);
  for (const extra of overrides?.extraCredits?.ontario ?? []) ontarioCredits.push(extra);

  const ontarioDtc = round2(grossedUpDividends * taxConfig.ontario.dividendTaxCredit.eligibleRate);
  pushCredit(ontarioCredits, 'Ontario dividend tax credit (eligible dividends)', 'ON428 line 61520', 'Ontario', ontarioDtc);
  annotate(explanation, 'ontario dividend tax credit', 'Ontario', ontarioDtc,
    `Grossed-up eligible dividends $${grossedUpDividends} × ${formatPct(taxConfig.ontario.dividendTaxCredit.eligibleRate)}.`);

  const onBefore = taxFromBrackets(taxableIncome, taxConfig.ontario.brackets);
  const onCreditsTotal = round2(sum(ontarioCredits.map((c) => c.amount)));
  const basicOntarioTax = Math.max(0, round2(onBefore - onCreditsTotal));
  const surtax = ontarioSurtax(basicOntarioTax);
  const ontarioTaxBeforeReduction = round2(basicOntarioTax + surtax);
  const dependants = overrides?.ontarioTaxReductionDependants ?? estimateChildrenCount(ctx);
  const reduction = ontarioTaxReduction(ontarioTaxBeforeReduction, dependants);
  annotate(explanation, 'ontario tax reduction', 'Ontario', reduction,
    `2 × ($${taxConfig.ontario.taxReduction.basic} + ${dependants} × $${taxConfig.ontario.taxReduction.perDependant}) − Ontario tax $${ontarioTaxBeforeReduction}.`);
  const healthPremium = ontarioHealthPremium(taxableIncome);
  const onAfter = round2(ontarioTaxBeforeReduction - reduction + healthPremium);

  // --- Totals ------------------------------------------------------------------------------
  const refundableTotal = round2(sum(engine.refundableCreditsAndBenefitsApplied.map((r) => r.amount)));
  const benefitsPaidSeparatelyTotal = round2(sum(engine.benefitsPaidSeparately.map((r) => r.amount)));
  const taxPayableTotal = round2(fedAfter + onAfter);
  const refundOrOwing = round2(person.taxesWithheld - taxPayableTotal + refundableTotal);

  const federal: TaxBreakdown = {
    taxableIncome,
    taxBeforeCredits: fedBefore,
    creditsApplied: federalCredits,
    nonRefundableCreditsTotal: fedCreditsTotal,
    taxAfterCredits: fedAfter,
    dividendTaxCredit: federalDtc,
  };

  const ontario: TaxBreakdown = {
    taxableIncome,
    taxBeforeCredits: onBefore,
    creditsApplied: ontarioCredits,
    nonRefundableCreditsTotal: onCreditsTotal,
    taxAfterCredits: onAfter,
    dividendTaxCredit: ontarioDtc,
    surtax,
    ontarioTaxReduction: reduction,
    healthPremium,
  };

  return {
    refundOrOwing,
    taxesWithheld: person.taxesWithheld,
    taxPayableTotal,
    refundableCreditsAndBenefitsTotal: refundableTotal,
    benefitsPaidSeparatelyTotal,
    benefitsPaidSeparately: engine.benefitsPaidSeparately,
    payroll: {
      cppContributions: payroll.cppTotal,
      cppEnhancedDeduction: payroll.cppEnhanced,
      eiPremiums: payroll.ei,
    },
    federal,
    ontario,
    deductionsApplied,
    refundableCreditsAndBenefitsApplied: engine.refundableCreditsAndBenefitsApplied,
    explanation,
  };
}

function pushCredit(
  list: AppliedItem[],
  name: string,
  lineForm: string,
  jurisdiction: 'Federal' | 'Ontario',
  amount: number
) {
  const rounded = round2(amount);
  if (rounded > 0) list.push({ name, amount: rounded, lineForm, jurisdiction });
}

/**
 * Items computed outside the rules engine still show up in "Explain my result" against the
 * matching catalog row (when the Excel catalog contains one).
 */
function annotate(
  explanation: ExplanationItem[],
  normalizedName: string,
  jurisdiction: 'Federal' | 'Ontario' | undefined,
  amount: number,
  reason: string
) {
  const rounded = round2(Math.max(0, amount));
  for (const row of explanation) {
    if (normalizeKey(row.name) !== normalizedName) continue;
    if (jurisdiction && row.jurisdiction !== jurisdiction) continue;
    row.applied = rounded > 0;
    row.amountApplied = rounded;
    row.reason = rounded > 0 ? reason : `Not applicable for these inputs. ${reason}`;
  }
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

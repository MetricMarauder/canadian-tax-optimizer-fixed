import { taxFromBrackets } from '@/lib/tax/brackets';
import { DEFAULT_YEAR, getConfig, getProvince, type ProvinceCode } from '@/lib/tax/config';
import { computePayroll, formatPct, grossedUpEligibleDividends, round2, totalIncome } from '@/lib/tax/income';
import { computeProvincial } from '@/lib/tax/provincial';
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
import { PROVINCIAL_PLACEHOLDER, runRules } from '@/lib/rules/engine';
import { estimateChildrenCount, estimateNetIncome, normalizeKey } from '@/lib/rules/implemented';

export const EXCEL_PATH = 'ontario_federal_tax_credits_2025.xlsx';

export type CalculationOverrides = {
  /** Tax year (defaults to 2025). */
  year?: number;
  /** Spouse's employment income, for family working-income tests. */
  spouseEmploymentIncome?: number;
  credits?: Pick<
    UserContext['credits'],
    | 'disabilityTransferInFederalBase'
    | 'disabilityTransferOutFederalBase'
    | 'disabilityTransferInProvincialBase'
    | 'disabilityTransferOutProvincialBase'
  >;
  benefits?: Pick<
    UserContext['benefits'],
    'cwbClaimBasic' | 'cwbClaimDisability' | 'cwbDisabilityBothEligible' | 'claimHouseholdBenefits' | 'claimCareCredit'
  >;
  /** Credits computed outside the rules engine (e.g. the household spouse amount). */
  extraCredits?: {
    federal?: AppliedItem[];
    provincial?: AppliedItem[];
  };
  /**
   * Dependants claimed for the provincial low-income tax reduction. Defaults to the person's own
   * child counts; the household optimizer assigns them to one spouse.
   */
  taxReductionDependants?: number;
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

  return calculateTaxFromItems(person, req.maritalStatus, req.spouseNetIncome ?? 0, items, { year: req.year });
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

export function buildContext(
  person: PersonInput,
  maritalStatus: MaritalStatus,
  spouseNetIncome: number,
  overrides?: CalculationOverrides
): UserContext {
  return {
    config: getConfig(overrides?.year ?? DEFAULT_YEAR),
    province: (person.province ?? 'ON') as ProvinceCode,
    age: person.age,
    maritalStatus,
    spouseNetIncome,
    spouseEmploymentIncome: overrides?.spouseEmploymentIncome,
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
}

export function calculateTaxFromItems(
  person: PersonInput,
  maritalStatus: MaritalStatus,
  spouseNetIncome: number,
  items: RuleItem[],
  overrides?: CalculationOverrides
): ReturnResult {
  const ctx = buildContext(person, maritalStatus, spouseNetIncome, overrides);
  const cfg = ctx.config;
  const prov = getProvince(cfg, ctx.province);
  const isQuebec = ctx.province === 'QC';

  const engine = runRules(items, ctx);
  const explanation = engine.explanation;
  const fedRate = cfg.federal.lowestRate;

  // --- Income & deductions ---------------------------------------------------------------
  const payroll = computePayroll(cfg, person.income.employment, ctx.province);
  const deductionsApplied: AppliedItem[] = [...engine.deductionsApplied];
  if (payroll.cppEnhanced > 0) {
    deductionsApplied.push({
      name: `Deduction for ${isQuebec ? 'QPP' : 'CPP'} enhanced contributions on employment income (estimated)`,
      amount: payroll.cppEnhanced,
      lineForm: 'Line 22215',
      jurisdiction: 'Federal',
      mechanism: 'Deduction',
    });
  }
  annotate(explanation, 'deduction for cpp qpp enhanced contributions on employment income', 'Federal', payroll.cppEnhanced,
    'Estimated from employment income (1% enhanced contribution + second additional contribution).');

  const deductionsTotal = sum(deductionsApplied.map((d) => d.amount));
  const taxableIncome = round2(Math.max(0, totalIncome(cfg, person.income) - deductionsTotal));
  const netIncome = taxableIncome; // no line-25000+ deductions are modelled
  const grossedUpDividends = grossedUpEligibleDividends(cfg, person.income);

  // --- Federal -----------------------------------------------------------------------------
  const federalCredits: AppliedItem[] = engine.federalNonRefundableCredits
    .filter((c) => c.amount > 0)
    .map((c) => ({ name: c.name, amount: c.amount, lineForm: c.lineForm, jurisdiction: 'Federal' }));
  const pensionPlan = isQuebec ? 'QPP' : 'CPP';
  pushCredit(federalCredits, `${pensionPlan} contributions through employment (estimated)`, 'Line 30800', payroll.cppBase * fedRate);
  pushCredit(federalCredits, 'Employment insurance premiums through employment (estimated)', 'Line 31200', payroll.ei * fedRate);
  pushCredit(federalCredits, 'QPIP premiums through employment (estimated)', 'Line 31205', payroll.qpip * fedRate);
  annotate(explanation, 'cpp qpp contributions through employment', 'Federal', payroll.cppBase * fedRate,
    `Base ${pensionPlan} $${payroll.cppBase} × ${formatPct(fedRate)} (estimated from employment income).`);
  annotate(explanation, 'employment insurance premiums through employment', 'Federal', payroll.ei * fedRate,
    `EI premiums $${payroll.ei} × ${formatPct(fedRate)} (estimated from employment income).`);
  for (const extra of overrides?.extraCredits?.federal ?? []) federalCredits.push(extra);

  const federalDtc = round2(grossedUpDividends * cfg.federal.dividendTaxCredit.eligibleRate);
  pushCredit(federalCredits, 'Federal dividend tax credit (eligible dividends)', 'Line 40425', federalDtc);
  annotate(explanation, 'federal dividend tax credit', 'Federal', federalDtc,
    `Grossed-up eligible dividends $${grossedUpDividends} × ${formatPct(cfg.federal.dividendTaxCredit.eligibleRate)}.`);

  const fedBefore = taxFromBrackets(taxableIncome, cfg.federal.brackets);
  const fedCreditsTotal = round2(sum(federalCredits.map((c) => c.amount)));
  const basicFederalTax = Math.max(0, round2(fedBefore - fedCreditsTotal));
  const quebecAbatement = isQuebec ? round2(basicFederalTax * cfg.federal.quebecAbatement) : 0;
  const fedAfter = round2(basicFederalTax - quebecAbatement);

  // --- Provincial ----------------------------------------------------------------------------
  const childCareDeduction = deductionsApplied.find((d) => /child care/i.test(d.name))?.amount ?? 0;
  const afni = round2(estimateNetIncome(ctx) + (maritalStatus === 'single' ? 0 : Math.max(0, spouseNetIncome)));
  const provincial = computeProvincial({
    ctx,
    prov,
    taxableIncome,
    netIncome,
    afni,
    payroll,
    grossedUpDividends,
    childCareDeduction,
    extraCredits: overrides?.extraCredits?.provincial ?? [],
    taxReductionDependants: overrides?.taxReductionDependants ?? estimateChildrenCount(ctx),
  });
  annotateProvincialRows(explanation, ctx.province, prov.name, provincial.annotations);

  // --- Totals --------------------------------------------------------------------------------
  const refundableApplied = [...engine.refundableCreditsAndBenefitsApplied, ...provincial.refundable];
  const benefitsApplied = [...engine.benefitsPaidSeparately, ...provincial.benefits];
  const refundableTotal = round2(sum(refundableApplied.map((r) => r.amount)));
  const benefitsPaidSeparatelyTotal = round2(sum(benefitsApplied.map((r) => r.amount)));
  const taxPayableTotal = round2(fedAfter + provincial.taxPayable);
  const refundOrOwing = round2(person.taxesWithheld - taxPayableTotal + refundableTotal);

  const federal: TaxBreakdown = {
    taxableIncome,
    taxBeforeCredits: fedBefore,
    creditsApplied: federalCredits,
    nonRefundableCreditsTotal: fedCreditsTotal,
    taxAfterCredits: fedAfter,
    dividendTaxCredit: federalDtc,
    ...(isQuebec ? { quebecAbatement } : {}),
  };

  return {
    refundOrOwing,
    taxesWithheld: person.taxesWithheld,
    taxPayableTotal,
    refundableCreditsAndBenefitsTotal: refundableTotal,
    benefitsPaidSeparatelyTotal,
    benefitsPaidSeparately: benefitsApplied,
    payroll: {
      cppContributions: payroll.cppTotal,
      cppEnhancedDeduction: payroll.cppEnhanced,
      eiPremiums: payroll.ei,
      qpipPremiums: payroll.qpip,
    },
    federal,
    provincial: {
      province: ctx.province,
      name: prov.name,
      notes: prov.notes ?? [],
      taxableIncome: provincial.taxableIncome,
      taxBeforeCredits: provincial.taxBeforeCredits,
      creditsApplied: provincial.credits,
      nonRefundableCreditsTotal: provincial.nonRefundableCreditsTotal,
      taxAfterCredits: provincial.taxPayable,
      dividendTaxCredit: provincial.dividendTaxCredit,
      surtax: provincial.surtax,
      taxReduction: provincial.taxReduction,
      healthPremium: provincial.healthPremium,
    },
    deductionsApplied,
    refundableCreditsAndBenefitsApplied: refundableApplied,
    explanation,
  };
}

function pushCredit(list: AppliedItem[], name: string, lineForm: string, amount: number) {
  const rounded = round2(amount);
  if (rounded > 0) list.push({ name, amount: rounded, lineForm, jurisdiction: 'Federal' });
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

/** Fills in the catalog's provincial (Ontario) rows from the provincial calculation. */
function annotateProvincialRows(
  explanation: ExplanationItem[],
  province: ProvinceCode,
  provinceName: string,
  annotations: { key: string; amount: number; reason: string }[]
) {
  for (const row of explanation) {
    if (row.reason !== PROVINCIAL_PLACEHOLDER) continue;
    if (province !== 'ON') {
      row.applied = false;
      row.amountApplied = 0;
      row.reason = `Ontario-only item — not applicable for ${provinceName}. ${provinceName} amounts are shown in the provincial breakdown.`;
      continue;
    }
    const key = normalizeKey(row.name);
    const match = annotations.find((a) => a.key === key);
    if (match) {
      row.applied = match.amount > 0;
      row.amountApplied = match.amount;
      row.reason = match.amount > 0 ? match.reason : `Not applicable for these inputs. ${match.reason}`;
    } else if (key.includes('tuition')) {
      row.reason = 'Ontario has no tuition credit for current-year fees (eliminated in 2017); pre-2017 carryforwards are not modelled.';
    } else {
      row.reason = 'Not yet modelled for Ontario.';
    }
  }
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

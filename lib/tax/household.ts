import taxConfig from '@/lib/tax/config/2025.json';
import type {
  CalculateRequest,
  CalculateResponse,
  PersonInput,
  ReturnResult,
  HouseholdSettings,
} from '@/lib/api/types';
import type { CalculationOverrides } from '@/lib/tax/calculate';
import type { UserContext } from '@/lib/rules/types';
import type { RuleItem } from '@/lib/rules/types';
import { loadRuleItems } from '@/lib/excel/loadCredits';
import { calculateTax, calculateTaxFromItems } from '@/lib/tax/calculate';
import { estimateNetIncome, normalizeKey } from '@/lib/rules/implemented';

/**
 * Context passed into the return calculation so you can implement cross-return logic later:
 * - spouse amount claimant
 * - tuition transfer
 * - home buyer split
 * - pension splitting
 */
export type ReturnContext = {
  household: HouseholdSettings;
  role: 'taxpayer' | 'spouse';
  spouse?: PersonInput;
};

type Claimant = 'taxpayer' | 'spouse' | null;

type OptimizationPlan = {
  donationsClaimant: Claimant;
  childCareClaimant: Claimant;
  benefitClaimant: Claimant;
  cwbClaimant: Claimant;
  personalAmountClaimant: Claimant;
  disabilityTransferFrom: Claimant;
  disabilityTransferFederalBase: number;
  disabilityTransferOntarioBase: number;
  tuitionTransferFromTaxpayer: number;
  tuitionTransferFromSpouse: number;
};

type Evaluation = {
  plan: OptimizationPlan;
  taxpayer: ReturnResult;
  spouse: ReturnResult;
  household: CalculateResponse['household'];
  personalAmountClaimant: Claimant;
  personalAmountFederalCredit: number;
  personalAmountOntarioCredit: number;
  score: number;
};

type OptimizationContext = {
  maritalStatus: HouseholdSettings['maritalStatus'];
  taxpayerBase: PersonInput;
  spouseBase: PersonInput;
  items: RuleItem[];
  tuitionTransferCap: number;
  cache: Map<string, Evaluation>;
};

type PreparedInputs = {
  taxpayer: PersonInput;
  spouse: PersonInput;
  taxpayerOverrides: CalculationOverrides;
  spouseOverrides: CalculationOverrides;
};

type TransferCreditSplit = {
  tuition: number;
  disability: number;
  other: number;
};

type TransferBaseCaps = {
  tuition: number;
  disabilityFederal: number;
  disabilityOntario: number;
};

const EXCEL_PATH = 'ontario_federal_tax_credits_2025.xlsx';
const TUITION_TRANSFER_MAX = 5000;
const ONTARIO_SPOUSAL_AMOUNT_BASE = 11905;
const FEDERAL_SPOUSAL_CREDIT_NAME = 'Spouse or common-law partner amount (line 30300)';
const ONTARIO_SPOUSAL_CREDIT_NAME = 'Ontario spouse or common-law partner amount (line 58120)';

export async function calculateReturn(person: PersonInput, ctx: ReturnContext): Promise<ReturnResult> {
  // In MVP: compute that person’s return with an estimated spouse net income for benefits.
  // Later: apply spouse-amount + transfers based on ctx.household.claimant, spouse net income, etc.
  const spouseNetIncome = ctx.spouse ? estimateNetIncome(buildUserContext(ctx.spouse, ctx.household.maritalStatus)) : 0;
  return calculateTax(person, ctx.household.maritalStatus, spouseNetIncome);
}

export function combineHousehold(taxpayer: ReturnResult, spouse?: ReturnResult) {
  const taxesWithheldTotal = round2(taxpayer.taxesWithheld + (spouse?.taxesWithheld ?? 0));
  const taxPayableTotal = round2(taxpayer.taxPayableTotal + (spouse?.taxPayableTotal ?? 0));
  const refundableCreditsAndBenefitsTotal =
    round2(taxpayer.refundableCreditsAndBenefitsTotal + (spouse?.refundableCreditsAndBenefitsTotal ?? 0));

  // refund/owing = withheld - payable + refundable/benefits
  const refundOrOwing = round2(taxesWithheldTotal - taxPayableTotal + refundableCreditsAndBenefitsTotal);

  return {
    refundOrOwing,
    taxesWithheldTotal,
    taxPayableTotal,
    refundableCreditsAndBenefitsTotal,
  };
}

export function calculateOptimizedHousehold(req: CalculateRequest): CalculateResponse {
  const { items } = loadRuleItems(EXCEL_PATH);
  return calculateOptimizedHouseholdFromItems(req, items);
}

export function calculateOptimizedHouseholdFromItems(
  req: CalculateRequest,
  items: RuleItem[]
): CalculateResponse {
  if (!req.spouse || req.household.maritalStatus === 'single') {
    const taxpayer = calculateTaxFromItems(req.taxpayer, req.household.maritalStatus, 0, items);
    return {
      household: combineHousehold(taxpayer),
      taxpayer,
    };
  }

  const ctx: OptimizationContext = {
    maritalStatus: req.household.maritalStatus,
    taxpayerBase: normalizePerson(req.taxpayer),
    spouseBase: normalizePerson(req.spouse),
    items,
    tuitionTransferCap: resolveTuitionTransferCap(req),
    cache: new Map<string, Evaluation>(),
  };

  const initialPlan: OptimizationPlan = {
    donationsClaimant: null,
    childCareClaimant: null,
    benefitClaimant: req.household.claimant,
    cwbClaimant: req.household.claimant,
    personalAmountClaimant: req.household.claimant,
    disabilityTransferFrom: null,
    disabilityTransferFederalBase: 0,
    disabilityTransferOntarioBase: 0,
    tuitionTransferFromTaxpayer: 0,
    tuitionTransferFromSpouse: 0,
  };

  const best = optimizePlan(initialPlan, ctx);
  const totalDonations = ctx.taxpayerBase.credits.donations + ctx.spouseBase.credits.donations;
  const totalChildCare =
    ctx.taxpayerBase.deductions.childCareExpenses + ctx.spouseBase.deductions.childCareExpenses;
  const hasBenefitEligibility =
    ctx.taxpayerBase.benefits.includeBenefitsEstimates || ctx.spouseBase.benefits.includeBenefitsEstimates;
  const hasCwbEligibility =
    ctx.taxpayerBase.benefits.cwbEligible ||
    ctx.taxpayerBase.benefits.cwbDisabilityEligible ||
    ctx.spouseBase.benefits.cwbEligible ||
    ctx.spouseBase.benefits.cwbDisabilityEligible;
  const tuitionNet = round2(best.plan.tuitionTransferFromSpouse - best.plan.tuitionTransferFromTaxpayer);
  const tuitionTransferAmount = Math.abs(tuitionNet);
  const tuitionFederalCreditTransferred = round2(tuitionTransferAmount * taxConfig.federal.lowestRate);
  const tuitionOntarioCreditTransferred = round2(tuitionTransferAmount * taxConfig.ontario.lowestRate);
  const taxpayer = annotateReturnWithTransfers(best.taxpayer, best.plan, 'taxpayer');
  const spouse = annotateReturnWithTransfers(best.spouse, best.plan, 'spouse');

  return {
    household: best.household,
    taxpayer,
    spouse,
    transferSummary: {
      tuitionTransferAmount,
      tuitionFederalCreditTransferred,
      tuitionOntarioCreditTransferred,
      tuitionTransferFromTaxpayer: best.plan.tuitionTransferFromTaxpayer,
      tuitionTransferFromSpouse: best.plan.tuitionTransferFromSpouse,
      tuitionNetTo: tuitionNet > 0 ? 'taxpayer' : tuitionNet < 0 ? 'spouse' : null,
      tuitionNetAmount: tuitionTransferAmount,
      personalAmountClaimant:
        best.personalAmountFederalCredit > 0 || best.personalAmountOntarioCredit > 0
          ? best.personalAmountClaimant
          : null,
      personalAmountFederalCredit: best.personalAmountFederalCredit,
      personalAmountOntarioCredit: best.personalAmountOntarioCredit,
      donationsClaimant: totalDonations > 0 ? best.plan.donationsClaimant : null,
      childCareClaimant: totalChildCare > 0 ? best.plan.childCareClaimant : null,
      disabilityTransferFrom:
        best.plan.disabilityTransferFederalBase > 0 || best.plan.disabilityTransferOntarioBase > 0
          ? best.plan.disabilityTransferFrom
          : null,
      disabilityTransferFederalBase: best.plan.disabilityTransferFederalBase,
      disabilityTransferOntarioBase: best.plan.disabilityTransferOntarioBase,
      benefitClaimant: hasBenefitEligibility ? best.plan.benefitClaimant : null,
      cwbClaimant: hasCwbEligibility ? best.plan.cwbClaimant : null,
    },
  };
}

function annotateReturnWithTransfers(
  result: ReturnResult,
  plan: OptimizationPlan,
  role: 'taxpayer' | 'spouse'
): ReturnResult {
  const transferIn = role === 'taxpayer' ? plan.tuitionTransferFromSpouse : plan.tuitionTransferFromTaxpayer;
  const transferOut = role === 'taxpayer' ? plan.tuitionTransferFromTaxpayer : plan.tuitionTransferFromSpouse;
  const counterpart = role === 'taxpayer' ? 'spouse' : 'taxpayer';
  const disabilityInFederal =
    plan.disabilityTransferFrom &&
    ((plan.disabilityTransferFrom === 'taxpayer' && role === 'spouse') ||
      (plan.disabilityTransferFrom === 'spouse' && role === 'taxpayer'))
      ? plan.disabilityTransferFederalBase
      : 0;
  const disabilityInOntario =
    plan.disabilityTransferFrom &&
    ((plan.disabilityTransferFrom === 'taxpayer' && role === 'spouse') ||
      (plan.disabilityTransferFrom === 'spouse' && role === 'taxpayer'))
      ? plan.disabilityTransferOntarioBase
      : 0;
  const disabilityOutFederal =
    plan.disabilityTransferFrom === role ? plan.disabilityTransferFederalBase : 0;
  const disabilityOutOntario =
    plan.disabilityTransferFrom === role ? plan.disabilityTransferOntarioBase : 0;

  return {
    ...result,
    federal: {
      ...result.federal,
      creditsApplied: annotateCredits(result.federal.creditsApplied, {
        tuitionIn: transferIn,
        tuitionOut: transferOut,
        disabilityIn: disabilityInFederal,
        disabilityOut: disabilityOutFederal,
        counterpart,
      }),
    },
    ontario: {
      ...result.ontario,
      creditsApplied: annotateCredits(result.ontario.creditsApplied, {
        tuitionIn: transferIn,
        tuitionOut: transferOut,
        disabilityIn: disabilityInOntario,
        disabilityOut: disabilityOutOntario,
        counterpart,
      }),
    },
  };
}

function annotateCredits(
  credits: ReturnResult['federal']['creditsApplied'],
  opts: { tuitionIn: number; tuitionOut: number; disabilityIn: number; disabilityOut: number; counterpart: string }
): ReturnResult['federal']['creditsApplied'] {
  return credits.map((credit) => {
    const key = normalizeKey(credit.name);
    const suffixes: string[] = [];

    if (key.includes('tuition') && opts.tuitionIn > 0) {
      suffixes.push(`includes $${opts.tuitionIn.toFixed(2)} transferred from ${opts.counterpart}`);
    }
    if (key.includes('tuition') && opts.tuitionOut > 0) {
      suffixes.push(`after transferring $${opts.tuitionOut.toFixed(2)} to ${opts.counterpart}`);
    }
    if (key.includes('disability amount') && opts.disabilityIn > 0) {
      suffixes.push(`includes $${opts.disabilityIn.toFixed(2)} transferred from ${opts.counterpart}`);
    }
    if (key.includes('disability amount') && opts.disabilityOut > 0) {
      suffixes.push(`after transferring $${opts.disabilityOut.toFixed(2)} to ${opts.counterpart}`);
    }

    if (suffixes.length === 0) return credit;
    return {
      ...credit,
      name: `${credit.name} (${suffixes.join('; ')})`,
    };
  });
}

function applySpousalPersonalAmountTransfer(
  requestedClaimant: Claimant,
  maritalStatus: HouseholdSettings['maritalStatus'],
  taxpayer: ReturnResult,
  spouse: ReturnResult,
  taxpayerNetIncome: number,
  spouseNetIncome: number
): {
  claimant: Claimant;
  federalCredit: number;
  ontarioCredit: number;
  taxpayer: ReturnResult;
  spouse: ReturnResult;
} {
  if (maritalStatus === 'single' || !requestedClaimant) {
    return {
      claimant: null,
      federalCredit: 0,
      ontarioCredit: 0,
      taxpayer,
      spouse,
    };
  }

  if (requestedClaimant === 'taxpayer') {
    const credits = computeSpousalPersonalAmountCredits(taxpayerNetIncome, spouseNetIncome);
    if (credits.federal <= 0 && credits.ontario <= 0) {
      return {
        claimant: null,
        federalCredit: 0,
        ontarioCredit: 0,
        taxpayer,
        spouse,
      };
    }

    return {
      claimant: 'taxpayer',
      federalCredit: credits.federal,
      ontarioCredit: credits.ontario,
      taxpayer: applySpousalPersonalAmountToReturn(taxpayer, credits.federal, credits.ontario, 'spouse'),
      spouse,
    };
  }

  const credits = computeSpousalPersonalAmountCredits(spouseNetIncome, taxpayerNetIncome);
  if (credits.federal <= 0 && credits.ontario <= 0) {
    return {
      claimant: null,
      federalCredit: 0,
      ontarioCredit: 0,
      taxpayer,
      spouse,
    };
  }

  return {
    claimant: 'spouse',
    federalCredit: credits.federal,
    ontarioCredit: credits.ontario,
    taxpayer,
    spouse: applySpousalPersonalAmountToReturn(spouse, credits.federal, credits.ontario, 'taxpayer'),
  };
}

function computeSpousalPersonalAmountCredits(
  claimantNetIncome: number,
  spouseNetIncome: number
): { federal: number; ontario: number } {
  const claimantFederalBase = federalBasicPersonalAmountBase(claimantNetIncome);
  const donorNetIncome = Math.max(0, spouseNetIncome);
  const federalBase = Math.max(0, claimantFederalBase - donorNetIncome);
  const ontarioBase = Math.max(0, ONTARIO_SPOUSAL_AMOUNT_BASE - donorNetIncome);

  return {
    federal: round2(federalBase * taxConfig.federal.lowestRate),
    ontario: round2(ontarioBase * taxConfig.ontario.lowestRate),
  };
}

function federalBasicPersonalAmountBase(netIncome: number): number {
  const cfg = taxConfig.federal.basicPersonalAmount;
  const income = Math.max(0, netIncome);
  if (income >= cfg.phaseoutEnd) return cfg.min;
  if (income <= cfg.phaseoutStart) return cfg.base;
  const frac = (income - cfg.phaseoutStart) / (cfg.phaseoutEnd - cfg.phaseoutStart);
  return round2(cfg.base - frac * (cfg.base - cfg.min));
}

function applySpousalPersonalAmountToReturn(
  result: ReturnResult,
  federalCredit: number,
  ontarioCredit: number,
  from: 'taxpayer' | 'spouse'
): ReturnResult {
  const updatedFederalCredits =
    federalCredit > 0
      ? [
          ...result.federal.creditsApplied,
          {
            name: `${FEDERAL_SPOUSAL_CREDIT_NAME} (transferred from ${from})`,
            amount: federalCredit,
            jurisdiction: 'Federal' as const,
            lineForm: 'Line 30300',
          },
        ]
      : result.federal.creditsApplied;
  const updatedOntarioCredits =
    ontarioCredit > 0
      ? [
          ...result.ontario.creditsApplied,
          {
            name: `${ONTARIO_SPOUSAL_CREDIT_NAME} (transferred from ${from})`,
            amount: ontarioCredit,
            jurisdiction: 'Ontario' as const,
            lineForm: 'Line 58120',
          },
        ]
      : result.ontario.creditsApplied;

  const federalNonRefundableCreditsTotal = round2(result.federal.nonRefundableCreditsTotal + federalCredit);
  const federalTaxAfterCredits = Math.max(0, round2(result.federal.taxBeforeCredits - federalNonRefundableCreditsTotal));
  const ontarioNonRefundableCreditsTotal = round2(result.ontario.nonRefundableCreditsTotal + ontarioCredit);
  const ontarioTaxAfterCredits = computeOntarioTaxAfterCredits(
    result.ontario.taxBeforeCredits,
    ontarioNonRefundableCreditsTotal
  );

  const taxPayableTotal = round2(federalTaxAfterCredits + ontarioTaxAfterCredits);
  const refundOrOwing = round2(
    result.taxesWithheld - taxPayableTotal + result.refundableCreditsAndBenefitsTotal
  );

  return {
    ...result,
    refundOrOwing,
    taxPayableTotal,
    federal: {
      ...result.federal,
      creditsApplied: updatedFederalCredits,
      nonRefundableCreditsTotal: federalNonRefundableCreditsTotal,
      taxAfterCredits: federalTaxAfterCredits,
    },
    ontario: {
      ...result.ontario,
      creditsApplied: updatedOntarioCredits,
      nonRefundableCreditsTotal: ontarioNonRefundableCreditsTotal,
      taxAfterCredits: ontarioTaxAfterCredits,
    },
  };
}

function computeOntarioTaxAfterCredits(taxBeforeCredits: number, nonRefundableCreditsTotal: number): number {
  const preSurtaxTax = Math.max(0, round2(taxBeforeCredits - nonRefundableCreditsTotal));
  const { threshold1Tax, rate1, threshold2Tax, rate2 } = taxConfig.ontario.surtax;
  const s1 = Math.max(0, (preSurtaxTax - threshold1Tax) * rate1);
  const s2 = Math.max(0, (preSurtaxTax - threshold2Tax) * rate2);
  return round2(preSurtaxTax + round2(s1 + s2));
}

function optimizePlan(initialPlan: OptimizationPlan, ctx: OptimizationContext): Evaluation {
  let best = evaluatePlan(initialPlan, ctx);

  for (let pass = 0; pass < 4; pass++) {
    const startKey = planKey(best.plan);

    best = pickBest(
      best,
      [
        { ...best.plan, donationsClaimant: null },
        { ...best.plan, donationsClaimant: 'taxpayer' },
        { ...best.plan, donationsClaimant: 'spouse' },
      ],
      ctx
    );

    best = pickBest(
      best,
      [
        { ...best.plan, childCareClaimant: null },
        { ...best.plan, childCareClaimant: 'taxpayer' },
        { ...best.plan, childCareClaimant: 'spouse' },
      ],
      ctx
    );

    best = pickBest(
      best,
      [
        { ...best.plan, benefitClaimant: null },
        { ...best.plan, benefitClaimant: 'taxpayer' },
        { ...best.plan, benefitClaimant: 'spouse' },
      ],
      ctx
    );

    best = pickBest(
      best,
      [
        { ...best.plan, cwbClaimant: null },
        { ...best.plan, cwbClaimant: 'taxpayer' },
        { ...best.plan, cwbClaimant: 'spouse' },
      ],
      ctx
    );

    best = pickBest(
      best,
      [
        { ...best.plan, personalAmountClaimant: null },
        { ...best.plan, personalAmountClaimant: 'taxpayer' },
        { ...best.plan, personalAmountClaimant: 'spouse' },
      ],
      ctx
    );

    best = pickBest(best, disabilityCandidates(best.plan, ctx), ctx);
    best = pickBest(best, tuitionCandidates(best.plan, ctx), ctx);

    if (planKey(best.plan) === startKey) break;
  }

  return best;
}

function disabilityCandidates(plan: OptimizationPlan, ctx: OptimizationContext): OptimizationPlan[] {
  const out: OptimizationPlan[] = [
    {
      ...plan,
      disabilityTransferFrom: null,
      disabilityTransferFederalBase: 0,
      disabilityTransferOntarioBase: 0,
    },
  ];
  const ratios = [0.25, 0.5, 0.75, 1];

  if (ctx.taxpayerBase.credits.hasDisabilityDTC) {
    for (const ratio of ratios) {
      out.push({
        ...plan,
        disabilityTransferFrom: 'taxpayer',
        disabilityTransferFederalBase: round2(taxConfig.federal.disabilityAmount * ratio),
        disabilityTransferOntarioBase: round2(taxConfig.ontario.disabilityAmount * ratio),
      });
    }
  }

  if (ctx.spouseBase.credits.hasDisabilityDTC) {
    for (const ratio of ratios) {
      out.push({
        ...plan,
        disabilityTransferFrom: 'spouse',
        disabilityTransferFederalBase: round2(taxConfig.federal.disabilityAmount * ratio),
        disabilityTransferOntarioBase: round2(taxConfig.ontario.disabilityAmount * ratio),
      });
    }
  }

  return out;
}

function tuitionCandidates(plan: OptimizationPlan, ctx: OptimizationContext): OptimizationPlan[] {
  const maxTaxpayerToSpouse = Math.min(ctx.taxpayerBase.credits.tuitionFees, ctx.tuitionTransferCap);
  const maxSpouseToTaxpayer = Math.min(ctx.spouseBase.credits.tuitionFees, ctx.tuitionTransferCap);
  const out: OptimizationPlan[] = [
    { ...plan, tuitionTransferFromTaxpayer: 0, tuitionTransferFromSpouse: 0 },
  ];

  for (const amount of generateAmountCandidates(maxTaxpayerToSpouse)) {
    if (amount <= 0) continue;
    out.push({
      ...plan,
      tuitionTransferFromTaxpayer: amount,
      tuitionTransferFromSpouse: 0,
    });
  }

  for (const amount of generateAmountCandidates(maxSpouseToTaxpayer)) {
    if (amount <= 0) continue;
    out.push({
      ...plan,
      tuitionTransferFromTaxpayer: 0,
      tuitionTransferFromSpouse: amount,
    });
  }

  return out;
}

function pickBest(current: Evaluation, candidates: OptimizationPlan[], ctx: OptimizationContext): Evaluation {
  let best = current;
  for (const candidate of candidates) {
    const next = evaluatePlan(candidate, ctx);
    if (isBetter(next, best)) best = next;
  }
  return best;
}

function evaluatePlan(plan: OptimizationPlan, ctx: OptimizationContext): Evaluation {
  const requested = normalizePlan(plan, ctx);
  const requestedKey = planKey(requested);
  const cached = ctx.cache.get(requestedKey);
  if (cached) return cached;

  const basePrepared = applyPlanBase(requested, ctx);

  const taxpayerNetIncome = estimateNetIncome(buildUserContext(basePrepared.taxpayer, ctx.maritalStatus));
  const spouseNetIncome = estimateNetIncome(buildUserContext(basePrepared.spouse, ctx.maritalStatus));
  const taxpayerSpouseNetIncome = spouseNetIncome;
  const spouseSpouseNetIncome = taxpayerNetIncome;

  const taxpayerBeforeTransfers = calculateTaxFromItems(
    basePrepared.taxpayer,
    ctx.maritalStatus,
    taxpayerSpouseNetIncome,
    ctx.items,
    basePrepared.taxpayerOverrides
  );
  const spouseBeforeTransfers = calculateTaxFromItems(
    basePrepared.spouse,
    ctx.maritalStatus,
    spouseSpouseNetIncome,
    ctx.items,
    basePrepared.spouseOverrides
  );

  const normalized = constrainTransfersToUnused(
    requested,
    ctx,
    basePrepared,
    taxpayerBeforeTransfers,
    spouseBeforeTransfers
  );
  const key = planKey(normalized);
  const normalizedCached = ctx.cache.get(key);
  if (normalizedCached) {
    ctx.cache.set(requestedKey, normalizedCached);
    return normalizedCached;
  }

  const prepared = applyPlanTransfers(basePrepared, normalized);
  const taxpayer = calculateTaxFromItems(
    prepared.taxpayer,
    ctx.maritalStatus,
    taxpayerSpouseNetIncome,
    ctx.items,
    prepared.taxpayerOverrides
  );
  const spouse = calculateTaxFromItems(
    prepared.spouse,
    ctx.maritalStatus,
    spouseSpouseNetIncome,
    ctx.items,
    prepared.spouseOverrides
  );
  const withPersonalAmount = applySpousalPersonalAmountTransfer(
    normalized.personalAmountClaimant,
    ctx.maritalStatus,
    taxpayer,
    spouse,
    taxpayerNetIncome,
    spouseNetIncome
  );
  const household = combineHousehold(withPersonalAmount.taxpayer, withPersonalAmount.spouse);

  const evaluated: Evaluation = {
    plan: normalized,
    taxpayer: withPersonalAmount.taxpayer,
    spouse: withPersonalAmount.spouse,
    household,
    personalAmountClaimant: withPersonalAmount.claimant,
    personalAmountFederalCredit: withPersonalAmount.federalCredit,
    personalAmountOntarioCredit: withPersonalAmount.ontarioCredit,
    score: household.refundOrOwing,
  };
  ctx.cache.set(requestedKey, evaluated);
  ctx.cache.set(key, evaluated);
  return evaluated;
}

function applyPlanBase(plan: OptimizationPlan, ctx: OptimizationContext): PreparedInputs {
  const taxpayer = clonePerson(ctx.taxpayerBase);
  const spouse = clonePerson(ctx.spouseBase);

  if (plan.donationsClaimant) {
    const totalDonations = round2(taxpayer.credits.donations + spouse.credits.donations);
    if (plan.donationsClaimant === 'taxpayer') {
      taxpayer.credits.donations = totalDonations;
      spouse.credits.donations = 0;
    } else {
      spouse.credits.donations = totalDonations;
      taxpayer.credits.donations = 0;
    }
  }

  if (plan.childCareClaimant) {
    const totalChildCare = round2(taxpayer.deductions.childCareExpenses + spouse.deductions.childCareExpenses);
    const totalUnder7 = taxpayer.deductions.numChildrenUnder7 + spouse.deductions.numChildrenUnder7;
    const total7to16 = taxpayer.deductions.numChildren7to16 + spouse.deductions.numChildren7to16;
    const totalDtcEligible =
      taxpayer.deductions.numChildrenDTCEligible + spouse.deductions.numChildrenDTCEligible;

    if (plan.childCareClaimant === 'taxpayer') {
      taxpayer.deductions.childCareExpenses = totalChildCare;
      taxpayer.deductions.numChildrenUnder7 = totalUnder7;
      taxpayer.deductions.numChildren7to16 = total7to16;
      taxpayer.deductions.numChildrenDTCEligible = totalDtcEligible;
      spouse.deductions.childCareExpenses = 0;
      spouse.deductions.numChildrenUnder7 = 0;
      spouse.deductions.numChildren7to16 = 0;
      spouse.deductions.numChildrenDTCEligible = 0;
    } else {
      spouse.deductions.childCareExpenses = totalChildCare;
      spouse.deductions.numChildrenUnder7 = totalUnder7;
      spouse.deductions.numChildren7to16 = total7to16;
      spouse.deductions.numChildrenDTCEligible = totalDtcEligible;
      taxpayer.deductions.childCareExpenses = 0;
      taxpayer.deductions.numChildrenUnder7 = 0;
      taxpayer.deductions.numChildren7to16 = 0;
      taxpayer.deductions.numChildrenDTCEligible = 0;
    }
  }

  const taxpayerClaimsBenefits = plan.benefitClaimant === 'taxpayer';
  const spouseClaimsBenefits = plan.benefitClaimant === 'spouse';
  const taxpayerClaimsCwb = plan.cwbClaimant === 'taxpayer';
  const spouseClaimsCwb = plan.cwbClaimant === 'spouse';
  const bothDisabilityCwbEligible =
    taxpayer.benefits.cwbDisabilityEligible && spouse.benefits.cwbDisabilityEligible;

  const taxpayerOverrides: CalculationOverrides = {
    benefits: {
      claimGstHstCredit: taxpayerClaimsBenefits,
      claimOstc: taxpayerClaimsBenefits,
      claimCareCredit: taxpayerClaimsBenefits,
      cwbClaimBasic: taxpayerClaimsCwb,
      cwbClaimDisability: taxpayerClaimsCwb,
      cwbDisabilityBothEligible: bothDisabilityCwbEligible,
    },
    credits: {},
  };

  const spouseOverrides: CalculationOverrides = {
    benefits: {
      claimGstHstCredit: spouseClaimsBenefits,
      claimOstc: spouseClaimsBenefits,
      claimCareCredit: spouseClaimsBenefits,
      cwbClaimBasic: spouseClaimsCwb,
      cwbClaimDisability: spouseClaimsCwb,
      cwbDisabilityBothEligible: bothDisabilityCwbEligible,
    },
    credits: {},
  };

  return {
    taxpayer,
    spouse,
    taxpayerOverrides,
    spouseOverrides,
  };
}

function applyPlanTransfers(base: PreparedInputs, plan: OptimizationPlan): PreparedInputs {
  const taxpayer = clonePerson(base.taxpayer);
  const spouse = clonePerson(base.spouse);
  const taxpayerOverrides = cloneOverrides(base.taxpayerOverrides);
  const spouseOverrides = cloneOverrides(base.spouseOverrides);

  taxpayer.credits.tuitionFees = round2(
    Math.max(0, taxpayer.credits.tuitionFees - plan.tuitionTransferFromTaxpayer + plan.tuitionTransferFromSpouse)
  );
  spouse.credits.tuitionFees = round2(
    Math.max(0, spouse.credits.tuitionFees - plan.tuitionTransferFromSpouse + plan.tuitionTransferFromTaxpayer)
  );

  if (plan.disabilityTransferFrom === 'taxpayer') {
    taxpayerOverrides.credits = {
      ...(taxpayerOverrides.credits ?? {}),
      disabilityTransferOutFederalBase: plan.disabilityTransferFederalBase,
      disabilityTransferOutOntarioBase: plan.disabilityTransferOntarioBase,
    };
    spouseOverrides.credits = {
      ...(spouseOverrides.credits ?? {}),
      disabilityTransferInFederalBase: plan.disabilityTransferFederalBase,
      disabilityTransferInOntarioBase: plan.disabilityTransferOntarioBase,
    };
  } else if (plan.disabilityTransferFrom === 'spouse') {
    spouseOverrides.credits = {
      ...(spouseOverrides.credits ?? {}),
      disabilityTransferOutFederalBase: plan.disabilityTransferFederalBase,
      disabilityTransferOutOntarioBase: plan.disabilityTransferOntarioBase,
    };
    taxpayerOverrides.credits = {
      ...(taxpayerOverrides.credits ?? {}),
      disabilityTransferInFederalBase: plan.disabilityTransferFederalBase,
      disabilityTransferInOntarioBase: plan.disabilityTransferOntarioBase,
    };
  }

  return {
    taxpayer,
    spouse,
    taxpayerOverrides,
    spouseOverrides,
  };
}

function cloneOverrides(overrides: CalculationOverrides): CalculationOverrides {
  return {
    benefits: overrides.benefits ? { ...overrides.benefits } : undefined,
    credits: overrides.credits ? { ...overrides.credits } : undefined,
  };
}

function constrainTransfersToUnused(
  plan: OptimizationPlan,
  ctx: OptimizationContext,
  prepared: PreparedInputs,
  taxpayerResult: ReturnResult,
  spouseResult: ReturnResult
): OptimizationPlan {
  const adjusted: OptimizationPlan = {
    ...plan,
    disabilityTransferFederalBase: round2(plan.disabilityTransferFederalBase),
    disabilityTransferOntarioBase: round2(plan.disabilityTransferOntarioBase),
    tuitionTransferFromTaxpayer: round2(plan.tuitionTransferFromTaxpayer),
    tuitionTransferFromSpouse: round2(plan.tuitionTransferFromSpouse),
  };

  const taxpayerCaps = computeTransferBaseCaps(prepared.taxpayer, taxpayerResult);
  const spouseCaps = computeTransferBaseCaps(prepared.spouse, spouseResult);

  const requestedTuitionNet = adjusted.tuitionTransferFromSpouse - adjusted.tuitionTransferFromTaxpayer;
  if (requestedTuitionNet > 0) {
    const cap = Math.min(ctx.tuitionTransferCap, spouseCaps.tuition);
    adjusted.tuitionTransferFromSpouse = round2(Math.min(requestedTuitionNet, cap));
    adjusted.tuitionTransferFromTaxpayer = 0;
  } else if (requestedTuitionNet < 0) {
    const cap = Math.min(ctx.tuitionTransferCap, taxpayerCaps.tuition);
    adjusted.tuitionTransferFromTaxpayer = round2(Math.min(-requestedTuitionNet, cap));
    adjusted.tuitionTransferFromSpouse = 0;
  } else {
    adjusted.tuitionTransferFromTaxpayer = 0;
    adjusted.tuitionTransferFromSpouse = 0;
  }

  if (adjusted.disabilityTransferFrom === 'taxpayer') {
    adjusted.disabilityTransferFederalBase = round2(
      Math.min(adjusted.disabilityTransferFederalBase, taxpayerCaps.disabilityFederal)
    );
    adjusted.disabilityTransferOntarioBase = round2(
      Math.min(adjusted.disabilityTransferOntarioBase, taxpayerCaps.disabilityOntario)
    );
  } else if (adjusted.disabilityTransferFrom === 'spouse') {
    adjusted.disabilityTransferFederalBase = round2(
      Math.min(adjusted.disabilityTransferFederalBase, spouseCaps.disabilityFederal)
    );
    adjusted.disabilityTransferOntarioBase = round2(
      Math.min(adjusted.disabilityTransferOntarioBase, spouseCaps.disabilityOntario)
    );
  } else {
    adjusted.disabilityTransferFederalBase = 0;
    adjusted.disabilityTransferOntarioBase = 0;
  }

  if (adjusted.disabilityTransferFederalBase <= 0 && adjusted.disabilityTransferOntarioBase <= 0) {
    adjusted.disabilityTransferFrom = null;
    adjusted.disabilityTransferFederalBase = 0;
    adjusted.disabilityTransferOntarioBase = 0;
  }

  return adjusted;
}

function computeTransferBaseCaps(person: PersonInput, result: ReturnResult): TransferBaseCaps {
  const federalSplit = splitTransferCredits(result.federal);
  const ontarioSplit = splitTransferCredits(result.ontario);

  const federalUnused = computeUnusedTransferBases(result.federal, federalSplit, taxConfig.federal.lowestRate);
  const ontarioUnused = computeUnusedTransferBases(result.ontario, ontarioSplit, taxConfig.ontario.lowestRate);

  const tuitionCaps = [person.credits.tuitionFees, federalUnused.tuitionBase];
  // Ontario transfer of tuition credits only applies if an Ontario tuition credit exists in the model.
  if (ontarioSplit.tuition > 0) tuitionCaps.push(ontarioUnused.tuitionBase);
  const tuition = round2(Math.max(0, Math.min(...tuitionCaps)));

  const disabilityFederal = person.credits.hasDisabilityDTC
    ? round2(Math.max(0, Math.min(taxConfig.federal.disabilityAmount, federalUnused.disabilityBase)))
    : 0;
  const disabilityOntario = person.credits.hasDisabilityDTC
    ? round2(Math.max(0, Math.min(taxConfig.ontario.disabilityAmount, ontarioUnused.disabilityBase)))
    : 0;

  return { tuition, disabilityFederal, disabilityOntario };
}

function computeUnusedTransferBases(
  breakdown: ReturnResult['federal'],
  split: TransferCreditSplit,
  lowestRate: number
): { tuitionBase: number; disabilityBase: number } {
  const taxNeedAfterOtherCredits = Math.max(0, breakdown.taxBeforeCredits - split.other);
  const disabilityUsed = Math.min(split.disability, taxNeedAfterOtherCredits);
  const disabilityUnused = Math.max(0, split.disability - disabilityUsed);
  const taxNeedAfterDisability = Math.max(0, taxNeedAfterOtherCredits - disabilityUsed);
  const tuitionUsed = Math.min(split.tuition, taxNeedAfterDisability);
  const tuitionUnused = Math.max(0, split.tuition - tuitionUsed);

  const tuitionBase = lowestRate > 0 ? round2(tuitionUnused / lowestRate) : 0;
  const disabilityBase = lowestRate > 0 ? round2(disabilityUnused / lowestRate) : 0;
  return { tuitionBase, disabilityBase };
}

function splitTransferCredits(breakdown: ReturnResult['federal']): TransferCreditSplit {
  let tuition = 0;
  let disability = 0;

  for (const credit of breakdown.creditsApplied) {
    const key = normalizeKey(credit.name);
    if (key.includes('tuition')) tuition += credit.amount;
    else if (key.includes('disability amount')) disability += credit.amount;
  }

  const other = Math.max(0, round2(breakdown.nonRefundableCreditsTotal - tuition - disability));
  return { tuition: round2(tuition), disability: round2(disability), other };
}

function normalizePlan(plan: OptimizationPlan, ctx: OptimizationContext): OptimizationPlan {
  const maxTaxpayerToSpouse = Math.min(ctx.taxpayerBase.credits.tuitionFees, ctx.tuitionTransferCap);
  const maxSpouseToTaxpayer = Math.min(ctx.spouseBase.credits.tuitionFees, ctx.tuitionTransferCap);
  const rawNet = plan.tuitionTransferFromSpouse - plan.tuitionTransferFromTaxpayer;
  let tuitionTransferFromTaxpayer = 0;
  let tuitionTransferFromSpouse = 0;

  if (rawNet > 0) {
    tuitionTransferFromSpouse = round2(Math.min(rawNet, maxSpouseToTaxpayer));
  } else if (rawNet < 0) {
    tuitionTransferFromTaxpayer = round2(Math.min(-rawNet, maxTaxpayerToSpouse));
  }

  let disabilityTransferFrom: Claimant = plan.disabilityTransferFrom;
  let disabilityTransferFederalBase = round2(Math.max(0, plan.disabilityTransferFederalBase));
  let disabilityTransferOntarioBase = round2(Math.max(0, plan.disabilityTransferOntarioBase));

  if (disabilityTransferFederalBase <= 0 && disabilityTransferOntarioBase <= 0) {
    disabilityTransferFrom = null;
    disabilityTransferFederalBase = 0;
    disabilityTransferOntarioBase = 0;
  }

  return {
    donationsClaimant: plan.donationsClaimant,
    childCareClaimant: plan.childCareClaimant,
    benefitClaimant: plan.benefitClaimant,
    cwbClaimant: plan.cwbClaimant,
    personalAmountClaimant: plan.personalAmountClaimant,
    disabilityTransferFrom,
    disabilityTransferFederalBase,
    disabilityTransferOntarioBase,
    tuitionTransferFromTaxpayer,
    tuitionTransferFromSpouse,
  };
}

function isBetter(candidate: Evaluation, current: Evaluation): boolean {
  const delta = candidate.score - current.score;
  if (delta > 0.005) return true;
  if (Math.abs(delta) <= 0.005) {
    return planComplexity(candidate.plan) + 0.001 < planComplexity(current.plan);
  }
  return false;
}

function planComplexity(plan: OptimizationPlan): number {
  const claimantCount =
    (plan.donationsClaimant ? 1 : 0) +
    (plan.childCareClaimant ? 1 : 0) +
    (plan.benefitClaimant ? 1 : 0) +
    (plan.cwbClaimant ? 1 : 0) +
    (plan.personalAmountClaimant ? 1 : 0) +
    (plan.disabilityTransferFrom ? 1 : 0);
  return (
    claimantCount * 0.01 +
    Math.abs(plan.tuitionTransferFromSpouse - plan.tuitionTransferFromTaxpayer) +
    plan.disabilityTransferFederalBase +
    plan.disabilityTransferOntarioBase
  );
}

function planKey(plan: OptimizationPlan): string {
  return [
    plan.donationsClaimant ?? 'null',
    plan.childCareClaimant ?? 'null',
    plan.benefitClaimant ?? 'null',
    plan.cwbClaimant ?? 'null',
    plan.personalAmountClaimant ?? 'null',
    plan.disabilityTransferFrom ?? 'null',
    plan.disabilityTransferFederalBase.toFixed(2),
    plan.disabilityTransferOntarioBase.toFixed(2),
    plan.tuitionTransferFromTaxpayer.toFixed(2),
    plan.tuitionTransferFromSpouse.toFixed(2),
  ].join('|');
}

function generateAmountCandidates(max: number): number[] {
  if (max <= 0) return [0];
  const step = max <= 1000 ? 50 : max <= 5000 ? 100 : max <= 20000 ? 250 : 500;
  const out = new Set<number>([0, round2(max)]);
  for (let amount = step; amount < max; amount += step) {
    out.add(round2(amount));
  }
  return [...out].sort((a, b) => a - b);
}

function resolveTuitionTransferCap(req: CalculateRequest): number {
  const configuredCap = req.household.tuitionTransferAmount ?? 0;
  const maxAvailable = req.taxpayer.credits.tuitionFees + (req.spouse?.credits.tuitionFees ?? 0);
  if (configuredCap > 0) return Math.min(configuredCap, TUITION_TRANSFER_MAX, maxAvailable);
  return Math.min(TUITION_TRANSFER_MAX, maxAvailable);
}

function normalizePerson(person: PersonInput): PersonInput {
  return {
    ...person,
    deductions: {
      ...person.deductions,
      fhsaContributions: person.deductions.fhsaContributions ?? 0,
    },
  };
}

function clonePerson(person: PersonInput): PersonInput {
  return {
    age: person.age,
    province: person.province,
    income: { ...person.income },
    deductions: { ...person.deductions },
    credits: { ...person.credits },
    benefits: { ...person.benefits },
    taxesWithheld: person.taxesWithheld,
  };
}

function buildUserContext(person: PersonInput, maritalStatus: HouseholdSettings['maritalStatus']): UserContext {
  return {
    age: person.age,
    maritalStatus,
    spouseNetIncome: 0,
    income: person.income,
    deductions: {
      ...person.deductions,
      fhsaContributions: person.deductions.fhsaContributions ?? 0,
    },
    credits: person.credits,
    benefits: person.benefits,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

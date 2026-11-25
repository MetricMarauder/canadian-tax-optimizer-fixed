import { DEFAULT_YEAR, getConfig, getProvince, type ProvinceConfig, type TaxYearConfig } from '@/lib/tax/config';
import { provincialBpa, provincialSpouseAmountBase } from '@/lib/tax/provincial';
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
import { EXCEL_PATH, buildContext, calculateTax, calculateTaxFromItems } from '@/lib/tax/calculate';
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
  disabilityTransferProvincialBase: number;
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
  personalAmountProvincialCredit: number;
  score: number;
};

type OptimizationContext = {
  year: number;
  housing: UserContext['housing'];
  cfg: TaxYearConfig;
  prov: ProvinceConfig;
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
  disabilityProvincial: number;
};

const TUITION_TRANSFER_MAX = 5000;
const FEDERAL_SPOUSAL_CREDIT_NAME = 'Spouse or common-law partner amount (line 30300)';


export function combineHousehold(taxpayer: ReturnResult, spouse?: ReturnResult) {
  const taxesWithheldTotal = round2(taxpayer.taxesWithheld + (spouse?.taxesWithheld ?? 0));
  const taxPayableTotal = round2(taxpayer.taxPayableTotal + (spouse?.taxPayableTotal ?? 0));
  const refundableCreditsAndBenefitsTotal =
    round2(taxpayer.refundableCreditsAndBenefitsTotal + (spouse?.refundableCreditsAndBenefitsTotal ?? 0));

  // refund/owing = withheld - payable + refundable/benefits
  const refundOrOwing = round2(taxesWithheldTotal - taxPayableTotal + refundableCreditsAndBenefitsTotal);
  const benefitsPaidSeparatelyTotal = round2(
    taxpayer.benefitsPaidSeparatelyTotal + (spouse?.benefitsPaidSeparatelyTotal ?? 0)
  );

  return {
    refundOrOwing,
    taxesWithheldTotal,
    taxPayableTotal,
    refundableCreditsAndBenefitsTotal,
    benefitsPaidSeparatelyTotal,
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
  const year = req.year ?? DEFAULT_YEAR;
  const cfg = getConfig(year);
  const province = req.province;
  const taxpayerInput = { ...req.taxpayer, province };
  const housing = {
    rentPaid: req.household.rentPaid ?? 0,
    propertyTaxPaid: req.household.propertyTaxPaid ?? 0,
    northernOntario: req.household.northernOntario ?? false,
  };
  if (!req.spouse || req.household.maritalStatus === 'single') {
    const taxpayer = calculateTaxFromItems(taxpayerInput, req.household.maritalStatus, 0, items, { year, housing });
    return {
      year,
      province,
      household: combineHousehold(taxpayer),
      taxpayer,
    };
  }

  const ctx: OptimizationContext = {
    year,
    housing,
    cfg,
    prov: getProvince(cfg, province),
    maritalStatus: req.household.maritalStatus,
    taxpayerBase: normalizePerson(taxpayerInput),
    spouseBase: normalizePerson({ ...req.spouse, province }),
    items,
    tuitionTransferCap: resolveTuitionTransferCap(req),
    cache: new Map<string, Evaluation>(),
  };

  const totalChildCareExpenses =
    ctx.taxpayerBase.deductions.childCareExpenses + ctx.spouseBase.deductions.childCareExpenses;
  const initialPlan: OptimizationPlan = {
    donationsClaimant: null,
    // CRA rule: the spouse with the lower net income generally must claim child care expenses
    // (exceptions such as full-time school, incarceration or infirmity are not modelled).
    childCareClaimant: totalChildCareExpenses > 0 ? lowerNetIncomeSpouse(ctx) : null,
    benefitClaimant: req.household.claimant,
    cwbClaimant: req.household.claimant,
    personalAmountClaimant: req.household.claimant,
    disabilityTransferFrom: null,
    disabilityTransferFederalBase: 0,
    disabilityTransferProvincialBase: 0,
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
  const tuitionFederalCreditTransferred = round2(tuitionTransferAmount * cfg.federal.lowestRate);
  // Provincial tuition credits are not modelled (Ontario's was eliminated in 2017), so nothing transfers provincially.
  const tuitionProvincialCreditTransferred = 0;
  const taxpayer = annotateReturnWithTransfers(best.taxpayer, best.plan, 'taxpayer');
  const spouse = annotateReturnWithTransfers(best.spouse, best.plan, 'spouse');

  return {
    year,
    province,
    household: best.household,
    taxpayer,
    spouse,
    transferSummary: {
      tuitionTransferAmount,
      tuitionFederalCreditTransferred,
      tuitionProvincialCreditTransferred,
      tuitionTransferFromTaxpayer: best.plan.tuitionTransferFromTaxpayer,
      tuitionTransferFromSpouse: best.plan.tuitionTransferFromSpouse,
      tuitionNetTo: tuitionNet > 0 ? 'taxpayer' : tuitionNet < 0 ? 'spouse' : null,
      tuitionNetAmount: tuitionTransferAmount,
      personalAmountClaimant:
        best.personalAmountFederalCredit > 0 || best.personalAmountProvincialCredit > 0
          ? best.personalAmountClaimant
          : null,
      personalAmountFederalCredit: best.personalAmountFederalCredit,
      personalAmountProvincialCredit: best.personalAmountProvincialCredit,
      donationsClaimant: totalDonations > 0 ? best.plan.donationsClaimant : null,
      childCareClaimant: totalChildCare > 0 ? best.plan.childCareClaimant : null,
      disabilityTransferFrom:
        best.plan.disabilityTransferFederalBase > 0 || best.plan.disabilityTransferProvincialBase > 0
          ? best.plan.disabilityTransferFrom
          : null,
      disabilityTransferFederalBase: best.plan.disabilityTransferFederalBase,
      disabilityTransferProvincialBase: best.plan.disabilityTransferProvincialBase,
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
  const disabilityInProvincial =
    plan.disabilityTransferFrom &&
    ((plan.disabilityTransferFrom === 'taxpayer' && role === 'spouse') ||
      (plan.disabilityTransferFrom === 'spouse' && role === 'taxpayer'))
      ? plan.disabilityTransferProvincialBase
      : 0;
  const disabilityOutFederal =
    plan.disabilityTransferFrom === role ? plan.disabilityTransferFederalBase : 0;
  const disabilityOutProvincial =
    plan.disabilityTransferFrom === role ? plan.disabilityTransferProvincialBase : 0;

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
    provincial: {
      ...result.provincial,
      creditsApplied: annotateCredits(result.provincial.creditsApplied, {
        tuitionIn: transferIn,
        tuitionOut: transferOut,
        disabilityIn: disabilityInProvincial,
        disabilityOut: disabilityOutProvincial,
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

type SpousalAmount = {
  claimant: Claimant;
  federalCredit: number;
  provincialCredit: number;
};

/**
 * Spouse or common-law partner amount (federal line 30300 / provincial equivalent), claimed by
 * `requestedClaimant` based on the other spouse's net income.
 */
function computeSpousalAmount(
  ctx: OptimizationContext,
  requestedClaimant: Claimant,
  taxpayerNetIncome: number,
  spouseNetIncome: number
): SpousalAmount {
  if (ctx.maritalStatus === 'single' || !requestedClaimant) {
    return { claimant: null, federalCredit: 0, provincialCredit: 0 };
  }
  const credits =
    requestedClaimant === 'taxpayer'
      ? computeSpousalPersonalAmountCredits(ctx, taxpayerNetIncome, spouseNetIncome)
      : computeSpousalPersonalAmountCredits(ctx, spouseNetIncome, taxpayerNetIncome);
  if (credits.federal <= 0 && credits.provincial <= 0) {
    return { claimant: null, federalCredit: 0, provincialCredit: 0 };
  }
  return { claimant: requestedClaimant, federalCredit: credits.federal, provincialCredit: credits.provincial };
}

function spousalExtraCredits(
  ctx: OptimizationContext,
  amount: SpousalAmount,
  role: 'taxpayer' | 'spouse'
): CalculationOverrides['extraCredits'] {
  if (amount.claimant !== role) return undefined;
  const from = role === 'taxpayer' ? 'spouse' : 'taxpayer';
  return {
    federal:
      amount.federalCredit > 0
        ? [
            {
              name: `${FEDERAL_SPOUSAL_CREDIT_NAME} (based on ${from}'s net income)`,
              amount: amount.federalCredit,
              jurisdiction: 'Federal',
              lineForm: 'Line 30300',
            },
          ]
        : [],
    provincial:
      amount.provincialCredit > 0
        ? [
            {
              name: `Spouse or common-law partner amount (${ctx.prov.name}, based on ${from}'s net income)`,
              amount: amount.provincialCredit,
              jurisdiction: ctx.prov.name,
            },
          ]
        : [],
  };
}

function computeSpousalPersonalAmountCredits(
  ctx: OptimizationContext,
  claimantNetIncome: number,
  spouseNetIncome: number
): { federal: number; provincial: number } {
  const claimantFederalBase = federalBasicPersonalAmountBase(ctx.cfg, claimantNetIncome);
  const donorNetIncome = Math.max(0, spouseNetIncome);
  const federalBase = Math.max(0, claimantFederalBase - donorNetIncome);
  const provincialBase = provincialSpouseAmountBase(ctx.cfg, ctx.prov, claimantNetIncome, donorNetIncome);

  return {
    federal: round2(federalBase * ctx.cfg.federal.lowestRate),
    provincial: round2(provincialBase * ctx.prov.lowestRate),
  };
}

function federalBasicPersonalAmountBase(cfg: TaxYearConfig, netIncome: number): number {
  const b = cfg.federal.basicPersonalAmount;
  const income = Math.max(0, netIncome);
  if (income >= b.phaseoutEnd) return b.min;
  if (income <= b.phaseoutStart) return b.base;
  const frac = (income - b.phaseoutStart) / (b.phaseoutEnd - b.phaseoutStart);
  return round2(b.base - frac * (b.base - b.min));
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
      disabilityTransferProvincialBase: 0,
    },
  ];
  const ratios = [0.25, 0.5, 0.75, 1];

  if (ctx.taxpayerBase.credits.hasDisabilityDTC) {
    for (const ratio of ratios) {
      out.push({
        ...plan,
        disabilityTransferFrom: 'taxpayer',
        disabilityTransferFederalBase: round2(ctx.cfg.federal.disabilityAmount * ratio),
        disabilityTransferProvincialBase: round2(ctx.prov.disabilityAmount * ratio),
      });
    }
  }

  if (ctx.spouseBase.credits.hasDisabilityDTC) {
    for (const ratio of ratios) {
      out.push({
        ...plan,
        disabilityTransferFrom: 'spouse',
        disabilityTransferFederalBase: round2(ctx.cfg.federal.disabilityAmount * ratio),
        disabilityTransferProvincialBase: round2(ctx.prov.disabilityAmount * ratio),
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

  const taxpayerNetIncome = estimateNetIncome(buildUserContext(ctx, basePrepared.taxpayer));
  const spouseNetIncome = estimateNetIncome(buildUserContext(ctx, basePrepared.spouse));
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
  const spousal = computeSpousalAmount(
    ctx,
    normalized.personalAmountClaimant,
    taxpayerNetIncome,
    spouseNetIncome
  );
  const taxpayer = calculateTaxFromItems(
    prepared.taxpayer,
    ctx.maritalStatus,
    taxpayerSpouseNetIncome,
    ctx.items,
    { ...prepared.taxpayerOverrides, extraCredits: spousalExtraCredits(ctx, spousal, 'taxpayer') }
  );
  const spouse = calculateTaxFromItems(
    prepared.spouse,
    ctx.maritalStatus,
    spouseSpouseNetIncome,
    ctx.items,
    { ...prepared.spouseOverrides, extraCredits: spousalExtraCredits(ctx, spousal, 'spouse') }
  );
  const household = combineHousehold(taxpayer, spouse);

  const evaluated: Evaluation = {
    plan: normalized,
    taxpayer,
    spouse,
    household,
    personalAmountClaimant: spousal.claimant,
    personalAmountFederalCredit: spousal.federalCredit,
    personalAmountProvincialCredit: spousal.provincialCredit,
    // Household cash outcome: refund on the returns plus benefits CRA pays separately.
    score: round2(household.refundOrOwing + household.benefitsPaidSeparatelyTotal),
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

  const totalDependants =
    ctx.taxpayerBase.deductions.numChildrenUnder7 +
    ctx.taxpayerBase.deductions.numChildren7to16 +
    ctx.taxpayerBase.deductions.numChildrenDTCEligible +
    ctx.spouseBase.deductions.numChildrenUnder7 +
    ctx.spouseBase.deductions.numChildren7to16 +
    ctx.spouseBase.deductions.numChildrenDTCEligible;
  const higherIncome = higherNetIncomeSpouse(ctx);

  const taxpayerOverrides: CalculationOverrides = {
    benefits: {
      claimHouseholdBenefits: taxpayerClaimsBenefits,
      // CARE goes with the child care deduction (claimed by whoever deducts the expenses).
      claimCareCredit: true,
      cwbClaimBasic: taxpayerClaimsCwb,
      cwbClaimDisability: taxpayerClaimsCwb,
      cwbDisabilityBothEligible: bothDisabilityCwbEligible,
    },
    credits: {},
    year: ctx.year,
    spouseEmploymentIncome: spouse.income.employment,
    // Rent/property-tax based credits are claimed once, by the spouse who claims household benefits.
    housing: taxpayerClaimsBenefits ? ctx.housing : undefined,
    // Provincial low-income tax reduction: dependants are claimed by the higher-income spouse.
    taxReductionDependants: higherIncome === 'taxpayer' ? totalDependants : 0,
  };

  const spouseOverrides: CalculationOverrides = {
    benefits: {
      claimHouseholdBenefits: spouseClaimsBenefits,
      claimCareCredit: true,
      cwbClaimBasic: spouseClaimsCwb,
      cwbClaimDisability: spouseClaimsCwb,
      cwbDisabilityBothEligible: bothDisabilityCwbEligible,
    },
    credits: {},
    year: ctx.year,
    spouseEmploymentIncome: taxpayer.income.employment,
    housing: spouseClaimsBenefits ? ctx.housing : undefined,
    taxReductionDependants: higherIncome === 'spouse' ? totalDependants : 0,
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
      disabilityTransferOutProvincialBase: plan.disabilityTransferProvincialBase,
    };
    spouseOverrides.credits = {
      ...(spouseOverrides.credits ?? {}),
      disabilityTransferInFederalBase: plan.disabilityTransferFederalBase,
      disabilityTransferInProvincialBase: plan.disabilityTransferProvincialBase,
    };
  } else if (plan.disabilityTransferFrom === 'spouse') {
    spouseOverrides.credits = {
      ...(spouseOverrides.credits ?? {}),
      disabilityTransferOutFederalBase: plan.disabilityTransferFederalBase,
      disabilityTransferOutProvincialBase: plan.disabilityTransferProvincialBase,
    };
    taxpayerOverrides.credits = {
      ...(taxpayerOverrides.credits ?? {}),
      disabilityTransferInFederalBase: plan.disabilityTransferFederalBase,
      disabilityTransferInProvincialBase: plan.disabilityTransferProvincialBase,
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
    ...overrides,
    benefits: overrides.benefits ? { ...overrides.benefits } : undefined,
    credits: overrides.credits ? { ...overrides.credits } : undefined,
  };
}

/** Net income before child care expenses, used to decide which spouse must claim them. */
function netIncomeBeforeChildCare(octx: OptimizationContext, person: PersonInput): number {
  const ctx = buildUserContext(octx, person);
  return estimateNetIncome({ ...ctx, deductions: { ...ctx.deductions, childCareExpenses: 0 } });
}

function lowerNetIncomeSpouse(ctx: OptimizationContext): 'taxpayer' | 'spouse' {
  const t = netIncomeBeforeChildCare(ctx, ctx.taxpayerBase);
  const s = netIncomeBeforeChildCare(ctx, ctx.spouseBase);
  return s < t ? 'spouse' : 'taxpayer';
}

function higherNetIncomeSpouse(ctx: OptimizationContext): 'taxpayer' | 'spouse' {
  return lowerNetIncomeSpouse(ctx) === 'taxpayer' ? 'spouse' : 'taxpayer';
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
    disabilityTransferProvincialBase: round2(plan.disabilityTransferProvincialBase),
    tuitionTransferFromTaxpayer: round2(plan.tuitionTransferFromTaxpayer),
    tuitionTransferFromSpouse: round2(plan.tuitionTransferFromSpouse),
  };

  const taxpayerCaps = computeTransferBaseCaps(ctx, prepared.taxpayer, taxpayerResult);
  const spouseCaps = computeTransferBaseCaps(ctx, prepared.spouse, spouseResult);

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
    adjusted.disabilityTransferProvincialBase = round2(
      Math.min(adjusted.disabilityTransferProvincialBase, taxpayerCaps.disabilityProvincial)
    );
  } else if (adjusted.disabilityTransferFrom === 'spouse') {
    adjusted.disabilityTransferFederalBase = round2(
      Math.min(adjusted.disabilityTransferFederalBase, spouseCaps.disabilityFederal)
    );
    adjusted.disabilityTransferProvincialBase = round2(
      Math.min(adjusted.disabilityTransferProvincialBase, spouseCaps.disabilityProvincial)
    );
  } else {
    adjusted.disabilityTransferFederalBase = 0;
    adjusted.disabilityTransferProvincialBase = 0;
  }

  if (adjusted.disabilityTransferFederalBase <= 0 && adjusted.disabilityTransferProvincialBase <= 0) {
    adjusted.disabilityTransferFrom = null;
    adjusted.disabilityTransferFederalBase = 0;
    adjusted.disabilityTransferProvincialBase = 0;
  }

  return adjusted;
}

function computeTransferBaseCaps(ctx: OptimizationContext, person: PersonInput, result: ReturnResult): TransferBaseCaps {
  const federalSplit = splitTransferCredits(result.federal);
  const provincialSplit = splitTransferCredits(result.provincial);

  const federalUnused = computeUnusedTransferBases(result.federal, federalSplit, ctx.cfg.federal.lowestRate);
  const provincialUnused = computeUnusedTransferBases(result.provincial, provincialSplit, ctx.prov.lowestRate);

  const tuitionCaps = [person.credits.tuitionFees, federalUnused.tuitionBase];
  // A provincial tuition transfer only applies if a provincial tuition credit exists in the model.
  if (provincialSplit.tuition > 0) tuitionCaps.push(provincialUnused.tuitionBase);
  const tuition = round2(Math.max(0, Math.min(...tuitionCaps)));

  const disabilityFederal = person.credits.hasDisabilityDTC
    ? round2(Math.max(0, Math.min(ctx.cfg.federal.disabilityAmount, federalUnused.disabilityBase)))
    : 0;
  const disabilityProvincial = person.credits.hasDisabilityDTC
    ? round2(Math.max(0, Math.min(ctx.prov.disabilityAmount, provincialUnused.disabilityBase)))
    : 0;

  return { tuition, disabilityFederal, disabilityProvincial };
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
  let disabilityTransferProvincialBase = round2(Math.max(0, plan.disabilityTransferProvincialBase));

  if (disabilityTransferFederalBase <= 0 && disabilityTransferProvincialBase <= 0) {
    disabilityTransferFrom = null;
    disabilityTransferFederalBase = 0;
    disabilityTransferProvincialBase = 0;
  }

  return {
    donationsClaimant: plan.donationsClaimant,
    childCareClaimant: plan.childCareClaimant,
    benefitClaimant: plan.benefitClaimant,
    cwbClaimant: plan.cwbClaimant,
    personalAmountClaimant: plan.personalAmountClaimant,
    disabilityTransferFrom,
    disabilityTransferFederalBase,
    disabilityTransferProvincialBase,
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
    plan.disabilityTransferProvincialBase
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
    plan.disabilityTransferProvincialBase.toFixed(2),
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

function buildUserContext(ctx: OptimizationContext, person: PersonInput): UserContext {
  return buildContext(person, ctx.maritalStatus, 0, { year: ctx.year });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

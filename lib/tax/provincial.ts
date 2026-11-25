import type { AppliedItem } from '@/lib/api/types';
import type { UserContext } from '@/lib/rules/types';
import type { BenefitConfig, ProvinceConfig, TaxYearConfig } from '@/lib/tax/config';
import { taxFromBrackets } from '@/lib/tax/brackets';
import {
  formatPct,
  healthPremium,
  ontarioTaxReduction,
  provincialSurtax,
  round2,
  type PayrollContributions,
} from '@/lib/tax/income';

/**
 * Generic provincial/territorial tax calculation driven by `config.provinces[code]`.
 * Quebec is handled in a simplified way (see `quebec` notes in the config).
 */

export type ProvincialInputs = {
  ctx: UserContext;
  prov: ProvinceConfig;
  /** Federal taxable income (line 26000). */
  taxableIncome: number;
  /** Individual net income (line 23600). */
  netIncome: number;
  /** Adjusted family net income (self + spouse). */
  afni: number;
  payroll: PayrollContributions;
  grossedUpDividends: number;
  /** Child care deduction claimed on this return (for Ontario CARE). */
  childCareDeduction: number;
  /** Extra provincial credits computed elsewhere (e.g. household spouse amount). */
  extraCredits: AppliedItem[];
  /** Dependants claimed for the provincial low-income tax reduction. */
  taxReductionDependants: number;
};

export type CatalogAnnotation = {
  /** Normalized catalog row name (Ontario rows of the Excel catalog). */
  key: string;
  amount: number;
  reason: string;
};

export type ProvincialResult = {
  taxableIncome: number;
  taxBeforeCredits: number;
  credits: AppliedItem[];
  nonRefundableCreditsTotal: number;
  dividendTaxCredit: number;
  surtax: number;
  taxReduction: number;
  /** Ontario LIFT credit (ON428-A). */
  lift: number;
  healthPremium: number;
  taxPayable: number;
  /** Refundable credits claimed on the return (Ontario CARE, Quebec work premium). */
  refundable: AppliedItem[];
  /** Benefits paid separately after assessment. */
  benefits: AppliedItem[];
  annotations: CatalogAnnotation[];
};

export function computeProvincial(input: ProvincialInputs): ProvincialResult {
  const { ctx, prov, payroll } = input;
  const cfg = ctx.config;
  const rate = prov.lowestRate;
  const name = prov.name;
  const isQuebec = ctx.province === 'QC';
  const isFamily = ctx.maritalStatus !== 'single';
  const kids = childrenCount(ctx);
  const credits: AppliedItem[] = [];
  const annotations: CatalogAnnotation[] = [];

  const push = (label: string, amount: number, lineForm?: string, key?: string, reason?: string) => {
    const rounded = round2(amount);
    if (rounded > 0) credits.push({ name: label, amount: rounded, lineForm, jurisdiction: name });
    if (key) annotations.push({ key, amount: rounded, reason: reason ?? label });
  };

  // --- Quebec: deduction for workers reduces Quebec taxable income ------------------------
  let taxableIncome = input.taxableIncome;
  if (isQuebec && prov.quebec) {
    const q = prov.quebec;
    const workerDeduction = Math.min(q.workerDeductionMax, Math.max(0, ctx.income.employment) * q.workerDeductionRate);
    taxableIncome = round2(Math.max(0, taxableIncome - workerDeduction));
  }

  // --- Non-refundable credits -------------------------------------------------------------
  const bpa = provincialBpa(cfg, prov, input.netIncome);
  push(`Basic personal amount (${name})`, bpa * rate, undefined, 'basic personal amount',
    `${name} BPA $${round2(bpa)} × ${formatPct(rate)}.`);

  if (isQuebec && prov.quebec && !isFamily && kids === 0) {
    push('Amount for a person living alone (Quebec, assumed)', prov.quebec.livingAloneAmount * rate);
  }

  if (!isQuebec) {
    push(`CPP contributions (${name}, estimated)`, payroll.cppBase * rate, undefined, 'cpp qpp contributions',
      `Base CPP $${payroll.cppBase} × ${formatPct(rate)} (estimated from employment income).`);
    push(`EI premiums (${name}, estimated)`, payroll.ei * rate, undefined, 'employment insurance premiums',
      `EI premiums $${payroll.ei} × ${formatPct(rate)} (estimated from employment income).`);
  }

  if (prov.canadaEmploymentAmount) {
    push(`Canada employment amount (${name})`, Math.min(prov.canadaEmploymentAmount, Math.max(0, ctx.income.employment)) * rate);
  }

  // Disability amount (with spousal transfer of the unused part).
  if (prov.disabilityAmount > 0) {
    const selfBase = ctx.credits.hasDisabilityDTC ? prov.disabilityAmount : 0;
    const out = Math.max(0, Math.min(selfBase, ctx.credits.disabilityTransferOutProvincialBase ?? 0));
    const inn = Math.max(0, ctx.credits.disabilityTransferInProvincialBase ?? 0);
    const base = Math.max(0, selfBase - out) + inn;
    push(`Disability amount (${name})`, base * rate, undefined, 'disability amount for self',
      `${name} disability amount base $${round2(base)} × ${formatPct(rate)}.`);
  }

  // Donations.
  const donations = Math.max(0, ctx.credits.donations);
  if (donations > 0) {
    const d = prov.donationCredit;
    const first = Math.min(200, donations);
    const rest = Math.max(0, donations - 200);
    const atTop =
      d.topRate && d.topRateIncomeThreshold
        ? Math.min(rest, Math.max(0, taxableIncome - d.topRateIncomeThreshold))
        : 0;
    const credit = first * d.first200Rate + atTop * (d.topRate ?? d.over200Rate) + (rest - atTop) * d.over200Rate;
    push(`Donations and gifts (${name})`, credit, undefined, 'donations and gifts', `${name} donation credit.`);
  } else {
    annotations.push({ key: 'donations and gifts', amount: 0, reason: 'No donations entered.' });
  }

  for (const extra of input.extraCredits) {
    credits.push(extra);
    if (/spouse/i.test(extra.name)) {
      annotations.push({ key: 'spouse or common law partner amount', amount: extra.amount, reason: extra.name });
    }
  }

  const dividendTaxCredit = round2(input.grossedUpDividends * prov.dividendTaxCreditRate);
  push(`Dividend tax credit (${name})`, dividendTaxCredit, undefined, 'ontario dividend tax credit',
    `Grossed-up eligible dividends $${input.grossedUpDividends} × ${formatPct(prov.dividendTaxCreditRate)}.`);

  // --- Tax ----------------------------------------------------------------------------------
  const taxBeforeCredits = taxFromBrackets(taxableIncome, prov.brackets);
  const nonRefundableCreditsTotal = round2(credits.reduce((a, c) => a + c.amount, 0));
  const basicTax = Math.max(0, round2(taxBeforeCredits - nonRefundableCreditsTotal));
  const surtax = provincialSurtax(prov, basicTax);
  const taxBeforeReduction = round2(basicTax + surtax);

  let taxReduction = 0;
  const tr = prov.taxReduction;
  if (tr?.type === 'ontario') {
    taxReduction = ontarioTaxReduction(tr.basic, tr.perDependant, taxBeforeReduction, input.taxReductionDependants);
    annotations.push({
      key: 'ontario tax reduction',
      amount: taxReduction,
      reason: `2 × ($${tr.basic} + ${input.taxReductionDependants} × $${tr.perDependant}) − Ontario tax $${taxBeforeReduction}.`,
    });
  } else if (tr?.type === 'linear') {
    const income = tr.incomeBasis === 'family' ? input.afni : input.netIncome;
    const hasSpouseOrDependant = isFamily || kids > 0;
    const maxAmount =
      tr.basic + (hasSpouseOrDependant ? tr.spouse ?? 0 : 0) + (tr.perChild ?? 0) * input.taxReductionDependants;
    const amount = Math.max(0, maxAmount - Math.max(0, income - tr.threshold) * tr.rate);
    taxReduction = round2(Math.min(amount, taxBeforeReduction));
  }

  // Ontario LIFT credit: reduces Ontario tax (not the Health Premium) after the tax reduction.
  let lift = 0;
  if (prov.lift) {
    const l = prov.lift;
    const maxLift = Math.min(l.max, Math.max(0, ctx.income.employment) * l.employmentRate);
    const excess = Math.max(
      Math.max(0, input.netIncome - l.individualThreshold),
      isFamily ? Math.max(0, input.afni - l.familyThreshold) : 0
    );
    lift = round2(Math.min(Math.max(0, maxLift - excess * l.rate), Math.max(0, taxBeforeReduction - taxReduction)));
    annotations.push({
      key: 'low income individuals and families tax credit',
      amount: lift,
      reason: `LIFT: lesser of $${l.max} and ${formatPct(l.employmentRate)} of employment income, less ${formatPct(l.rate)} of income over $${l.individualThreshold} (family $${l.familyThreshold}).`,
    });
  }

  const premium = healthPremium(prov, taxableIncome);
  const taxPayable = round2(taxBeforeReduction - taxReduction - lift + premium);

  // --- Refundable credits & benefits ---------------------------------------------------------
  const refundable: AppliedItem[] = [];
  const benefits: AppliedItem[] = [];
  const env: BenefitEnv = {
    ctx,
    afni: input.afni,
    kids,
    isFamily,
    familyEmployment: Math.max(0, ctx.income.employment) + Math.max(0, ctx.spouseEmploymentIncome ?? 0),
    childCareDeduction: input.childCareDeduction,
    housing: ctx.housing ?? { rentPaid: 0, propertyTaxPaid: 0, northernOntario: false },
  };
  const claimsHousehold = ctx.benefits.includeBenefitsEstimates && ctx.benefits.claimHouseholdBenefits !== false;

  for (const b of prov.benefits) {
    const calc = BENEFIT_CALCULATORS[b.id];
    if (!calc) continue;
    const catalogKey = CATALOG_KEYS[b.id];
    const skipReason = !ctx.benefits.includeBenefitsEstimates
      ? 'Benefit estimates disabled.'
      : b.onReturn && !b.household
        ? ctx.benefits.claimCareCredit === false
          ? 'Claimed on the spouse return.'
          : null
        : !claimsHousehold
          ? 'Household benefits claimed on the spouse return.'
          : null;
    if (skipReason) {
      if (catalogKey) annotations.push({ key: catalogKey, amount: 0, reason: skipReason });
      continue;
    }
    const amount = round2(Math.max(0, calc(b, env)));
    if (amount > 0) (b.onReturn ? refundable : benefits).push({ name: b.name, amount, jurisdiction: name });
    if (catalogKey) annotations.push({ key: catalogKey, amount, reason: `${b.name} estimate.` });
  }

  if (isQuebec && prov.quebec) {
    if (claimsHousehold) {
      // The work premium is claimed on the return by one spouse for the family.
      const wp = round2(quebecWorkPremium(prov, env));
      if (wp > 0) refundable.push({ name: 'Quebec work premium', amount: wp, jurisdiction: name });
      const sol = round2(quebecSolidarity(prov, env));
      if (sol > 0) benefits.push({ name: 'Quebec solidarity tax credit', amount: sol, jurisdiction: name });
      const fa = round2(quebecFamilyAllowance(prov, env));
      if (fa > 0) benefits.push({ name: 'Quebec family allowance', amount: fa, jurisdiction: name });
    }
  }

  return {
    taxableIncome,
    taxBeforeCredits,
    credits,
    nonRefundableCreditsTotal,
    dividendTaxCredit,
    surtax,
    taxReduction,
    lift,
    healthPremium: premium,
    taxPayable,
    refundable,
    benefits,
    annotations,
  };
}

/** Provincial basic personal amount, including income-tested versions (Manitoba, Yukon). */
export function provincialBpa(cfg: TaxYearConfig, prov: ProvinceConfig, netIncome: number): number {
  const b = prov.basicPersonalAmount;
  const fed = cfg.federal.basicPersonalAmount;
  const conf = 'followsFederal' in b ? fed : b;
  const min = conf.min ?? conf.base;
  if (conf.phaseoutStart === undefined || conf.phaseoutEnd === undefined) return conf.base;
  if (netIncome <= conf.phaseoutStart) return conf.base;
  if (netIncome >= conf.phaseoutEnd) return min;
  const frac = (netIncome - conf.phaseoutStart) / (conf.phaseoutEnd - conf.phaseoutStart);
  return round2(conf.base - frac * (conf.base - min));
}

/** Provincial spouse or common-law partner amount (base, before multiplying by the credit rate). */
export function provincialSpouseAmountBase(
  cfg: TaxYearConfig,
  prov: ProvinceConfig,
  claimantNetIncome: number,
  spouseNetIncome: number
): number {
  const s = prov.spouseAmount;
  const max = s.followsFederal ? provincialBpa(cfg, prov, claimantNetIncome) : s.max;
  if (max <= 0) return 0;
  return Math.min(max, Math.max(0, max + s.threshold - Math.max(0, spouseNetIncome)));
}

function childrenCount(ctx: UserContext): number {
  return Math.max(0, ctx.deductions.numChildrenUnder7 + ctx.deductions.numChildren7to16 + ctx.deductions.numChildrenDTCEligible);
}

/** Benefit ids that correspond to rows in the (Ontario) Excel catalog. */
const CATALOG_KEYS: Record<string, string> = {
  on_care: 'ontario childcare access and relief from expenses tax credit',
  on_ostc: 'ontario sales tax credit',
  on_ocb: 'ontario child benefit',
  on_oeptc: 'ontario energy and property tax credit',
  on_noec: 'northern ontario energy credit',
};

// --- Benefit calculators -----------------------------------------------------------------------

type BenefitEnv = {
  ctx: UserContext;
  afni: number;
  kids: number;
  isFamily: boolean;
  familyEmployment: number;
  childCareDeduction: number;
  housing: { rentPaid: number; propertyTaxPaid: number; northernOntario: boolean };
};

type BenefitCalculator = (b: BenefitConfig, env: BenefitEnv) => number;

const reduce = (amount: number, income: number, threshold: number, rate: number) =>
  Math.max(0, amount - Math.max(0, income - threshold) * rate);

/** 1 below `fullBelow`, 0 at `zeroAt`, linear in between. */
const linearFactor = (income: number, fullBelow: number, zeroAt: number) =>
  income <= fullBelow ? 1 : income >= zeroAt ? 0 : (zeroAt - income) / (zeroAt - fullBelow);

const tieredSum = (amounts: number[], kids: number) => {
  let total = 0;
  for (let i = 0; i < kids; i++) total += amounts[Math.min(i, amounts.length - 1)];
  return total;
};

const BENEFIT_CALCULATORS: Record<string, BenefitCalculator> = {
  on_care: (b, env) => {
    if (env.childCareDeduction <= 0) return 0;
    const row = (b.table as { max: number | null; rate: number }[]).find((r) => r.max === null || env.afni <= r.max);
    return env.childCareDeduction * (row?.rate ?? 0);
  },
  on_ostc: (b, env) => {
    const people = (env.isFamily ? 2 : 1) + env.kids;
    const threshold = !env.isFamily && env.kids === 0 ? b.singleThreshold : b.familyThreshold;
    return reduce(b.perPerson * people, env.afni, threshold, b.rate);
  },
  on_ocb: (b, env) => reduce(b.perChild * env.kids, env.afni, b.threshold, b.rate),
  bc_family: (b, env) => {
    if (env.kids <= 0) return 0;
    const max = tieredSum(b.amounts, env.kids);
    const min = tieredSum(b.minimums, env.kids);
    const afterFirst = Math.max(min, max - Math.max(0, env.afni - b.threshold) * b.rate);
    return reduce(afterFirst, env.afni, b.secondThreshold, b.rate);
  },
  ab_acfb: (b, env) => {
    if (env.kids <= 0) return 0;
    const n = Math.min(env.kids, 4);
    const baseMax = tieredSum(b.base, n);
    const base = baseMax * linearFactor(env.afni, b.baseThreshold, b.workingThreshold);
    const workingMax = tieredSum(b.working, n);
    const phasedIn = Math.min(workingMax, Math.max(0, env.familyEmployment - b.workingPhaseInBase) * b.workingPhaseInRate);
    const working = reduce(phasedIn, env.afni, b.workingThreshold, b.workingReductionRate);
    return base + working;
  },
  sk_litc: (b, env) => {
    const amount = b.adult + (env.isFamily ? b.spouse : 0) + b.perChild * Math.min(env.kids, b.maxChildren);
    return reduce(amount, env.afni, b.threshold, b.rate);
  },
  nb_hstc: (b, env) => reduce(b.adult + (env.isFamily ? b.spouse : 0) + b.perChild * env.kids, env.afni, b.threshold, b.rate),
  ns_altc: (b, env) => reduce(b.adult + b.perChild * env.kids, env.afni, b.threshold, b.rate),
  ns_cb: (b, env) => b.perChild * env.kids * linearFactor(env.afni, b.fullBelow, b.zeroAt),
  pe_ieb: (b, env) => {
    const t = !env.isFamily && env.kids === 0 ? b.single : b.family;
    return t.max - (t.max - t.min) * (1 - linearFactor(env.afni, t.from, t.to));
  },
  pe_cb: (b, env) => {
    const tier = (b.tiers as { below: number; perChild: number }[]).find((t) => env.afni < t.below);
    return tier ? tier.perChild * env.kids : 0;
  },
  nl_is: (b, env) => {
    const phaseIn = Math.min(b.phaseInExtra, Math.max(0, env.afni - b.phaseInBase) * b.phaseInRate);
    const amount = b.basic + phaseIn + (env.isFamily ? b.spouse : 0) + b.perChild * env.kids;
    return reduce(amount, env.afni, b.threshold, b.rate);
  },
  nl_cb: (b, env) => tieredSum(b.amounts, env.kids) * linearFactor(env.afni, b.fullBelow, b.zeroAt),
  yt_cb: (b, env) => {
    if (env.kids <= 0) return 0;
    const rate = env.kids === 1 ? b.rateOneChild : b.rateMoreChildren;
    return reduce(b.perChild * env.kids, env.afni, b.threshold, rate);
  },
  on_oeptc: (b, env) => {
    // Occupancy cost = 20% of rent + property tax. Energy component capped; property tax component
    // = min(10% of occupancy, cap) + add-on, limited to occupancy cost. Reduced by 2% of AFNI over threshold.
    const occupancy = Math.max(0, env.housing.rentPaid) * b.rentShare + Math.max(0, env.housing.propertyTaxPaid);
    if (occupancy <= 0) return 0;
    const energy = Math.min(occupancy, b.energyMax);
    const property = Math.min(occupancy, Math.min(occupancy * b.propertyRate, b.propertyCap) + b.propertyAddOn);
    const threshold = !env.isFamily && env.kids === 0 ? b.singleThreshold : b.familyThreshold;
    return reduce(energy + property, env.afni, threshold, b.rate);
  },
  on_noec: (b, env) => {
    if (!env.housing.northernOntario || env.housing.rentPaid + env.housing.propertyTaxPaid <= 0) return 0;
    const single = !env.isFamily && env.kids === 0;
    return reduce(single ? b.singleMax : b.familyMax, env.afni, single ? b.singleThreshold : b.familyThreshold, b.rate);
  },
  bc_renter: (b, env) => (env.housing.rentPaid > 0 ? reduce(b.max, env.afni, b.threshold, b.rate) : 0),
  mb_ratc: (b, env) => Math.min(b.max, Math.max(0, env.housing.rentPaid) * b.rentShare),
  nb_ctb: (b, env) => {
    if (env.kids <= 0) return 0;
    const basic = reduce(b.perChild * env.kids, env.afni, b.threshold, env.kids === 1 ? b.rateOneChild : b.rateMoreChildren);
    const wisIn = Math.min(b.wisMax, Math.max(0, env.familyEmployment - b.wisPhaseInBase) * b.wisPhaseInRate);
    return basic + wisIn * linearFactor(env.afni, b.wisFrom, b.wisTo);
  },
  nu_cb: (b, env) => {
    if (env.kids <= 0) return 0;
    const worker = env.familyEmployment > b.workerIncomeBase ? (env.kids === 1 ? b.workerOneChild : b.workerMoreChildren) : 0;
    return reduce(b.perChild * env.kids + worker, env.afni, b.threshold, env.kids === 1 ? b.rateOneChild : b.rateMoreChildren);
  },
  nl_seniors: (b, env) => (env.ctx.age >= b.minimumAge ? reduce(b.max, env.afni, b.threshold, b.rate) : 0),
  nt_cb: (b, env) => {
    if (env.kids <= 0) return 0;
    const n = env.kids;
    const table = (arr: number[], extra: number) => (n <= arr.length ? arr[n - 1] : arr[arr.length - 1] + (n - arr.length) * extra);
    const under6 = Math.max(0, env.ctx.deductions.numChildrenUnder7);
    const monthly =
      (table(b.under6Monthly, b.under6Extra) * under6 + table(b.age6to17Monthly, b.age6to17Extra) * (n - under6)) / n;
    return monthly * 12 * linearFactor(env.afni, b.fullBelow, b.zeroAt);
  },
};

function quebecWorkPremium(prov: ProvinceConfig, env: BenefitEnv): number {
  const wp = prov.quebec!.workPremium;
  const couple = env.isFamily;
  const hasKids = env.kids > 0;
  const rate = couple ? (hasKids ? wp.coupleWithChildrenRate : wp.coupleRate) : hasKids ? wp.singleParentRate : wp.singleRate;
  const exclusion = couple ? wp.coupleExclusion : wp.singleExclusion;
  const threshold = couple ? wp.coupleThreshold : wp.singleThreshold;
  const work = env.familyEmployment;
  if (work <= exclusion) return 0;
  const max = rate * (Math.min(work, threshold) - exclusion);
  return reduce(max, env.afni, threshold, wp.reductionRate);
}

function quebecSolidarity(prov: ProvinceConfig, env: BenefitEnv): number {
  const s = prov.quebec!.solidarity;
  const livingAlone = !env.isFamily && env.kids === 0;
  const qst = s.qstBasic + (env.isFamily ? s.qstSpouse : 0) + (livingAlone ? s.qstLivingAlone : 0);
  const housing = (env.isFamily ? s.housingCouple : s.housingSingle) + s.housingPerChild * env.kids;
  return reduce(qst + housing, env.afni, s.threshold, s.rate);
}

function quebecFamilyAllowance(prov: ProvinceConfig, env: BenefitEnv): number {
  if (env.kids <= 0) return 0;
  const f = prov.quebec!.familyAllowance;
  const max = (env.isFamily ? f.twoParentMax : f.singleParentMax) * env.kids;
  const min = (env.isFamily ? f.twoParentMin : f.singleParentMin) * env.kids;
  const threshold = env.isFamily ? f.coupleThreshold : f.singleParentThreshold;
  return Math.max(min, max - Math.max(0, env.afni - threshold) * f.rate);
}

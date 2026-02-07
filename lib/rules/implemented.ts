import taxConfig from '@/lib/tax/config/2025.json';
import type { MappingFn, RuleResult, UserContext } from '@/lib/rules/types';

function applied(amount: number, reasonYes: string, reasonNo: string, prong: RuleResult['prong'], kind: RuleResult['kind']): RuleResult {
  if (amount > 0) {
    return { applied: true, amount, reason: reasonYes, prong, kind };
  }
  return { applied: false, amount: 0, reason: reasonNo, prong, kind };
}

const rrspDeduction: MappingFn = (ctx) => {
  const contrib = ctx.deductions.rrspContributions;
  const limit = ctx.deductions.rrspDeductionLimit;
  const capped = limit > 0 ? Math.min(contrib, limit) : contrib;
  return applied(
    Math.max(0, capped),
    limit > 0 ? `RRSP deduction capped at limit $${limit}.` : 'RRSP deduction applied.',
    'No RRSP contributions entered.',
    'A',
    'deduction'
  );
};

const fhsaDeduction: MappingFn = (ctx) => {
  const amt = Math.max(0, ctx.deductions.fhsaContributions ?? 0);
  return applied(amt, 'FHSA deduction applied.', 'No FHSA contributions entered.', 'A', 'deduction');
};

export const IMPLEMENTED_RULES: Record<string, MappingFn> = {
  'rrsp deduction': rrspDeduction,
  'rrsp prpp deduction': rrspDeduction,
  'rrsp or prpp deduction': rrspDeduction,
  'fhsa deduction': fhsaDeduction,
  'first home savings account deduction': fhsaDeduction,
  'first home savings account fhsa deduction': fhsaDeduction,
  'first home savings account contributions': fhsaDeduction,
  'fhsa contributions': fhsaDeduction,
  'rpp deduction': (ctx) => {
    const amt = Math.max(0, ctx.deductions.rppContributions);
    return applied(amt, 'RPP deduction applied.', 'No RPP contributions entered.', 'A', 'deduction');
  },
  'union or professional dues': (ctx) => {
    const amt = Math.max(0, ctx.deductions.unionDues);
    return applied(amt, 'Union/professional dues deduction applied.', 'No union/professional dues entered.', 'A', 'deduction');
  },
  'child care expenses': (ctx) => {
    const caps = taxConfig.deductions.childCareCaps;
    const capTotal =
      ctx.deductions.numChildrenUnder7 * caps.under7 +
      ctx.deductions.numChildren7to16 * caps.age7to16 +
      ctx.deductions.numChildrenDTCEligible * caps.dtcEligible;
    const claimed = Math.max(0, ctx.deductions.childCareExpenses);
    const allowed = Math.min(claimed, capTotal || claimed);
    return applied(
      allowed,
      capTotal > 0 ? `Child care deduction capped at $${capTotal} based on child counts.` : 'Child care deduction applied.',
      'No child care expenses entered.',
      'A',
      'deduction'
    );
  },
  'basic personal amount': (ctx) => {
    const cfg = taxConfig.federal.basicPersonalAmount;
    const netIncome = estimateNetIncome(ctx);
    const base = cfg.base;
    const min = cfg.min;
    const start = cfg.phaseoutStart;
    const end = cfg.phaseoutEnd;

    let bpa = base;
    if (netIncome >= end) bpa = min;
    else if (netIncome > start) {
      const frac = (netIncome - start) / (end - start);
      bpa = base - frac * (base - min);
    }

    const credit = round2(bpa * taxConfig.federal.lowestRate);
    return { applied: true, amount: credit, reason: `Federal BPA base $${round2(bpa)} × ${taxConfig.federal.lowestRate * 100}%.`, prong: 'B', kind: 'nonRefundableCredit' };
  },
  'ontario basic personal amount': (ctx) => {
    const base = taxConfig.ontario.basicPersonalAmount;
    const credit = round2(base * taxConfig.ontario.lowestRate);
    return { applied: true, amount: credit, reason: `Ontario BPA $${base} × ${taxConfig.ontario.lowestRate * 100}%.`, prong: 'B', kind: 'nonRefundableCredit' };
  },
  'canada employment amount': (ctx) => {
    const max = taxConfig.federal.canadaEmploymentAmountMax;
    const base = Math.min(Math.max(0, ctx.income.employment), max);
    const credit = round2(base * taxConfig.federal.lowestRate);
    return applied(credit, `Employment amount $${round2(base)} × ${taxConfig.federal.lowestRate * 100}%.`, 'No employment income.', 'B', 'nonRefundableCredit');
  },
  'disability amount': (ctx) => {
    const base = taxConfig.federal.disabilityAmount;
    const selfBase = ctx.credits.hasDisabilityDTC ? base : 0;
    const transferOut = Math.max(0, Math.min(selfBase, ctx.credits.disabilityTransferOutFederalBase ?? 0));
    const transferIn = Math.max(0, ctx.credits.disabilityTransferInFederalBase ?? 0);
    const totalBase = Math.max(0, selfBase - transferOut) + transferIn;
    if (totalBase <= 0) {
      return { applied: false, amount: 0, reason: 'DTC not selected / no transferable amount.', prong: 'B', kind: 'nonRefundableCredit' };
    }
    const credit = round2(totalBase * taxConfig.federal.lowestRate);
    const reason = `Federal disability amount base $${round2(totalBase)} × ${taxConfig.federal.lowestRate * 100}%.`;
    return { applied: true, amount: credit, reason, prong: 'B', kind: 'nonRefundableCredit' };
  },
  'ontario disability amount': (ctx) => {
    const base = taxConfig.ontario.disabilityAmount;
    const selfBase = ctx.credits.hasDisabilityDTC ? base : 0;
    const transferOut = Math.max(0, Math.min(selfBase, ctx.credits.disabilityTransferOutOntarioBase ?? 0));
    const transferIn = Math.max(0, ctx.credits.disabilityTransferInOntarioBase ?? 0);
    const totalBase = Math.max(0, selfBase - transferOut) + transferIn;
    if (totalBase <= 0) {
      return { applied: false, amount: 0, reason: 'DTC not selected / no transferable amount.', prong: 'B', kind: 'nonRefundableCredit' };
    }
    const credit = round2(totalBase * taxConfig.ontario.lowestRate);
    const reason = `Ontario disability amount base $${round2(totalBase)} × ${taxConfig.ontario.lowestRate * 100}%.`;
    return { applied: true, amount: credit, reason, prong: 'B', kind: 'nonRefundableCredit' };
  },
  'donations and gifts': (ctx) => {
    const donations = Math.max(0, ctx.credits.donations);
    if (donations <= 0) {
      return { applied: false, amount: 0, reason: 'No donations entered.', prong: 'B', kind: 'nonRefundableCredit' };
    }
    const first = Math.min(200, donations);
    const rest = Math.max(0, donations - 200);

    // Federal
    const taxableIncome = estimateTaxableIncome(ctx);
    const fedCfg = taxConfig.federal.donationCredit;
    const restRate = taxableIncome > fedCfg.topRateIncomeThreshold ? fedCfg.over200TopRate : fedCfg.over200Rate;
    const fedCredit = round2(first * fedCfg.first200Rate + rest * restRate);

    // Ontario
    const onCfg = taxConfig.ontario.donationCredit;
    const onCredit = round2(first * onCfg.first200Rate + rest * onCfg.over200Rate);

    // Engine splits by jurisdiction later; we return total and label reason.
    return { applied: true, amount: round2(fedCredit + onCredit), reason: `Donations credit (Fed $${fedCredit} + ON $${onCredit}).`, prong: 'B', kind: 'nonRefundableCredit' };
  },
  'tuition amount': (ctx) => {
    const tuition = Math.max(0, ctx.credits.tuitionFees);
    if (tuition <= 0) {
      return { applied: false, amount: 0, reason: 'No tuition fees entered.', prong: 'B', kind: 'nonRefundableCredit' };
    }
    const credit = round2(tuition * taxConfig.federal.lowestRate);
    return applied(
      credit,
      `Federal tuition credit $${round2(tuition)} × ${taxConfig.federal.lowestRate * 100}%.`,
      'No tuition fees entered.',
      'B',
      'nonRefundableCredit'
    );
  },
  'ontario tuition amount': (ctx) => {
    const tuition = Math.max(0, ctx.credits.tuitionFees);
    if (tuition <= 0) {
      return { applied: false, amount: 0, reason: 'No tuition fees entered.', prong: 'B', kind: 'nonRefundableCredit' };
    }
    const credit = round2(tuition * taxConfig.ontario.lowestRate);
    return applied(
      credit,
      `Ontario tuition credit $${round2(tuition)} × ${taxConfig.ontario.lowestRate * 100}%.`,
      'No tuition fees entered.',
      'B',
      'nonRefundableCredit'
    );
  },
  'canada workers benefit': (ctx) => {
    const claimBasic = ctx.benefits.cwbClaimBasic ?? ctx.benefits.cwbEligible;
    const claimDisability = ctx.benefits.cwbClaimDisability ?? ctx.benefits.cwbDisabilityEligible;
    if (!claimBasic && !claimDisability) {
      return { applied: false, amount: 0, reason: 'CWB not selected / not eligible.', prong: 'C', kind: 'refundableCreditOrBenefit' };
    }

    const cfg = taxConfig.benefits.cwb;
    const isFamily = ctx.maritalStatus !== 'single';
    const ani = estimateAdjustedFamilyNetIncome(ctx);

    let base = 0;
    if (ctx.benefits.cwbEligible && claimBasic) {
      const max = isFamily ? cfg.familyMax : cfg.singleMax;
      const start = isFamily ? cfg.familyPhaseoutStart : cfg.singlePhaseoutStart;
      const end = isFamily ? cfg.familyPhaseoutEnd : cfg.singlePhaseoutEnd;
      base = phaseout(max, ani, start, end);
    }

    let disability = 0;
    if (ctx.benefits.cwbDisabilityEligible && ctx.credits.hasDisabilityDTC && claimDisability) {
      if (!isFamily) disability = phaseout(cfg.disabilityMax, ani, cfg.disabilitySingleStart, cfg.disabilitySingleEnd);
      else {
        const end = ctx.benefits.cwbDisabilityBothEligible ? cfg.disabilityFamilyEndBoth : cfg.disabilityFamilyEndOne;
        disability = phaseout(cfg.disabilityMax, ani, cfg.disabilityFamilyStart, end);
      }
    }

    const total = round2(base + disability);
    return applied(
      total,
      `CWB estimated from CRA thresholds (base $${round2(base)} + disability $${round2(disability)}).`,
      'CWB not payable at this income / inputs.',
      'C',
      'refundableCreditOrBenefit'
    );
  },
  'ontario care child care tax credit': (ctx) => {
    if (!ctx.benefits.includeBenefitsEstimates) {
      return { applied: false, amount: 0, reason: 'Benefit estimates disabled.', prong: 'C', kind: 'refundableCreditOrBenefit' };
    }
    if (ctx.benefits.claimCareCredit === false) {
      return { applied: false, amount: 0, reason: 'CARE claim set to other spouse.', prong: 'C', kind: 'refundableCreditOrBenefit' };
    }
    const childCareDeduction = IMPLEMENTED_RULES['child care expenses'](ctx).amount;
    if (childCareDeduction <= 0) {
      return { applied: false, amount: 0, reason: 'No child care deduction amount (line 21400).', prong: 'C', kind: 'refundableCreditOrBenefit' };
    }

    const ani = estimateAdjustedFamilyNetIncome(ctx);
    const rate = lookupCareRate(ani);
    const credit = round2(childCareDeduction * rate);

    return applied(
      credit,
      `Ontario CARE credit rate ${(rate * 100).toFixed(0)}% × child care deduction $${round2(childCareDeduction)}.`,
      'Ontario CARE not payable at this income / inputs.',
      'C',
      'refundableCreditOrBenefit'
    );
  },
  'gst hst credit': (ctx) => {
    if (!ctx.benefits.includeBenefitsEstimates) {
      return { applied: false, amount: 0, reason: 'Benefit estimates disabled.', prong: 'C', kind: 'refundableCreditOrBenefit' };
    }
    if (ctx.benefits.claimGstHstCredit === false) {
      return { applied: false, amount: 0, reason: 'GST/HST credit claimed by spouse.', prong: 'C', kind: 'refundableCreditOrBenefit' };
    }

    const cfg = taxConfig.benefits.gstHst;
    const isFamily = ctx.maritalStatus !== 'single';
    const children = estimateChildrenCount(ctx);
    const ani = estimateAdjustedFamilyNetIncome(ctx);

    let base = cfg.baseAdult;
    if (isFamily) base += cfg.baseSpouse;

    // Use child counts we have as a proxy for “children under 19”.
    if (!isFamily && children > 0) {
      // single-parent: first child treated like “line 3” on CRA sheet
      base += cfg.baseSingleParentFirstChild;
      if (children > 1) base += (children - 1) * cfg.perChild;
    } else {
      base += children * cfg.perChild;
    }

    // Additional credit: only for single individuals (no spouse). We approximate single with no children.
    let additional = 0;
    if (!isFamily) {
      const excess = Math.max(0, ani - cfg.singleAdditionalBase);
      additional = Math.min(cfg.singleAdditionalMax, excess * cfg.singleAdditionalRate);
      // CRA sheet note: single parents enter full $184 as “additional”; we already add baseSingleParentFirstChild, so keep this as computed.
    }

    const subtotal = base + additional;
    const reduction = Math.max(0, (ani - cfg.reductionBase) * cfg.reductionRate);
    const annual = Math.max(0, subtotal - reduction);

    return applied(
      round2(annual),
      `GST/HST credit estimate (annual) based on CRA calculation sheet amounts and AFNI reduction.`,
      'GST/HST credit not payable at this income / inputs.',
      'C',
      'refundableCreditOrBenefit'
    );
  },
  'gst/hst credit': (ctx) => IMPLEMENTED_RULES['gst hst credit'](ctx),
  'ontario sales tax credit': (ctx) => {
    if (!ctx.benefits.includeBenefitsEstimates) {
      return { applied: false, amount: 0, reason: 'Benefit estimates disabled.', prong: 'C', kind: 'refundableCreditOrBenefit' };
    }
    if (ctx.benefits.claimOstc === false) {
      return { applied: false, amount: 0, reason: 'OSTC claimed by spouse.', prong: 'C', kind: 'refundableCreditOrBenefit' };
    }

    const cfg = taxConfig.benefits.ostc;
    const isFamily = ctx.maritalStatus !== 'single';
    const children = estimateChildrenCount(ctx);
    const adults = isFamily ? 2 : 1;
    const max = cfg.maxPerAdultOrChild * (adults + children);

    const ani = estimateAdjustedFamilyNetIncome(ctx);
    const threshold = !isFamily && children === 0 ? cfg.singleNoChildrenThreshold : cfg.familyThreshold;
    const reduction = Math.max(0, (ani - threshold) * cfg.reductionRate);
    const annual = Math.max(0, max - reduction);

    return applied(
      round2(annual),
      `OSTC estimate (annual) using max per person and 4% reduction over threshold.`,
      'OSTC not payable at this income / inputs.',
      'C',
      'refundableCreditOrBenefit'
    );
  }
};

export function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function estimateNetIncome(ctx: UserContext): number {
  // MVP approximation: employment + other + 50% of capital gains + eligible dividends
  const income = ctx.income.employment + ctx.income.other + 0.5 * ctx.income.capitalGains + ctx.income.eligibleDividends;
  // Deductions: only those we model in engine A
  const rrsp = IMPLEMENTED_RULES['rrsp deduction'](ctx).amount;
  const fhsa = IMPLEMENTED_RULES['fhsa deduction'](ctx).amount;
  const rpp = IMPLEMENTED_RULES['rpp deduction'](ctx).amount;
  const dues = IMPLEMENTED_RULES['union or professional dues'](ctx).amount;
  const childcare = IMPLEMENTED_RULES['child care expenses'](ctx).amount;
  return Math.max(0, income - rrsp - fhsa - rpp - dues - childcare);
}

export function estimateTaxableIncome(ctx: UserContext): number {
  // Same as net income in MVP.
  return estimateNetIncome(ctx);
}

export function estimateAdjustedFamilyNetIncome(ctx: UserContext): number {
  const self = estimateNetIncome(ctx);
  const spouse = ctx.maritalStatus === 'single' ? 0 : Math.max(0, ctx.spouseNetIncome);
  return self + spouse;
}

function estimateChildrenCount(ctx: UserContext): number {
  // Proxy for children-under-19 count (for benefit estimation only)
  return Math.max(0, ctx.deductions.numChildrenUnder7 + ctx.deductions.numChildren7to16 + ctx.deductions.numChildrenDTCEligible);
}

function phaseout(max: number, income: number, start: number, end: number): number {
  if (income <= start) return max;
  if (income >= end) return 0;
  const frac = (income - start) / (end - start);
  return max * (1 - frac);
}

function lookupCareRate(familyAdjustedIncome: number): number {
  for (const row of taxConfig.ontario.careChildcareTaxCredit.table) {
    if (row.max === null) return row.rate;
    if (familyAdjustedIncome <= row.max) return row.rate;
  }
  return 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

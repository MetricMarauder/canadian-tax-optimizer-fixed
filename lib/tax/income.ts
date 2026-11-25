import type { ProvinceCode, ProvinceConfig, TaxYearConfig } from '@/lib/tax/config';

/**
 * Core income/payroll helpers shared by the rules engine, the return calculation and the
 * household optimizer. Keeping them in one place makes sure net income (used for phase-outs
 * and benefits) is computed the same way everywhere.
 */

export type IncomeInputs = {
  employment: number;
  other: number;
  capitalGains: number;
  eligibleDividends: number;
};

export type PayrollContributions = {
  /** Total employee CPP or QPP (base + first enhanced + CPP2/QPP2). */
  cppTotal: number;
  /** Base CPP/QPP portion — non-refundable credit (line 30800). */
  cppBase: number;
  /** Enhanced portion (first additional + second additional) — deduction (line 22215). */
  cppEnhanced: number;
  /** EI premiums — non-refundable credit (line 31200). Reduced rate in Quebec. */
  ei: number;
  /** QPIP premiums (Quebec only) — federal credit (line 31205). */
  qpip: number;
};

/** Taxable amount of eligible dividends (actual dividends × 1.38). */
export function grossedUpEligibleDividends(cfg: TaxYearConfig, income: IncomeInputs): number {
  const grossUp = cfg.federal.dividendTaxCredit.eligibleGrossUp;
  return round2(Math.max(0, income.eligibleDividends) * (1 + grossUp));
}

/** Total income (line 15000) for the income types the estimator models. */
export function totalIncome(cfg: TaxYearConfig, income: IncomeInputs): number {
  return round2(
    Math.max(0, income.employment) +
      Math.max(0, income.other) +
      0.5 * Math.max(0, income.capitalGains) +
      grossedUpEligibleDividends(cfg, income)
  );
}

/**
 * Employee CPP (or QPP in Quebec), CPP2/QPP2, EI and QPIP on employment income, assuming one
 * employer and a full year. Self-employment and multiple-employer overpayments are not modelled.
 */
export function computePayroll(
  cfg: TaxYearConfig,
  employmentIncome: number,
  province: ProvinceCode = 'ON'
): PayrollContributions {
  const cpp = cfg.payroll.cpp;
  const isQuebec = province === 'QC';
  const baseRate = isQuebec ? cfg.payroll.qpp.baseRate : cpp.baseRate;
  const enhancedRate = isQuebec ? cfg.payroll.qpp.firstEnhancedRate : cpp.firstEnhancedRate;
  const secondRate = isQuebec ? cfg.payroll.qpp.qpp2Rate : cpp.cpp2Rate;
  const earnings = Math.max(0, employmentIncome);

  const pensionable = Math.max(0, Math.min(earnings, cpp.ympe) - cpp.basicExemption);
  const cppBase = round2(pensionable * baseRate);
  const firstEnhanced = round2(pensionable * enhancedRate);
  const second = round2(Math.max(0, Math.min(earnings, cpp.yampe) - cpp.ympe) * secondRate);
  const eiRate = isQuebec ? cfg.payroll.ei.quebecRate : cfg.payroll.ei.rate;
  const ei = round2(Math.min(earnings, cfg.payroll.ei.maxInsurableEarnings) * eiRate);
  const qpip = isQuebec ? round2(Math.min(earnings, cfg.payroll.qpip.maxInsurableEarnings) * cfg.payroll.qpip.rate) : 0;

  return {
    cppTotal: round2(cppBase + firstEnhanced + second),
    cppBase,
    cppEnhanced: round2(firstEnhanced + second),
    ei,
    qpip,
  };
}

/** Provincial health premium (Ontario), based on taxable income. */
export function healthPremium(prov: ProvinceConfig, taxableIncome: number): number {
  let premium = 0;
  for (const tier of prov.healthPremium ?? []) {
    if (taxableIncome > tier.from) {
      premium = Math.min(tier.max, tier.base + (taxableIncome - tier.from) * tier.rate);
    }
  }
  return round2(premium);
}

/** Provincial surtax on basic provincial tax (after non-refundable and dividend tax credits). */
export function provincialSurtax(prov: ProvinceConfig, basicTax: number): number {
  let surtax = 0;
  for (const tier of prov.surtax ?? []) {
    surtax += Math.max(0, (basicTax - tier.threshold) * tier.rate);
  }
  return round2(surtax);
}

/**
 * Ontario tax reduction (ON428 line 80): 2 × (basic + per-dependant amounts) − Ontario tax,
 * limited to the Ontario tax itself.
 */
export function ontarioTaxReduction(
  basic: number,
  perDependant: number,
  ontarioTaxAfterSurtax: number,
  dependants: number
): number {
  const personal = basic + Math.max(0, dependants) * perDependant;
  const reduction = Math.max(0, 2 * personal - ontarioTaxAfterSurtax);
  return round2(Math.min(reduction, Math.max(0, ontarioTaxAfterSurtax)));
}

export function formatPct(rate: number): string {
  return `${Number((rate * 100).toFixed(4))}%`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

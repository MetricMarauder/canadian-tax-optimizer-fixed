import taxConfig from '@/lib/tax/config/2025.json';

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
  /** Total employee CPP (base + first enhanced + CPP2). */
  cppTotal: number;
  /** Base CPP portion (4.95%) — claimed as a non-refundable credit (line 30800 / ON428 58240). */
  cppBase: number;
  /** Enhanced CPP portion (1% first + CPP2) — deducted from income (line 22215). */
  cppEnhanced: number;
  /** EI premiums — non-refundable credit (line 31200 / ON428 58300). */
  ei: number;
};

/** Taxable amount of eligible dividends (actual dividends × 1.38). */
export function grossedUpEligibleDividends(income: IncomeInputs): number {
  const grossUp = taxConfig.federal.dividendTaxCredit.eligibleGrossUp;
  return round2(Math.max(0, income.eligibleDividends) * (1 + grossUp));
}

/** Total income (line 15000) for the income types the estimator models. */
export function totalIncome(income: IncomeInputs): number {
  return round2(
    Math.max(0, income.employment) +
      Math.max(0, income.other) +
      0.5 * Math.max(0, income.capitalGains) +
      grossedUpEligibleDividends(income)
  );
}

/**
 * Employee CPP/CPP2/EI on employment income, assuming a single employer and a full year.
 * Self-employment and multiple-employer over-contributions are not modelled.
 */
export function computePayroll(employmentIncome: number): PayrollContributions {
  const cpp = taxConfig.payroll.cpp;
  const ei = taxConfig.payroll.ei;
  const earnings = Math.max(0, employmentIncome);

  const pensionable = Math.max(0, Math.min(earnings, cpp.ympe) - cpp.basicExemption);
  const cppBase = round2(pensionable * cpp.baseRate);
  const cppFirstEnhanced = round2(pensionable * cpp.firstEnhancedRate);
  const cpp2 = round2(Math.max(0, Math.min(earnings, cpp.yampe) - cpp.ympe) * cpp.cpp2Rate);
  const eiPremiums = round2(Math.min(earnings, ei.maxInsurableEarnings) * ei.rate);

  return {
    cppTotal: round2(cppBase + cppFirstEnhanced + cpp2),
    cppBase,
    cppEnhanced: round2(cppFirstEnhanced + cpp2),
    ei: eiPremiums,
  };
}

/** Ontario Health Premium (line 42800 component), based on taxable income. Not indexed. */
export function ontarioHealthPremium(taxableIncome: number): number {
  const tiers = taxConfig.ontario.healthPremium;
  let premium = 0;
  for (const tier of tiers) {
    if (taxableIncome > tier.from) {
      premium = Math.min(tier.max, tier.base + (taxableIncome - tier.from) * tier.rate);
    }
  }
  return round2(premium);
}

/** Ontario surtax on basic Ontario tax (after non-refundable and dividend tax credits). */
export function ontarioSurtax(basicOntarioTax: number): number {
  const { threshold1Tax, rate1, threshold2Tax, rate2 } = taxConfig.ontario.surtax;
  const s1 = Math.max(0, (basicOntarioTax - threshold1Tax) * rate1);
  const s2 = Math.max(0, (basicOntarioTax - threshold2Tax) * rate2);
  return round2(s1 + s2);
}

/**
 * Ontario tax reduction (ON428 line 80): 2 × (basic + per-dependant amounts) − Ontario tax,
 * limited to the Ontario tax itself.
 */
export function ontarioTaxReduction(ontarioTaxAfterSurtax: number, dependants: number): number {
  const cfg = taxConfig.ontario.taxReduction;
  const personal = cfg.basic + Math.max(0, dependants) * cfg.perDependant;
  const reduction = Math.max(0, 2 * personal - ontarioTaxAfterSurtax);
  return round2(Math.min(reduction, Math.max(0, ontarioTaxAfterSurtax)));
}

export function formatPct(rate: number): string {
  return `${Number((rate * 100).toFixed(4))}%`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

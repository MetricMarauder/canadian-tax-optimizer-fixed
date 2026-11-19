import mappingRaw from '@/lib/rules/mapping/rules_mapping.json';
import type { AppliedItem, ExplanationItem } from '@/lib/api/types';
import type { RuleItem, UserContext } from '@/lib/rules/types';
import { IMPLEMENTED_RULES, normalizeKey } from '@/lib/rules/implemented';

type MappingEntry = {
  prong: 'A' | 'B' | 'C';
  kind: 'deduction' | 'nonRefundableCredit' | 'refundableCreditOrBenefit';
  jurisdiction: 'Federal' | 'Ontario' | 'Both';
  requiredInputs: string[];
  params: Record<string, any>;
  /** Computed by the provincial calculator (lib/tax/provincial.ts), not by the rules engine. */
  provincial?: boolean;
};

const mapping: Record<string, MappingEntry> = mappingRaw as any;

/** Marker reason for provincial catalog rows; lib/tax/calculate.ts replaces it. */
export const PROVINCIAL_PLACEHOLDER = '__provincial__';

const ALIAS_KEYS: Record<string, string> = {
  [normalizeKey('RRSP/PRPP deduction')]: 'RRSP deduction',
  [normalizeKey('RRSP or PRPP deduction')]: 'RRSP deduction',
  [normalizeKey('Registered pension plan (RPP) deduction')]: 'RPP deduction',
  [normalizeKey('Annual union, professional or like dues')]: 'Union or professional dues',
  [normalizeKey('First Home Savings Account (FHSA) deduction')]: 'FHSA deduction',
  [normalizeKey('First Home Savings Account (FHSA) contributions')]: 'FHSA deduction',
  [normalizeKey('First Home Savings Account deduction')]: 'FHSA deduction',
  [normalizeKey('FHSA contributions')]: 'FHSA deduction',
  [normalizeKey('Tuition amounts')]: 'Tuition amount',
  [normalizeKey('Disability amount for self (DTC)')]: 'Disability amount',
  [normalizeKey('Canada workers benefit (CWB)')]: 'Canada workers benefit',
  [normalizeKey('Canada child benefit (CCB)')]: 'Canada child benefit',
};

export type EngineOutput = {
  deductionsApplied: AppliedItem[];
  federalNonRefundableCredits: AppliedItem[];
  /** Refundable credits claimed on the return (change the refund / balance owing). */
  refundableCreditsAndBenefitsApplied: AppliedItem[];
  /** Benefits paid separately by CRA after assessment (e.g. CGEB, CCB) — not part of the refund. */
  benefitsPaidSeparately: AppliedItem[];
  explanation: ExplanationItem[];
};

/**
 * Runs the federal rules for every catalog row. Rows that belong to a province (the catalog's
 * Ontario rows) are left as placeholders: the provincial calculator fills them in for Ontario
 * residents and marks them "not applicable" for other provinces.
 */
export function runRules(items: RuleItem[], ctx: UserContext): EngineOutput {
  const deductionsApplied: AppliedItem[] = [];
  const federalNonRefundableCredits: AppliedItem[] = [];
  const refundableCreditsAndBenefitsApplied: AppliedItem[] = [];
  const benefitsPaidSeparately: AppliedItem[] = [];
  const explanation: ExplanationItem[] = [];
  // Several catalog rows can map to the same rule; each rule must only be applied once.
  const appliedRuleKeys = new Map<string, string>();

  const normalizeMapKey = new Map<string, string>();
  for (const key of Object.keys(mapping)) {
    normalizeMapKey.set(normalizeKey(key), key);
  }
  for (const [aliasKey, canonical] of Object.entries(ALIAS_KEYS)) {
    if (mapping[canonical]) {
      normalizeMapKey.set(aliasKey, canonical);
    }
  }

  for (const item of items) {
    const normalizedName = normalizeKey(item.name);
    const key = normalizeMapKey.get(normalizedName);

    if (item.jurisdiction === 'Ontario' || (key && mapping[key].provincial)) {
      explanation.push(makeExplain(item, false, 0, PROVINCIAL_PLACEHOLDER));
      continue;
    }

    if (!key) {
      explanation.push(makeExplain(item, false, 0, 'Not yet mapped in rules_mapping.json'));
      continue;
    }

    const ruleFn = IMPLEMENTED_RULES[normalizeKey(key)];
    if (!ruleFn) {
      explanation.push(makeExplain(item, false, 0, 'Mapped, but not implemented in code yet.'));
      continue;
    }

    const ruleKey = normalizeKey(key);
    const firstRow = appliedRuleKeys.get(ruleKey);
    if (firstRow) {
      explanation.push(makeExplain(item, false, 0, `Already included in the calculation for "${firstRow}".`));
      continue;
    }
    appliedRuleKeys.set(ruleKey, item.name);

    const meta = mapping[key];
    const res = ruleFn(ctx, meta.params);

    if (res.kind === 'deduction') {
      deductionsApplied.push(makeApplied(item, res.amount));
    } else if (res.kind === 'nonRefundableCredit') {
      federalNonRefundableCredits.push(makeApplied(item, res.amount));
    } else if (res.amount > 0) {
      const target = meta.params?.paidSeparately ? benefitsPaidSeparately : refundableCreditsAndBenefitsApplied;
      target.push(makeApplied(item, res.amount));
    }

    explanation.push(makeExplain(item, res.applied, Math.round(res.amount * 100) / 100, res.reason));
  }

  return {
    deductionsApplied,
    federalNonRefundableCredits,
    refundableCreditsAndBenefitsApplied,
    benefitsPaidSeparately,
    explanation,
  };
}

function makeExplain(item: RuleItem, applied: boolean, amountApplied: number, reason: string): ExplanationItem {
  return {
    id: item.id,
    name: item.name,
    jurisdiction: item.jurisdiction,
    mechanism: item.mechanism,
    refundable: item.refundableFlag,
    lineForm: item.lineForm,
    applied,
    amountApplied,
    reason,
  };
}

function makeApplied(item: RuleItem, amount: number): AppliedItem {
  return {
    id: item.id,
    name: item.name,
    jurisdiction: 'Federal',
    mechanism: item.mechanism,
    lineForm: item.lineForm,
    amount,
  };
}

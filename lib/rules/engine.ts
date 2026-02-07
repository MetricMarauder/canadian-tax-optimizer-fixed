import mappingRaw from '@/lib/rules/mapping/rules_mapping.json';
import type { AppliedItem, ExplanationItem, Jurisdiction } from '@/lib/api/types';
import type { RuleItem, UserContext } from '@/lib/rules/types';
import taxConfig from '@/lib/tax/config/2025.json';
import { IMPLEMENTED_RULES, estimateTaxableIncome, normalizeKey } from '@/lib/rules/implemented';

type MappingEntry = {
  prong: 'A' | 'B' | 'C';
  kind: 'deduction' | 'nonRefundableCredit' | 'refundableCreditOrBenefit';
  jurisdiction: 'Federal' | 'Ontario' | 'Both';
  requiredInputs: string[];
  params: Record<string, any>;
};

const mapping: Record<string, MappingEntry> = mappingRaw as any;

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
  [normalizeKey('Unused tuition and education amounts (Ontario)')]: 'Ontario tuition amount',
  [normalizeKey('Disability amount for self (DTC)')]: 'Disability amount',
  [normalizeKey('Disability amount for self (Ontario)')]: 'Ontario disability amount',
  [normalizeKey('Ontario childcare access and relief from expenses (CARE) tax credit')]: 'Ontario CARE child care tax credit',
  [normalizeKey('Canada workers benefit (CWB)')]: 'Canada workers benefit',
  [normalizeKey('Ontario Sales Tax Credit (OSTC)')]: 'Ontario sales tax credit',
};

const JURISDICTION_OVERRIDES: Record<string, Partial<Record<Jurisdiction, string>>> = {
  [normalizeKey('Basic personal amount')]: {
    Ontario: 'Ontario basic personal amount',
    Federal: 'Basic personal amount',
  },
  [normalizeKey('Disability amount for self')]: {
    Ontario: 'Ontario disability amount',
    Federal: 'Disability amount',
  },
};

export type EngineOutput = {
  deductionsApplied: AppliedItem[];
  federalNonRefundableCredits: AppliedItem[];
  ontarioNonRefundableCredits: AppliedItem[];
  refundableCreditsAndBenefitsApplied: AppliedItem[];
  explanation: ExplanationItem[];
};

export function runRules(items: RuleItem[], ctx: UserContext): EngineOutput {
  const deductionsApplied: AppliedItem[] = [];
  const federalNonRefundableCredits: AppliedItem[] = [];
  const ontarioNonRefundableCredits: AppliedItem[] = [];
  const refundableCreditsAndBenefitsApplied: AppliedItem[] = [];
  const explanation: ExplanationItem[] = [];

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
    const override = JURISDICTION_OVERRIDES[normalizedName]?.[item.jurisdiction];
    const key = override ?? normalizeMapKey.get(normalizedName);
    if (!key) {
      explanation.push(makeExplain(item, false, 0, 'Not yet mapped in rules_mapping.json'));
      continue;
    }

    const ruleFn = IMPLEMENTED_RULES[normalizeKey(key)];
    if (!ruleFn) {
      explanation.push(makeExplain(item, false, 0, 'Mapped, but not implemented in code yet.'));
      continue;
    }

    const meta = mapping[key];
    const res = ruleFn(ctx, meta.params);

    // Special case: donations are jurisdiction-split but often appear as one row.
    if (normalizeKey(key) === 'donations and gifts') {
      const split = splitDonations(ctx);
      if (split.federal > 0) federalNonRefundableCredits.push(makeApplied(item, 'Federal', split.federal));
      if (split.ontario > 0) ontarioNonRefundableCredits.push(makeApplied(item, 'Ontario', split.ontario));
      explanation.push(makeExplain(item, split.federal + split.ontario > 0, split.federal + split.ontario, res.reason));
      continue;
    }

    const jurisdictionTargets = meta.jurisdiction === 'Both' ? (['Federal', 'Ontario'] as Jurisdiction[]) : ([meta.jurisdiction] as Jurisdiction[]);

    if (res.kind === 'deduction') {
      deductionsApplied.push(makeApplied(item, 'Federal', res.amount));
    } else if (res.kind === 'nonRefundableCredit') {
      for (const j of jurisdictionTargets) {
        if (j === 'Federal') federalNonRefundableCredits.push(makeApplied(item, j, res.amount));
        if (j === 'Ontario') ontarioNonRefundableCredits.push(makeApplied(item, j, res.amount));
      }
    } else {
      for (const j of jurisdictionTargets) {
        refundableCreditsAndBenefitsApplied.push(makeApplied(item, j, res.amount));
      }
    }

    explanation.push(makeExplain(item, res.applied, res.amount, res.reason));
  }

  return {
    deductionsApplied,
    federalNonRefundableCredits,
    ontarioNonRefundableCredits,
    refundableCreditsAndBenefitsApplied,
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

function makeApplied(item: RuleItem, jurisdiction: Jurisdiction, amount: number): AppliedItem {
  return {
    id: item.id,
    name: item.name,
    jurisdiction,
    mechanism: item.mechanism,
    lineForm: item.lineForm,
    amount,
  };
}

function splitDonations(ctx: UserContext): { federal: number; ontario: number } {
  const donations = Math.max(0, ctx.credits.donations);
  const first = Math.min(200, donations);
  const rest = Math.max(0, donations - 200);

  const taxableIncome = estimateTaxableIncome(ctx);
  const fedCfg = taxConfig.federal.donationCredit;
  const restRate = taxableIncome > fedCfg.topRateIncomeThreshold ? fedCfg.over200TopRate : fedCfg.over200Rate;
  const federal = round2(first * fedCfg.first200Rate + rest * restRate);

  const onCfg = taxConfig.ontario.donationCredit;
  const ontario = round2(first * onCfg.first200Rate + rest * onCfg.over200Rate);

  return { federal, ontario };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

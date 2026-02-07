import mappingRaw from '@/lib/rules/mapping/rules_mapping.json';
import type { RuleItem } from '@/lib/rules/types';

type MappingEntry = {
  kind: 'deduction' | 'nonRefundableCredit' | 'refundableCreditOrBenefit';
  jurisdiction: 'Federal' | 'Ontario' | 'Both';
};

const mapping: Record<string, MappingEntry> = mappingRaw as Record<string, MappingEntry>;

function mechanismFromKind(kind: MappingEntry['kind']): string {
  if (kind === 'deduction') return 'Deduction';
  if (kind === 'nonRefundableCredit') return 'Non-refundable credit';
  return 'Refundable credit / benefit';
}

export function buildFallbackRuleItems(): RuleItem[] {
  return Object.entries(mapping).map(([name, meta], idx) => {
    const jurisdiction = meta.jurisdiction === 'Ontario' ? 'Ontario' : 'Federal';
    return {
      id: `fallback_${idx + 1}`,
      name,
      jurisdiction,
      mechanism: mechanismFromKind(meta.kind),
      impact: '',
      refundableFlag: meta.kind === 'refundableCreditOrBenefit',
      lineForm: undefined,
      eligibilitySummary: '',
      calcSummary: '',
      spousalTransfer: '',
      carryforward: '',
      notes: '',
      sourceUrls: [],
    };
  });
}

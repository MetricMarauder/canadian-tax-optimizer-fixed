import { describe, expect, it } from 'vitest';
import { loadRuleItems } from '@/lib/excel/loadCredits';
import { RULE_ITEMS } from '@/lib/rules/catalog';

describe('lib/rules/catalog.json', () => {
  it('matches the Excel catalog (run `npm run catalog` after editing the .xlsx)', () => {
    expect(RULE_ITEMS).toEqual(loadRuleItems('ontario_federal_tax_credits_2025.xlsx').items);
  });
});

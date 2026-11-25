import type { RuleItem } from '@/lib/rules/types';
import catalog from '@/lib/rules/catalog.json';

/** Credit catalog generated from the Excel file by `npm run catalog`. */
export const RULE_ITEMS = catalog as RuleItem[];

/**
 * Converts the Excel credit catalog into lib/rules/catalog.json so the calculator
 * can run in the browser (no filesystem access). Re-run after editing the .xlsx:
 *   npm run catalog
 */
import fs from 'node:fs';
import { loadRuleItems } from '../lib/excel/loadCredits';

const excelPath = process.argv[2] ?? 'ontario_federal_tax_credits_2025.xlsx';
const { items } = loadRuleItems(excelPath);
fs.writeFileSync('lib/rules/catalog.json', JSON.stringify(items, null, 2) + '\n');
console.log(`Wrote ${items.length} items to lib/rules/catalog.json`);

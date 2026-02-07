import { loadRuleItems, EXPECTED_COLUMNS } from '../lib/excel/loadCredits';

const excelPath = process.argv[2] ?? 'ontario_federal_tax_credits_2025.xlsx';
const { columns, items } = loadRuleItems(excelPath);

console.log('--- Expected columns (source-of-truth) ---');
console.log(EXPECTED_COLUMNS);

console.log('\n--- Actual columns found ---');
console.log(columns);

console.log('\n--- Sample rows (first 5) ---');
console.log(
  items.slice(0, 5).map((i) => ({
    id: i.id,
    name: i.name,
    jurisdiction: i.jurisdiction,
    mechanism: i.mechanism,
    refundableFlag: i.refundableFlag,
    lineForm: i.lineForm,
    eligibilitySummary: (i.eligibilitySummary ?? '').slice(0, 120),
    calcSummary: (i.calcSummary ?? '').slice(0, 120),
    sourceUrls: i.sourceUrls,
  }))
);

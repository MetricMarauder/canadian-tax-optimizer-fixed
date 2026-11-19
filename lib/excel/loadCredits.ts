import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import type { RuleItem } from '@/lib/rules/types';
import { buildFallbackRuleItems } from '@/lib/rules/fallbackItems';

const SHEET = '2025_ON_FED_Credits';

// Columns are based on the 2025 sheet; we accept legacy header variants too.
export const EXPECTED_COLUMNS = [
  'Credit/Deduction Name',
  'Jurisdiction',
  'Mechanism',
  'Impact',
  'Refundable?',
  'Line/Form (2025 return)',
  'Eligibility (summary)',
  'Calculation / Amount (summary)',
  'Spousal transfer / sharing',
  'Carryforward / carryback',
  'Notes',
  'Source URLs',
] as const;

function pickColumn(row: Record<string, any>, ...names: string[]): any {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  }
  return '';
}

function resolveExcelPath(excelPath: string): string {
  if (path.isAbsolute(excelPath)) return excelPath;

  const cwd = process.cwd();
  const candidates = [cwd, path.resolve(cwd, '..'), path.resolve(cwd, '../..'), path.resolve(cwd, '../../..')];
  for (const dir of candidates) {
    const full = path.join(dir, excelPath);
    if (fs.existsSync(full)) return full;
  }

  return path.join(cwd, excelPath);
}

function canRead(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function loadRuleItems(excelPath: string): { columns: string[]; items: RuleItem[] } {
  const abs = resolveExcelPath(excelPath);
  if (!fs.existsSync(abs) || !canRead(abs)) {
    // For a clean DX: use a small fallback list so the UI isn't empty.
    // The full catalog still requires the Excel file.
    console.warn(`Excel file not found at ${abs}. Using fallback rules list.`);
    return { columns: [...EXPECTED_COLUMNS], items: buildFallbackRuleItems() };
  }

  let wb: XLSX.WorkBook;
  try {
    // XLSX.readFile is not available in the ESM build of `xlsx` (this package is "type": "module"),
    // so read the bytes ourselves and parse the buffer.
    wb = XLSX.read(fs.readFileSync(abs), { type: 'buffer' });
  } catch (err: any) {
    console.warn(`Unable to read Excel file at ${abs}: ${err?.message ?? err}. Using fallback rules list.`);
    return { columns: [...EXPECTED_COLUMNS], items: buildFallbackRuleItems() };
  }

  const ws = wb.Sheets[SHEET];
  if (!ws) {
    console.warn(`Sheet not found: ${SHEET}. Using fallback rules list.`);
    return { columns: [...EXPECTED_COLUMNS], items: buildFallbackRuleItems() };
  }

  const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
  const columns = Object.keys(json[0] ?? {});

  const items: RuleItem[] = json.map((row, idx) => {
    const name = String(pickColumn(row, 'Credit/Deduction Name') ?? '').trim();
    const jurisdictionRaw = String(pickColumn(row, 'Jurisdiction', 'Jurisdiction (Federal or Ontario)') ?? '').trim();
    const jurisdiction = jurisdictionRaw.toLowerCase().includes('ontario') ? 'Ontario' : 'Federal';

    const refundableRaw = String(pickColumn(row, 'Refundable?') ?? '').trim().toLowerCase();
    const refundableFlag = refundableRaw === 'yes' || refundableRaw === 'true' || refundableRaw === 'y';

    const sourceRaw = String(pickColumn(row, 'Source URLs') ?? '').trim();
    const sourceUrls = sourceRaw
      ? sourceRaw
          .split(/\s*(?:\n|,|;|\|)\s*/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    return {
      id: `row_${idx + 2}`,
      name,
      jurisdiction,
      mechanism: String(pickColumn(row, 'Mechanism', 'Mechanism (e.g., Deduction, Non-refundable credit, Refundable credit, Benefit, etc.)') ?? ''),
      impact: String(pickColumn(row, 'Impact') ?? ''),
      refundableFlag,
      lineForm: String(pickColumn(row, 'Line/Form (2025 return)') ?? '') || undefined,
      eligibilitySummary: String(pickColumn(row, 'Eligibility (summary)') ?? ''),
      calcSummary: String(pickColumn(row, 'Calculation / Amount (summary)') ?? ''),
      spousalTransfer: String(pickColumn(row, 'Spousal transfer / sharing') ?? ''),
      carryforward: String(pickColumn(row, 'Carryforward / carryback') ?? ''),
      notes: String(pickColumn(row, 'Notes') ?? ''),
      sourceUrls,
    };
  });

  return { columns, items };
}

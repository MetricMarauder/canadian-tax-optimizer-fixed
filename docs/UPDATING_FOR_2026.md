# Updating the estimator for the 2026 tax year

All dollar amounts and rates live in `lib/tax/config/2025.json`. Most of the 2026 work is copying
that file to `2026.json` and updating the values, then repointing a few hard-coded references.

## 1. Code references to change

| Where | What |
|---|---|
| `lib/tax/config/2025.json` | Copy to `lib/tax/config/2026.json` and update the values below |
| `lib/tax/income.ts`, `calculate.ts`, `household.ts`, `lib/rules/implemented.ts` | `import taxConfig from '@/lib/tax/config/2025.json'` → `2026.json` |
| `lib/tax/calculate.ts`, `lib/tax/household.ts` | `EXCEL_PATH = 'ontario_federal_tax_credits_2025.xlsx'` |
| `lib/excel/loadCredits.ts` | Sheet name `2025_ON_FED_Credits` and column `Line/Form (2025 return)` |
| `scripts/printExcel.ts` | Default workbook path |
| `app/layout.tsx`, `package.json` | Titles / name mention 2025 |
| `tests/*` | Import `2026.json`; re-derive the expected values in `tests/scenarios.test.ts` and `tests/bugfixes_2025.test.ts` |

Tip: put the year in one place (for example `lib/tax/year.ts` exporting the config and workbook path) so
future years only need a single change.

## 2. Parameter checklist (2025 → 2026)

Values marked ✅ were confirmed from published 2026 sources in November 2026. Values marked ⚠️ are
not confirmed yet; check them against CRA's indexation table and the 2026 ON428 before relying on them.

### Federal
| Key | 2025 | 2026 |
|---|---|---|
| `federal.lowestRate` (also first bracket rate, credit rate, donation first-$200 rate) | 0.145 | 0.14 ✅ |
| `federal.brackets` | 57,375 / 114,750 / 177,882 / 253,414 | 58,523 / 117,045 / 181,440 / 258,482 ✅ |
| `federal.basicPersonalAmount` base / min | 16,129 / 14,538 | 16,452 / 14,829 ✅ |
| BPA phase-out start / end | 177,882 / 253,414 | 181,440 / 258,482 ✅ |
| `canadaEmploymentAmountMax` | 1,471 | 1,501 ✅ |
| `disabilityAmount` | 10,138 | ⚠️ about 10,341 (2% indexation) |
| `donationCredit.topRateIncomeThreshold` | 253,414 | 258,482 ✅ |
| Dividend gross-up / federal DTC rate | 38% / 15.0198% | unchanged ⚠️ |

### Ontario
| Key | 2025 | 2026 |
|---|---|---|
| `ontario.brackets` | 52,886 / 105,775 / 150,000 / 220,000 | 53,891 / 107,785 / 150,000 / 220,000 ✅ |
| `ontario.basicPersonalAmount` | 12,747 | 12,989 ✅ |
| `ontario.spouseAmount` base / max | 11,905 / 10,823 | ⚠️ max 11,029, base ≈ 12,132 |
| `ontario.disabilityAmount` | 10,298 | ⚠️ (1.9% indexation, about 10,494) |
| `ontario.surtax` thresholds | 5,710 / 7,307 | ⚠️ (indexed by 1.9%) |
| `ontario.taxReduction` basic / per dependant | 294 / 544 | 300 / 554 ✅ |
| `ontario.healthPremium` | not indexed | unchanged |
| CARE table (ON479-A) | 2025 table | ⚠️ check 2026 ON479-A |

### Payroll
| Key | 2025 | 2026 |
|---|---|---|
| CPP YMPE / YAMPE | 71,300 / 81,200 | 74,600 / 85,000 ✅ |
| CPP rates / basic exemption | 4.95% + 1% / 4% CPP2 / 3,500 | unchanged ✅ |
| EI max insurable / rate | 65,700 / 1.64% | 68,900 / 1.63% ✅ |

### Benefits
| Key | Used for the 2025 return | For the 2026 return |
|---|---|---|
| `benefits.cwb` | 2025 CWB amounts | ⚠️ 2026 indexed CWB amounts (CRA "CWB" page) |
| `benefits.gstHst` (CGEB) | July 2026 to June 2027 amounts (×1.25) | ⚠️ July 2027 to June 2028 amounts (CRA publishes these around November 2026) |
| `benefits.ostc` | July 2026 to June 2027 | ⚠️ July 2027 to June 2028 |

### Workbook
Regenerate `ontario_federal_tax_credits_2026.xlsx` (sheet `2026_ON_FED_Credits`). The Canada
Carbon Rebate row can be removed (it ended in 2025). Rename the GST/HST credit row to the Canada
Groceries and Essentials Benefit, or add an alias in `lib/rules/engine.ts` (`ALIAS_KEYS`).

## 3. Verify

1. `npm test`
2. `npm run print:excel` to confirm the new workbook loads (you should see about 95 rows, not the fallback list).
3. Compare two or three scenarios against CRA's Payroll Deductions Online Calculator or a commercial
   tax program for the same inputs.

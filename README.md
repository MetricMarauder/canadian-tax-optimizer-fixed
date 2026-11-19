# Canada (Ontario + Federal) 2025 Tax Refund Estimator (MVP)

> **Disclaimer**: This app is an **estimator** for educational/planning purposes. It is **not** official filing software and may not match CRA results in all cases.

## What this repo does
- Loads your **authoritative catalog** from `ontario_federal_tax_credits_2025.xlsx` (sheet `2025_ON_FED_Credits`).
- Computes an estimated **refund or amount owing** for an Ontario resident for the **2025** tax year.
- Produces an **explainable breakdown** per jurisdiction (Federal/Ontario) and per Excel row (applied vs not applied).
- Keeps all numeric parameters in `lib/tax/config/2025.json` (no magic numbers in UI).

## Tech stack
- Next.js + TypeScript
- API: `app/api/calculate/route.ts`
- Validation: zod
- Excel parsing: `xlsx`
- Tests: Vitest

## Setup
1) Copy the input file into the project root:

```bash
cp /path/to/ontario_federal_tax_credits_2025.xlsx ./ontario_federal_tax_credits_2025.xlsx
```

2) Install deps and run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Step 1: Inspect Excel columns + sample rows

```bash
npm run print:excel
# or
npm run print:excel -- ./ontario_federal_tax_credits_2025.xlsx
```

This prints:
- expected vs actual columns
- first 5 rows (id/name/jurisdiction/line)

## How the rules engine works
### Normalized internal model
Each sheet row becomes a `RuleItem` (`lib/rules/types.ts`). The app **never hardcodes** the list of credits/deductions — it reads them from the Excel.

### 3-prong logic
- **A) Deductions**: reduce taxable income
- **B) Credits**: non-refundable (reduce payable) and refundable/benefits (increase refund / reduce owing)
- **C) Other benefits / transfers**: income-tested benefits, grants, etc.

### Mapping layer (text -> code)
Because the Excel “Eligibility” / “Calculation” are human summaries, we implement executable logic via:
- `lib/rules/mapping/rules_mapping.json`: maps **Credit/Deduction Name** → prong + required inputs + params
- `lib/rules/implemented.ts`: code implementations keyed by normalized names

If a row has **no mapping**, or is mapped but not implemented, it still appears in the **Explain my result** list with an explicit reason.

## Implemented rules

**Core calculation (always applied, `lib/tax/calculate.ts` + `lib/tax/income.ts`)**
- Federal and Ontario brackets, Ontario surtax, Ontario tax reduction (ON428 line 80), Ontario Health Premium
- Employee CPP / CPP2 / EI estimated from employment income: base CPP + EI credits (federal and Ontario) and the enhanced-CPP deduction (line 22215)
- Eligible dividends: 38% gross-up plus federal (15.0198%) and Ontario (10%) dividend tax credits

**Deductions (A)**
- RRSP (capped by the RRSP deduction limit when one is entered), FHSA, RPP, union/professional dues
- Child care expenses (per-child limits, and at most 2/3 of earned income)

**Non-refundable credits (B)**
- Federal BPA (with phase-out), Ontario BPA, Canada employment amount
- Disability amount (federal + Ontario), with spousal transfer of the unused part
- Donations (federal 33% rate only on income above the top-bracket threshold; Ontario 11.16% above $200)
- Federal tuition (with spousal transfer up to $5,000). Ontario has had no tuition credit since 2017
- Spouse or common-law partner amount (federal + Ontario, Ontario capped at the 2025 maximum)

**Refundable credits on the return (C)**
- Canada Workers Benefit: 27% phase-in above $3,000 of working income, 15% phase-out, disability supplement
- Ontario CARE child care credit (ON479-A)

**Benefits paid separately (shown apart from the refund)**
- Canada Groceries and Essentials Benefit (formerly the GST/HST credit) for July 2026 to June 2027
- Ontario Sales Tax Credit (OTB component) for July 2026 to June 2027

**Household optimizer (`lib/tax/household.ts`)** picks who claims donations, benefits, CWB and the spouse amount, and how much tuition/disability to transfer. Child care is always claimed by the lower-income spouse (CRA rule). Ontario tax-reduction dependants go to the higher-income spouse.

### Known limitations
Not modelled: self-employment, non-eligible dividends, pension income/splitting, age amount, medical expenses, LIFT credit, OEPTC/NOEC, CCB/OCB, RRSP room calculation, AMT, the federal "top-up" credit for very large non-refundable claims, and multiple-employer CPP/EI overpayments.

## Where the numbers come from
All numeric parameters are in `lib/tax/config/2025.json`. They come from CRA's 2025 payroll and indexation tables, Finance Canada (the 2025 lowest-rate change to 14.5% effective), the Ontario 2025 Budget / Fall Economic Statement (indexed credits, surtax, tax reduction), the CRA CWB page, and Schedule ON479-A (CARE). See `docs/UPDATING_FOR_2026.md` for how to roll the config forward.

## API
`POST /api/calculate`

Request/response types are in `lib/api/types.ts`.

## Tests
Run:

```bash
npm test
```

Included unit tests cover brackets, deduction caps, BPA phase-out, CWB, household optimization, seeded end-to-end scenarios (cross-checked against an independent calculation) and regression tests for the fixes in `tests/bugfixes_2025.test.ts`.

## Extending coverage
1) Run `npm run print:excel` and copy exact names from the sheet.
2) Add mappings in `lib/rules/mapping/rules_mapping.json`.
3) Add implementations in `lib/rules/implemented.ts`.
4) Add tests for any new edge-case rules.

---

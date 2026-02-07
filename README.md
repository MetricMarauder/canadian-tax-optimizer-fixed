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

## Implemented MVP rules (first subset)
These are implemented end-to-end in the engine today:

**Deductions (A)**
- RRSP deduction (with user-provided “RRSP deduction limit” cap)
- RPP deduction
- Union/professional dues
- Child care expenses deduction (simple per-child caps)

**Non-refundable credits (B)**
- Federal Basic Personal Amount (with phaseout)
- Ontario Basic Personal Amount
- Canada Employment Amount
- Disability amount (Federal + Ontario) (toggle)
- Donations (Federal + Ontario split)

**Refundable credits / benefits (C)**
- Canada Workers Benefit (basic + disability supplement if toggled)
- Ontario CARE Child Care Tax Credit (Schedule ON479-A) (based on family adjusted income table)
- Ontario Sales Tax Credit (benefit estimate)
- GST/HST credit (benefit estimate; currently uses CRA’s **July 2025–June 2026** base-year calculation sheet as a proxy)

## Where the numbers come from (authoritative sources)
All numeric parameters are stored in `lib/tax/config/2025.json`, sourced from:
- Federal personal income tax rate change for 2025 (lowest bracket effective rate). citeturn5view0turn5view1
- CRA Payroll Deductions formulas/tables containing the 2025 federal and Ontario brackets, Ontario BPA, surtax thresholds, etc. citeturn8view1
- Federal Basic Personal Amount details/phaseout. citeturn2view0
- Canada Workers Benefit (2025 max amounts and phaseout ranges). citeturn20view0
- Ontario CARE credit schedule/table (ON479-A 2025). citeturn25view0
- Ontario Sales Tax Credit parameters for payments based on 2025 return. citeturn23view0
- GST/HST credit base-year calculation sheet (proxy amounts for benefit estimate). citeturn22view0

## API
`POST /api/calculate`

Request/response types are in `lib/api/types.ts`.

## Tests
Run:

```bash
npm test
```

Included unit tests:
- bracket calculation (federal + ontario)
- capped deduction (child care)
- phaseout credit (federal BPA)
- refundable benefit (CWB)

## Extending coverage
1) Run `npm run print:excel` and copy exact names from the sheet.
2) Add mappings in `lib/rules/mapping/rules_mapping.json`.
3) Add implementations in `lib/rules/implemented.ts`.
4) Add tests for any new edge-case rules.

---

If you want, next steps are: add more income types (eligible dividend gross-up + dividend tax credit, RRSP room model), Ontario Health Premium, medical expenses credit, tuition carryforward, spousal transfers, and full ON428/TD1 parity.

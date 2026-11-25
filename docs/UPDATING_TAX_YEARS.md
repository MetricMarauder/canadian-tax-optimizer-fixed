# Updating tax years

Every parameter (federal, payroll, benefits and all 13 provinces/territories) is defined in
`scripts/generate-config.py`, which writes `lib/tax/config/<year>.json`. Don't edit the JSON by hand.

## Status of the 2026 tax year (as of November 2026)

The app already supports 2026 (`year: 2026`). Federal, payroll and provincial brackets/credit amounts
come from published 2026 figures. These items are **estimates** and should be replaced when CRA and
the provinces publish them (normally November 2026 to January 2027):

| Item | What's used now | Replace with |
|---|---|---|
| CWB 2026 amounts | 2025 × 1.02 | CRA "Canada workers benefit" 2026 amounts |
| CGEB (GST/HST credit) July 2027–June 2028 | 2026 amounts × 1.02 | CRA indexation table (Nov/Dec 2026) |
| CCB July 2027–June 2028 | July 2026 × 1.02 | CRA CCB page / indexation table |
| Provincial benefits from July 2027 (OSTC, OEPTC, NOEC, OCB, BCFB, ACFB, SLITC, NBHSTC, NBCTB, NSALTC, NSCB, PEI, NL, YT, NT, NU) | July 2026 amounts (ON indexed 1.9%) | CRA provincial programs pages and OEPTC/NOEC calculation sheets |
| B.C. renter's tax credit 2026 threshold | 2025 × 1.022 | gov.bc.ca renter's tax credit page |
| Quebec solidarity (July 2027) and family allowance (2027) | indexed ~2% | Quebec "Parameters of the personal income tax system for 2027" |
| NB, NS, NL low-income tax reductions 2026 | indexed / carried forward | NB428, NS428, NL428 2026 forms |
| Ontario CARE table 2026 | 2025 table | ON479-A 2026 |

Search the generator for `estimate` to find each one.

CRA usually releases the final 2026 T1 forms in January 2027, and NETFILE for the 2026 tax year is
expected to open in late February 2027 (the 2025 season opened February 23, 2026). The filing deadline
is April 30, 2027.

## Adding a new year (e.g. 2027)

1. In `scripts/generate-config.py`, add `config_2027()` (copy `config_2026()` and update values), and add
   it to `main()`.
2. Run `python3 scripts/generate-config.py`.
3. In `lib/tax/config/index.ts`, import `2027.json`, add `2027` to `SUPPORTED_YEARS` and `CONFIGS`.
4. Add a published-table check for the new year in `tests/provinces.test.ts`.
5. `npm test` and `npm run build`.

## Checklist of parameters per year

- **Federal**: brackets, lowest rate, BPA (base/min/phase-out), Canada employment amount, disability amount,
  donation top-rate threshold.
- **Payroll**: CPP YMPE/YAMPE/rates, QPP rates, EI max insurable earnings and rates (incl. Quebec), QPIP.
- **Benefits**: CWB, CGEB (GST/HST credit), CCB.
- **Each province/territory**: brackets, credit rate, BPA, spouse amount and threshold, disability amount,
  donation rates, dividend tax credit rate, surtax (ON), health premium (ON), low-income tax reduction, benefits.
- **Quebec**: living-alone amount, deduction for workers, work premium, solidarity credit, family allowance.

Good sources: CRA "Indexation adjustment for personal income tax and benefit amounts", CRA payroll
deductions formulas (T4127), KPMG and RCGT annual tax tables, TaxTips.ca, and each province's finance site.

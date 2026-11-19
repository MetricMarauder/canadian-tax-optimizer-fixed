'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { CalculateRequest, CalculateResponse, MaritalStatus } from '@/lib/api/types';
import { DEFAULT_YEAR, PROVINCES, SUPPORTED_YEARS, type ProvinceCode } from '@/lib/tax/config';

function toNumber(v: string): number {
  if (v.trim() === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function labelPerson(person: 'taxpayer' | 'spouse' | null | undefined): string {
  if (person === 'taxpayer') return 'Taxpayer';
  if (person === 'spouse') return 'Spouse';
  return 'None';
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-medium">{label}</div>
      {children}
    </label>
  );
}

type PersonForm = {
  age: string;
  employmentIncome: string;
  otherIncome: string;
  capitalGains: string;
  eligibleDividends: string;

  rrspContributions: string;
  rrspDeductionLimit: string;
  fhsaContributions: string;
  rppContributions: string;
  unionDues: string;

  childCareExpenses: string;
  numChildrenUnder7: string;
  numChildren7to16: string;
  numChildrenDTCEligible: string;

  hasDisabilityDTC: boolean;
  donations: string;
  tuitionFees: string;

  taxesWithheld: string;

  cwbEligible: boolean;
  cwbDisabilityEligible: boolean;
  includeBenefitsEstimates: boolean;
};

type HouseholdForm = {
  province: ProvinceCode;
  year: number;
  maritalStatus: MaritalStatus;
  hasSpouse: boolean;
  claimant: 'taxpayer' | 'spouse';
  tuitionTransferAmount: string;
};

const defaultPerson = (): PersonForm => ({
  age: '35',
  employmentIncome: '80000',
  otherIncome: '1150',
  capitalGains: '0',
  eligibleDividends: '0',

  rrspContributions: '5000',
  rrspDeductionLimit: '0',
  fhsaContributions: '2000',
  rppContributions: '0',
  unionDues: '0',

  childCareExpenses: '0',
  numChildrenUnder7: '0',
  numChildren7to16: '0',
  numChildrenDTCEligible: '0',

  hasDisabilityDTC: false,
  donations: '500',
  tuitionFees: '0',

  taxesWithheld: '13000',

  cwbEligible: true,
  cwbDisabilityEligible: false,
  includeBenefitsEstimates: true,
});

const defaultSpouse = (): PersonForm => {
  const s = defaultPerson();
  s.age = '30';
  s.employmentIncome = '1700';
  s.otherIncome = '0';
  s.capitalGains = '0';
  s.eligibleDividends = '0';
  s.rrspContributions = '0';
  s.rrspDeductionLimit = '0';
  s.fhsaContributions = '0';
  s.rppContributions = '0';
  s.unionDues = '0';
  s.childCareExpenses = '0';
  s.numChildrenUnder7 = '0';
  s.numChildren7to16 = '0';
  s.numChildrenDTCEligible = '0';
  s.donations = '0';
  s.tuitionFees = '24000';
  s.taxesWithheld = '0';
  return s;
};

function personToInput(p: PersonForm, province: ProvinceCode) {
  return {
    age: toNumber(p.age),
    province,
    income: {
      employment: toNumber(p.employmentIncome),
      other: toNumber(p.otherIncome),
      capitalGains: toNumber(p.capitalGains),
      eligibleDividends: toNumber(p.eligibleDividends),
    },
    deductions: {
      rrspContributions: toNumber(p.rrspContributions),
      rrspDeductionLimit: toNumber(p.rrspDeductionLimit),
      fhsaContributions: toNumber(p.fhsaContributions),
      rppContributions: toNumber(p.rppContributions),
      unionDues: toNumber(p.unionDues),
      childCareExpenses: toNumber(p.childCareExpenses),
      numChildrenUnder7: toNumber(p.numChildrenUnder7),
      numChildren7to16: toNumber(p.numChildren7to16),
      numChildrenDTCEligible: toNumber(p.numChildrenDTCEligible),
    },
    credits: {
      hasDisabilityDTC: p.hasDisabilityDTC,
      donations: toNumber(p.donations),
      tuitionFees: toNumber(p.tuitionFees),
    },
    benefits: {
      cwbEligible: p.cwbEligible,
      cwbDisabilityEligible: p.cwbDisabilityEligible,
      includeBenefitsEstimates: p.includeBenefitsEstimates,
    },
    taxesWithheld: toNumber(p.taxesWithheld),
  };
}

function PersonSection({
  title,
  person,
  setPerson,
}: {
  title: string;
  person: PersonForm;
  setPerson: React.Dispatch<React.SetStateAction<PersonForm>>;
}) {
  const setText =
    (key: keyof PersonForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.target.value;
      setPerson((s) => ({ ...s, [key]: value } as PersonForm));
    };

  const setBool =
    (key: keyof PersonForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const checked = e.target.checked;
      setPerson((s) => ({ ...s, [key]: checked } as PersonForm));
    };

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold">{title}</h2>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Age">
          <input className="w-full rounded-lg border p-2" inputMode="numeric" type="text" value={person.age} onChange={setText('age')} />
        </Field>

        <Field label="Employment income (CPP/EI are estimated from this)">
          <input className="w-full rounded-lg border p-2" inputMode="decimal" type="text" value={person.employmentIncome} onChange={setText('employmentIncome')} />
        </Field>

        <Field label="Other income (interest, etc.)">
          <input className="w-full rounded-lg border p-2" inputMode="decimal" type="text" value={person.otherIncome} onChange={setText('otherIncome')} />
        </Field>

        <Field label="Capital gains">
          <input className="w-full rounded-lg border p-2" inputMode="decimal" type="text" value={person.capitalGains} onChange={setText('capitalGains')} />
        </Field>

        <Field label="Eligible dividends (actual amount, before gross-up)">
          <input className="w-full rounded-lg border p-2" inputMode="decimal" type="text" value={person.eligibleDividends} onChange={setText('eligibleDividends')} />
        </Field>

        <div className="md:col-span-2">
          <h3 className="mt-2 text-md font-semibold">Deductions</h3>
        </div>

        <Field label="RRSP contributions">
          <input className="w-full rounded-lg border p-2" inputMode="decimal" type="text" value={person.rrspContributions} onChange={setText('rrspContributions')} />
        </Field>

        <Field label="RRSP deduction limit (optional; caps deduction)">
          <input className="w-full rounded-lg border p-2" inputMode="decimal" type="text" value={person.rrspDeductionLimit} onChange={setText('rrspDeductionLimit')} />
        </Field>

        <Field label="FHSA contributions">
          <input className="w-full rounded-lg border p-2" inputMode="decimal" type="text" value={person.fhsaContributions} onChange={setText('fhsaContributions')} />
        </Field>

        <Field label="RPP contributions">
          <input className="w-full rounded-lg border p-2" inputMode="decimal" type="text" value={person.rppContributions} onChange={setText('rppContributions')} />
        </Field>

        <Field label="Union / professional dues">
          <input className="w-full rounded-lg border p-2" inputMode="decimal" type="text" value={person.unionDues} onChange={setText('unionDues')} />
        </Field>

        <Field label="Child care expenses (line 21400)">
          <input className="w-full rounded-lg border p-2" inputMode="decimal" type="text" value={person.childCareExpenses} onChange={setText('childCareExpenses')} />
        </Field>

        <Field label="# children under 7">
          <input className="w-full rounded-lg border p-2" inputMode="numeric" type="text" value={person.numChildrenUnder7} onChange={setText('numChildrenUnder7')} />
        </Field>

        <Field label="# children age 7–16">
          <input className="w-full rounded-lg border p-2" inputMode="numeric" type="text" value={person.numChildren7to16} onChange={setText('numChildren7to16')} />
        </Field>

        <Field label="# children eligible for DTC (any age)">
          <input className="w-full rounded-lg border p-2" inputMode="numeric" type="text" value={person.numChildrenDTCEligible} onChange={setText('numChildrenDTCEligible')} />
        </Field>

        <div className="md:col-span-2">
          <h3 className="mt-2 text-md font-semibold">Credits & benefits</h3>
        </div>

        <Field label="Disability Tax Credit (DTC) approved?">
          <input type="checkbox" className="h-5 w-5" checked={person.hasDisabilityDTC} onChange={setBool('hasDisabilityDTC')} />
        </Field>

        <Field label="Charitable donations">
          <input className="w-full rounded-lg border p-2" inputMode="decimal" type="text" value={person.donations} onChange={setText('donations')} />
        </Field>

        <Field label="Tuition fees (eligible amount)">
          <input className="w-full rounded-lg border p-2" inputMode="decimal" type="text" value={person.tuitionFees} onChange={setText('tuitionFees')} />
        </Field>

        <Field label="Canada Workers Benefit eligible?">
          <input type="checkbox" className="h-5 w-5" checked={person.cwbEligible} onChange={setBool('cwbEligible')} />
        </Field>

        <Field label="CWB disability supplement eligible?">
          <input type="checkbox" className="h-5 w-5" checked={person.cwbDisabilityEligible} onChange={setBool('cwbDisabilityEligible')} />
        </Field>

        <Field label="Estimate benefits (CGEB/GST credit, CCB, provincial benefits)?">
          <input type="checkbox" className="h-5 w-5" checked={person.includeBenefitsEstimates} onChange={setBool('includeBenefitsEstimates')} />
        </Field>

        <Field label="Income tax deducted (T4 box 22 etc. — not CPP/EI)">
          <input className="w-full rounded-lg border p-2" inputMode="decimal" type="text" value={person.taxesWithheld} onChange={setText('taxesWithheld')} />
        </Field>
      </div>
    </section>
  );
}

function Breakdown({
  title,
  data,
}: {
  title: string;
  data: {
    taxableIncome: number;
    taxBeforeCredits: number;
    nonRefundableCreditsTotal: number;
    creditsApplied: { name: string; amount: number; lineForm?: string; jurisdiction: string }[];
    taxAfterCredits: number;
    surtax?: number;
    taxReduction?: number;
    healthPremium?: number;
    quebecAbatement?: number;
    notes?: string[];
  };
}) {
  return (
    <div className="rounded-2xl border p-4">
      <h3 className="text-md font-semibold">{title}</h3>
      <div className="mt-2 text-sm">
        <div>Taxable income: <span className="font-medium">${data.taxableIncome.toFixed(2)}</span></div>
        <div>Tax before credits: <span className="font-medium">${data.taxBeforeCredits.toFixed(2)}</span></div>
        <div>Non-refundable credits applied: <span className="font-medium">${data.nonRefundableCreditsTotal.toFixed(2)}</span></div>
        {!!data.quebecAbatement && (
          <div>Quebec abatement (16.5%): <span className="font-medium">−${data.quebecAbatement.toFixed(2)}</span></div>
        )}
        {!!data.surtax && (
          <div>Surtax: <span className="font-medium">${data.surtax.toFixed(2)}</span></div>
        )}
        {!!data.taxReduction && (
          <div>Low-income tax reduction: <span className="font-medium">−${data.taxReduction.toFixed(2)}</span></div>
        )}
        {!!data.healthPremium && (
          <div>Health premium: <span className="font-medium">${data.healthPremium.toFixed(2)}</span></div>
        )}
        <div>Tax payable: <span className="font-medium">${data.taxAfterCredits.toFixed(2)}</span></div>
      </div>
      <div className="mt-3">
        <div className="text-sm font-semibold">Credits detail</div>
        <ul className="mt-1 list-disc pl-5 text-sm">
          {data.creditsApplied.map((c, idx) => (
            <li key={idx}>{c.name}: ${c.amount.toFixed(2)} {c.lineForm ? `(${c.lineForm})` : ''}</li>
          ))}
          {data.creditsApplied.length === 0 && <li className="list-none text-gray-600">(none)</li>}
        </ul>
      </div>
      {data.notes && data.notes.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          <div className="font-semibold">Limitations / estimates</div>
          <ul className="list-disc pl-4">
            {data.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CalculateResponse | null>(null);

  const [household, setHousehold] = useState<HouseholdForm>({
    province: 'ON',
    year: DEFAULT_YEAR,
    maritalStatus: 'married',
    hasSpouse: true,
    claimant: 'taxpayer',
    tuitionTransferAmount: '0',
  });

  const [taxpayer, setTaxpayer] = useState<PersonForm>(() => defaultPerson());
  const [spouse, setSpouse] = useState<PersonForm>(() => defaultSpouse());

  const request: CalculateRequest = useMemo(() => {
    const base: CalculateRequest = {
      year: household.year,
      province: household.province,
      household: {
        maritalStatus: household.maritalStatus,
        claimant: household.claimant,
        tuitionTransferAmount: toNumber(household.tuitionTransferAmount),
      },
      taxpayer: personToInput(taxpayer, household.province),
    };

    if (household.hasSpouse && household.maritalStatus !== 'single') {
      base.spouse = personToInput(spouse, household.province);
    }

    return base;
  }, [household, taxpayer, spouse]);

  async function submit() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/calculate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      setResult((await res.json()) as CalculateResponse);
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid gap-6">
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Household</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Province or territory (residence on December 31)">
            <select
              className="w-full rounded-lg border p-2"
              value={household.province}
              onChange={(e) => setHousehold((s) => ({ ...s, province: e.target.value as ProvinceCode }))}
            >
              {PROVINCES.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tax year">
            <select
              className="w-full rounded-lg border p-2"
              value={household.year}
              onChange={(e) => setHousehold((s) => ({ ...s, year: Number(e.target.value) }))}
            >
              {SUPPORTED_YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                  {y === 2026 ? ' (preliminary — file in 2027)' : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Marital status">
            <select
              className="w-full rounded-lg border p-2"
              value={household.maritalStatus}
              onChange={(e) => {
                const ms = e.target.value as MaritalStatus;
                setHousehold((s) => ({
                  ...s,
                  maritalStatus: ms,
                  hasSpouse: ms === 'single' ? false : s.hasSpouse,
                }));
              }}
            >
              <option value="single">Single</option>
              <option value="married">Married</option>
              <option value="commonlaw">Common-law</option>
            </select>
          </Field>

          <Field label="Include spouse return?">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={household.hasSpouse}
              disabled={household.maritalStatus === 'single'}
              onChange={(e) => setHousehold((s) => ({ ...s, hasSpouse: e.target.checked }))}
            />
          </Field>

          <div className="md:col-span-2 text-sm text-gray-600">
            Transfers are auto-optimized (donations, tuition, disability, child care, benefits, CWB).
          </div>
        </div>

        <button
          className="mt-5 rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
          onClick={submit}
          disabled={loading}
        >
          {loading ? 'Calculating…' : 'Estimate household'}
        </button>

        {error && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      </section>

      <PersonSection title="Taxpayer" person={taxpayer} setPerson={setTaxpayer} />

      {household.hasSpouse && household.maritalStatus !== 'single' && (
        <PersonSection title="Spouse / common-law partner" person={spouse} setPerson={setSpouse} />
      )}

      {result && (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Household result</h2>

          <div className="mt-3 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl bg-gray-50 p-4">
              <div className="text-sm text-gray-600">Household refund / amount owing</div>
              <div className="mt-1 text-2xl font-semibold">
                {result.household.refundOrOwing >= 0
                  ? `Refund: $${result.household.refundOrOwing.toFixed(2)}`
                  : `Owing: $${Math.abs(result.household.refundOrOwing).toFixed(2)}`}
              </div>
              <div className="mt-2 text-xs text-gray-600">
                Total withheld: ${result.household.taxesWithheldTotal.toFixed(2)}
              </div>
              <div className="mt-1 text-xs text-gray-600">
                Net = withheld + refundable credits on the return − tax payable. Positive = refund, negative = owing.
              </div>
              <div className="mt-1 text-xs text-gray-700">
                {result.household.refundOrOwing >= 0 ? 'You will receive this refund.' : 'You owe this amount.'}
              </div>
            </div>

            <div className="rounded-xl bg-gray-50 p-4">
              <div className="text-sm text-gray-600">Household totals</div>
              <div className="mt-1 text-sm">
                Tax payable total: <span className="font-semibold">${result.household.taxPayableTotal.toFixed(2)}</span>
              </div>
              <div className="mt-1 text-sm">
                Refundable credits on return (CWB, CARE, QC work premium):{' '}
                <span className="font-semibold">${result.household.refundableCreditsAndBenefitsTotal.toFixed(2)}</span>
              </div>
              <div className="mt-1 text-sm">
                Benefits paid separately (CGEB, CCB, provincial benefits):{' '}
                <span className="font-semibold">${result.household.benefitsPaidSeparatelyTotal.toFixed(2)}</span>
              </div>
              <div className="mt-1 text-xs text-gray-600">
                Benefits are paid by CRA over the following July–June and are not part of the refund.
              </div>
            </div>

            {result.transferSummary && (
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="text-sm text-gray-600">Transfers (auto)</div>
                <div className="mt-1 text-sm">
                  Tuition transfer amount (auto):{' '}
                  <span className="font-semibold">${result.transferSummary.tuitionTransferAmount.toFixed(2)}</span>
                </div>
                <div className="mt-1 text-sm">
                  From spouse to taxpayer:{' '}
                  <span className="font-semibold">${result.transferSummary.tuitionTransferFromSpouse.toFixed(2)}</span>
                </div>
                <div className="mt-1 text-sm">
                  From taxpayer to spouse:{' '}
                  <span className="font-semibold">${result.transferSummary.tuitionTransferFromTaxpayer.toFixed(2)}</span>
                </div>
                <div className="mt-1 text-sm">
                  Tuition credit transferred:{' '}
                  <span className="font-semibold">
                    ${result.transferSummary.tuitionFederalCreditTransferred.toFixed(2)} federal, $
                    {result.transferSummary.tuitionProvincialCreditTransferred.toFixed(2)} provincial
                  </span>
                </div>
                <div className="mt-1 text-sm">
                  Tuition net to: <span className="font-semibold">{labelPerson(result.transferSummary.tuitionNetTo)}</span>
                  {result.transferSummary.tuitionNetAmount > 0 && (
                    <>
                      {' '}
                      (<span className="font-semibold">${result.transferSummary.tuitionNetAmount.toFixed(2)}</span>)
                    </>
                  )}
                </div>
                <div className="mt-1 text-sm">
                  Personal amount claimant:{' '}
                  <span className="font-semibold">{labelPerson(result.transferSummary.personalAmountClaimant)}</span>
                </div>
                <div className="mt-1 text-sm">
                  Personal amount credit transferred:{' '}
                  <span className="font-semibold">
                    ${result.transferSummary.personalAmountFederalCredit.toFixed(2)} federal, $
                    {result.transferSummary.personalAmountProvincialCredit.toFixed(2)} provincial
                  </span>
                </div>
                <div className="mt-1 text-sm">
                  Donations claimed by: <span className="font-semibold">{labelPerson(result.transferSummary.donationsClaimant)}</span>
                </div>
                <div className="mt-1 text-sm">
                  Child care claimed by: <span className="font-semibold">{labelPerson(result.transferSummary.childCareClaimant)}</span>
                </div>
                <div className="mt-1 text-sm">
                  Benefits claimant: <span className="font-semibold">{labelPerson(result.transferSummary.benefitClaimant)}</span>
                </div>
                <div className="mt-1 text-sm">
                  CWB claimant: <span className="font-semibold">{labelPerson(result.transferSummary.cwbClaimant)}</span>
                </div>
                <div className="mt-1 text-sm">
                  Disability transfer base:{' '}
                  <span className="font-semibold">
                    ${result.transferSummary.disabilityTransferFederalBase.toFixed(2)} federal, $
                    {result.transferSummary.disabilityTransferProvincialBase.toFixed(2)} provincial
                  </span>
                  {result.transferSummary.disabilityTransferFrom && (
                    <>
                      {' '}
                      from{' '}
                      <span className="font-semibold">{labelPerson(result.transferSummary.disabilityTransferFrom)}</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 grid gap-6">
            <div className="rounded-2xl border p-4">
              <h3 className="text-md font-semibold">Taxpayer breakdown</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Breakdown title="Federal" data={result.taxpayer.federal} />
                <Breakdown title={result.taxpayer.provincial.name} data={result.taxpayer.provincial} />
              </div>
            </div>

            {result.spouse && (
              <div className="rounded-2xl border p-4">
                <h3 className="text-md font-semibold">Spouse breakdown</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Breakdown title="Federal" data={result.spouse.federal} />
                  <Breakdown title={result.spouse.provincial.name} data={result.spouse.provincial} />
                </div>
              </div>
            )}

            <div className="rounded-2xl border p-4">
              <h3 className="text-md font-semibold">Explain my result (taxpayer)</h3>
              <p className="mt-1 text-sm text-gray-700">
                Every row from the Excel sheet appears here for the taxpayer return.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 pr-2">Applied</th>
                      <th className="py-2 pr-2">Name</th>
                      <th className="py-2 pr-2">Jurisdiction</th>
                      <th className="py-2 pr-2">Mechanism</th>
                      <th className="py-2 pr-2">Line/Form</th>
                      <th className="py-2 pr-2">Amount</th>
                      <th className="py-2 pr-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.taxpayer.explanation.map((e) => (
                      <tr key={e.id} className="border-b align-top">
                        <td className="py-2 pr-2">{e.applied ? '✅' : '—'}</td>
                        <td className="py-2 pr-2 font-medium">{e.name}</td>
                        <td className="py-2 pr-2">{e.jurisdiction}</td>
                        <td className="py-2 pr-2">{e.mechanism}</td>
                        <td className="py-2 pr-2">{e.lineForm ?? ''}</td>
                        <td className="py-2 pr-2">{e.amountApplied ? `$${e.amountApplied.toFixed(2)}` : ''}</td>
                        <td className="py-2 pr-2 text-gray-700">{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {result.spouse && (
              <div className="rounded-2xl border p-4">
                <h3 className="text-md font-semibold">Explain my result (spouse)</h3>
                <p className="mt-1 text-sm text-gray-700">
                  Every row from the Excel sheet appears here for the spouse return.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-2 pr-2">Applied</th>
                        <th className="py-2 pr-2">Name</th>
                        <th className="py-2 pr-2">Jurisdiction</th>
                        <th className="py-2 pr-2">Mechanism</th>
                        <th className="py-2 pr-2">Line/Form</th>
                        <th className="py-2 pr-2">Amount</th>
                        <th className="py-2 pr-2">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.spouse.explanation.map((e) => (
                        <tr key={e.id} className="border-b align-top">
                          <td className="py-2 pr-2">{e.applied ? '✅' : '—'}</td>
                          <td className="py-2 pr-2 font-medium">{e.name}</td>
                          <td className="py-2 pr-2">{e.jurisdiction}</td>
                          <td className="py-2 pr-2">{e.mechanism}</td>
                          <td className="py-2 pr-2">{e.lineForm ?? ''}</td>
                          <td className="py-2 pr-2">{e.amountApplied ? `$${e.amountApplied.toFixed(2)}` : ''}</td>
                          <td className="py-2 pr-2 text-gray-700">{e.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

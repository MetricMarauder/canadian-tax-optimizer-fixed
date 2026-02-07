"""
Ontario Personal Tax Calculator 2025 - Enhanced Version (v2)
Includes expanded federal/provincial deductions & credits, interactive CLI for family members,
and a simple optimizer for RRSP/FHSA/RESP allocation between spouses to help maximize tax outcomes.

Save as: ontario_tax_calculator_enhanced_v2.py
Run: python ontario_tax_calculator_enhanced_v2.py

NOTES:
- This script expands the original calculator with many common Canadian deductions/credits
  but it is still not a fully exhaustive reconstruction of CRA rules. Use for planning and
  educational purposes, not as definitive tax filing advice.
- Interactive mode lets you add multiple people, enter common fields, and then runs calculations
  and optimization suggestions.
"""

from dataclasses import dataclass, asdict, field
from typing import List, Optional, Dict, Any, Tuple
import copy
import json
import math
import sys

# ---------------------------
# Data classes
# ---------------------------

@dataclass
class PersonalTaxData:
    # Basic identity
    name: str = "Taxpayer"
    age: int = 30
    province: str = "Ontario"
    is_spouse: bool = False

    # Income sources
    employment_income: float = 0.0
    self_employment_income: float = 0.0
    interest_income: float = 0.0
    eligible_dividends: float = 0.0
    ineligible_dividends: float = 0.0
    capital_gains: float = 0.0
    pension_income: float = 0.0
    oas_income: float = 0.0
    cpp_benefits: float = 0.0
    ei_benefits: float = 0.0
    rental_income: float = 0.0
    other_income: float = 0.0
    foreign_income: float = 0.0
    rrsp_withdrawals: float = 0.0

    # Deductions (eligible deductions that reduce total income/net income)
    rrsp_contributions: float = 0.0
    rrsp_room_available: float = 0.0
    fhsa_contributions: float = 0.0
    fhsa_room_available: float = 8000.0
    child_care_expenses: float = 0.0
    union_dues: float = 0.0
    professional_dues: float = 0.0
    moving_expenses: float = 0.0
    home_office_expenses: float = 0.0
    employment_expenses: float = 0.0
    carrying_charges: float = 0.0
    support_payments_paid: float = 0.0
    northern_residents_deduction: float = 0.0
    business_expenses: float = 0.0  # for self-employed

    # Student / Education
    tuition_fees: float = 0.0  # eligible tuition (for credit)
    student_loan_interest: float = 0.0  # credit

    # Other deductions
    cpe_deduction: float = 0.0
    employee_stock_option_deduction: float = 0.0
    other_deductions: float = 0.0
    net_capital_losses_prior_years: float = 0.0
    non_capital_losses_prior_years: float = 0.0

    # Credits / personal items
    has_disability: bool = False
    disability_amount_claimed: float = 0.0
    medical_expenses: float = 0.0
    charitable_donations: float = 0.0
    home_buyers_amount: bool = False
    home_accessibility_expenses: float = 0.0
    digital_news_subscription: bool = False
    political_contributions_federal: float = 0.0
    political_contributions_ontario: float = 0.0
    volunteer_firefighter: bool = False
    search_rescue_volunteer: bool = False
    canada_training_credit_used: float = 0.0
    labour_sponsored_funds: float = 0.0

    # Family and transfers
    support_payments_received: float = 0.0
    pension_income_split_amount: float = 0.0  # amount transferred to/from spouse

    # Payroll
    cpp_employee_contrib_override: Optional[float] = None
    ei_premiums_override: Optional[float] = None
    income_tax_withheld: float = 0.0

    # Misc
    notes: str = ""


@dataclass
class FamilyTaxData:
    taxpayer: PersonalTaxData
    spouse: Optional[PersonalTaxData] = None
    has_spouse: bool = False
    num_children: int = 0
    children_ages: List[int] = field(default_factory=list)
    children_with_disability: List[int] = field(default_factory=list)
    resp_contributions: float = 0.0
    eligible_dependant: bool = False
    canada_caregiver_amount: float = 0.0


@dataclass
class PersonalTaxResults:
    name: str
    total_income: float
    total_deductions: float
    rrsp_deduction_used: float
    fhsa_deduction_used: float
    rrsp_excess_contributions: float
    fhsa_excess_contributions: float
    net_income: float
    taxable_income: float
    federal_tax: float
    ontario_tax: float
    cpp_contributions: float
    ei_premiums: float
    total_tax: float
    after_tax_income: float
    effective_tax_rate: float
    marginal_tax_rate: float
    federal_non_refundable_credits: float
    federal_refundable_credits: float
    ontario_non_refundable_credits: float
    ontario_refundable_credits: float
    total_credits: float
    total_credits_including_dividend_foreign: float
    dividend_tax_credit: float
    foreign_tax_credit: float
    tax_withheld: float
    balance_due: float


@dataclass
class FamilyTaxResults:
    taxpayer_results: PersonalTaxResults
    spouse_results: Optional[PersonalTaxResults]
    family_total_income: float
    family_total_tax: float
    family_after_tax_income: float
    family_effective_rate: float
    family_tax_withheld: float
    family_balance_due: float
    ccb_estimate: float
    resp_grant: float
    gst_hst_credit: float
    ontario_trillium_benefit: float


# ---------------------------
# Tax calculator
# ---------------------------

class TaxCalculator:
    # 2025 Federal Tax Brackets (full-year rate reflects 14.5% lowest bracket)
    FEDERAL_BRACKETS = [
        (0, 57375, 0.145),
        (57375, 114750, 0.205),
        (114750, 177882, 0.26),
        (177882, 253414, 0.29),
        (253414, math.inf, 0.33)
    ]

    # 2025 Ontario Tax Brackets
    ONTARIO_BRACKETS = [
        (0, 52886, 0.0505),
        (52886, 105775, 0.0915),
        (105775, 150000, 0.1116),
        (150000, 220000, 0.1216),
        (220000, math.inf, 0.1316)
    ]

    # CPP and EI Constants (2025)
    CPP_MAX_EARNINGS = 71300
    CPP_YAMPE = 81200
    CPP_BASIC_EXEMPTION = 3500
    CPP_RATE = 0.0595
    CPP_MAX_CONTRIBUTION = 4034.10
    CPP2_RATE = 0.04
    CPP2_MAX_CONTRIBUTION = 396.00

    EI_MAX_INSURABLE = 65700
    EI_RATE = 0.0164
    EI_MAX_PREMIUM = 1077.48

    # FHSA Limits
    FHSA_ANNUAL_LIMIT = 8000
    FHSA_LIFETIME_LIMIT = 40000

    # RESP Grant
    RESP_GRANT_RATE = 0.20
    RESP_GRANT_MAX_ANNUAL = 500
    RESP_GRANT_LIFETIME_MAX = 7200

    # Tuition transfer
    TUITION_TRANSFER_LIMIT = 5000

    # Federal Credit Amounts (2025)
    FEDERAL_CREDIT_RATE = 0.145
    BASIC_PERSONAL_AMOUNT_MAX = 16129
    BASIC_PERSONAL_AMOUNT_MIN = 14538
    BASIC_PERSONAL_AMOUNT_REDUCTION_START = 177882
    BASIC_PERSONAL_AMOUNT_REDUCTION_END = 253414
    SPOUSE_AMOUNT = 16129
    ELIGIBLE_DEPENDANT_AMOUNT = 16129
    AGE_AMOUNT = 9028
    AGE_AMOUNT_THRESHOLD = 45522
    AGE_AMOUNT_PHASEOUT_END = 105709
    PENSION_INCOME_AMOUNT = 2000
    DISABILITY_AMOUNT = 10138
    DISABILITY_SUPPLEMENT = 5914
    CAREGIVER_AMOUNT = 8601
    CANADA_EMPLOYMENT_AMOUNT = 1471
    HOME_BUYERS_AMOUNT = 10000
    ADOPTION_EXPENSES_LIMIT = 18210
    DIGITAL_NEWS_CREDIT = 500
    VOLUNTEER_FIREFIGHTER_AMOUNT = 3000
    SEARCH_RESCUE_VOLUNTEER_AMOUNT = 3000

    # Ontario Credit Amounts (2025)
    ON_BASIC_PERSONAL_AMOUNT = 12747
    ON_SPOUSE_AMOUNT = 11905
    ON_ELIGIBLE_DEPENDANT_AMOUNT = 11905
    ON_AGE_AMOUNT = 6223
    ON_AGE_AMOUNT_THRESHOLD = 46330
    ON_PENSION_INCOME_AMOUNT = 1762
    ON_DISABILITY_AMOUNT = 10298
    ON_DISABILITY_SUPPLEMENT = 6007
    ON_CAREGIVER_AMOUNT = 6008
    ON_MEDICAL_THRESHOLD = 2885
    ON_CHARITABLE_RATE_REMAINDER = 0.1116

    # Ontario Surtax (2025)
    ON_SURTAX_THRESHOLD_1 = 5710
    ON_SURTAX_RATE_1 = 0.20
    ON_SURTAX_THRESHOLD_2 = 7307
    ON_SURTAX_RATE_2 = 0.36

    def __init__(self, family_data: FamilyTaxData):
        self.family = family_data

    # ---------------------------
    # Helpers
    # ---------------------------
    def _calc_cpp(self, employment_income: float, self_employment_income: float = 0.0, override: Optional[float] = None) -> float:
        if override is not None:
            return override
        total_pensionable = employment_income + self_employment_income
        pensionable = max(0.0, min(total_pensionable, self.CPP_MAX_EARNINGS) - self.CPP_BASIC_EXEMPTION)
        base = min(pensionable * self.CPP_RATE, self.CPP_MAX_CONTRIBUTION)
        additional_pensionable = max(0.0, min(total_pensionable, self.CPP_YAMPE) - self.CPP_MAX_EARNINGS)
        cpp2 = min(additional_pensionable * self.CPP2_RATE, self.CPP2_MAX_CONTRIBUTION)
        employee = base + cpp2
        if self_employment_income > 0:
            return employee * 2.0  # self-employed pay both portions
        return employee

    def _calc_ei(self, employment_income: float, override: Optional[float] = None) -> float:
        if override is not None:
            return override
        return min(min(employment_income, self.EI_MAX_INSURABLE) * self.EI_RATE, self.EI_MAX_PREMIUM)

    def _cpp_employee_portion(self, person: PersonalTaxData) -> float:
        cpp_total = self._calc_cpp(person.employment_income, person.self_employment_income, person.cpp_employee_contrib_override)
        if person.self_employment_income > 0:
            return cpp_total / 2.0
        return cpp_total

    def _total_income(self, person: PersonalTaxData) -> float:
        return (
            person.employment_income + person.self_employment_income + person.interest_income +
            person.eligible_dividends * 1.38 + person.ineligible_dividends * 1.15 +
            person.capital_gains * 0.50 + person.pension_income + person.oas_income +
            person.cpp_benefits + person.ei_benefits + person.rental_income + person.other_income +
            person.foreign_income + person.rrsp_withdrawals + person.support_payments_received
        )

    def _bracket_tax(self, income: float, brackets: List[Tuple[float, float, float]]) -> float:
        tax = 0.0
        for lo, hi, rate in brackets:
            if income > lo:
                taxable = min(income, hi) - lo
                tax += taxable * rate
        return tax

    # ---------------------------
    # Net income & taxable income
    # ---------------------------
    def _deduction_components(self, person: PersonalTaxData, total_income: Optional[float] = None) -> Dict[str, float]:
        total_income = self._total_income(person) if total_income is None else total_income

        other_deductions = (
            person.child_care_expenses + person.union_dues + person.professional_dues +
            person.moving_expenses + person.home_office_expenses + person.employment_expenses +
            person.carrying_charges + person.support_payments_paid + person.northern_residents_deduction +
            person.cpe_deduction + person.other_deductions + person.business_expenses
        )
        other_used = min(other_deductions, total_income)
        remaining = max(0.0, total_income - other_used)

        rrsp_deduction = min(max(0.0, person.rrsp_contributions), remaining)
        remaining -= rrsp_deduction
        fhsa_deduction = min(max(0.0, person.fhsa_contributions), remaining)

        total_deductions = other_used + rrsp_deduction + fhsa_deduction

        return {
            "total": total_deductions,
            "rrsp_deduction": rrsp_deduction,
            "fhsa_deduction": fhsa_deduction,
        }

    def calculate_net_income(self, person: PersonalTaxData) -> float:
        """Return net income (Line 23600) after common deductions"""
        total_income = self._total_income(person)
        deductions = self._deduction_components(person, total_income=total_income)
        return max(0.0, total_income - deductions["total"])

    def calculate_taxable_income(self, person: PersonalTaxData, net_income: float) -> float:
        taxable = net_income
        taxable -= person.net_capital_losses_prior_years
        taxable -= person.non_capital_losses_prior_years
        taxable -= person.employee_stock_option_deduction
        return max(0.0, taxable)

    # ---------------------------
    # Credits
    # ---------------------------
    def calc_federal_non_refundable_credits(self, person: PersonalTaxData, net_income: float, is_taxpayer: bool = True) -> float:
        rate = self.FEDERAL_CREDIT_RATE
        credits = 0.0

        # Basic personal amount (income-tested)
        bpa = self.BASIC_PERSONAL_AMOUNT_MAX
        if net_income > self.BASIC_PERSONAL_AMOUNT_REDUCTION_START:
            reduction_span = max(1.0, self.BASIC_PERSONAL_AMOUNT_REDUCTION_END - self.BASIC_PERSONAL_AMOUNT_REDUCTION_START)
            reduction = (self.BASIC_PERSONAL_AMOUNT_MAX - self.BASIC_PERSONAL_AMOUNT_MIN) * (net_income - self.BASIC_PERSONAL_AMOUNT_REDUCTION_START) / reduction_span
            bpa = max(self.BASIC_PERSONAL_AMOUNT_MIN, self.BASIC_PERSONAL_AMOUNT_MAX - reduction)
        credits += bpa * rate

        # Spouse amount
        if is_taxpayer and self.family.has_spouse and self.family.spouse:
            spouse_net = self.calculate_net_income(self.family.spouse)
            if spouse_net < self.SPOUSE_AMOUNT:
                credits += max(0.0, self.SPOUSE_AMOUNT - spouse_net) * rate

        # Eligible dependant
        if is_taxpayer and self.family.eligible_dependant and not self.family.has_spouse:
            credits += self.ELIGIBLE_DEPENDANT_AMOUNT * rate

        # Age amount
        if person.age >= 65:
            age_amt = self.AGE_AMOUNT
            if net_income > self.AGE_AMOUNT_THRESHOLD:
                reduction = (net_income - self.AGE_AMOUNT_THRESHOLD) * 0.15
                age_amt = max(0.0, age_amt - reduction)
            credits += age_amt * rate

        # Pension income amount
        if person.pension_income > 0:
            credits += min(self.PENSION_INCOME_AMOUNT, person.pension_income) * rate

        # Canada employment amount
        if person.employment_income > 0:
            credits += min(self.CANADA_EMPLOYMENT_AMOUNT, person.employment_income) * rate

        # Disability amount
        if person.has_disability:
            credits += self.DISABILITY_AMOUNT * rate
            # Child supplement if relevant
            if person.age < 18:
                supplement = self.DISABILITY_SUPPLEMENT
                credits += supplement * rate

        # Caregiver
        if is_taxpayer and self.family.canada_caregiver_amount > 0:
            credits += min(self.CAREGIVER_AMOUNT, self.family.canada_caregiver_amount) * rate

        # Medical expenses (non-refundable) - threshold is lesser of $2,834 and 3% of net income
        threshold = min(2834, net_income * 0.03)
        if person.medical_expenses > threshold:
            credits += (person.medical_expenses - threshold) * rate

        # Charitable donations (federal simplified calculation using federal rates)
        if person.charitable_donations > 0:
            first_200 = min(200, person.charitable_donations) * rate
            remainder = max(0.0, person.charitable_donations - 200)
            # progressive federal credit for donations
            credits += first_200
            if remainder > 0:
                credits += remainder * 0.29

        # Tuition credit
        credits += person.tuition_fees * rate

        # Student loan interest
        credits += person.student_loan_interest * rate

        # Home buyers' amount
        if person.home_buyers_amount:
            credits += min(self.HOME_BUYERS_AMOUNT, 10000) * rate

        # Home accessibility
        if person.home_accessibility_expenses > 0:
            credits += min(20000, person.home_accessibility_expenses) * rate

        # Adoption expenses
        # NOTE: simplistic; in reality has caps and carry-forward rules
        # skip explicit addition here unless data added

        # Digital news subscription credit
        if person.digital_news_subscription:
            credits += self.DIGITAL_NEWS_CREDIT * rate

        # Volunteer / Search & Rescue
        if person.volunteer_firefighter:
            credits += self.VOLUNTEER_FIREFIGHTER_AMOUNT * rate
        if person.search_rescue_volunteer:
            credits += self.SEARCH_RESCUE_VOLUNTEER_AMOUNT * rate

        # CPP and EI credits (non-refundable portion)
        cpp = self._cpp_employee_portion(person)
        ei = self._calc_ei(person.employment_income, person.ei_premiums_override)
        credits += cpp * rate
        credits += ei * rate

        # Canada Training Credit used
        credits += min(person.canada_training_credit_used, 250) * rate

        # Labour-sponsored funds credit (federal)
        credits += person.labour_sponsored_funds * 0.15

        # Political contributions - federal
        if person.political_contributions_federal > 0:
            contrib = person.political_contributions_federal
            # simplified slabbed credit
            if contrib <= 400:
                credits += contrib * 0.75
            elif contrib <= 750:
                credits += 300 + (contrib - 400) * 0.50
            else:
                credits += 475 + (contrib - 750) * 0.33

        return credits

    def calc_federal_refundable(self, person: PersonalTaxData, net_income: float, is_taxpayer: bool = True) -> float:
        credits = 0.0
        # Canada Worker Benefit
        if is_taxpayer and net_income > 3000 and net_income < 35000:
            base = 1590
            if net_income < 24975:
                credits += min(base, net_income * 0.27)
            else:
                credits += max(0.0, base - (net_income - 24975) * 0.12)
            # disability supplement
            if person.has_disability and net_income < 37930:
                sup = 800
                if net_income < 32244:
                    credits += min(sup, net_income * 0.27)
                else:
                    credits += max(0.0, sup - (net_income - 32244) * 0.12)

        # Medical expense supplement (simplified)
        # ... omitted complex rules for brevity

        return credits

    def calc_ontario_non_refundable(self, person: PersonalTaxData, net_income: float, is_taxpayer: bool = True) -> float:
        rate = 0.0505
        credits = 0.0
        credits += self.ON_BASIC_PERSONAL_AMOUNT * rate

        if is_taxpayer and self.family.has_spouse and self.family.spouse:
            spouse_net = self.calculate_net_income(self.family.spouse)
            if spouse_net < self.ON_SPOUSE_AMOUNT:
                credits += max(0.0, self.ON_SPOUSE_AMOUNT - spouse_net) * rate

        if is_taxpayer and self.family.eligible_dependant and not self.family.has_spouse:
            credits += self.ON_ELIGIBLE_DEPENDANT_AMOUNT * rate

        if person.age >= 65:
            age_amt = self.ON_AGE_AMOUNT
            if net_income > self.ON_AGE_AMOUNT_THRESHOLD:
                reduction = (net_income - self.ON_AGE_AMOUNT_THRESHOLD) * 0.15
                age_amt = max(0.0, age_amt - reduction)
            credits += age_amt * rate

        if person.pension_income > 0:
            credits += min(self.ON_PENSION_INCOME_AMOUNT, person.pension_income) * rate

        if person.has_disability:
            credits += self.ON_DISABILITY_AMOUNT * rate

        if is_taxpayer and self.family.canada_caregiver_amount > 0:
            credits += min(self.ON_CAREGIVER_AMOUNT, self.family.canada_caregiver_amount) * rate

        # Medical expenses (Ontario) - threshold is lesser of $2,885 and 3% of net income
        threshold = min(self.ON_MEDICAL_THRESHOLD, net_income * 0.03)
        if person.medical_expenses > threshold:
            credits += (person.medical_expenses - threshold) * rate

        # Charitable donations (Ontario)
        if person.charitable_donations > 0:
            first_200 = min(200, person.charitable_donations) * rate
            remainder = max(0.0, person.charitable_donations - 200)
            credits += first_200
            if remainder > 0:
                credits += remainder * self.ON_CHARITABLE_RATE_REMAINDER

        # Student loan interest (Ontario)
        credits += person.student_loan_interest * rate

        # CPP and EI credits (Ontario)
        cpp = self._cpp_employee_portion(person)
        ei = self._calc_ei(person.employment_income, person.ei_premiums_override)
        credits += (cpp + ei) * rate

        # Political contributions - Ontario (simplified)
        if person.political_contributions_ontario > 0:
            contrib = person.political_contributions_ontario
            if contrib <= 500.05:
                credits += contrib * 0.75
            elif contrib <= 1666.82:
                credits += 375.04 + (contrib - 500.05) * 0.50
            elif contrib <= 3792.22:
                credits += 958.43 + (contrib - 1666.82) * 0.3333
            else:
                credits += 1666.82

        # Seniors' home safety
        if person.age >= 65 and person.home_accessibility_expenses > 0:
            credits += min(6000, person.home_accessibility_expenses) * 0.25

        return credits

    def calc_ontario_refundable(self, person: PersonalTaxData, net_income: float) -> float:
        credits = 0.0
        # staycation etc - omitted for 2024 unless user supplies values
        return credits

    def calculate_dividend_tax_credit(self, person: PersonalTaxData) -> Tuple[float, float]:
        fed_div = person.eligible_dividends * 0.150198 + person.ineligible_dividends * 0.090301
        ont_div = person.eligible_dividends * 0.10 + person.ineligible_dividends * 0.029863
        return fed_div, ont_div

    def calculate_foreign_tax_credit(self, person: PersonalTaxData) -> float:
        if person.foreign_income <= 0:
            return 0.0
        # Simplified assumption: 15% foreign tax paid and allowed as credit
        return person.foreign_income * 0.15

    # ---------------------------
    # Person calculation
    # ---------------------------
    def calculate_person(self, p: PersonalTaxData, is_taxpayer: bool = True) -> PersonalTaxResults:
        total_income = self._total_income(p)
        deductions = self._deduction_components(p, total_income=total_income)
        total_deductions = deductions["total"]
        rrsp_deduction_used = deductions["rrsp_deduction"]
        fhsa_deduction_used = deductions["fhsa_deduction"]
        rrsp_excess = max(0.0, p.rrsp_contributions - rrsp_deduction_used)
        fhsa_excess = max(0.0, p.fhsa_contributions - fhsa_deduction_used)

        net_income = max(0.0, total_income - total_deductions)
        taxable_income = self.calculate_taxable_income(p, net_income)

        cpp = self._calc_cpp(p.employment_income, p.self_employment_income, p.cpp_employee_contrib_override)
        ei = self._calc_ei(p.employment_income, p.ei_premiums_override)

        fed_tax_gross = self._bracket_tax(taxable_income, self.FEDERAL_BRACKETS)
        ont_tax_gross = self._bracket_tax(taxable_income, self.ONTARIO_BRACKETS)

        fed_non_ref = self.calc_federal_non_refundable_credits(p, net_income, is_taxpayer)
        fed_ref = self.calc_federal_refundable(p, net_income, is_taxpayer)
        ont_non_ref = self.calc_ontario_non_refundable(p, net_income, is_taxpayer)
        ont_ref = self.calc_ontario_refundable(p, net_income)

        fed_div, ont_div = self.calculate_dividend_tax_credit(p)
        foreign_credit = self.calculate_foreign_tax_credit(p)

        fed_tax_after = max(0.0, fed_tax_gross - fed_non_ref - fed_div - foreign_credit)
        ont_basic = max(0.0, ont_tax_gross - ont_non_ref - ont_div)

        ont_surtax = self.calculate_ontario_surtax(ont_basic)
        ont_health = self.calculate_ontario_health_premium(taxable_income)
        ont_total = ont_basic + ont_surtax + ont_health

        total_tax = fed_tax_after + ont_total + cpp + ei - fed_ref - ont_ref
        after_tax = total_income - total_deductions - total_tax

        eff_rate = (total_tax / total_income * 100) if total_income > 0 else 0.0
        marginal = self.calculate_marginal_rate(taxable_income)
        tax_withheld = max(0.0, p.income_tax_withheld)
        balance_due = total_tax - tax_withheld

        total_credits = fed_non_ref + fed_ref + ont_non_ref + ont_ref
        total_credits_all = total_credits + fed_div + ont_div + foreign_credit

        return PersonalTaxResults(
            name=p.name,
            total_income=total_income,
            total_deductions=total_deductions,
            rrsp_deduction_used=rrsp_deduction_used,
            fhsa_deduction_used=fhsa_deduction_used,
            rrsp_excess_contributions=rrsp_excess,
            fhsa_excess_contributions=fhsa_excess,
            net_income=net_income,
            taxable_income=taxable_income,
            federal_tax=fed_tax_after,
            ontario_tax=ont_total,
            cpp_contributions=cpp,
            ei_premiums=ei,
            total_tax=total_tax,
            after_tax_income=after_tax,
            effective_tax_rate=eff_rate,
            marginal_tax_rate=marginal,
            federal_non_refundable_credits=fed_non_ref,
            federal_refundable_credits=fed_ref,
            ontario_non_refundable_credits=ont_non_ref,
            ontario_refundable_credits=ont_ref,
            total_credits=total_credits,
            total_credits_including_dividend_foreign=total_credits_all,
            dividend_tax_credit=fed_div + ont_div,
            foreign_tax_credit=foreign_credit,
            tax_withheld=tax_withheld,
            balance_due=balance_due
        )

    def calculate_ontario_surtax(self, basic_ontario_tax: float) -> float:
        surtax = 0.0
        if basic_ontario_tax > self.ON_SURTAX_THRESHOLD_1:
            surtax += (basic_ontario_tax - self.ON_SURTAX_THRESHOLD_1) * self.ON_SURTAX_RATE_1
        if basic_ontario_tax > self.ON_SURTAX_THRESHOLD_2:
            surtax += (basic_ontario_tax - self.ON_SURTAX_THRESHOLD_2) * self.ON_SURTAX_RATE_2
        return surtax

    def calculate_ontario_health_premium(self, taxable_income: float) -> float:
        if taxable_income <= 20000:
            return 0.0
        if taxable_income <= 36000:
            return min(300.0, (taxable_income - 20000) * 0.06)
        if taxable_income <= 48000:
            return 300.0 + (taxable_income - 36000) * 0.06
        if taxable_income <= 72000:
            return 450.0 + (taxable_income - 48000) * 0.25
        if taxable_income <= 200000:
            return 600.0 + (taxable_income - 72000) * 0.25
        if taxable_income <= 202000:
            return min(900.0, (taxable_income - 200000) * 0.25)
        return 900.0

    def calculate_marginal_rate(self, income: float) -> float:
        fed = 0.0
        ont = 0.0
        for lo, hi, rate in self.FEDERAL_BRACKETS:
            if income <= hi:
                fed = rate
                break
        for lo, hi, rate in self.ONTARIO_BRACKETS:
            if income <= hi:
                ont = rate
                break
        return (fed + ont) * 100.0

    # ---------------------------
    # Family calculations and benefits
    # ---------------------------
    def calculate_ccb(self) -> float:
        if self.family.num_children == 0:
            return 0.0
        taxpayer_net = self.calculate_net_income(self.family.taxpayer)
        spouse_net = self.calculate_net_income(self.family.spouse) if self.family.has_spouse and self.family.spouse else 0.0
        family_net = taxpayer_net + spouse_net
        ccb = 0.0
        for i, age in enumerate(self.family.children_ages):
            base = 7787 if age < 6 else 6570
            if i in self.family.children_with_disability:
                base += 3322
            if family_net > 36502:
                num_children = self.family.num_children
                # graduated reduction rates
                if num_children == 1:
                    rr = 0.07
                elif num_children == 2:
                    rr = 0.135
                elif num_children == 3:
                    rr = 0.19
                else:
                    rr = 0.23
                ccb += max(0.0, base - (family_net - 36502) * rr)
            else:
                ccb += base
        return ccb

    def calculate_gst_hst_credit(self) -> float:
        taxpayer_net = self.calculate_net_income(self.family.taxpayer)
        spouse_net = self.calculate_net_income(self.family.spouse) if self.family.has_spouse and self.family.spouse else 0.0
        family_net = taxpayer_net + spouse_net
        credit = 519
        if self.family.has_spouse:
            credit += 519
        elif self.family.eligible_dependant:
            credit += 519
        credit += self.family.num_children * 273
        threshold = 43675
        if family_net > threshold:
            credit = max(0.0, credit - (family_net - threshold) * 0.05)
        return credit

    def calculate_ontario_trillium_benefit(self) -> float:
        taxpayer_net = self.calculate_net_income(self.family.taxpayer)
        spouse_net = self.calculate_net_income(self.family.spouse) if self.family.has_spouse and self.family.spouse else 0.0
        family_net = taxpayer_net + spouse_net
        ostc = 360
        if self.family.has_spouse:
            ostc += 360
        ostc += self.family.num_children * 360
        threshold = 28929
        if family_net > threshold:
            ostc = max(0.0, ostc - (family_net - threshold) * 0.04)
        oeptc = 0.0
        noec = 0.0
        return ostc + oeptc + noec

    def calculate_resp_grant(self) -> float:
        return min(self.family.resp_contributions * self.RESP_GRANT_RATE, self.RESP_GRANT_MAX_ANNUAL * max(1, self.family.num_children))

    def _family_tax_payable(self, results: FamilyTaxResults) -> float:
        """Return tax payable before refundable credits are applied."""
        tp_ref = results.taxpayer_results.federal_refundable_credits + results.taxpayer_results.ontario_refundable_credits
        sp_ref = 0.0
        if results.spouse_results:
            sp_ref = results.spouse_results.federal_refundable_credits + results.spouse_results.ontario_refundable_credits
        return results.family_total_tax + tp_ref + sp_ref

    def _apply_transferable_credits(self, family: FamilyTaxData) -> FamilyTaxData:
        if not family.has_spouse or family.spouse is None:
            return family

        base_family = copy.deepcopy(family)
        best_family = copy.deepcopy(family)
        best_results = TaxCalculator(best_family).calculate_family(auto_transfer_credits=False)
        best_tax_payable = self._family_tax_payable(best_results)

        total_donations = max(0.0, base_family.taxpayer.charitable_donations + base_family.spouse.charitable_donations)
        total_medical = max(0.0, base_family.taxpayer.medical_expenses + base_family.spouse.medical_expenses)

        donation_targets = ["taxpayer", "spouse"] if total_donations > 0 else ["unchanged"]
        medical_targets = ["taxpayer", "spouse"] if total_medical > 0 else ["unchanged"]

        for donation_target in donation_targets:
            for medical_target in medical_targets:
                trial_family = copy.deepcopy(base_family)
                if trial_family.spouse is None:
                    continue
                if donation_target != "unchanged":
                    if donation_target == "taxpayer":
                        trial_family.taxpayer.charitable_donations = total_donations
                        trial_family.spouse.charitable_donations = 0.0
                    else:
                        trial_family.taxpayer.charitable_donations = 0.0
                        trial_family.spouse.charitable_donations = total_donations

                if medical_target != "unchanged":
                    if medical_target == "taxpayer":
                        trial_family.taxpayer.medical_expenses = total_medical
                        trial_family.spouse.medical_expenses = 0.0
                    else:
                        trial_family.taxpayer.medical_expenses = 0.0
                        trial_family.spouse.medical_expenses = total_medical

                max_sp_to_tp = self._max_tuition_transfer(trial_family, student_is_taxpayer=False)
                max_tp_to_sp = self._max_tuition_transfer(trial_family, student_is_taxpayer=True)
                sp_to_tp_options = [0.0, max_sp_to_tp] if max_sp_to_tp > 0 else [0.0]
                tp_to_sp_options = [0.0, max_tp_to_sp] if max_tp_to_sp > 0 else [0.0]

                for sp_to_tp in sp_to_tp_options:
                    for tp_to_sp in tp_to_sp_options:
                        alloc_family = copy.deepcopy(trial_family)
                        if alloc_family.spouse is None:
                            continue
                        alloc_family.spouse.tuition_fees = max(0.0, alloc_family.spouse.tuition_fees - sp_to_tp + tp_to_sp)
                        alloc_family.taxpayer.tuition_fees = max(0.0, alloc_family.taxpayer.tuition_fees + sp_to_tp - tp_to_sp)

                        trial = TaxCalculator(alloc_family).calculate_family(auto_transfer_credits=False)
                        trial_tax_payable = self._family_tax_payable(trial)
                        if trial_tax_payable < best_tax_payable:
                            best_tax_payable = trial_tax_payable
                            best_family = alloc_family

        return best_family

    def calculate_family(self, auto_transfer_credits: bool = True) -> FamilyTaxResults:
        if auto_transfer_credits and self.family.has_spouse and self.family.spouse:
            adjusted_family = self._apply_transferable_credits(self.family)
            return TaxCalculator(adjusted_family).calculate_family(auto_transfer_credits=False)
        tp_res = self.calculate_person(self.family.taxpayer, is_taxpayer=True)
        sp_res = None
        if self.family.has_spouse and self.family.spouse:
            self.family.spouse.name = self.family.spouse.name or "Spouse"
            sp_res = self.calculate_person(self.family.spouse, is_taxpayer=False)

        total_income = tp_res.total_income + (sp_res.total_income if sp_res else 0.0)
        total_tax = tp_res.total_tax + (sp_res.total_tax if sp_res else 0.0)
        total_withheld = tp_res.tax_withheld + (sp_res.tax_withheld if sp_res else 0.0)
        family_balance_due = total_tax - total_withheld
        ccb = self.calculate_ccb()
        gst = self.calculate_gst_hst_credit()
        trillium = self.calculate_ontario_trillium_benefit()
        resp = self.calculate_resp_grant()
        family_after_tax = (
            tp_res.after_tax_income
            + (sp_res.after_tax_income if sp_res else 0.0)
            + ccb
            + gst
            + trillium
            + resp
        )

        return FamilyTaxResults(
            taxpayer_results=tp_res,
            spouse_results=sp_res,
            family_total_income=total_income,
            family_total_tax=total_tax,
            family_after_tax_income=family_after_tax,
            family_effective_rate=(total_tax / total_income * 100.0) if total_income > 0 else 0.0,
            family_tax_withheld=total_withheld,
            family_balance_due=family_balance_due,
            ccb_estimate=ccb,
            resp_grant=resp,
            gst_hst_credit=gst,
            ontario_trillium_benefit=trillium
        )

    # ---------------------------
    # Simple optimizer helpers
    # ---------------------------
    def optimize_rrsp_allocation(self, step: float = 500.0) -> Dict[str, Any]:
        """Try simple allocation of RRSP contributions between taxpayer and spouse to minimize combined tax.
        step: granularity for searching (e.g. 500 dollars)."""
        tp = self.family.taxpayer
        sp = self.family.spouse
        if not self.family.has_spouse or sp is None:
            return {}

        # Available rooms
        tp_room = max(0.0, tp.rrsp_room_available - tp.rrsp_contributions)
        sp_room = max(0.0, sp.rrsp_room_available - sp.rrsp_contributions)
        total_room = tp_room + sp_room

        # We'll search allocations from 0..total_room to spouse (i.e., how much spouse contributes)
        best = {
            'allocation_spouse': 0.0,
            'allocation_taxpayer': 0.0,
            'family_after_tax': -math.inf,
            'savings': 0.0
        }

        base_results = self.calculate_family()
        base_after_tax = base_results.family_after_tax_income

        # Cap search range by reasonable limits
        max_search = min(total_room, 100000)
        steps = int(max(1, math.ceil(max_search / step)))

        for i in range(steps + 1):
            spouse_contrib = round(i * step, 2)
            if spouse_contrib > sp_room:
                # spouse can't contribute more than their room; if over, extra goes to taxpayer
                spouse_act = sp_room
                taxpayer_act = spouse_contrib - spouse_act
            else:
                spouse_act = spouse_contrib
                taxpayer_act = 0.0

            taxpayer_act = min(tp_room, max(0.0, max_search - spouse_act)) if taxpayer_act == 0.0 else min(tp_room, taxpayer_act)

            # Apply trial contributions
            tp.rrsp_contributions += taxpayer_act
            sp.rrsp_contributions += spouse_act

            # Recompute family
            trial = self.calculate_family()

            # revert
            tp.rrsp_contributions -= taxpayer_act
            sp.rrsp_contributions -= spouse_act

            if trial.family_after_tax_income > best['family_after_tax']:
                best.update({
                    'allocation_spouse': spouse_act,
                    'allocation_taxpayer': taxpayer_act,
                    'family_after_tax': trial.family_after_tax_income,
                    'savings': trial.family_after_tax_income - base_after_tax
                })

        return best

    def _allocation_candidates(self, total: float, step: float) -> List[float]:
        if total <= 0:
            return [0.0]
        steps = int(total // step) if step > 0 else 0
        candidates = [round(i * step, 2) for i in range(steps + 1)]
        if abs(candidates[-1] - total) > 0.01:
            candidates.append(round(total, 2))
        return candidates

    def _max_tuition_transfer(self, family: FamilyTaxData, student_is_taxpayer: bool) -> float:
        student = family.taxpayer if student_is_taxpayer else family.spouse
        if student is None or student.tuition_fees <= 0:
            return 0.0

        family_copy = copy.deepcopy(family)
        target = family_copy.taxpayer if student_is_taxpayer else family_copy.spouse
        if target is None:
            return 0.0
        total_tuition = max(0.0, target.tuition_fees)

        def taxes_cleared(tuition_used: float) -> bool:
            target.tuition_fees = max(0.0, min(total_tuition, tuition_used))
            calc = TaxCalculator(family_copy)
            res = calc.calculate_person(target, is_taxpayer=student_is_taxpayer)
            health = calc.calculate_ontario_health_premium(res.taxable_income)
            return res.federal_tax <= 0.0001 and res.ontario_tax <= health + 0.0001

        if taxes_cleared(0.0):
            tuition_needed = 0.0
        else:
            lo, hi = 0.0, total_tuition
            for _ in range(30):
                mid = (lo + hi) / 2.0
                if taxes_cleared(mid):
                    hi = mid
                else:
                    lo = mid
            tuition_needed = hi

        target.tuition_fees = total_tuition
        unused = max(0.0, total_tuition - tuition_needed)
        return min(self.TUITION_TRANSFER_LIMIT, unused)

    def optimize_contribution_allocation(self, step: float = 500.0) -> Dict[str, Any]:
        """Allocate RRSP and FHSA contributions between spouses to maximize family after-tax income."""
        tp = self.family.taxpayer
        sp = self.family.spouse
        if not self.family.has_spouse or sp is None:
            return {}

        total_rrsp = max(0.0, tp.rrsp_contributions + sp.rrsp_contributions)
        total_fhsa = max(0.0, tp.fhsa_contributions + sp.fhsa_contributions)

        base_results = self.calculate_family()
        base_after_tax = base_results.family_after_tax_income

        best = {
            "rrsp_spouse": sp.rrsp_contributions,
            "rrsp_taxpayer": tp.rrsp_contributions,
            "fhsa_spouse": sp.fhsa_contributions,
            "fhsa_taxpayer": tp.fhsa_contributions,
            "family_after_tax": base_after_tax,
            "savings": 0.0,
        }

        rrsp_candidates = self._allocation_candidates(total_rrsp, step)
        fhsa_candidates = self._allocation_candidates(total_fhsa, step)

        for rrsp_spouse in rrsp_candidates:
            rrsp_taxpayer = max(0.0, total_rrsp - rrsp_spouse)
            for fhsa_spouse in fhsa_candidates:
                fhsa_taxpayer = max(0.0, total_fhsa - fhsa_spouse)
                family_copy = copy.deepcopy(self.family)
                if family_copy.spouse is None:
                    continue
                family_copy.spouse.rrsp_contributions = rrsp_spouse
                family_copy.taxpayer.rrsp_contributions = rrsp_taxpayer
                family_copy.spouse.fhsa_contributions = fhsa_spouse
                family_copy.taxpayer.fhsa_contributions = fhsa_taxpayer

                trial = TaxCalculator(family_copy).calculate_family()
                if trial.family_after_tax_income > best["family_after_tax"]:
                    best.update({
                        "rrsp_spouse": rrsp_spouse,
                        "rrsp_taxpayer": rrsp_taxpayer,
                        "fhsa_spouse": fhsa_spouse,
                        "fhsa_taxpayer": fhsa_taxpayer,
                        "family_after_tax": trial.family_after_tax_income,
                        "savings": trial.family_after_tax_income - base_after_tax,
                    })

        return best

    def optimize_transferable_credits(self) -> Dict[str, Any]:
        """Optimize simple transferable credits between spouses (tuition, donations, medical)."""
        tp = self.family.taxpayer
        sp = self.family.spouse
        if not self.family.has_spouse or sp is None:
            return {}

        base_results = self.calculate_family(auto_transfer_credits=False)
        base_after_tax = base_results.family_after_tax_income
        base_tax_payable = self._family_tax_payable(base_results)

        total_donations = max(0.0, tp.charitable_donations + sp.charitable_donations)
        total_medical = max(0.0, tp.medical_expenses + sp.medical_expenses)

        best = {
            "donations_claimed_by": "unchanged",
            "medical_claimed_by": "unchanged",
            "tuition_transfer_to_taxpayer": 0.0,
            "tuition_transfer_to_spouse": 0.0,
            "family_after_tax": base_after_tax,
            "family_tax_payable": base_tax_payable,
            "tax_payable_reduction": 0.0,
            "savings": 0.0,
        }

        donation_targets = ["taxpayer", "spouse"] if total_donations > 0 else ["unchanged"]
        medical_targets = ["taxpayer", "spouse"] if total_medical > 0 else ["unchanged"]

        for donation_target in donation_targets:
            for medical_target in medical_targets:
                base_family = copy.deepcopy(self.family)
                if base_family.spouse is None:
                    continue
                if donation_target != "unchanged":
                    if donation_target == "taxpayer":
                        base_family.taxpayer.charitable_donations = total_donations
                        base_family.spouse.charitable_donations = 0.0
                    else:
                        base_family.taxpayer.charitable_donations = 0.0
                        base_family.spouse.charitable_donations = total_donations

                if medical_target != "unchanged":
                    if medical_target == "taxpayer":
                        base_family.taxpayer.medical_expenses = total_medical
                        base_family.spouse.medical_expenses = 0.0
                    else:
                        base_family.taxpayer.medical_expenses = 0.0
                        base_family.spouse.medical_expenses = total_medical

                max_sp_to_tp = self._max_tuition_transfer(base_family, student_is_taxpayer=False)
                max_tp_to_sp = self._max_tuition_transfer(base_family, student_is_taxpayer=True)
                sp_to_tp_options = [0.0, max_sp_to_tp] if max_sp_to_tp > 0 else [0.0]
                tp_to_sp_options = [0.0, max_tp_to_sp] if max_tp_to_sp > 0 else [0.0]

                for sp_to_tp in sp_to_tp_options:
                    for tp_to_sp in tp_to_sp_options:
                        family_copy = copy.deepcopy(base_family)
                        if family_copy.spouse is None:
                            continue
                        family_copy.spouse.tuition_fees = max(0.0, family_copy.spouse.tuition_fees - sp_to_tp)
                        family_copy.taxpayer.tuition_fees += sp_to_tp
                        family_copy.taxpayer.tuition_fees = max(0.0, family_copy.taxpayer.tuition_fees - tp_to_sp)
                        family_copy.spouse.tuition_fees += tp_to_sp

                        trial = TaxCalculator(family_copy).calculate_family(auto_transfer_credits=False)
                        trial_tax_payable = self._family_tax_payable(trial)
                        if trial_tax_payable < best["family_tax_payable"]:
                            best.update({
                                "donations_claimed_by": donation_target,
                                "medical_claimed_by": medical_target,
                                "tuition_transfer_to_taxpayer": sp_to_tp,
                                "tuition_transfer_to_spouse": tp_to_sp,
                                "family_after_tax": trial.family_after_tax_income,
                                "family_tax_payable": trial_tax_payable,
                                "tax_payable_reduction": base_tax_payable - trial_tax_payable,
                                "savings": base_tax_payable - trial_tax_payable,
                            })

        return best

    def optimize_rrsp_refund(self, step: float = 500.0) -> Dict[str, Any]:
        """Suggest additional RRSP contributions to maximize refund based on tax withheld."""
        tp = self.family.taxpayer
        sp = self.family.spouse

        total_withheld = max(0.0, tp.income_tax_withheld) + (max(0.0, sp.income_tax_withheld) if sp else 0.0)
        if total_withheld <= 0:
            return {}

        tp_room = max(0.0, (tp.rrsp_room_available or 0.0) - tp.rrsp_contributions)
        sp_room = max(0.0, (sp.rrsp_room_available or 0.0) - sp.rrsp_contributions) if sp else 0.0

        tp_candidates = self._allocation_candidates(tp_room, step)
        sp_candidates = self._allocation_candidates(sp_room, step)

        base_results = self.calculate_family()
        base_refund = total_withheld - base_results.family_total_tax

        best = {
            "additional_rrsp_taxpayer": 0.0,
            "additional_rrsp_spouse": 0.0,
            "family_refund": base_refund,
            "family_balance_due": base_results.family_balance_due,
            "family_after_tax": base_results.family_after_tax_income,
        }

        for tp_extra in tp_candidates:
            for sp_extra in sp_candidates:
                family_copy = copy.deepcopy(self.family)
                if family_copy.spouse is None and sp_extra > 0:
                    continue
                family_copy.taxpayer.rrsp_contributions += tp_extra
                if family_copy.spouse:
                    family_copy.spouse.rrsp_contributions += sp_extra

                trial = TaxCalculator(family_copy).calculate_family()
                refund = total_withheld - trial.family_total_tax
                if refund > best["family_refund"]:
                    best.update({
                        "additional_rrsp_taxpayer": tp_extra,
                        "additional_rrsp_spouse": sp_extra,
                        "family_refund": refund,
                        "family_balance_due": trial.family_balance_due,
                        "family_after_tax": trial.family_after_tax_income,
                    })

        return best


# ---------------------------
# Simple interactive CLI helpers
# ---------------------------

def ask_float(prompt: str, default: float = 0.0) -> float:
    try:
        val = input(f"{prompt} [{default}]: ")
        if val.strip() == "":
            return float(default)
        return float(val.replace(',', ''))
    except Exception:
        print("Invalid input, using default.")
        return float(default)


def ask_int(prompt: str, default: int = 0) -> int:
    try:
        val = input(f"{prompt} [{default}]: ")
        if val.strip() == "":
            return int(default)
        return int(val)
    except Exception:
        print("Invalid input, using default.")
        return int(default)


def ask_yesno(prompt: str, default: bool = False) -> bool:
    d = 'Y' if default else 'N'
    val = input(f"{prompt} (y/n) [{d}]: ")
    if val.strip() == "":
        return default
    return val.strip().lower().startswith('y')


def build_person_interactive(name_hint: str = "Taxpayer") -> PersonalTaxData:
    print(f"\nEntering data for {name_hint}. Leave blank to accept the default shown in [brackets].")
    p = PersonalTaxData(name=name_hint)
    p.age = ask_int("Age", p.age)
    p.employment_income = ask_float("Employment income", p.employment_income)
    p.self_employment_income = ask_float("Self-employment income", p.self_employment_income)
    p.interest_income = ask_float("Interest income", p.interest_income)
    p.eligible_dividends = ask_float("Eligible dividends (actual received)", p.eligible_dividends)
    p.ineligible_dividends = ask_float("Ineligible dividends (actual received)", p.ineligible_dividends)
    p.capital_gains = ask_float("Capital gains (taxable portion is 50% in Canada)", p.capital_gains)
    p.pension_income = ask_float("Pension income", p.pension_income)
    p.oas_income = ask_float("OAS income", p.oas_income)
    p.cpp_benefits = ask_float("CPP/QPP benefits (taxable)", p.cpp_benefits)
    p.ei_benefits = ask_float("EI benefits (taxable)", p.ei_benefits)
    p.rental_income = ask_float("Rental income", p.rental_income)
    p.other_income = ask_float("Other income", p.other_income)
    p.foreign_income = ask_float("Foreign income (gross)", p.foreign_income)
    p.rrsp_withdrawals = ask_float("RRSP withdrawals", p.rrsp_withdrawals)

    # Deductions & credits
    p.rrsp_contributions = ask_float("RRSP contributions (this year)", p.rrsp_contributions)
    p.rrsp_room_available = ask_float("RRSP room available", p.rrsp_room_available or 0)
    p.fhsa_contributions = ask_float("FHSA contributions (this year)", p.fhsa_contributions)
    p.fhsa_room_available = ask_float("FHSA room available", p.fhsa_room_available)
    p.child_care_expenses = ask_float("Child care expenses paid", p.child_care_expenses)
    p.union_dues = ask_float("Union dues", p.union_dues)
    p.professional_dues = ask_float("Professional dues", p.professional_dues)
    p.moving_expenses = ask_float("Moving expenses (eligible)", p.moving_expenses)
    p.home_office_expenses = ask_float("Home office expenses (employment/self-employment)", p.home_office_expenses)
    p.employment_expenses = ask_float("Other employment expenses (T777)", p.employment_expenses)
    p.carrying_charges = ask_float("Carrying charges/interest expenses eligible", p.carrying_charges)
    p.support_payments_paid = ask_float("Support payments paid (alimony)", p.support_payments_paid)
    p.support_payments_received = ask_float("Support payments received (alimony)", p.support_payments_received)
    p.northern_residents_deduction = ask_float("Northern residents deduction (if applicable)", p.northern_residents_deduction)
    p.business_expenses = ask_float("Business expenses (if self-employed)", p.business_expenses)

    p.tuition_fees = ask_float("Eligible tuition fees (for credit)", p.tuition_fees)
    p.student_loan_interest = ask_float("Student loan interest paid (for credit)", p.student_loan_interest)
    p.cpe_deduction = ask_float("CPE deduction (if applicable)", p.cpe_deduction)
    p.employee_stock_option_deduction = ask_float("Employee stock option deduction (if applicable)", p.employee_stock_option_deduction)
    p.other_deductions = ask_float("Other deductions (specify)", p.other_deductions)
    p.net_capital_losses_prior_years = ask_float("Net capital losses carried in", p.net_capital_losses_prior_years)
    p.non_capital_losses_prior_years = ask_float("Non-capital losses carried in (business loss)", p.non_capital_losses_prior_years)

    p.has_disability = ask_yesno("Do you have a disability eligible for the disability tax credit?", p.has_disability)
    if p.has_disability:
        p.disability_amount_claimed = ask_float("Disability amount claimed (if specific)", p.disability_amount_claimed)
    p.medical_expenses = ask_float("Total eligible medical expenses", p.medical_expenses)
    p.charitable_donations = ask_float("Charitable donations (cash/gifts)", p.charitable_donations)
    p.home_buyers_amount = ask_yesno("Claim home buyers' amount this year?", p.home_buyers_amount)
    p.home_accessibility_expenses = ask_float("Home accessibility expenses (eligible)", p.home_accessibility_expenses)
    p.digital_news_subscription = ask_yesno("Have qualifying digital news subscription?", p.digital_news_subscription)
    p.political_contributions_federal = ask_float("Political contributions (federal)", p.political_contributions_federal)
    p.political_contributions_ontario = ask_float("Political contributions (Ontario)", p.political_contributions_ontario)
    p.volunteer_firefighter = ask_yesno("Volunteer firefighter credit eligible?", p.volunteer_firefighter)
    p.search_rescue_volunteer = ask_yesno("Search & rescue volunteer credit eligible?", p.search_rescue_volunteer)
    p.canada_training_credit_used = ask_float("Canada training credit used this year", p.canada_training_credit_used)
    p.labour_sponsored_funds = ask_float("Labour-sponsored funds amount (federal credit)", p.labour_sponsored_funds)

    p.foreign_income = ask_float("Foreign income (gross)", p.foreign_income)

    p.cpp_employee_contrib_override = None
    p.ei_premiums_override = None

    p.notes = input("Optional notes: ") or ""

    return p


# ---------------------------
# Output and printing helpers
# ---------------------------

def print_person_results(res: PersonalTaxResults):
    print('\n' + '='*80)
    print(f"{res.name.upper()} SUMMARY")
    print('='*80)
    print(f"Total Income: ${res.total_income:,.2f}")
    print(f"Total Deductions: ${res.total_deductions:,.2f}")
    print(f"Net Income: ${res.net_income:,.2f}")
    print(f"Taxable Income: ${res.taxable_income:,.2f}")
    print(f"Federal Tax (after credits): ${res.federal_tax:,.2f}")
    print(f"Ontario Tax (after credits + surtax): ${res.ontario_tax:,.2f}")
    print(f"CPP Contributions: ${res.cpp_contributions:,.2f}")
    print(f"EI Premiums: ${res.ei_premiums:,.2f}")
    print(f"Total Tax: ${res.total_tax:,.2f}")
    print(f"After-tax Income: ${res.after_tax_income:,.2f}")
    print(f"Effective Tax Rate: {res.effective_tax_rate:.2f}%")
    print(f"Marginal Tax Rate: {res.marginal_tax_rate:.2f}%")
    print('='*80)


def print_family_results(fr: FamilyTaxResults):
    print('\n' + '#' * 80)
    print('FAMILY SUMMARY')
    print('#' * 80)
    print_person_results(fr.taxpayer_results)
    if fr.spouse_results:
        print_person_results(fr.spouse_results)
    print('--- Family Totals ---')
    print(f"Family Total Income: ${fr.family_total_income:,.2f}")
    print(f"Family Total Tax: ${fr.family_total_tax:,.2f}")
    print(f"Family After-tax Income: ${fr.family_after_tax_income:,.2f}")
    print(f"Family Effective Tax Rate: {fr.family_effective_rate:.2f}%")
    print(f"Estimated CCB: ${fr.ccb_estimate:,.2f}")
    print(f"Estimated GST/HST credit: ${fr.gst_hst_credit:,.2f}")
    print(f"Estimated Ontario Trillium benefit: ${fr.ontario_trillium_benefit:,.2f}")
    print(f"Estimated RESP grant: ${fr.resp_grant:,.2f}")
    print('#' * 80)


# ---------------------------
# Utilities for saving/loading scenarios
# ---------------------------

def save_scenario(filename: str, family: FamilyTaxData, results: FamilyTaxResults):
    payload = {
        'family': asdict(family),
        'results': asdict(results)
    }
    with open(filename, 'w') as f:
        json.dump(payload, f, indent=2)
    print(f"Scenario saved to {filename}")


def load_scenario(filename: str) -> Optional[FamilyTaxData]:
    try:
        with open(filename, 'r') as f:
            data = json.load(f)
        fam = data.get('family')
        # Very simple loader (doesn't restore complex defaults)
        taxpayer = PersonalTaxData(**fam['taxpayer'])
        spouse = PersonalTaxData(**fam['spouse']) if fam.get('spouse') else None
        family = FamilyTaxData(taxpayer=taxpayer, spouse=spouse,
                               has_spouse=fam.get('has_spouse', False),
                               num_children=fam.get('num_children', 0),
                               children_ages=fam.get('children_ages', []),
                               children_with_disability=fam.get('children_with_disability', []),
                               resp_contributions=fam.get('resp_contributions', 0.0),
                               eligible_dependant=fam.get('eligible_dependant', False))
        return family
    except Exception as e:
        print('Failed to load scenario:', e)
        return None


# ---------------------------
# Main interactive flow
# ---------------------------

def main_interactive():
    print('\n' + '='*80)
    print('ONTARIO PERSONAL TAX CALCULATOR 2024 - Interactive (v2)')
    print('='*80)

    mode = input('Load scenario from file? (enter filename or leave blank to build interactively): ').strip()
    if mode:
        family = load_scenario(mode)
        if not family:
            print('Falling back to interactive build.')
    else:
        # Build taxpayer
        taxpayer = build_person_interactive('Taxpayer')
        has_spouse = ask_yesno('Do you have a spouse/common-law partner?', False)
        spouse = None
        if has_spouse:
            spouse = build_person_interactive('Spouse')
            spouse.is_spouse = True
        num_children = ask_int('Number of children', 0)
        children_ages = []
        for i in range(num_children):
            age = ask_int(f"Age of child #{i+1}", 0)
            children_ages.append(age)

        resp_contrib = ask_float('Total RESP contributions this year (for all children)', 0.0)

        family = FamilyTaxData(
            taxpayer=taxpayer,
            spouse=spouse,
            has_spouse=has_spouse,
            num_children=num_children,
            children_ages=children_ages,
            resp_contributions=resp_contrib
        )

    calc = TaxCalculator(family)
    results = calc.calculate_family()
    print_family_results(results)

    # Optimizations
    if family.has_spouse and family.spouse:
        print('\nRunning RRSP allocation optimizer (coarse) to search for family after-tax max...')
        best = calc.optimize_rrsp_allocation(step=500.0)
        if best and best['savings'] > 0:
            print('\nOptimization suggestion:')
            print(f"Contribute ${best['allocation_spouse']:,.2f} to spouse RRSP and ${best['allocation_taxpayer']:,.2f} to taxpayer RRSP (trial) -> estimated family after-tax increase: ${best['savings']:,.2f}")
        else:
            print('No beneficial RRSP re-allocation found with current inputs (coarse search).')

    # FHSA suggestion
    tp = family.taxpayer
    if tp.age < 40 and tp.fhsa_room_available - tp.fhsa_contributions > 0:
        print('\nFHSA suggestion:')
        print(f"You have FHSA room of ${tp.fhsa_room_available - tp.fhsa_contributions:,.2f}. Consider contributing to reduce taxable income and save for first home.")

    # RESP suggestion
    if family.num_children > 0:
        missing = max(0.0, family.num_children * 2500 - family.resp_contributions)
        if missing > 0:
            print('\nRESP suggestion:')
            print(f"Contribute up to ${missing:,.2f} more (across children) to capture the full ${TaxCalculator.RESP_GRANT_RATE*100:.0f}% CESG (up to ${TaxCalculator.RESP_GRANT_MAX_ANNUAL:,.0f} per child).")

    # Save scenario option
    if ask_yesno('\nSave this scenario to file?', False):
        fname = input('Filename to save (e.g. mytax.json) [my_tax_scenario.json]: ').strip() or 'my_tax_scenario.json'
        save_scenario(fname, family, results)

    print('\nDone. Note: this tool is for planning/education and simplifies many CRA rules.')


# ---------------------------
# Entry point
# ---------------------------

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] in ('--interactive', '-i'):
        main_interactive()
    else:
        print('Run with --interactive or -i to launch the interactive data entry UI.')
        print('Example: python ontario_tax_calculator_enhanced_v2.py --interactive')

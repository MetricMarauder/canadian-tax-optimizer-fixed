#!/usr/bin/env python3
"""
Generates lib/tax/config/<year>.json for every supported tax year.

All parameters live in this one file so a yearly update is a single, reviewable diff.
Values marked "estimate" in a province/benefit `notes` list were not published (or not found)
when this file was last updated and are indexed/carry-forward approximations.

Run:  python3 scripts/generate-config.py
"""
import json
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'lib', 'tax', 'config')


def brackets(thresholds, rates):
    assert len(rates) == len(thresholds) + 1
    out = [{"upTo": t, "rate": r} for t, r in zip(thresholds, rates)]
    out.append({"upTo": None, "rate": rates[-1]})
    return out


def cwb(single_max, family_max, single_start, family_start, dis_max, dis_single_start, dis_family_start):
    return {
        "singleMax": single_max,
        "familyMax": family_max,
        "singlePhaseoutStart": single_start,
        "singlePhaseoutEnd": round(single_start + single_max / 0.15),
        "familyPhaseoutStart": family_start,
        "familyPhaseoutEnd": round(family_start + family_max / 0.15),
        "disabilityMax": dis_max,
        "disabilitySingleStart": dis_single_start,
        "disabilitySingleEnd": round(dis_single_start + dis_max / 0.15),
        "disabilityFamilyStart": dis_family_start,
        "disabilityFamilyEndOne": round(dis_family_start + dis_max / 0.15),
        "disabilityFamilyEndBoth": round(dis_family_start + dis_max / 0.075),
        "workingIncomeBase": 3000,
        "phaseInRate": 0.27,
        "phaseOutRate": 0.15,
        "disabilityWorkingIncomeBase": 1150,
        "disabilityPhaseInRate": 0.27,
        "minimumAge": 19,
    }


OHP = [
    {"from": 20000, "rate": 0.06, "base": 0, "max": 300},
    {"from": 36000, "rate": 0.06, "base": 300, "max": 450},
    {"from": 48000, "rate": 0.25, "base": 450, "max": 600},
    {"from": 72000, "rate": 0.25, "base": 600, "max": 750},
    {"from": 200000, "rate": 0.25, "base": 750, "max": 900},
]

CARE_TABLE = [
    {"max": 20000, "rate": 0.75}, {"max": 22500, "rate": 0.73}, {"max": 25000, "rate": 0.71},
    {"max": 27500, "rate": 0.69}, {"max": 30000, "rate": 0.67}, {"max": 32500, "rate": 0.65},
    {"max": 35000, "rate": 0.63}, {"max": 37500, "rate": 0.61}, {"max": 40000, "rate": 0.59},
    {"max": 45000, "rate": 0.57}, {"max": 50000, "rate": 0.55}, {"max": 55000, "rate": 0.53},
    {"max": 60000, "rate": 0.51}, {"max": 63600, "rate": 0.49}, {"max": 67200, "rate": 0.47},
    {"max": 70800, "rate": 0.45}, {"max": 74400, "rate": 0.43}, {"max": 78000, "rate": 0.41},
    {"max": 81600, "rate": 0.39}, {"max": 85200, "rate": 0.37}, {"max": 88800, "rate": 0.35},
    {"max": 92400, "rate": 0.33}, {"max": 96000, "rate": 0.31}, {"max": 99600, "rate": 0.29},
    {"max": 103200, "rate": 0.27}, {"max": 106800, "rate": 0.25}, {"max": 110400, "rate": 0.23},
    {"max": 114000, "rate": 0.21}, {"max": 117600, "rate": 0.19}, {"max": 121200, "rate": 0.17},
    {"max": 124800, "rate": 0.15}, {"max": 128400, "rate": 0.13}, {"max": 132000, "rate": 0.11},
    {"max": 135600, "rate": 0.09}, {"max": 139200, "rate": 0.07}, {"max": 142800, "rate": 0.05},
    {"max": 146400, "rate": 0.03}, {"max": 150000, "rate": 0.01}, {"max": None, "rate": 0.0},
]


def bpa_flat(amount):
    return {"base": amount}


def province(name, credit_rate, thresholds, rates, bpa, spouse_max, spouse_threshold, disability,
             donation_first, donation_rest, dtc, top_donation=None, **extra):
    p = {
        "name": name,
        "brackets": brackets(thresholds, rates),
        "lowestRate": credit_rate,
        "basicPersonalAmount": bpa,
        "spouseAmount": {"max": spouse_max, "threshold": spouse_threshold},
        "disabilityAmount": disability,
        "donationCredit": {"first200Rate": donation_first, "over200Rate": donation_rest},
        "dividendTaxCreditRate": dtc,
        "benefits": [],
        "notes": [],
    }
    if top_donation:
        p["donationCredit"]["topRate"] = top_donation[0]
        p["donationCredit"]["topRateIncomeThreshold"] = top_donation[1]
    p.update(extra)
    return p


# --------------------------------------------------------------------------------------------
# 2025
# --------------------------------------------------------------------------------------------

def config_2025():
    federal = {
        "brackets": brackets([57375, 114750, 177882, 253414], [0.145, 0.205, 0.26, 0.29, 0.33]),
        "lowestRate": 0.145,
        "basicPersonalAmount": {"base": 16129, "min": 14538, "phaseoutStart": 177882, "phaseoutEnd": 253414},
        "canadaEmploymentAmountMax": 1471,
        "disabilityAmount": 10138,
        "donationCredit": {"first200Rate": 0.145, "over200Rate": 0.29, "over200TopRate": 0.33,
                           "topRateIncomeThreshold": 253414},
        "dividendTaxCredit": {"eligibleGrossUp": 0.38, "eligibleRate": 0.150198},
        "quebecAbatement": 0.165,
    }
    payroll = {
        "cpp": {"ympe": 71300, "yampe": 81200, "basicExemption": 3500, "baseRate": 0.0495,
                "firstEnhancedRate": 0.01, "cpp2Rate": 0.04},
        "qpp": {"baseRate": 0.054, "firstEnhancedRate": 0.01, "qpp2Rate": 0.04},
        "ei": {"maxInsurableEarnings": 65700, "rate": 0.0164, "quebecRate": 0.0131},
        "qpip": {"maxInsurableEarnings": 98000, "rate": 0.00494},
    }
    benefits = {
        "cwb": cwb(1633, 2813, 26855, 30639, 843, 37740, 49389),
        "gstHst": {
            "_note": "Canada Groceries and Essentials Benefit (formerly GST/HST credit) for July 2026–June 2027, "
                     "based on the 2025 return: 2026-indexed amounts × 1.25. Phase-out threshold/rate not enhanced.",
            "baseAdult": 356, "baseSpouse": 356, "baseSingleParentFirstChild": 356, "perChild": 188,
            "singleAdditionalBase": 11564, "singleAdditionalMax": 187, "singleAdditionalRate": 0.02,
            "enhancementFactor": 1.25, "reductionBase": 46432, "reductionRate": 0.05,
        },
        "ccb": {
            "_note": "Canada child benefit, July 2026–June 2027 (based on 2025 AFNI).",
            "under6": 8157, "age6to17": 6883, "threshold1": 38237, "threshold2": 82847,
            "rates1": [0.07, 0.135, 0.19, 0.23], "rates2": [0.032, 0.057, 0.08, 0.095],
        },
    }

    provinces = {}

    on = province("Ontario", 0.0505, [52886, 105775, 150000, 220000], [0.0505, 0.0915, 0.1116, 0.1216, 0.1316],
                  bpa_flat(12747), 10823, 1082, 10298, 0.0505, 0.1116, 0.10)
    on["surtax"] = [{"threshold": 5710, "rate": 0.20}, {"threshold": 7307, "rate": 0.36}]
    on["healthPremium"] = OHP
    on["taxReduction"] = {"type": "ontario", "basic": 294, "perDependant": 544}
    on["benefits"] = [
        {"id": "on_care", "name": "Ontario CARE child care tax credit", "onReturn": True, "table": CARE_TABLE},
        {"id": "on_ostc", "name": "Ontario sales tax credit (OTB)", "perPerson": 378,
         "singleThreshold": 29047, "familyThreshold": 36309, "rate": 0.04},
        {"id": "on_ocb", "name": "Ontario child benefit", "perChild": 1760, "threshold": 26865, "rate": 0.08},
        # Ontario energy and property tax credit (OTB), July 2026–June 2027, non-senior calculation sheets.
        {"id": "on_oeptc", "name": "Ontario energy and property tax credit (OTB)", "rentShare": 0.20,
         "energyMax": 290, "propertyRate": 0.10, "propertyCap": 944, "propertyAddOn": 73,
         "singleThreshold": 29047, "familyThreshold": 36309, "rate": 0.02},
        # Northern Ontario energy credit (OTB), July 2026–June 2027.
        {"id": "on_noec", "name": "Northern Ontario energy credit (OTB)", "singleMax": 189, "familyMax": 290,
         "singleThreshold": 50833, "familyThreshold": 65356, "rate": 0.01},
    ]
    # Low-income Individuals and Families Tax (LIFT) credit, ON428-A.
    on["lift"] = {"max": 875, "employmentRate": 0.0505, "individualThreshold": 32500, "familyThreshold": 65000,
                  "rate": 0.05}
    on["notes"] = [
        "OEPTC uses the non-senior calculation; the senior version (higher maximum, age 64+) is not modelled.",
        "OEPTC single-person threshold is assumed equal to the OSTC single threshold ($29,047).",
    ]
    provinces["ON"] = on

    bc = province("British Columbia", 0.0506, [49279, 98560, 113158, 137407, 186306, 259829],
                  [0.0506, 0.077, 0.105, 0.1229, 0.147, 0.168, 0.205], bpa_flat(12932), 11073, 1108, 9699,
                  0.0506, 0.168, 0.12, top_donation=(0.205, 259829))
    bc["taxReduction"] = {"type": "linear", "basic": 562, "threshold": 25020, "rate": 0.0356, "incomeBasis": "individual"}
    bc["benefits"] = [
        {"id": "bc_family", "name": "B.C. family benefit", "amounts": [1750, 1100, 900], "minimums": [775, 750, 725],
         "threshold": 30176, "secondThreshold": 96562, "rate": 0.04},
        {"id": "bc_renter", "name": "B.C. renter's tax credit", "onReturn": True, "household": True, "max": 400,
         "threshold": 64764, "rate": 0.02},
    ]
    provinces["BC"] = bc

    ab = province("Alberta", 0.08, [60000, 151234, 181481, 241974, 362961], [0.08, 0.10, 0.12, 0.13, 0.14, 0.15],
                  bpa_flat(22323), 22323, 0, 17219, 0.60, 0.21, 0.0812)
    ab["benefits"] = [
        {"id": "ab_acfb", "name": "Alberta child and family benefit",
         "base": [1529, 764, 764, 764], "working": [782, 712, 426, 141],
         "workingPhaseInBase": 2760, "workingPhaseInRate": 0.15,
         "baseThreshold": 28116, "workingThreshold": 47115, "workingReductionRate": 0.15},
    ]
    ab["notes"] = [
        "ACFB base component is modelled as phasing out linearly between $28,116 and $47,115 (estimate: published reduction rates not confirmed).",
        "Alberta's 2025 supplemental credit (for credits above $60,000) is not modelled.",
    ]
    provinces["AB"] = ab

    sk = province("Saskatchewan", 0.105, [53463, 152750], [0.105, 0.125, 0.145], bpa_flat(19491), 19491, 1949,
                  13986, 0.105, 0.145, 0.11)
    sk["benefits"] = [
        {"id": "sk_litc", "name": "Saskatchewan low-income tax credit", "adult": 460, "spouse": 460, "perChild": 181,
         "maxChildren": 2, "threshold": 39345, "rate": 0.03},
    ]
    provinces["SK"] = sk

    mb = province("Manitoba", 0.108, [47000, 100000], [0.108, 0.1275, 0.174],
                  {"base": 15780, "min": 0, "phaseoutStart": 200000, "phaseoutEnd": 400000},
                  9134, 0, 6180, 0.108, 0.174, 0.08)
    mb["benefits"] = [
        {"id": "mb_ratc", "name": "Manitoba renters affordability tax credit", "onReturn": True, "household": True,
         "max": 575, "rentShare": 0.20},
    ]
    mb["notes"] = [
        "Manitoba family tax benefit, Manitoba child benefit and the renters seniors' top-up are not modelled.",
        "The homeowners affordability tax credit is applied on the property tax bill, so it is not part of the return.",
    ]
    provinces["MB"] = mb

    nb = province("New Brunswick", 0.094, [51306, 102614, 190060], [0.094, 0.14, 0.16, 0.195], bpa_flat(13396),
                  10499, 1051, 10010, 0.094, 0.1795, 0.14)
    nb["taxReduction"] = {"type": "linear", "basic": 802, "spouse": 802, "threshold": 21918, "rate": 0.03,
                          "incomeBasis": "family"}
    nb["benefits"] = [
        {"id": "nb_hstc", "name": "New Brunswick harmonized sales tax credit", "adult": 300, "spouse": 300,
         "perChild": 100, "threshold": 35000, "rate": 0.02},
        {"id": "nb_ctb", "name": "New Brunswick child tax benefit", "perChild": 250, "threshold": 20000,
         "rateOneChild": 0.025, "rateMoreChildren": 0.05,
         "wisMax": 250, "wisPhaseInBase": 3750, "wisPhaseInRate": 0.04, "wisFrom": 20921, "wisTo": 25921},
    ]
    nb["notes"] = [
        "Low-income tax reduction amount/threshold are estimates (2024 values indexed; 2025 family maximum $1,604).",
    ]
    provinces["NB"] = nb

    ns = province("Nova Scotia", 0.0879, [29590, 59180, 93000, 150000], [0.0879, 0.1495, 0.1667, 0.175, 0.21],
                  bpa_flat(11744), 11744, 874, 7341, 0.0879, 0.21, 0.0885)
    ns["taxReduction"] = {"type": "linear", "basic": 300, "spouse": 300, "perChild": 165, "threshold": 15000,
                          "rate": 0.05, "incomeBasis": "family"}
    ns["benefits"] = [
        {"id": "ns_altc", "name": "Nova Scotia affordable living tax credit", "adult": 255, "perChild": 60,
         "threshold": 30000, "rate": 0.05},
        {"id": "ns_cb", "name": "Nova Scotia child benefit", "perChild": 1525, "fullBelow": 26000, "zeroAt": 34000},
    ]
    ns["notes"] = ["Nova Scotia child benefit modelled as a linear phase-out between $26,000 and $34,000 (estimate)."]
    provinces["NS"] = ns

    pe = province("Prince Edward Island", 0.095, [33328, 64656, 105000, 140000], [0.095, 0.1347, 0.166, 0.1762, 0.19],
                  bpa_flat(14650), 12443, 1244, 6890, 0.095, 0.19, 0.105)
    pe["taxReduction"] = {"type": "linear", "basic": 350, "spouse": 350, "perChild": 300, "threshold": 22650,
                          "rate": 0.05, "incomeBasis": "family"}
    pe["benefits"] = [
        {"id": "pe_ieb", "name": "PEI Island essentials benefit",
         "single": {"max": 310, "min": 175, "from": 95000, "to": 108500},
         "family": {"max": 365, "min": 175, "from": 95000, "to": 114000}},
        {"id": "pe_cb", "name": "PEI child benefit", "tiers": [{"below": 45000, "perChild": 410},
                                                              {"below": 80000, "perChild": 290}]},
    ]
    provinces["PE"] = pe

    nl = province("Newfoundland and Labrador", 0.087,
                  [44192, 88382, 157792, 220910, 282214, 564429, 1128858],
                  [0.087, 0.145, 0.158, 0.178, 0.198, 0.208, 0.213, 0.218], bpa_flat(11067), 9043, 905, 7467,
                  0.087, 0.218, 0.063)
    nl["taxReduction"] = {"type": "linear", "basic": 997, "spouse": 557, "threshold": 23928, "rate": 0.16,
                          "incomeBasis": "family"}
    nl["benefits"] = [
        {"id": "nl_is", "name": "Newfoundland and Labrador income supplement", "basic": 254, "phaseInExtra": 266,
         "phaseInBase": 15000, "phaseInRate": 0.0532, "spouse": 69, "perChild": 231, "threshold": 40000, "rate": 0.09},
        {"id": "nl_cb", "name": "Newfoundland and Labrador child benefit", "amounts": [1888, 2002, 2150, 2310],
         "fullBelow": 20397, "zeroAt": 38193},
        {"id": "nl_seniors", "name": "Newfoundland and Labrador seniors' benefit", "max": 1882, "minimumAge": 64,
         "threshold": 30409, "rate": 0.1166},
    ]
    nl["notes"] = [
        "NL income supplement uses 2025 benefit-year amounts; its phase-out rate (9%) is an estimate.",
        "NL child benefit modelled as a linear phase-out between $20,397 and $38,193 (estimate).",
        "NL seniors' benefit phase-out rate (11.66%) is an estimate.",
    ]
    provinces["NL"] = nl

    yt = province("Yukon", 0.064, [57375, 114750, 177882, 500000], [0.064, 0.09, 0.109, 0.128, 0.15],
                  {"followsFederal": True}, 16129, 0, 10138, 0.064, 0.128, 0.1202,
                  canadaEmploymentAmount=1471)
    yt["spouseAmount"]["followsFederal"] = True
    yt["benefits"] = [
        {"id": "yt_cb", "name": "Yukon child benefit", "perChild": 966, "threshold": 35000,
         "rateOneChild": 0.025, "rateMoreChildren": 0.05},
    ]
    yt["notes"] = ["Yukon low-income family tax credit is not modelled."]
    provinces["YT"] = yt

    nt = province("Northwest Territories", 0.059, [51964, 103930, 168967], [0.059, 0.086, 0.122, 0.1405],
                  bpa_flat(17842), 17842, 0, 14469, 0.059, 0.1405, 0.115)
    nt["benefits"] = [
        {"id": "nt_cb", "name": "Northwest Territories child benefit",
         "under6Monthly": [67.91, 122.25, 166.41, 203.75], "under6Extra": 30.58,
         "age6to17Monthly": [54.33, 97.83, 133.08, 163.00], "age6to17Extra": 24.41,
         "fullBelow": 30000, "zeroAt": 80000},
    ]
    nt["notes"] = ["NWT child benefit modelled as a linear phase-out between $30,000 and $80,000 (estimate)."]
    provinces["NT"] = nt

    nu = province("Nunavut", 0.04, [54707, 109413, 177881], [0.04, 0.07, 0.09, 0.115], bpa_flat(19274), 19274, 0,
                  16405, 0.04, 0.115, 0.0551)
    nu["benefits"] = [
        {"id": "nu_cb", "name": "Nunavut child benefit", "perChild": 696, "threshold": 22065,
         "rateOneChild": 0.025, "rateMoreChildren": 0.05,
         "workerOneChild": 290, "workerMoreChildren": 369, "workerIncomeBase": 3955},
    ]
    nu["notes"] = ["Nunavut child benefit uses the doubled 2026 amount ($696/child); its reduction rates (2.5%/5%) are estimates."]
    provinces["NU"] = nu

    qc = province("Quebec", 0.14, [53255, 106495, 129590], [0.14, 0.19, 0.24, 0.2575], bpa_flat(18571), 0, 0, 0,
                  0.20, 0.24, 0.117, top_donation=(0.2575, 129590))
    qc["quebec"] = {
        "livingAloneAmount": 2128,
        "workerDeductionRate": 0.06, "workerDeductionMax": 1420,
        "workPremium": {
            "singleRate": 0.116, "coupleRate": 0.116, "singleParentRate": 0.30, "coupleWithChildrenRate": 0.25,
            "singleExclusion": 2400, "coupleExclusion": 3600,
            "singleThreshold": 12620, "coupleThreshold": 19534, "reductionRate": 0.10,
        },
        "solidarity": {
            "_note": "July 2026–June 2027 amounts (based on 2025 return).",
            "qstBasic": 363, "qstSpouse": 363, "qstLivingAlone": 172,
            "housingCouple": 906, "housingSingle": 746, "housingPerChild": 158,
            "threshold": 43195, "rate": 0.06,
        },
        "familyAllowance": {
            "_note": "Calendar 2026 amounts (based on 2025 income).",
            "twoParentMax": 3068, "twoParentMin": 1221, "singleParentMax": 4145, "singleParentMin": 1651,
            "coupleThreshold": 60398, "singleParentThreshold": 44000, "rate": 0.04,
        },
    }
    qc["notes"] = [
        "Quebec is simplified: TP-1 is approximated with Quebec brackets, the basic, living-alone and donation credits, the deduction for workers and the dividend credit. Quebec disability, spouse-transfer and medical credits are not modelled.",
        "Federal tax for Quebec residents is reduced by the 16.5% Quebec abatement; QPP/QPIP and the reduced EI rate replace CPP/EI.",
        "The CWB uses the general federal parameters; Quebec, Alberta and Nunavut have modified CWB amounts.",
        "Family allowance reduction rate (4%) and single-parent threshold are estimates.",
    ]
    provinces["QC"] = qc

    return {
        "year": 2025,
        "federal": federal,
        "payroll": payroll,
        "benefits": benefits,
        "deductions": {"childCareCaps": {"under7": 8000, "age7to16": 5000, "dtcEligible": 11000},
                       "childCareEarnedIncomeFraction": 0.6666666667},
        "provinces": provinces,
    }


# --------------------------------------------------------------------------------------------
# 2026
# --------------------------------------------------------------------------------------------

def config_2026():
    c = config_2025()
    c["year"] = 2026
    est = "(estimate: 2025-return amounts indexed ~2%; replace when CRA publishes July 2027 amounts)"

    c["federal"].update({
        "brackets": brackets([58523, 117045, 181440, 258482], [0.14, 0.205, 0.26, 0.29, 0.33]),
        "lowestRate": 0.14,
        "basicPersonalAmount": {"base": 16452, "min": 14829, "phaseoutStart": 181440, "phaseoutEnd": 258482},
        "canadaEmploymentAmountMax": 1501,
        "disabilityAmount": 10341,
        "donationCredit": {"first200Rate": 0.14, "over200Rate": 0.29, "over200TopRate": 0.33,
                           "topRateIncomeThreshold": 258482},
    })
    c["payroll"] = {
        "cpp": {"ympe": 74600, "yampe": 85000, "basicExemption": 3500, "baseRate": 0.0495,
                "firstEnhancedRate": 0.01, "cpp2Rate": 0.04},
        "qpp": {"baseRate": 0.053, "firstEnhancedRate": 0.01, "qpp2Rate": 0.04},
        "ei": {"maxInsurableEarnings": 68900, "rate": 0.0163, "quebecRate": 0.013},
        "qpip": {"maxInsurableEarnings": 103000, "rate": 0.0043},
    }
    c["benefits"]["cwb"] = cwb(1666, 2869, 27392, 31252, 860, 38495, 50377)
    c["benefits"]["cwb"]["_note"] = "2026 CWB amounts are estimates (2025 × 1.02)."
    c["benefits"]["gstHst"].update({
        "_note": "CGEB for July 2027–June 2028 " + est,
        "baseAdult": 363, "baseSpouse": 363, "baseSingleParentFirstChild": 363, "perChild": 192,
        "singleAdditionalBase": 11795, "singleAdditionalMax": 191, "reductionBase": 47361,
    })
    c["benefits"]["ccb"].update({
        "_note": "CCB for July 2027–June 2028 " + est,
        "under6": 8320, "age6to17": 7021, "threshold1": 39002, "threshold2": 84504,
    })

    p = c["provinces"]

    on = p["ON"]
    on["brackets"] = brackets([53891, 107785, 150000, 220000], [0.0505, 0.0915, 0.1116, 0.1216, 0.1316])
    on["basicPersonalAmount"] = bpa_flat(12989)
    on["spouseAmount"] = {"max": 11029, "threshold": 1103}
    on["disabilityAmount"] = 10494
    on["surtax"] = [{"threshold": 5818, "rate": 0.20}, {"threshold": 7446, "rate": 0.36}]
    on["taxReduction"] = {"type": "ontario", "basic": 300, "perDependant": 554}
    on["benefits"][1].update({"perPerson": 385, "singleThreshold": 29599, "familyThreshold": 36999})
    on["benefits"][2].update({"perChild": 1793, "threshold": 27375})
    on["benefits"][3].update({"energyMax": 296, "propertyCap": 962, "propertyAddOn": 74,
                              "singleThreshold": 29599, "familyThreshold": 36999})
    on["benefits"][4].update({"singleMax": 193, "familyMax": 296, "singleThreshold": 51799, "familyThreshold": 66598})
    on["notes"] = on["notes"] + ["OSTC, Ontario child benefit, OEPTC and NOEC for July 2027 " + est,
                                 "CARE table assumed unchanged for 2026."]

    bc = p["BC"]
    bc["brackets"] = brackets([50363, 100728, 115648, 140430, 190405, 265545],
                              [0.056, 0.077, 0.105, 0.1229, 0.147, 0.168, 0.205])
    bc["lowestRate"] = 0.056
    bc["basicPersonalAmount"] = bpa_flat(13216)
    bc["spouseAmount"] = {"max": 11317, "threshold": 1132}
    bc["disabilityAmount"] = 9913
    bc["donationCredit"] = {"first200Rate": 0.056, "over200Rate": 0.168, "topRate": 0.205,
                            "topRateIncomeThreshold": 265545}
    bc["taxReduction"] = {"type": "linear", "basic": 690, "threshold": 25570, "rate": 0.0356, "incomeBasis": "individual"}
    bc["benefits"][1].update({"threshold": 66189})
    bc["notes"] = ["B.C. family benefit for July 2027 assumed unchanged (estimate).",
                   "B.C. renter's tax credit 2026 threshold is an estimate (2025 × 1.022)."]

    ab = p["AB"]
    ab["brackets"] = brackets([61200, 154259, 185111, 246813, 370220], [0.08, 0.10, 0.12, 0.13, 0.14, 0.15])
    ab["basicPersonalAmount"] = bpa_flat(22769)
    ab["spouseAmount"] = {"max": 22769, "threshold": 0}
    ab["disabilityAmount"] = 17563
    ab["notes"].append("ACFB for July 2027 assumed unchanged (estimate).")

    sk = p["SK"]
    sk["brackets"] = brackets([54532, 155805], [0.105, 0.125, 0.145])
    sk["basicPersonalAmount"] = bpa_flat(20381)
    sk["spouseAmount"] = {"max": 20381, "threshold": 2038}
    sk["disabilityAmount"] = 14266
    sk["notes"] = ["Saskatchewan low-income tax credit for July 2027 assumed unchanged (estimate)."]

    p["MB"]["benefits"][0]["max"] = 625
    nb = p["NB"]
    nb["brackets"] = brackets([52333, 104666, 193861], [0.094, 0.14, 0.16, 0.195])
    nb["basicPersonalAmount"] = bpa_flat(13664)
    nb["spouseAmount"] = {"max": 10709, "threshold": 1072}
    nb["disabilityAmount"] = 10210
    nb["taxReduction"].update({"basic": 818, "spouse": 818, "threshold": 22356})

    ns = p["NS"]
    ns["brackets"] = brackets([30995, 61991, 97417, 157124], [0.0879, 0.1495, 0.1667, 0.175, 0.21])
    ns["basicPersonalAmount"] = bpa_flat(11932)
    ns["spouseAmount"] = {"max": 11932, "threshold": 888}
    ns["notes"].append("Nova Scotia low-income tax reduction assumed unchanged for 2026 (estimate).")

    pe = p["PE"]
    pe["brackets"] = brackets([33928, 65820, 106890, 142250, 200000], [0.095, 0.1347, 0.166, 0.1762, 0.19, 0.20])
    pe["basicPersonalAmount"] = bpa_flat(15000)
    pe["spouseAmount"] = {"max": 12740, "threshold": 1274}
    pe["donationCredit"] = {"first200Rate": 0.095, "over200Rate": 0.20}
    pe["taxReduction"]["threshold"] = 23000

    nl = p["NL"]
    nl["brackets"] = brackets([44678, 89354, 159528, 223340, 285319, 570638, 1141275],
                              [0.087, 0.145, 0.158, 0.178, 0.198, 0.208, 0.213, 0.218])
    nl["basicPersonalAmount"] = bpa_flat(13094)
    nl["spouseAmount"] = {"max": 9142, "threshold": 915}
    nl["disabilityAmount"] = 7549
    nl["taxReduction"].update({"basic": 842, "spouse": 563, "threshold": 24191})
    nl["notes"].append("NL low-income tax reduction threshold for 2026 is an estimate (2025 × 1.011).")

    yt = p["YT"]
    yt["brackets"] = brackets([58523, 117045, 181440, 500000], [0.064, 0.09, 0.109, 0.128, 0.15])
    yt["disabilityAmount"] = 10341
    yt["canadaEmploymentAmount"] = 1501

    nt = p["NT"]
    nt["brackets"] = brackets([53003, 106009, 172346], [0.059, 0.086, 0.122, 0.1405])
    nt["basicPersonalAmount"] = bpa_flat(18198)
    nt["spouseAmount"] = {"max": 18198, "threshold": 0}
    nt["disabilityAmount"] = 14758

    nu = p["NU"]
    nu["brackets"] = brackets([55801, 111602, 181439], [0.04, 0.07, 0.09, 0.115])
    nu["basicPersonalAmount"] = bpa_flat(19659)
    nu["spouseAmount"] = {"max": 19659, "threshold": 0}
    nu["disabilityAmount"] = 16733

    qc = p["QC"]
    qc["brackets"] = brackets([54345, 108680, 132245], [0.14, 0.19, 0.24, 0.2575])
    qc["basicPersonalAmount"] = bpa_flat(18952)
    qc["donationCredit"] = {"first200Rate": 0.20, "over200Rate": 0.24, "topRate": 0.2575,
                            "topRateIncomeThreshold": 132245}
    q = qc["quebec"]
    q["livingAloneAmount"] = 2172
    q["workerDeductionMax"] = 1450
    q["workPremium"].update({"singleThreshold": 12808, "coupleThreshold": 19828})
    q["solidarity"].update({"_note": "July 2027–June 2028 " + est, "qstBasic": 370, "qstSpouse": 370,
                            "qstLivingAlone": 175, "housingCouple": 924, "housingSingle": 761,
                            "housingPerChild": 161, "threshold": 44059})
    q["familyAllowance"]["_note"] = "Calendar 2027 " + est

    # Mark indexed benefit carry-forwards
    for code in ["NS", "PE", "NL", "YT", "NT", "NB", "SK", "AB", "BC"]:
        p[code].setdefault("notes", [])
    for code in ["NS", "PE", "NL", "YT", "NT", "NB"]:
        p[code]["notes"].append("Benefits paid from July 2027 assumed unchanged from July 2026 amounts (estimate).")
    return c


def main():
    for cfg in (config_2025(), config_2026()):
        path = os.path.join(OUT_DIR, f"{cfg['year']}.json")
        with open(path, "w") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print("wrote", os.path.relpath(path))


if __name__ == "__main__":
    main()

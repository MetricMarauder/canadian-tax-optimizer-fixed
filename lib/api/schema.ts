import { z } from 'zod';
import { PROVINCE_CODES, PROVINCES, SUPPORTED_YEARS } from '@/lib/tax/config';

/** Accepts a two-letter code ('ON') or a full name ('Ontario'), case-insensitive. */
const ProvinceSchema = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  const byName = PROVINCES.find((p) => p.name.toLowerCase() === t.toLowerCase());
  return byName ? byName.code : t.toUpperCase();
}, z.enum(PROVINCE_CODES));

const YearSchema = z.coerce
  .number()
  .int()
  .refine((y) => (SUPPORTED_YEARS as readonly number[]).includes(y), {
    message: `Supported tax years: ${SUPPORTED_YEARS.join(', ')}`,
  });

const PersonIncomeSchema = z.object({
  employment: z.number().min(0).default(0),
  other: z.number().min(0).default(0),
  capitalGains: z.number().min(0).default(0),
  eligibleDividends: z.number().min(0).default(0),
});

const PersonDeductionsSchema = z.object({
  rrspContributions: z.number().min(0).default(0),
  rrspDeductionLimit: z.number().min(0).default(0),
  fhsaContributions: z.number().min(0).default(0),
  rppContributions: z.number().min(0).default(0),
  unionDues: z.number().min(0).default(0),
  childCareExpenses: z.number().min(0).default(0),
  numChildrenUnder7: z.number().int().min(0).default(0),
  numChildren7to16: z.number().int().min(0).default(0),
  numChildrenDTCEligible: z.number().int().min(0).default(0),
});

const PersonCreditsSchema = z.object({
  hasDisabilityDTC: z.boolean().default(false),
  donations: z.number().min(0).default(0),
  tuitionFees: z.number().min(0).default(0),
});

const PersonBenefitsSchema = z.object({
  cwbEligible: z.boolean().default(false),
  cwbDisabilityEligible: z.boolean().default(false),
  includeBenefitsEstimates: z.boolean().default(true),
});

const PersonInputSchema = z.object({
  age: z.number().int().min(0).max(120),
  province: ProvinceSchema.optional(),
  income: PersonIncomeSchema,
  deductions: PersonDeductionsSchema,
  credits: PersonCreditsSchema,
  benefits: PersonBenefitsSchema,
  taxesWithheld: z.number().min(0).default(0),
});

const HouseholdSettingsSchema = z.object({
  maritalStatus: z.enum(['single', 'married', 'commonlaw']),
  claimant: z.enum(['taxpayer', 'spouse']).default('taxpayer'),
  tuitionTransferAmount: z.number().min(0).default(0),
});

export const CalculateRequestSchema = z.object({
  year: YearSchema.default(2025),
  province: ProvinceSchema,
  household: HouseholdSettingsSchema,
  taxpayer: PersonInputSchema,
  spouse: PersonInputSchema.optional(),
});

export type CalculateRequestParsed = z.infer<typeof CalculateRequestSchema>;

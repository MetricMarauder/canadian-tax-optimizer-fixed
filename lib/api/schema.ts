import { z } from 'zod';

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
  province: z.literal('Ontario').default('Ontario'),
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
  province: z.literal('Ontario'),
  household: HouseholdSettingsSchema,
  taxpayer: PersonInputSchema,
  spouse: PersonInputSchema.optional(),
});

export type CalculateRequestParsed = z.infer<typeof CalculateRequestSchema>;

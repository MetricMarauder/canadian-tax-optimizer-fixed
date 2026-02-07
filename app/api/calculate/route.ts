import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { CalculateRequest, CalculateResponse } from '@/lib/api/types';
import { calculateOptimizedHousehold } from '@/lib/tax/household';

// Basic runtime validation (expand later)
const PersonSchema = z.object({
  age: z.number().int().min(0),
  province: z.literal('Ontario'),
  income: z.object({
    employment: z.number().min(0),
    other: z.number().min(0),
    capitalGains: z.number().min(0),
    eligibleDividends: z.number().min(0),
  }),
  deductions: z.object({
    rrspContributions: z.number().min(0),
    rrspDeductionLimit: z.number().min(0),
    fhsaContributions: z.number().min(0).optional(),
    rppContributions: z.number().min(0),
    unionDues: z.number().min(0),
    childCareExpenses: z.number().min(0),
    numChildrenUnder7: z.number().min(0),
    numChildren7to16: z.number().min(0),
    numChildrenDTCEligible: z.number().min(0),
  }),
  credits: z.object({
    hasDisabilityDTC: z.boolean(),
    donations: z.number().min(0),
    tuitionFees: z.number().min(0),
  }),
  benefits: z.object({
    cwbEligible: z.boolean(),
    cwbDisabilityEligible: z.boolean(),
    includeBenefitsEstimates: z.boolean(),
  }),
  taxesWithheld: z.number().min(0),
});

const ReqSchema = z.object({
  province: z.literal('Ontario'),
  household: z.object({
    maritalStatus: z.enum(['single', 'married', 'commonlaw']),
    claimant: z.enum(['taxpayer', 'spouse']),
    tuitionTransferAmount: z.number().min(0).optional(),
  }),
  taxpayer: PersonSchema,
  spouse: PersonSchema.optional(),
});

export async function POST(req: Request) {
  try {
    const json = (await req.json()) as CalculateRequest;
    const parsed = ReqSchema.parse(json);
    const out: CalculateResponse = calculateOptimizedHousehold(parsed);

    return NextResponse.json(out);
  } catch (e: any) {
    return new NextResponse(e?.message ?? 'Bad Request', { status: 400 });
  }
}

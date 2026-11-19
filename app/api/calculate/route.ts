import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import type { CalculateResponse } from '@/lib/api/types';
import { CalculateRequestSchema } from '@/lib/api/schema';
import { calculateOptimizedHousehold } from '@/lib/tax/household';

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return new NextResponse('Request body must be valid JSON.', { status: 400 });
  }

  try {
    const parsed = CalculateRequestSchema.parse(json);
    // The household's province applies to both returns (residence on December 31).
    const out: CalculateResponse = calculateOptimizedHousehold({
      ...parsed,
      taxpayer: { ...parsed.taxpayer, province: parsed.province },
      spouse: parsed.spouse ? { ...parsed.spouse, province: parsed.province } : undefined,
    });
    return NextResponse.json(out);
  } catch (e: any) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: 'Invalid request', issues: e.issues }, { status: 400 });
    }
    console.error(e);
    return new NextResponse('Internal error while calculating.', { status: 500 });
  }
}

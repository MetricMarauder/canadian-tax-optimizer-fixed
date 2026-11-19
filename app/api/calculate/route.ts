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
    const out: CalculateResponse = calculateOptimizedHousehold(parsed);
    return NextResponse.json(out);
  } catch (e: any) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: 'Invalid request', issues: e.issues }, { status: 400 });
    }
    console.error(e);
    return new NextResponse('Internal error while calculating.', { status: 500 });
  }
}

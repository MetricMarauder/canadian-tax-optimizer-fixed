import { ZodError } from 'zod';
import type { CalculateResponse } from '@/lib/api/types';
import { CalculateRequestSchema } from '@/lib/api/schema';
import { calculateOptimizedHousehold } from '@/lib/tax/household';

/**
 * Validates a request and runs the household calculation. Runs entirely in the
 * browser, so no income data is sent to a server.
 */
export function calculate(input: unknown): CalculateResponse {
  try {
    const parsed = CalculateRequestSchema.parse(input);
    // The household's province applies to both returns (residence on December 31).
    return calculateOptimizedHousehold({
      ...parsed,
      taxpayer: { ...parsed.taxpayer, province: parsed.province },
      spouse: parsed.spouse ? { ...parsed.spouse, province: parsed.province } : undefined,
    });
  } catch (e) {
    if (e instanceof ZodError) {
      const msg = e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
      throw new Error(`Invalid input: ${msg}`);
    }
    throw e;
  }
}

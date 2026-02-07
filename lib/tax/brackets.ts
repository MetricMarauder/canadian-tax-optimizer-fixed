export type Bracket = { upTo: number | null; rate: number };

export function taxFromBrackets(taxableIncome: number, brackets: Bracket[]): number {
  const income = Math.max(0, taxableIncome);
  let remaining = income;
  let lastCap = 0;
  let tax = 0;

  for (const b of brackets) {
    const cap = b.upTo ?? Infinity;
    const width = Math.max(0, cap - lastCap);
    const amt = Math.min(remaining, width);
    if (amt <= 0) break;
    tax += amt * b.rate;
    remaining -= amt;
    lastCap = cap;
    if (remaining <= 0) break;
  }

  // Round to cents
  return Math.round(tax * 100) / 100;
}

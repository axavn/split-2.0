// All amounts move through the app as INTEGER CENTS and only become dollar
// strings at render time. 0.1 + 0.2 !== 0.3 in floating point; integers are
// exact, so money math stays exact.

// Parses a user-typed amount ("42", "42.5", "42.50") into integer cents,
// or null if it isn't a valid money amount. String surgery instead of
// parseFloat on purpose: Number("42.50") * 100 goes through floating point
// (and e.g. 4.56 * 100 === 455.9999…); splitting the digits keeps everything
// in exact integer math.
export function parseAmountToCents(raw: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!match) return null;
  const dollars = Number(match[1]);
  const cents = match[2] ? Number(match[2].padEnd(2, '0')) : 0;
  return dollars * 100 + cents;
}

export function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}$${(abs / 100).toFixed(2)}`;
}

// Splits a total into `count` parts that differ by at most one cent and sum
// exactly to the total. 1000 / 3 -> [334, 333, 333]: the leftover cents from
// integer division are handed out one each to the first entries.
export function splitCentsEvenly(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

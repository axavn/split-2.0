// All amounts move through the app as INTEGER CENTS and only become dollar
// strings at render time. 0.1 + 0.2 !== 0.3 in floating point; integers are
// exact, so money math stays exact.

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

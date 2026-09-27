// Keeps only known numeric fields from untrusted client data — used wherever we store a
// client-reported metrics/analytics object, so a bad payload can't reshape our documents
// or crash a save() with a Mongoose cast error.
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function pickNumbers<K extends string>(input: unknown, keys: readonly K[]): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  if (!input || typeof input !== 'object') return out;
  const s = input as Record<string, unknown>;
  for (const k of keys) {
    if (isFiniteNumber(s[k])) out[k] = s[k] as number;
  }
  return out;
}

// For an object whose keys aren't known ahead of time (e.g. an emotion histogram) but whose
// values must all be finite numbers. Caps the key count so a payload can't grow unbounded.
export function pickNumberRecord(input: unknown, maxKeys = 10): Record<string, number> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= maxKeys) break;
    if (k.length <= 32 && isFiniteNumber(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

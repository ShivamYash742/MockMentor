import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickNumbers, pickNumberRecord } from './sanitize.ts';
import { sanitizeFaceAnalytics } from './faceAnalytics.ts';

test('pickNumbers keeps only known finite-number fields', () => {
  const out = pickNumbers({ a: 1, b: 'nope', c: NaN, d: Infinity, e: 2 }, ['a', 'b', 'c', 'd', 'z'] as const);
  assert.deepEqual(out, { a: 1 });
});

test('pickNumbers ignores non-objects', () => {
  assert.deepEqual(pickNumbers(null, ['a']), {});
  assert.deepEqual(pickNumbers('x', ['a']), {});
});

test('pickNumberRecord keeps only numeric entries and caps the count', () => {
  const input: Record<string, unknown> = {};
  for (let i = 0; i < 20; i++) input[`k${i}`] = i;
  input.bad = 'x';
  const out = pickNumberRecord(input, 5);
  assert.equal(Object.keys(out!).length, 5);
  assert.ok(Object.values(out!).every((v) => typeof v === 'number'));
});

test('sanitizeFaceAnalytics drops unknown fields and keeps known numbers', () => {
  const out = sanitizeFaceAnalytics({
    duration_s: 42,
    stress_avg: 0.5,
    __proto__: { polluted: true },
    unknownField: 'inject-me',
    emotions_avg: { happy: 0.5, notAnEmotion: 'x' },
  });
  assert.equal(out?.duration_s, 42);
  assert.equal(out?.stress_avg, 0.5);
  assert.equal((out as Record<string, unknown>).unknownField, undefined);
  assert.deepEqual(out?.emotions_avg, { happy: 0.5 });
});

test('sanitizeFaceAnalytics caps and sanitizes questionSnapshots', () => {
  const snapshots = Array.from({ length: 30 }, (_, i) => ({ duration_s: i, junk: 'x' }));
  const out = sanitizeFaceAnalytics({ questionSnapshots: snapshots });
  assert.equal(out?.questionSnapshots?.length, 20);
  assert.deepEqual(out?.questionSnapshots?.[0], { duration_s: 0 });
});

test('sanitizeFaceAnalytics returns null for garbage input', () => {
  assert.equal(sanitizeFaceAnalytics(null), null);
  assert.equal(sanitizeFaceAnalytics('hello'), null);
  assert.equal(sanitizeFaceAnalytics({ junk: 'only' }), null);
});

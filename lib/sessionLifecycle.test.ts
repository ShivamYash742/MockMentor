import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeSession, computeSessionMetrics, sanitizeTiming } from './sessionLifecycle.ts';

const start = new Date('2026-09-30T10:00:00Z');
const end = new Date('2026-09-30T10:03:00Z');
const messages = [
  { sender: 'interviewer', text: 'Tell me about a project.' },
  { sender: 'user', text: 'one two three four five six', duration: 3000, pauseBefore: 800 },
  { sender: 'interviewer', text: 'How did you test it?' },
  { sender: 'user', text: 'A typed answer with no timing.' },
];

test('metrics come from the stored transcript and the session clock', () => {
  const m = computeSessionMetrics(messages, start, end);
  assert.equal(m.totalDuration, 180000);
  assert.equal(m.userSpeakingTime, 3000);
  assert.equal(m.wordsPerMinute, 120); // spoken answer only: 6 words in 3 s
  assert.equal(m.totalPauses, 1);
  assert.equal(m.interruptionCount, 0);
});

test('timing from the client is clamped and non-numbers are dropped', () => {
  assert.deepEqual(sanitizeTiming({ durationMs: 4200.7, pauseBefore: 800 }), { duration: 4201, pauseBefore: 800 });
  assert.deepEqual(sanitizeTiming({ durationMs: 1e12, pauseBefore: -5 }), { duration: 600000, pauseBefore: 0 });
  assert.deepEqual(sanitizeTiming({ durationMs: 'x', pauseBefore: NaN }), {});
  assert.deepEqual(sanitizeTiming(null), {});
});

test('closeSession ends the session with metrics and sanitized camera data, keeping any it had', async () => {
  let saved = 0;
  const session = { messages, startTime: start, status: 'active', save: async () => { saved++; } } as Parameters<typeof closeSession>[0];
  await closeSession(session, end, { stress_avg: 2.5, junk: 'x' });
  assert.equal(session.status, 'completed');
  assert.equal(session.endTime, end);
  assert.equal((session.metrics as { totalDuration: number }).totalDuration, 180000);
  assert.deepEqual(session.faceAnalytics, { stress_avg: 2.5 });
  assert.equal(saved, 1);

  await closeSession(session, end, { stress_avg: 9 });
  assert.deepEqual(session.faceAnalytics, { stress_avg: 2.5 }); // the first summary wins
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateSession, combineSummaries, type AggregatedSummary } from './faceAnalysis.ts';

const neutral = { happy: 0, sad: 0, angry: 0, surprised: 0, fear: 0, disgust: 0, neutral: 1 };

// n frames, one per `stepS` seconds, with a blink every `blinkEvery` frames.
function frames(n: number, stepS: number, blinkEvery: number, stress = 2) {
  return Array.from({ length: n }, (_, i) => ({
    ts: i * stepS,
    face_detected: true,
    emotions: neutral,
    dominant: 'neutral',
    head_pose: { yaw: 0, pitch: 0, roll: 0 },
    gaze: { x: 0, y: 0, looking_at_screen: i % 2 === 0 },
    eye: { ear: 0.3, blink_count: Math.floor(i / blinkEvery), blinks_per_min: i < 10 ? 600 : 15 },
    hands: { movement: 0, fidget_level: 'low' },
    posture: { shoulder_tilt: 0, lean: 'upright' },
    stress_score: stress,
    engagement: 0.8,
    confidence: 0.7,
    attention: 0.9,
  }));
}

test('blink rate is total blinks over the window, not an average of noisy running rates', () => {
  // 601 frames over 60s, a blink every 40 frames (4s) → 15 blinks → 15/min. The per-frame
  // running rate is wildly high for the first frames, which used to inflate the average.
  const summary = aggregateSession(frames(601, 0.1, 40));
  assert.equal(summary.total_blinks, 15);
  assert.equal(summary.blinks_per_min_avg, 15);
});

test('combineSummaries weights averages by frames and sums totals', () => {
  const a: AggregatedSummary = { ...aggregateSession(frames(100, 0.1, 50, 2)) };
  const b: AggregatedSummary = { ...aggregateSession(frames(300, 0.1, 50, 6)) };
  const whole = combineSummaries([a, b])!;
  assert.equal(whole.frame_count, 400);
  assert.equal(whole.stress_avg, 5); // (2*100 + 6*300) / 400
  assert.equal(whole.stress_peak, 6);
  assert.equal(whole.total_blinks, a.total_blinks + b.total_blinks);
  assert.equal(whole.duration_s, Math.round((a.duration_s + b.duration_s) * 1000) / 1000);
  assert.equal(whole.emotions_avg.neutral, 1);
  assert.equal(whole.attention_on_screen_frac, 0.5);
});

test('combineSummaries skips empty segments and returns null when there is no data', () => {
  assert.equal(combineSummaries([]), null);
  const empty = aggregateSession([]);
  assert.equal(combineSummaries([empty]), null);
  const one = aggregateSession(frames(50, 0.1, 10));
  assert.equal(combineSummaries([empty, one])!.frame_count, 50);
});

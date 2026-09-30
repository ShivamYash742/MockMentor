import { computeSpeechMetrics, type SpeechMetrics } from './speechMetrics.ts';
import { sanitizeFaceAnalytics } from './faceAnalytics.ts';

interface StoredMessage {
  sender: string;
  text: string;
  duration?: number;
  pauseBefore?: number;
}

export interface SessionMetrics extends SpeechMetrics {
  totalDuration: number;
  interruptionCount: number;
}

// Metrics come from the server's own copy of the transcript, never from the client, so they
// exist even when the tab was closed before the client could send them.
export function computeSessionMetrics(messages: StoredMessage[], startTime: Date, endTime: Date): SessionMetrics {
  const totalDuration = Math.max(0, endTime.getTime() - startTime.getTime());
  const answers = messages
    .filter((m) => m.sender === 'user')
    .map((m) => ({ content: m.text, durationMs: m.duration, pauseBefore: m.pauseBefore }));
  return {
    totalDuration,
    ...computeSpeechMetrics(answers, totalDuration),
    interruptionCount: 0, // not tracked — no interruption-detection signal exists
  };
}

interface ClosableSession {
  messages: StoredMessage[];
  startTime: Date;
  endTime?: Date;
  status: string;
  metrics?: unknown;
  faceAnalytics?: unknown;
  save(): Promise<unknown>;
}

// Ends an active session: used by the client's "end", by the stale-interview auto-close, and by
// generate-report when the client's "end" never arrived. faceAnalytics is untrusted client data.
export async function closeSession(session: ClosableSession, endTime: Date, faceAnalytics?: unknown) {
  session.endTime = endTime;
  session.status = 'completed';
  session.metrics = computeSessionMetrics(session.messages, session.startTime, endTime);
  const face = sanitizeFaceAnalytics(faceAnalytics);
  if (face && !session.faceAnalytics) session.faceAnalytics = face;
  await session.save();
}

// Timing the client measured for a spoken answer. Clamped: it's untrusted, and feeds the report.
const MAX_TIMING_MS = 10 * 60 * 1000;
export function sanitizeTiming(input: unknown): { duration?: number; pauseBefore?: number } {
  const clamp = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_TIMING_MS, Math.max(0, Math.round(v))) : undefined;
  const t = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: { duration?: number; pauseBefore?: number } = {};
  const duration = clamp(t.durationMs);
  const pauseBefore = clamp(t.pauseBefore);
  if (duration !== undefined) out.duration = duration;
  if (pauseBefore !== undefined) out.pauseBefore = pauseBefore;
  return out;
}

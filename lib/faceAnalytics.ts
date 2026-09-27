import { pickNumbers, pickNumberRecord } from './sanitize.ts';

const SUMMARY_NUMBER_KEYS = [
  'duration_s', 'frame_count', 'stress_avg', 'stress_peak', 'engagement_avg',
  'confidence_avg', 'attention_avg', 'attention_on_screen_frac', 'total_blinks', 'blinks_per_min_avg',
] as const;

const MAX_SNAPSHOTS = 20;

// Mirrors FaceSummary (lib/mlSidecar.ts) field-for-field, but every field is optional since
// sanitizing can drop any of them — a client that omits or corrupts one shouldn't lose the rest.
interface SummaryFields {
  duration_s?: number;
  frame_count?: number;
  stress_avg?: number;
  stress_peak?: number;
  engagement_avg?: number;
  confidence_avg?: number;
  attention_avg?: number;
  attention_on_screen_frac?: number;
  total_blinks?: number;
  blinks_per_min_avg?: number;
  emotions_avg?: Record<string, number>;
  dominant_histogram?: Record<string, number>;
}

function sanitizeSummary(input: unknown): SummaryFields | null {
  if (!input || typeof input !== 'object') return null;
  const s = input as Record<string, unknown>;
  const out: SummaryFields = { ...pickNumbers(s, SUMMARY_NUMBER_KEYS) };

  const emotions = pickNumberRecord(s.emotions_avg);
  if (emotions) out.emotions_avg = emotions;

  const dominant = pickNumberRecord(s.dominant_histogram);
  if (dominant) out.dominant_histogram = dominant;

  return Object.keys(out).length ? out : null;
}

export type SanitizedFaceAnalytics = SummaryFields & { questionSnapshots?: SummaryFields[] };

// The client reports face-tracking data (mediapipe runs in-browser), so it's never trusted
// as-is: this keeps only known numeric fields and caps the snapshot list before it's stored.
export function sanitizeFaceAnalytics(input: unknown): SanitizedFaceAnalytics | null {
  if (!input || typeof input !== 'object') return null;

  const summary = sanitizeSummary(input);
  const rawSnapshots = (input as Record<string, unknown>).questionSnapshots;
  const questionSnapshots = Array.isArray(rawSnapshots)
    ? rawSnapshots.slice(0, MAX_SNAPSHOTS).map(sanitizeSummary).filter((s): s is SummaryFields => s !== null)
    : undefined;

  if (!summary && !questionSnapshots?.length) return null;
  return { ...summary, ...(questionSnapshots?.length ? { questionSnapshots } : {}) };
}

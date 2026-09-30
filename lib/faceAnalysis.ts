/**
 * Face analysis algorithms — ported from Python ML sidecar to TypeScript.
 * Runs client-side using MediaPipe Tasks Vision API output.
 */

// ─── Smoothing ───────────────────────────────────────────────────────────────

export class EMA {
  private alpha: number;
  private _val: Record<string, number> | number | null = null;

  constructor(alpha = 0.3) {
    this.alpha = alpha;
  }

  update<T extends Record<string, number> | number>(x: T): T {
    if (this._val === null) {
      this._val = x;
    } else if (typeof x === 'object' && typeof this._val === 'object') {
      const prev = this._val as Record<string, number>;
      const next: Record<string, number> = {};
      for (const k of Object.keys(x)) {
        next[k] = this.alpha * (x as Record<string, number>)[k] + (1 - this.alpha) * (prev[k] ?? (x as Record<string, number>)[k]);
      }
      this._val = next;
    } else if (typeof x === 'number') {
      this._val = this.alpha * x + (1 - this.alpha) * (this._val as number);
    }
    return this._val as T;
  }

  get value() {
    return this._val;
  }

  reset() {
    this._val = null;
  }
}

export class WindowSmooth {
  private buf: number[] = [];
  private maxlen: number;

  constructor(maxlen = 5) {
    this.maxlen = maxlen;
  }

  update(x: number): number {
    this.buf.push(x);
    if (this.buf.length > this.maxlen) this.buf.shift();
    return this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
  }

  reset() {
    this.buf = [];
  }
}

// ─── Face landmark indices ──────────────────────────────────────────────────

export const LEFT_EYE = [33, 160, 158, 133, 153, 144];
export const RIGHT_EYE = [263, 387, 385, 362, 380, 373];

// Iris centers
const IRIS_LEFT = 468;
const IRIS_RIGHT = 473;
const LEFT_OUTER = 33;
const LEFT_INNER = 133;
const RIGHT_INNER = 362;
const RIGHT_OUTER = 263;
const LEFT_TOP = 159;
const LEFT_BOT = 145;
const RIGHT_TOP = 386;
const RIGHT_BOT = 374;

const EPSILON = 1e-6;

function safeDist(a: number[], b: number[]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) + EPSILON;
}

// ─── Eye Aspect Ratio (EAR) ─────────────────────────────────────────────────

export function eyeAspectRatio(
  landmarks: Array<{ x: number; y: number }>,
  eyeIndices: number[],
): number {
  try {
    const pts = eyeIndices.map(i => [landmarks[i].x, landmarks[i].y]);
    const vertical = safeDist(pts[1], pts[5]) + safeDist(pts[2], pts[4]);
    const horizontal = safeDist(pts[0], pts[3]);
    return vertical / (2.0 * horizontal);
  } catch {
    return 0.3;
  }
}

// ─── Emotion classification ─────────────────────────────────────────────────

export interface EmotionScores {
  [key: string]: number;
  happy: number;
  sad: number;
  angry: number;
  surprised: number;
  fear: number;
  disgust: number;
  neutral: number;
}

const WEIGHTS: Record<string, Record<string, number>> = {
  happy: {
    mouthSmileLeft: 1.2,
    mouthSmileRight: 1.2,
    cheekSquintLeft: 0.6,
    cheekSquintRight: 0.6,
    mouthDimpleLeft: 0.4,
    mouthDimpleRight: 0.4,
  },
  sad: {
    mouthFrownLeft: 1.0,
    mouthFrownRight: 1.0,
    browInnerUp: 0.7,
    mouthStretchLeft: 0.4,
    mouthStretchRight: 0.4,
    mouthShrugLower: 0.3,
  },
  angry: {
    browDownLeft: 1.2,
    browDownRight: 1.2,
    noseSneerLeft: 0.8,
    noseSneerRight: 0.8,
    mouthPressLeft: 0.5,
    mouthPressRight: 0.5,
    eyeSquintLeft: 0.4,
    eyeSquintRight: 0.4,
  },
  surprised: {
    jawOpen: 1.2,
    eyeWideLeft: 1.0,
    eyeWideRight: 1.0,
    browOuterUpLeft: 0.8,
    browOuterUpRight: 0.8,
    mouthFunnel: 0.3,
  },
  fear: {
    browInnerUp: 0.9,
    eyeWideLeft: 0.9,
    eyeWideRight: 0.9,
    mouthStretchLeft: 0.7,
    mouthStretchRight: 0.7,
    mouthShrugUpper: 0.4,
  },
  disgust: {
    noseSneerLeft: 1.2,
    noseSneerRight: 1.2,
    mouthLowerDownLeft: 0.5,
    mouthLowerDownRight: 0.5,
    mouthUpperUpLeft: 0.4,
    mouthUpperUpRight: 0.4,
    mouthPucker: 0.3,
  },
};

const WEIGHT_SUMS: Record<string, number> = {};
for (const [emotion, w] of Object.entries(WEIGHTS)) {
  WEIGHT_SUMS[emotion] = Object.values(w).reduce((a, b) => a + b, 0);
}

export const EMOTIONS = ['happy', 'sad', 'angry', 'surprised', 'fear', 'disgust', 'neutral'] as const;

export function blendshapesToDict(
  blendshapeList: Array<{ categoryName: string; score: number }>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const bs of blendshapeList) {
    result[bs.categoryName] = bs.score;
  }
  return result;
}

export function classifyEmotions(
  blendshapeList: Array<{ categoryName: string; score: number }>,
): EmotionScores {
  const bs = blendshapesToDict(blendshapeList);

  const raw: Record<string, number> = {};
  for (const [emotion, weights] of Object.entries(WEIGHTS)) {
    let score = 0;
    for (const [name, w] of Object.entries(weights)) {
      score += (bs[name] ?? 0) * w;
    }
    raw[emotion] = score / WEIGHT_SUMS[emotion];
  }

  // Boost separation: square root amplifies weak signals
  const boosted: Record<string, number> = {};
  for (const [e, v] of Object.entries(raw)) {
    boosted[e] = Math.sqrt(Math.max(0, v));
  }

  const totalNonNeutral = Object.values(boosted).reduce((a, b) => a + b, 0);

  let neutral: number;
  if (totalNonNeutral < 0.4) {
    neutral = 1.0 - totalNonNeutral * 0.8;
  } else {
    neutral = Math.max(0, 1.0 - totalNonNeutral);
  }

  boosted.neutral = neutral;
  const grandTotal = Object.values(boosted).reduce((a, b) => a + b, 0) + EPSILON;

  const result: Record<string, number> = {};
  for (const e of EMOTIONS) {
    result[e] = Math.round((boosted[e] ?? 0) / grandTotal * 10000) / 10000;
  }

  return result as unknown as EmotionScores;
}

export function dominantEmotion(scores: EmotionScores): string {
  let maxVal = -Infinity;
  let maxKey = 'neutral';
  for (const [k, v] of Object.entries(scores)) {
    if (v > maxVal) {
      maxVal = v;
      maxKey = k;
    }
  }
  return maxKey;
}

// ─── Gaze tracking ──────────────────────────────────────────────────────────

export interface GazeResult {
  x: number;
  y: number;
  looking_at_screen: boolean;
}

function irisOffset(
  iris: { x: number; y: number },
  outer: { x: number; y: number },
  inner: { x: number; y: number },
  top: { x: number; y: number },
  bot: { x: number; y: number },
): [number, number] {
  const spanX = Math.abs(outer.x - inner.x) + EPSILON;
  const spanY = Math.abs(top.y - bot.y) + EPSILON;
  const cx = (outer.x + inner.x) / 2;
  const cy = (top.y + bot.y) / 2;
  const ox = (iris.x - cx) / spanX;
  const oy = (iris.y - cy) / spanY;
  return [ox, oy];
}

export function computeGaze(landmarks: Array<{ x: number; y: number }>): GazeResult {
  try {
    const irisL = landmarks[IRIS_LEFT];
    const irisR = landmarks[IRIS_RIGHT];

    const [lx, ly] = irisOffset(
      irisL,
      landmarks[LEFT_OUTER], landmarks[LEFT_INNER],
      landmarks[LEFT_TOP], landmarks[LEFT_BOT],
    );
    const [rx, ry] = irisOffset(
      irisR,
      landmarks[RIGHT_OUTER], landmarks[RIGHT_INNER],
      landmarks[RIGHT_TOP], landmarks[RIGHT_BOT],
    );

    const gazeX = (lx + rx) / 2;
    const gazeY = (ly + ry) / 2;
    const onScreen = Math.abs(gazeX) < 0.18 && Math.abs(gazeY) < 0.18;

    return { x: Math.round(gazeX * 10000) / 10000, y: Math.round(gazeY * 10000) / 10000, looking_at_screen: onScreen };
  } catch {
    return { x: 0, y: 0, looking_at_screen: true };
  }
}

// ─── Head pose decomposition ────────────────────────────────────────────────

export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
}

export function decomposeHeadPose(matrix: number[]): HeadPose {
  try {
    // 4x4 row-major matrix from MediaPipe
    const M = matrix;
    const R = [
      [M[0], M[1], M[2]],
      [M[4], M[5], M[6]],
      [M[8], M[9], M[10]],
    ];

    const pitch = Math.atan2(-R[2][1], R[2][2]) * (180 / Math.PI);
    const yaw = Math.asin(Math.max(-1, Math.min(1, R[2][0]))) * (180 / Math.PI);
    const roll = Math.atan2(-R[1][0], R[0][0]) * (180 / Math.PI);

    return {
      yaw: Math.round(yaw * 100) / 100,
      pitch: Math.round(pitch * 100) / 100,
      roll: Math.round(roll * 100) / 100,
    };
  } catch {
    return { yaw: 0, pitch: 0, roll: 0 };
  }
}

// ─── Posture ────────────────────────────────────────────────────────────────

export interface PostureResult {
  shoulder_tilt: number;
  lean: string;
}

export function computePosture(poseLandmarks?: Array<Array<{ x: number; y: number }>>): PostureResult {
  try {
    if (!poseLandmarks || !poseLandmarks[0]) {
      return { shoulder_tilt: 0, lean: 'upright' };
    }
    const lms = poseLandmarks[0];
    const ls = lms[11]; // left shoulder
    const rs = lms[12]; // right shoulder
    const nose = lms[0];

    const shoulderTilt = Math.round(Math.abs(ls.y - rs.y) * 10000) / 100;

    const midX = (ls.x + rs.x) / 2;
    const dx = nose.x - midX;

    let lean: string;
    if (Math.abs(dx) < 0.05) {
      lean = 'upright';
    } else if (dx < 0) {
      lean = 'left';
    } else {
      lean = 'right';
    }

    return { shoulder_tilt: shoulderTilt, lean };
  } catch {
    return { shoulder_tilt: 0, lean: 'unknown' };
  }
}

// ─── Hand tracking ──────────────────────────────────────────────────────────

export interface HandResult {
  movement: number;
  fidget_level: string;
}

function centroid(landmarks: Array<{ x: number; y: number }>): [number, number] {
  let sumX = 0, sumY = 0;
  for (const lm of landmarks) {
    sumX += lm.x;
    sumY += lm.y;
  }
  return [sumX / landmarks.length, sumY / landmarks.length];
}

function fidgetLevel(movement: number): string {
  if (movement < 0.003) return 'still';
  if (movement < 0.008) return 'low';
  if (movement < 0.018) return 'medium';
  return 'high';
}

export class HandTracker {
  private prev: [number, number] | null = null;
  private smoother: WindowSmooth;

  constructor(smoothWindow = 8) {
    this.smoother = new WindowSmooth(smoothWindow);
  }

  update(handLandmarksList?: Array<Array<{ x: number; y: number }>>): HandResult {
    let rawMovement = 0;

    if (handLandmarksList && handLandmarksList.length > 0) {
      const center = centroid(handLandmarksList[0]);
      if (this.prev) {
        rawMovement = Math.sqrt((center[0] - this.prev[0]) ** 2 + (center[1] - this.prev[1]) ** 2);
      }
      this.prev = center;
    } else {
      this.prev = null;
    }

    const smoothed = this.smoother.update(rawMovement);
    const fidget = fidgetLevel(smoothed);

    return {
      movement: Math.round(smoothed * 100000) / 100000,
      fidget_level: fidget,
    };
  }

  reset() {
    this.prev = null;
    this.smoother.reset();
  }
}

// ─── Meta-signals (stress, engagement, confidence, attention) ───────────────

export interface MetaSignals {
  stress_score: number;
  engagement: number;
  confidence: number;
  attention: number;
}

export function computeMetaSignals(
  ear: number,
  blinksPerMin: number,
  handMovement: number,
  baselineEar: number,
  baselineMovement: number,
  emotions: EmotionScores,
  gaze: GazeResult,
  headPose: HeadPose,
): MetaSignals {
  const earDrop = Math.max(0, baselineEar - ear);
  const movementExcess = Math.max(0, handMovement - baselineMovement);

  // Stress (0–10)
  const stress = Math.min(10, (
    earDrop * 8.0 +
    Math.min(blinksPerMin, 40) * 0.03 +
    Math.min(movementExcess, 0.02) * 200.0 +
    emotions.fear * 3.0 +
    emotions.angry * 2.5 +
    emotions.disgust * 1.5 +
    emotions.sad * 1.0
  ));

  // Head distraction
  const yaw = Math.abs(headPose.yaw);
  const pitch = Math.abs(headPose.pitch);
  const headDistract = Math.min(1, (yaw / 35 + pitch / 25) / 2);

  // Engagement [0, 1]
  const onScreen = gaze.looking_at_screen;
  let baseEngage = 1.0;
  if (!onScreen) baseEngage -= 0.35;
  if (emotions.neutral > 0.85) baseEngage -= 0.15;
  baseEngage -= headDistract * 0.2;
  baseEngage += emotions.happy * 0.1;
  const engagement = Math.max(0, Math.min(1, baseEngage));

  // Confidence [0, 1]
  const confidence = Math.max(0, Math.min(1,
    1.0 - stress / 12.0
    + emotions.happy * 0.2
    - emotions.fear * 0.2
    - headDistract * 0.1
  ));

  // Attention [0, 1]
  const attention = Math.max(0, Math.min(1,
    (engagement + (onScreen ? 1.0 : 0.0)) / 2.0
    - headDistract * 0.15
  ));

  return {
    stress_score: Math.round(stress * 1000) / 1000,
    engagement: Math.round(engagement * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    attention: Math.round(attention * 1000) / 1000,
  };
}

// ─── Session aggregation (port of storage.py) ───────────────────────────────

export interface AggregatedSummary {
  session_id: string | null;
  duration_s: number;
  frame_count: number;
  emotions_avg: EmotionScores;
  dominant_histogram: Record<string, number>;
  stress_avg: number;
  stress_peak: number;
  engagement_avg: number;
  confidence_avg: number;
  attention_avg: number;
  attention_on_screen_frac: number;
  total_blinks: number;
  blinks_per_min_avg: number;
}

interface FrameData {
  ts: number;
  face_detected: boolean;
  emotions: EmotionScores;
  dominant: string;
  head_pose: HeadPose;
  gaze: GazeResult;
  eye: { ear: number; blink_count: number; blinks_per_min: number };
  hands: HandResult;
  posture: PostureResult;
  stress_score: number;
  engagement: number;
  confidence: number;
  attention: number;
}

export function aggregateSession(frames: FrameData[]): AggregatedSummary {
  const n = frames.length;
  if (n === 0) {
    return {
      session_id: null,
      duration_s: 0, frame_count: 0,
      emotions_avg: { happy: 0, sad: 0, angry: 0, surprised: 0, fear: 0, disgust: 0, neutral: 1 },
      dominant_histogram: {}, stress_avg: 0, stress_peak: 0,
      engagement_avg: 0, confidence_avg: 0, attention_avg: 0,
      attention_on_screen_frac: 0, total_blinks: 0, blinks_per_min_avg: 0,
    };
  }

  const emotionKeys = ['happy', 'sad', 'angry', 'surprised', 'fear', 'disgust', 'neutral'] as const;

  function avg(pick: (f: FrameData) => number | undefined): number {
    let sum = 0;
    for (const f of frames) sum += pick(f) ?? 0;
    return sum / n;
  }

  const emotionsAvg: EmotionScores = {} as EmotionScores;
  for (const k of emotionKeys) {
    emotionsAvg[k] = Math.round(avg((f) => f.emotions?.[k]) * 10000) / 10000;
  }

  // Dominant histogram
  const domCounts: Record<string, number> = {};
  for (const f of frames) {
    const d = f.dominant ?? 'neutral';
    domCounts[d] = (domCounts[d] ?? 0) + 1;
  }
  const dominantHistogram: Record<string, number> = {};
  for (const [k, v] of Object.entries(domCounts)) {
    dominantHistogram[k] = Math.round(v / n * 1000) / 1000;
  }

  const totalBlinks = Math.max(...frames.map(f => f.eye?.blink_count ?? 0));
  const lookFrac = frames.filter(f => f.gaze?.looking_at_screen).length / n;
  const durationS = frames[frames.length - 1].ts - frames[0].ts;

  return {
    session_id: null,
    duration_s: durationS,
    frame_count: n,
    emotions_avg: emotionsAvg,
    dominant_histogram: dominantHistogram,
    stress_avg: Math.round(avg((f) => f.stress_score) * 10000) / 10000,
    stress_peak: Math.round(Math.max(...frames.map(f => f.stress_score ?? 0)) * 1000) / 1000,
    engagement_avg: Math.round(avg((f) => f.engagement) * 10000) / 10000,
    confidence_avg: Math.round(avg((f) => f.confidence) * 10000) / 10000,
    attention_avg: Math.round(avg((f) => f.attention) * 10000) / 10000,
    attention_on_screen_frac: Math.round(lookFrac * 1000) / 1000,
    total_blinks: totalBlinks,
    // Blinks over the whole window. Averaging each frame's running rate (as this used to) is
    // inflated early on: one blink in the first second reads as 60/min.
    blinks_per_min_avg: blinkRate(totalBlinks, durationS),
  };
}

function blinkRate(blinks: number, durationS: number): number {
  return durationS > 0 ? Math.round((blinks / (durationS / 60)) * 100) / 100 : 0;
}

/**
 * Combines per-question summaries into one for the whole interview. The tracker's frame log is
 * reset at every new question, so the last summary alone only covers the final question.
 * Averages are weighted by frame count; totals are summed; the peak is the highest peak.
 */
export function combineSummaries(parts: AggregatedSummary[]): AggregatedSummary | null {
  const segments = parts.filter((p) => p && p.frame_count > 0);
  if (segments.length === 0) return null;
  const frames = segments.reduce((sum, s) => sum + s.frame_count, 0);
  const weighted = (pick: (s: AggregatedSummary) => number | undefined, digits = 4) => {
    const total = segments.reduce((sum, s) => sum + (pick(s) ?? 0) * s.frame_count, 0);
    const scale = 10 ** digits;
    return Math.round((total / frames) * scale) / scale;
  };

  const emotions = {} as EmotionScores;
  for (const k of EMOTIONS) emotions[k] = weighted((s) => s.emotions_avg?.[k]);

  const histogram: Record<string, number> = {};
  for (const s of segments) {
    for (const [k, v] of Object.entries(s.dominant_histogram ?? {})) {
      histogram[k] = (histogram[k] ?? 0) + v * s.frame_count;
    }
  }
  for (const k of Object.keys(histogram)) histogram[k] = Math.round((histogram[k] / frames) * 1000) / 1000;

  const durationS = segments.reduce((sum, s) => sum + (s.duration_s ?? 0), 0);
  const totalBlinks = segments.reduce((sum, s) => sum + (s.total_blinks ?? 0), 0);

  return {
    session_id: null,
    duration_s: Math.round(durationS * 1000) / 1000,
    frame_count: frames,
    emotions_avg: emotions,
    dominant_histogram: histogram,
    stress_avg: weighted((s) => s.stress_avg),
    stress_peak: Math.max(...segments.map((s) => s.stress_peak ?? 0)),
    engagement_avg: weighted((s) => s.engagement_avg),
    confidence_avg: weighted((s) => s.confidence_avg),
    attention_avg: weighted((s) => s.attention_avg),
    attention_on_screen_frac: weighted((s) => s.attention_on_screen_frac, 3),
    total_blinks: totalBlinks,
    blinks_per_min_avg: blinkRate(totalBlinks, durationS),
  };
}

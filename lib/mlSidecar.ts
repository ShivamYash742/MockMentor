// Face-tracking result types, shared by the browser tracker (hooks/useFaceTracker.ts) and its UI.
// The shape matches the Python sidecar's output (model/schema.py), which is where it came from.

export interface FaceEmotions {
  happy: number;
  sad: number;
  angry: number;
  surprised: number;
  fear: number;
  disgust: number;
  neutral: number;
}

export interface HeadPoseResult {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface GazeResult {
  x: number;
  y: number;
  looking_at_screen: boolean;
}

export interface EyeResult {
  ear: number;
  blink_count: number;
  blinks_per_min: number;
}

export interface HandResult {
  movement: number;
  fidget_level: string;
}

export interface PostureResult {
  shoulder_tilt: number;
  lean: string;
}

export interface FaceResult {
  ts: number;
  face_detected: boolean;
  emotions: FaceEmotions;
  dominant: string;
  head_pose: HeadPoseResult;
  gaze: GazeResult;
  eye: EyeResult;
  hands: HandResult;
  posture: PostureResult;
  stress_score: number;
  engagement: number;
  confidence: number;
  attention: number;
}

export interface FaceSummary {
  session_id: string | null;
  duration_s: number;
  frame_count: number;
  emotions_avg: FaceEmotions;
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

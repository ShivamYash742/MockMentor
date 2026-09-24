# MockMentor — ML Face Analysis Build Log

> Full record of all work done across Phase 1, 2, and 3 by both the AI assistant and the user.

---

## Phase 1 — Python ML Sidecar (Model Power-Up)

**Goal:** Replace the basic face tracker with a production-grade ML pipeline capable of blendshapes, 7-class emotion classification, head pose, iris gaze, blink detection, and real-time meta-signals.

---

### Assistant — New Package Structure

Created `model/tracker/` as a proper Python package with dedicated modules:

#### `model/tracker/smoothing.py`
- `EMA(alpha=0.3)` — exponential moving average for scalar and dict values
- `WindowSmooth(maxlen=N)` — deque-based rolling mean for stable signal output

#### `model/tracker/emotion.py`
- `_WEIGHTS` dict — 7 emotions (happy, sad, angry, surprised, fear, disgust, neutral), each mapped to ARKit blendshape names with float weights
- `classify_emotions(blendshape_list)` — computes weighted scores → sqrt boost (amplifies weak signals) → softmax normalization → returns `dict[str, float]`
- `dominant_emotion(scores)` — returns highest-scoring emotion string

#### `model/tracker/face.py`
- `FaceTracker` wrapping MediaPipe `FaceLandmarker`
- Flags: `output_face_blendshapes=True`, `output_facial_transformation_matrixes=True`, confidence=0.6
- `eye_aspect_ratio(landmarks, eye_indices)` — EAR formula for blink detection
- Constants: `LEFT_EYE = [33,160,158,133,153,144]`, `RIGHT_EYE = [263,387,385,362,380,373]`

#### `model/tracker/gaze.py`
- Iris landmarks: `_IRIS_LEFT=468`, `_IRIS_RIGHT=473`
- Eye corners: `_LEFT_OUTER=33`, `_LEFT_INNER=133`, `_RIGHT_INNER=362`, `_RIGHT_OUTER=263`
- `compute_gaze(landmarks)` → `{x, y, looking_at_screen}` — looking_at_screen = `abs(x)<0.18 and abs(y)<0.18`

#### `model/tracker/hands.py`
- `HandTracker(smooth_window=8)` — tracks centroid delta per hand
- `_fidget_level(movement)` → still / low / medium / high (thresholds: 0.003 / 0.008 / 0.018)

#### `model/tracker/pose.py`
- `decompose_head_pose(matrix_flat)` → `{yaw, pitch, roll}` in degrees from 4×4 facial transformation matrix
- `compute_posture(pose_landmarks)` → `{shoulder_tilt, lean}` from landmarks 0/11/12

#### `model/tracker/stress.py`
- `compute_meta_signals(ear, blinks_per_min, hand_movement, baseline_ear, baseline_movement, emotions, gaze, head_pose)`
- Returns `(stress, engagement, confidence, attention)` all clipped 0–1 except stress (0–10+ scale)
- Stress formula: `ear_drop×8.0 + min(bpm,40)×0.03 + min(movement,0.02)×200 + fear×3 + angry×2.5 + disgust×1.5 + sad×1.0`

#### `model/tracker/__init__.py` (assistant base)
- `CALIBRATION_FRAMES = 90`
- `Pipeline` class — orchestrates FaceTracker, HandTracker, PoseLandmarker, all smoothers
- `process(frame_bgr, ts)` → `FrameResult`
- `reset_session()` — resets blink counter, timers, all EMA smoothers
- `close()` — releases MediaPipe resources

#### `model/schema.py`
- `FrameResult` dataclass — all fields: ts, face_detected, emotions, dominant, head_pose, gaze, eye, hands, posture, stress_score, engagement, confidence, attention
- `.to_dict()` via `dataclasses.asdict()`

#### `model/storage.py`
- `SessionStorage(max_frames=5400)` — deque of frame dicts
- `aggregate()` → session summary: stress_avg, stress_peak, emotions_avg, dominant_histogram, attention_on_screen_frac, total_blinks, blinks_per_min_avg, engagement_avg, confidence_avg, attention_avg, duration_s, frame_count

#### `model/server.py`
- FastAPI server on port 8001
- `GET /` — full HTML browser dashboard: live camera preview via `getUserMedia`, canvas capture at 5fps, WebSocket to `/ws/debug`, live display of all FrameResult fields (stress bar, 7 emotion bars, meta signals, head pose, gaze, blink count, calibration overlay)
- `GET /api/` — JSON service info
- `GET /api/health` — health check
- `GET /api/docs` — Swagger UI
- `WS /ws/{session_id}` — receives base64 JPEG frames, responds with FrameResult JSON; commands: `reset`, `summary`

#### `model/requirements.txt`
- Added: `uvicorn[standard]`, `python-multipart`
- Bumped: `mediapipe>=0.10.14`

---

### User — Customizations to Phase 1

User made significant improvements directly to the code:

#### `model/tracker/__init__.py` (user changes)
- Changed `WindowSmooth(maxlen=3)` — tighter smoothing window for faster response
- Set `EAR_THRESH = 0.22` — tuned threshold for blink detection
- **Fixed blink detection logic**: used `raw_ear` (unsmoothed) for threshold comparison — smoothing was killing the EAR dip and missing blinks
- Exposed `last_face_res`, `last_hand_res`, `last_pose_res` as public attributes on `Pipeline` — allows debug overlay in `new.py` without re-running detectors

#### `model/new.py` (user changes — full rich overlay)
- Added complete face mesh connection sets:
  - `_FACE_OVAL`, `_FACE_LIPS`, `_FACE_LEFT_BROW`, `_FACE_RIGHT_BROW`
  - `_FACE_LEFT_EYE_EDGE`, `_FACE_RIGHT_EYE_EDGE`, `_FACE_NOSE`, `_FACE_CHEEKS`
  - Combined into `_ALL_FACE_CONNECTIONS`
- `draw_face_mesh()` — draws all 478 landmark dots + dense mesh edges in green
- `draw_hand_landmarks()` — hand skeleton with orange/blue per hand, larger dots on fingertips (indices 4,8,12,16,20), white ring accent
- `draw_pose_landmarks()` — full body skeleton in purple
- `[L]` key toggle — shows/hides all landmark overlays at runtime
- Auto camera scan — tries indices 0–4 to find active camera
- Uses `pipeline.last_face_res/hand_res/pose_res` cached results — no double inference

---

## Phase 2 — Next.js Integration

**Goal:** Bridge the Python ML sidecar into the live interview UI — no second camera permission, graceful fallback if sidecar not running, live HUD overlay, face analytics saved to DB and included in report.

---

### Assistant — TypeScript/React Integration

#### `lib/mlSidecar.ts` (new)
- `ML_BASE_URL` — reads `NEXT_PUBLIC_ML_SIDECAR_URL` env var, defaults to `http://localhost:8001`
- `ML_WS_BASE` — converts HTTP to WS protocol
- Interfaces: `FaceEmotions`, `FaceResult`, `FaceSummary` — full TypeScript types matching Python `FrameResult` and `storage.aggregate()` output

#### `hooks/useFaceTracker.ts` (new)
- `useFaceTracker(videoRef, sessionId, enabled)` — React hook
- Captures frames from existing `videoRef.current` — reuses interview camera, no second `getUserMedia` call
- Constants: `FRAME_INTERVAL_MS=250` (4fps), `JPEG_QUALITY=0.55`, `CANVAS_W/H=320/240`
- Off-screen canvas for JPEG encoding
- WebSocket to `/ws/{sessionId}` — sends `{ frame: base64, ts }`, receives `FrameResult` JSON
- `summaryResolvers` ref pattern — `requestSummary()` returns a Promise that resolves when server responds with `cmd: 'summary'`
- `resetSession()` — sends `{ cmd: 'reset' }` over WS
- `isSidecarAvailable` — stays false if WebSocket connection fails; whole system degrades silently
- Returns: `{ lastFrame, isConnected, isSidecarAvailable, requestSummary, resetSession }`

#### `components/interview/StressHUD.tsx` (new)
- `StressHUD({ frame: FaceResult | null })` — returns null if face not detected
- Stress bar: green (0–4) / amber (4–7) / red (7+) with numeric label
- Engagement bar (blue)
- Attention bar (indigo)
- Dominant emotion badge — color-coded per emotion
- Gaze badge: green "👁 on screen" or red "👁 looking away"
- Renders inside user camera panel, only when `isSidecarAvailable === true`

#### `lib/models/InterviewReport.ts` (edited)
- Added `IFaceAnalytics` interface — all session aggregate fields
- Added optional `faceAnalytics?: IFaceAnalytics` to `IInterviewReport`
- Added `faceAnalytics: { type: mongoose.Schema.Types.Mixed, required: false }` to Mongoose schema

#### `app/api/generate-report/route.ts` (edited)
- Destructures `faceAnalytics` from POST body
- Spreads into `InterviewReport` constructor: `...(faceAnalytics ? { faceAnalytics } : {})`

#### `components/interview-complete.tsx` (edited)
- Added `faceAnalytics?: object | null` to props interface
- Forwards in `generateReport()` POST body

#### `components/interview.tsx` (edited)
- Added imports: `useFaceTracker`, `StressHUD`, `FaceSummary`
- `faceSummaryRef = useRef<FaceSummary | null>(null)`
- Hook: `const { lastFrame, isSidecarAvailable, requestSummary } = useFaceTracker(videoRef, sessionId, isCameraOn)`
- `exitInterview()`: calls `await requestSummary()` → stores in ref → passed to `<InterviewComplete faceAnalytics={...} />`
- `<StressHUD frame={lastFrame} />` inside user camera div (conditional on `isSidecarAvailable`)

---

## Phase 3 — Advanced Signals & Report Intelligence

**Goal:** Per-question emotion snapshots, biometric section in the interview report, real-time attention alert.

---

### Assistant — Phase 3 Implementation

#### 3.3 — Per-Question Emotion Timeline (`components/interview.tsx`)

New refs:
```typescript
const questionSnapshotsRef = useRef<FaceSummary[]>([]);
const interviewerMsgCountRef = useRef(0);
```

New effect — fires on every `contextMessages` change:
```typescript
useEffect(() => {
  if (!isSidecarAvailable) return;
  const count = contextMessages.filter(m => m.sender !== 'CLIENT').length;
  if (count > interviewerMsgCountRef.current && interviewerMsgCountRef.current > 0) {
    requestSummary().then(summary => {
      if (summary) questionSnapshotsRef.current.push(summary);
      resetSession();
    });
  }
  interviewerMsgCountRef.current = count;
}, [contextMessages, isSidecarAvailable]);
```

Behavior: each new interviewer question snapshots the previous question's ML session aggregate → pushes to array → resets ML session window for clean next-question baseline.

`exitInterview()` updated to merge all snapshots:
```typescript
const finalSummary = await requestSummary();
faceSummaryRef.current = finalSummary
  ? { ...finalSummary, questionSnapshots: questionSnapshotsRef.current }
  : questionSnapshotsRef.current.length > 0
    ? { questionSnapshots: questionSnapshotsRef.current }
    : null;
```

Stored in DB as part of `faceAnalytics` (MongoDB Mixed type accepts the extended object).

---

#### 3.5 — Attention Alert TTS (`components/interview.tsx`)

New refs:
```typescript
const gazeOffTimeRef = useRef<number | null>(null);
const alertCooldownRef = useRef<number>(0);
```

New effect:
```typescript
useEffect(() => {
  if (!isSidecarAvailable || !lastFrame?.face_detected) return;
  const now = Date.now();
  if (!lastFrame.gaze?.looking_at_screen) {
    if (!gazeOffTimeRef.current) gazeOffTimeRef.current = now;
    else if (now - gazeOffTimeRef.current >= 3000 && now - alertCooldownRef.current >= 10000) {
      alertCooldownRef.current = now;
      gazeOffTimeRef.current = null;
      const utt = new SpeechSynthesisUtterance('Please look at the camera.');
      utt.volume = 0.8;
      utt.rate = 1.1;
      window.speechSynthesis.speak(utt);
    }
  } else {
    gazeOffTimeRef.current = null;
  }
}, [lastFrame, isSidecarAvailable]);
```

Behavior: if gaze leaves screen for 3+ consecutive seconds → browser TTS fires reminder. 10s cooldown prevents spam.

---

#### 3.4 — Biometric Intelligence Report Section (`components/interview-report.tsx`)

Added `faceAnalytics?` to `ReportData` interface:
```typescript
faceAnalytics?: {
  duration_s: number;
  frame_count: number;
  emotions_avg: Record<string, number>;
  dominant_histogram: Record<string, number>;
  stress_avg: number;
  stress_peak: number;
  engagement_avg: number;
  confidence_avg: number;
  attention_avg: number;
  attention_on_screen_frac: number;
  total_blinks: number;
  blinks_per_min_avg: number;
};
```

New "Biometric Intelligence" section in report (after Behavioral Neuro-Insights, before Q&A Analysis):
- **Emotion Distribution card** — bar chart for all 7 emotions, sorted by dominance, percentage labels
- **Physiological Signals card** — stress / engagement / confidence / attention bars with color coding (rose / blue / emerald / indigo), plus 2×2 stat grid: on-screen focus %, total blinks, blink rate/min, peak stress score
- Section is conditionally rendered — only appears when ML sidecar was active during the interview

---

## File Inventory

| File | Created By | Phase | Purpose |
|------|-----------|-------|---------|
| `model/tracker/smoothing.py` | Assistant | 1 | EMA + WindowSmooth classes |
| `model/tracker/emotion.py` | Assistant | 1 | 7-class emotion classifier |
| `model/tracker/face.py` | Assistant | 1 | FaceTracker + EAR |
| `model/tracker/gaze.py` | Assistant | 1 | Iris gaze estimation |
| `model/tracker/hands.py` | Assistant | 1 | Hand fidget tracking |
| `model/tracker/pose.py` | Assistant | 1 | Head pose + posture |
| `model/tracker/stress.py` | Assistant | 1 | Meta-signal computation |
| `model/tracker/__init__.py` | Assistant (base) + **User** (tuning) | 1 | Pipeline orchestrator |
| `model/new.py` | Assistant (base) + **User** (full overlay) | 1 | Local debug viewer |
| `model/schema.py` | Assistant | 1 | FrameResult dataclass |
| `model/storage.py` | Assistant | 1 | Session aggregate storage |
| `model/server.py` | Assistant | 1 | FastAPI WS server + browser dashboard |
| `model/requirements.txt` | Assistant | 1 | Python deps |
| `lib/mlSidecar.ts` | Assistant | 2 | TS types + URL config |
| `hooks/useFaceTracker.ts` | Assistant | 2 | React WS bridge hook |
| `components/interview/StressHUD.tsx` | Assistant | 2 | Live HUD overlay |
| `lib/models/InterviewReport.ts` | Assistant | 2 | DB schema with faceAnalytics |
| `app/api/generate-report/route.ts` | Assistant | 2 | Report API with faceAnalytics |
| `components/interview-complete.tsx` | Assistant | 2 | Forwards faceAnalytics to report gen |
| `components/interview.tsx` | Assistant | 2+3 | Hook wiring + 3.3 + 3.5 |
| `components/interview-report.tsx` | Assistant | 3 | Biometric Intelligence section |

---

## Key Design Decisions

| Decision | Reason |
|----------|--------|
| Browser sends frames via WS, not Python reading camera | Python sidecar has no webcam access in production; browser owns camera |
| Reuse existing `videoRef` in `useFaceTracker` | Avoid second `getUserMedia` call / second permission prompt |
| `isSidecarAvailable` graceful fallback | Sidecar is optional; Next.js app must work fully without it |
| `raw_ear` for blink threshold, smoothed EAR for display | Smoothing kills the EAR dip; blink detection requires raw signal |
| `last_face_res/hand_res/last_pose_res` cached on Pipeline | Debug overlay in `new.py` without double inference |
| MongoDB Mixed type for `faceAnalytics` | Allows schema-free extension (questionSnapshots added in Phase 3 without migration) |
| 10s TTS cooldown for attention alert | Prevent spam if user is consistently looking away |
| Per-question snapshot on new interviewer message | Clean question boundary detection without modifying the AI chat flow |

---

## Phase 3 Not Implemented (Optional Future Work)

| Item | Description |
|------|-------------|
| 3.1 CNN emotion model | Replace blendshape heuristics with AffectNet/FER2013 ONNX model for higher accuracy |
| 3.2 Voice prosody fusion | WebAudio API pitch/energy/tremor analysis merged with face signals |

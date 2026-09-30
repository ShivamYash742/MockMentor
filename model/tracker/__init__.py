"""
Tracker package — orchestrates all sub-modules into a single Pipeline.
Call Pipeline.process(frame_bgr, timestamp_s) → FrameResult.
"""
import os
import sys
import threading
import time
import urllib.request
import numpy as np

# ── Headless / Render compatibility ──────────────────────────────────────────
# MediaPipe eagerly tries to dlopen libGLESv2.so.2 even for CPU inference.
# On Render free tier (and any headless Linux without Mesa GPU) this crashes.
# Force Mesa software renderer before the first mediapipe import.
os.environ.setdefault("LIBGL_ALWAYS_SOFTWARE", "1")
os.environ.setdefault("MESA_GL_VERSION_OVERRIDE", "3.3")
os.environ.setdefault("EGL_PLATFORM", "surfaceless")

import mediapipe as mp


from .face import FaceTracker, eye_aspect_ratio, face_crop, LEFT_EYE, RIGHT_EYE
from .emotion import EmotionModel, classify_emotions, dominant_emotion
from .gaze import compute_gaze
from .hands import HandTracker
from .pose import decompose_head_pose, compute_posture
from .stress import compute_meta_signals
from .smoothing import EMA, WindowSmooth

# MediaPipe helpers for hand/pose (reuse existing landmarkers)
BaseOptions = mp.tasks.BaseOptions
HandLandmarker = mp.tasks.vision.HandLandmarker
HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
PoseLandmarker = mp.tasks.vision.PoseLandmarker
PoseLandmarkerOptions = mp.tasks.vision.PoseLandmarkerOptions
VisionRunningMode = mp.tasks.vision.RunningMode

_MODEL_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models"))

# Downloaded on first use. Model files are gitignored, so without this a fresh deploy (server.py)
# had no models at all — only new.py used to download them.
_MODEL_URLS = {
    "face_landmarker.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    "hand_landmarker.task": "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    "pose_landmarker_lite.task": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    # HSEmotion enet_b2_7, pinned to a commit so the weights can't change under us.
    "enet_b2_7.onnx": "https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/520a051c64cd191521e5934655314e769a319684/models/affectnet_emotions/onnx/enet_b2_7.onnx",
}

CALIBRATION_FRAMES = 90

# Emotion runs on a sampled frame, not every frame (~31 ms/face single-threaded on CPU);
# between samples the last smoothed reading is reused. Tuning knob: lower = more responsive.
EMOTION_INTERVAL_S = 1.0


def model_path(name: str) -> str:
    """Local path to a model file, downloading it first if absent."""
    path = os.path.join(_MODEL_DIR, name)
    if not os.path.exists(path):
        os.makedirs(_MODEL_DIR, exist_ok=True)
        print(f"Downloading {name}...")
        # Download to a temp name so an interrupted download never leaves a truncated model behind.
        urllib.request.urlretrieve(_MODEL_URLS[name], path + ".part")
        os.replace(path + ".part", path)
    return path


# schema.py lives one level up. Imported once here; process() used to insert into sys.path on
# every frame, so the list grew without bound for as long as the server ran.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")))
from schema import FrameResult  # noqa: E402


class Models:
    """The heavy, shareable part: MediaPipe landmarkers and the emotion model, loaded once.

    MediaPipe landmarkers aren't thread-safe, and in VIDEO mode each one needs strictly increasing
    timestamps, so every caller goes through `lock` and takes timestamps from `next_timestamp_ms()`.
    """

    def __init__(self):
        self.lock = threading.Lock()
        self._timestamp_ms = 0

        self.face = FaceTracker(model_path("face_landmarker.task"))

        hand_opts = HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model_path("hand_landmarker.task")),
            running_mode=VisionRunningMode.VIDEO,
            num_hands=2,
            min_hand_detection_confidence=0.6,
            min_tracking_confidence=0.6,
        )
        self.hand_lm = HandLandmarker.create_from_options(hand_opts)

        pose_opts = PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model_path("pose_landmarker_lite.task")),
            running_mode=VisionRunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.6,
            min_tracking_confidence=0.6,
        )
        self.pose_lm = PoseLandmarker.create_from_options(pose_opts)

        # Emotion: trained model if it loads, else the blendshape heuristic — a failed download
        # shouldn't take the whole pipeline down. onnxruntime sessions are safe to share.
        try:
            self.emotion_model = EmotionModel(model_path("enet_b2_7.onnx"))
        except Exception as exc:
            print(f"Emotion model unavailable, falling back to blendshape heuristic: {exc}")
            self.emotion_model = None

    def next_timestamp_ms(self) -> int:
        """Shared ~30 fps synthetic clock; call with `lock` held."""
        self._timestamp_ms += 33
        return self._timestamp_ms

    def close(self):
        self.face.close()
        self.hand_lm.close()
        self.pose_lm.close()


class Pipeline:
    """Full per-frame analysis pipeline: one per camera session (blinks, calibration, smoothing).

    Pass shared `models` to run many sessions on one set of models (the server does); without
    them the pipeline loads its own (new.py, tests). The server used to share one Pipeline between
    all connections, so blink counts, calibration and smoothing leaked between users.
    """

    def __init__(self, models: "Models | None" = None):
        self._owns_models = models is None
        self.models = models or Models()
        # Per-pipeline references, so a test (or a failed model) can swap one for this session only.
        self.face = self.models.face
        self._hand_lm = self.models.hand_lm
        self._pose_lm = self.models.pose_lm
        self._emotion_model = self.models.emotion_model

        self.hands = HandTracker(smooth_window=8)
        self._last_emotion_t = float("-inf")

        # EMA smoothers
        self._ear_smooth = WindowSmooth(maxlen=3)  # smaller window = faster blink response
        # Model samples arrive ~1/s, so smooth less than the per-frame heuristic did.
        self._emotion_ema = EMA(alpha=0.5 if self._emotion_model else 0.25)
        self._stress_ema = EMA(alpha=0.2)
        self._head_pose_ema = EMA(alpha=0.3)
        self._gaze_ema = EMA(alpha=0.3)

        # Blink state
        self._blink_count = 0
        self._eye_closed = False
        self._start_time = time.time()

        # Calibration
        self._frame_count = 0
        self._baseline_ear: float = 0.28
        self._baseline_movement: float = 0.001
        self._cal_ear_acc: float = 0.0
        self._cal_mov_acc: float = 0.0

        self.last_face_res = None   # exposed for debug overlay
        self.last_hand_res = None   # exposed for debug overlay
        self.last_pose_res = None   # exposed for debug overlay

    # ------------------------------------------------------------------
    def process(self, frame_bgr: np.ndarray, ts: float = None):
        """Process one BGR frame. Returns FrameResult."""
        if ts is None:
            ts = time.time()

        rgb = frame_bgr[:, :, ::-1].copy()  # BGR → RGB
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        with self.models.lock:
            timestamp_ms = self.models.next_timestamp_ms()
            face_res = self.face.detect(mp_image, timestamp_ms)
            hand_res = self._hand_lm.detect_for_video(mp_image, timestamp_ms)
            pose_res = self._pose_lm.detect_for_video(mp_image, timestamp_ms)
        self.last_face_res = face_res  # cache for debug overlay
        self.last_hand_res = hand_res  # cache for debug overlay
        self.last_pose_res = pose_res  # cache for debug overlay

        face_detected = bool(face_res.face_landmarks)

        # --- EAR + blink ---
        # Use RAW ear for blink threshold (smoothing kills the dip),
        # smooth only for the display value.
        ear = 0.28
        if face_detected:
            lm = face_res.face_landmarks[0]
            ear_l = eye_aspect_ratio(lm, LEFT_EYE)
            ear_r = eye_aspect_ratio(lm, RIGHT_EYE)
            raw_ear = (ear_l + ear_r) / 2.0
            ear = self._ear_smooth.update(raw_ear)  # smoothed, for HUD display only

            EAR_THRESH = 0.22  # slightly higher → more robust detection
            if raw_ear < EAR_THRESH and not self._eye_closed:
                self._eye_closed = True
            elif raw_ear >= EAR_THRESH and self._eye_closed:
                self._blink_count += 1
                self._eye_closed = False

        elapsed = time.time() - self._start_time + 1e-6
        blinks_per_min = self._blink_count / (elapsed / 60.0)

        # --- Emotions ---
        emotions = {"happy": 0.0, "sad": 0.0, "angry": 0.0,
                    "surprised": 0.0, "fear": 0.0, "disgust": 0.0, "neutral": 1.0}
        if face_detected and self._emotion_model:
            now = time.monotonic()  # server clock, not the client-supplied ts
            if now - self._last_emotion_t >= EMOTION_INTERVAL_S:
                crop = face_crop(rgb, face_res.face_landmarks[0])
                if crop is not None:
                    self._emotion_ema.update(self._emotion_model(crop))
                    self._last_emotion_t = now
            emotions = self._emotion_ema.value or emotions
        elif face_detected and face_res.face_blendshapes:
            emotions = self._emotion_ema.update(classify_emotions(face_res.face_blendshapes[0]))

        dom = dominant_emotion(emotions)

        # --- Head pose ---
        head_pose = {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}
        if face_detected and face_res.facial_transformation_matrixes:
            raw_pose = decompose_head_pose(face_res.facial_transformation_matrixes[0].data)
            head_pose = self._head_pose_ema.update(raw_pose) or raw_pose

        # --- Gaze ---
        gaze = {"x": 0.0, "y": 0.0, "looking_at_screen": True}
        if face_detected and len(face_res.face_landmarks[0]) > 477:
            raw_gaze = compute_gaze(face_res.face_landmarks[0])
            gaze_smooth = self._gaze_ema.update(
                {"x": raw_gaze["x"], "y": raw_gaze["y"]}
            ) or {}
            gaze = {
                "x": round(gaze_smooth.get("x", raw_gaze["x"]), 4),
                "y": round(gaze_smooth.get("y", raw_gaze["y"]), 4),
                "looking_at_screen": raw_gaze["looking_at_screen"],
            }

        # --- Hands ---
        hand_data = self.hands.update(hand_res.hand_landmarks)

        # --- Posture ---
        posture = compute_posture(pose_res.pose_landmarks)

        # --- Calibration ---
        self._frame_count += 1
        if self._frame_count <= CALIBRATION_FRAMES:
            alpha = 0.1
            self._cal_ear_acc = (1 - alpha) * self._cal_ear_acc + alpha * ear
            self._cal_mov_acc = (1 - alpha) * self._cal_mov_acc + alpha * hand_data["movement"]
            if self._frame_count == CALIBRATION_FRAMES:
                self._baseline_ear = self._cal_ear_acc
                self._baseline_movement = self._cal_mov_acc

        # --- Stress meta-signals ---
        stress, engagement, confidence, attention = compute_meta_signals(
            ear=ear,
            blinks_per_min=blinks_per_min,
            hand_movement=hand_data["movement"],
            baseline_ear=self._baseline_ear,
            baseline_movement=self._baseline_movement,
            emotions=emotions,
            gaze=gaze,
            head_pose=head_pose,
        )
        smoothed_stress = self._stress_ema.update(stress)
        stress = round(smoothed_stress if smoothed_stress is not None else stress, 3)

        return FrameResult(
            ts=round(ts, 3),
            face_detected=face_detected,
            emotions={k: round(v, 4) for k, v in emotions.items()},
            dominant=dom,
            head_pose=head_pose,
            gaze=gaze,
            eye={
                "ear": round(ear, 4),
                "blink_count": self._blink_count,
                "blinks_per_min": round(blinks_per_min, 2),
            },
            hands=hand_data,
            posture=posture,
            stress_score=stress,
            engagement=engagement,
            confidence=confidence,
            attention=attention,
        )

    def close(self):
        # Shared models belong to whoever created them (the server), not to one session.
        if self._owns_models:
            self.models.close()

    def reset_session(self):
        self._blink_count = 0
        self._eye_closed = False
        self._start_time = time.time()
        self._frame_count = 0
        self.hands.reset()
        self._emotion_ema.reset()
        self._last_emotion_t = float("-inf")
        self._stress_ema.reset()
        self._head_pose_ema.reset()
        self._gaze_ema.reset()
        self._ear_smooth.reset()

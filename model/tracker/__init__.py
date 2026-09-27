"""
Tracker package — orchestrates all sub-modules into a single Pipeline.
Call Pipeline.process(frame_bgr, timestamp_s) → FrameResult.
"""
import os
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


class Pipeline:
    """Full per-frame analysis pipeline."""

    def __init__(self):
        self.face = FaceTracker(model_path("face_landmarker.task"))

        hand_opts = HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model_path("hand_landmarker.task")),
            running_mode=VisionRunningMode.VIDEO,
            num_hands=2,
            min_hand_detection_confidence=0.6,
            min_tracking_confidence=0.6,
        )
        self._hand_lm = HandLandmarker.create_from_options(hand_opts)

        pose_opts = PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model_path("pose_landmarker_lite.task")),
            running_mode=VisionRunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.6,
            min_tracking_confidence=0.6,
        )
        self._pose_lm = PoseLandmarker.create_from_options(pose_opts)

        self.hands = HandTracker(smooth_window=8)

        # Emotion: trained model if it loads, else the blendshape heuristic — a failed download
        # shouldn't take the whole pipeline down.
        try:
            self._emotion_model = EmotionModel(model_path("enet_b2_7.onnx"))
        except Exception as exc:
            print(f"Emotion model unavailable, falling back to blendshape heuristic: {exc}")
            self._emotion_model = None
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

        self._timestamp_ms = 0
        self.last_face_res = None   # exposed for debug overlay
        self.last_hand_res = None   # exposed for debug overlay
        self.last_pose_res = None   # exposed for debug overlay

    # ------------------------------------------------------------------
    def process(self, frame_bgr: np.ndarray, ts: float = None):
        """Process one BGR frame. Returns FrameResult."""
        import sys, os as _os
        sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), ".."))
        from schema import FrameResult

        if ts is None:
            ts = time.time()

        self._timestamp_ms += 33  # ~30 fps synthetic clock
        rgb = frame_bgr[:, :, ::-1].copy()  # BGR → RGB
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        face_res = self.face.detect(mp_image, self._timestamp_ms)
        self.last_face_res = face_res  # cache for debug overlay
        hand_res = self._hand_lm.detect_for_video(mp_image, self._timestamp_ms)
        self.last_hand_res = hand_res  # cache for debug overlay
        pose_res = self._pose_lm.detect_for_video(mp_image, self._timestamp_ms)
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
        self.face.close()
        self._hand_lm.close()
        self._pose_lm.close()

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

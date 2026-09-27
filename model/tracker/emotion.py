"""
7-class emotion classification.

EmotionModel is the primary path: a trained model on the face crop. classify_emotions() is
the rule-based fallback from MediaPipe blendshapes, used only if the model can't be loaded.
"""
from typing import Dict, List

import cv2
import numpy as np
import onnxruntime as ort

# enet_b2_7 output order, mapped to this app's emotion keys.
_MODEL_LABELS = ["angry", "disgust", "fear", "happy", "neutral", "sad", "surprised"]
_MEAN = np.array([0.485, 0.456, 0.406], np.float32)  # ImageNet stats, RGB order
_STD = np.array([0.229, 0.224, 0.225], np.float32)


class EmotionModel:
    """HSEmotion enet_b2_7 (EfficientNet-B2 trained on AffectNet, Apache-2.0) via onnxruntime.

    Preprocessing mirrors the reference implementation (hsemotion-onnx / EmotiEffLib):
    RGB face crop -> 260x260 -> /255 -> ImageNet normalize -> CHW.
    """

    def __init__(self, path: str):
        self._sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self._input = self._sess.get_inputs()[0].name

    def __call__(self, face_rgb: np.ndarray) -> Dict[str, float]:
        x = cv2.resize(face_rgb, (260, 260)).astype(np.float32) / 255.0
        x = ((x - _MEAN) / _STD).transpose(2, 0, 1)[None]
        logits = self._sess.run(None, {self._input: x})[0][0]
        p = np.exp(logits - logits.max())
        p /= p.sum()
        return {label: float(v) for label, v in zip(_MODEL_LABELS, p)}

# ARKit blendshape → emotion weights (positive contribution)
_WEIGHTS: Dict[str, Dict[str, float]] = {
    "happy": {
        "mouthSmileLeft": 1.2,
        "mouthSmileRight": 1.2,
        "cheekSquintLeft": 0.6,
        "cheekSquintRight": 0.6,
        "mouthDimpleLeft": 0.4,
        "mouthDimpleRight": 0.4,
    },
    "sad": {
        "mouthFrownLeft": 1.0,
        "mouthFrownRight": 1.0,
        "browInnerUp": 0.7,
        "mouthStretchLeft": 0.4,
        "mouthStretchRight": 0.4,
        "mouthShrugLower": 0.3,
    },
    "angry": {
        "browDownLeft": 1.2,
        "browDownRight": 1.2,
        "noseSneerLeft": 0.8,
        "noseSneerRight": 0.8,
        "mouthPressLeft": 0.5,
        "mouthPressRight": 0.5,
        "eyeSquintLeft": 0.4,
        "eyeSquintRight": 0.4,
    },
    "surprised": {
        "jawOpen": 1.2,
        "eyeWideLeft": 1.0,
        "eyeWideRight": 1.0,
        "browOuterUpLeft": 0.8,
        "browOuterUpRight": 0.8,
        "mouthFunnel": 0.3,
    },
    "fear": {
        "browInnerUp": 0.9,
        "eyeWideLeft": 0.9,
        "eyeWideRight": 0.9,
        "mouthStretchLeft": 0.7,
        "mouthStretchRight": 0.7,
        "mouthShrugUpper": 0.4,
    },
    "disgust": {
        "noseSneerLeft": 1.2,
        "noseSneerRight": 1.2,
        "mouthLowerDownLeft": 0.5,
        "mouthLowerDownRight": 0.5,
        "mouthUpperUpLeft": 0.4,
        "mouthUpperUpRight": 0.4,
        "mouthPucker": 0.3,
    },
}

_WEIGHT_SUMS = {emotion: sum(w.values()) for emotion, w in _WEIGHTS.items()}

EMOTIONS = ["happy", "sad", "angry", "surprised", "fear", "disgust", "neutral"]


def blendshapes_to_dict(blendshape_list) -> Dict[str, float]:
    """Convert MediaPipe blendshape result list to {name: score} dict."""
    return {bs.category_name: float(bs.score) for bs in blendshape_list}


def classify_emotions(blendshape_list) -> Dict[str, float]:
    """
    Returns normalized probability dict over 7 emotions.
    Each raw score = weighted sum of relevant blendshapes / sum_of_weights.
    Neutral = residual after sigmoid-like compression.
    """
    bs = blendshapes_to_dict(blendshape_list)

    raw: Dict[str, float] = {}
    for emotion, weights in _WEIGHTS.items():
        score = sum(bs.get(name, 0.0) * w for name, w in weights.items())
        raw[emotion] = score / _WEIGHT_SUMS[emotion]

    # Boost separation: square root amplifies weak signals
    import math
    boosted = {e: math.sqrt(max(0.0, v)) for e, v in raw.items()}

    total_non_neutral = sum(boosted.values())

    if total_non_neutral < 0.4:
        # All emotions weak → mostly neutral
        neutral = 1.0 - total_non_neutral * 0.8
    else:
        neutral = max(0.0, 1.0 - total_non_neutral)

    boosted["neutral"] = neutral
    grand_total = sum(boosted.values()) + 1e-9

    result = {e: round(boosted.get(e, 0.0) / grand_total, 4) for e in EMOTIONS}

    return result


def dominant_emotion(scores: Dict[str, float]) -> str:
    return max(scores, key=scores.__getitem__)

"""
Self-check for the emotion upgrade. Run: python test_pipeline.py  (downloads models + a test image
on first run). No camera needed.
"""
import json
import os
import urllib.request
from types import SimpleNamespace

import cv2
import numpy as np

import tracker
from tracker import Pipeline, EMOTION_INTERVAL_S
from tracker.face import face_crop

# EmotiEffLib's own test image (3 faces; their reference labels: Happiness, Anger, Fear).
IMG_URL = ("https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/"
           "520a051c64cd191521e5934655314e769a319684/tests/test_images/20180720_174416.jpg")
# Webcam-sized windows around each face (x, y, size), left to right.
FACES = [((655, 1033, 1008), "happy"), ((1134, 1285, 1008), "angry"), ((1638, 1285, 1008), "fear")]


def load_image():
    path = os.path.join(tracker._MODEL_DIR, "_test_faces.jpg")
    if not os.path.exists(path):
        os.makedirs(tracker._MODEL_DIR, exist_ok=True)  # a fresh checkout has no models/ yet
        urllib.request.urlretrieve(IMG_URL, path)
    return cv2.imread(path)


def test_face_crop_clips_to_frame():
    img = np.zeros((100, 200, 3), np.uint8)
    pts = [SimpleNamespace(x=x, y=y) for x, y in [(-0.2, 0.1), (0.5, 1.3), (0.25, 0.5)]]
    assert face_crop(img, pts).shape == (90, 100, 3)  # x 0..100, y 10..100
    assert face_crop(img, [SimpleNamespace(x=1.5, y=0.5)] * 3) is None  # fully off-frame


def test_model_matches_reference_labels():
    """Catches a wrong label order, wrong colour space, or wrong crop. Also writes the crops and
    scores to models/_parity.json, which lib/emotionModel.test.ts checks the browser path against."""
    bgr = load_image()
    p = Pipeline()
    parity = []
    for (x, y, s), expected in FACES:
        rgb = bgr[y:y + s, x:x + s, ::-1].copy()
        res = p.face.detect(p_image(rgb), next_ts())
        crop = cv2.resize(face_crop(rgb, res.face_landmarks[0]), (260, 260))  # the model's input size
        scores = p._emotion_model(crop)
        got = max(scores, key=scores.get)
        assert got == expected, f"expected {expected}, got {got}: {scores}"
        assert abs(sum(scores.values()) - 1) < 1e-4
        rgba = np.dstack([crop, np.full(crop.shape[:2], 255, np.uint8)])
        parity.append({"expected": expected, "rgba": rgba.tobytes().hex(), "scores": scores})
    with open(os.path.join(tracker._MODEL_DIR, "_parity.json"), "w") as f:
        json.dump(parity, f)
    p.close()


def test_sampling_and_fallback():
    (x, y, s), _ = FACES[0]
    frame = load_image()[y:y + s, x:x + s]
    p = Pipeline()
    calls = []
    model = p._emotion_model
    p._emotion_model = lambda crop: calls.append(1) or model(crop)

    r1 = p.process(frame)
    r2 = p.process(frame)
    assert len(calls) == 1, "second frame inside the interval must reuse the last reading"
    assert r1.dominant == r2.dominant == "happy"
    p._last_emotion_t -= EMOTION_INTERVAL_S
    p.process(frame)
    assert len(calls) == 2, "must re-sample once the interval has passed"

    p._emotion_model = None  # as if the model failed to load
    r = p.process(frame)
    assert r.face_detected and r.dominant in r.emotions
    assert abs(sum(r.emotions.values()) - 1) < 1e-3
    p.close()


_ts = [0]


def next_ts():
    _ts[0] += 33
    return _ts[0]


def p_image(rgb):
    import mediapipe as mp
    return mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok -", name)

"""
Debug runner — local OpenCV window showing all tracker signals.
Does NOT run in production. Press ESC to quit.

Usage: python new.py
"""
import os
import sys
import time

import cv2
import numpy as np
import mediapipe as mp

# ── ensure model/ is importable ─────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Pipeline() downloads any missing model files itself.
from tracker import Pipeline
from tracker.face import LEFT_EYE, RIGHT_EYE

HAND_CONNECTIONS = [
    (0,1),(1,2),(2,3),(3,4),(0,5),(5,6),(6,7),(7,8),
    (5,9),(9,10),(10,11),(11,12),(9,13),(13,14),(14,15),(15,16),
    (13,17),(0,17),(17,18),(18,19),(19,20),
]
POSE_CONNECTIONS = [
    (0,1),(1,2),(2,3),(3,7),(0,4),(4,5),(5,6),(6,8),(9,10),
    (11,12),(11,13),(13,15),(15,17),(15,19),(15,21),(17,19),
    (12,14),(14,16),(16,18),(16,20),(16,22),(18,20),
    (11,23),(12,24),(23,24),(23,25),(24,26),(25,27),(26,28),
    (27,29),(28,30),(29,31),(30,32),
]


def draw_lms(frame, landmarks, connections=None, color=(0,255,0), r=1, t=1):
    h, w = frame.shape[:2]
    pts = [(int(lm.x*w), int(lm.y*h)) for lm in landmarks]
    for p in pts:
        cv2.circle(frame, p, r, color, -1)
    if connections:
        for s, e in connections:
            if s < len(pts) and e < len(pts):
                cv2.line(frame, pts[s], pts[e], color, t)


def stress_color(s: float):
    """Green → orange → red based on stress 0-10."""
    if s < 4:
        return (0, 200, 0)
    if s < 7:
        return (0, 165, 255)
    return (0, 0, 220)


def draw_hud(frame, result, calibrating: bool):
    h, w = frame.shape[:2]
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (340, h), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.45, frame, 0.55, 0, frame)

    def txt(msg, y, color=(220,220,220), scale=0.55, thick=1):
        cv2.putText(frame, msg, (8, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, thick)

    if calibrating:
        txt("CALIBRATING... sit naturally", 35, (0,255,255), 0.65, 2)
        return

    sc = stress_color(result.stress_score)

    txt(f"STRESS  {result.stress_score:.2f}/10", 35, sc, 0.7, 2)
    txt(f"STATE   {_state(result.stress_score)}", 62, sc, 0.65, 2)

    txt("─" * 36, 80, (80, 80, 80))

    txt(f"EAR      {result.eye['ear']:.3f}", 105)
    txt(f"Blinks   {result.eye['blink_count']}  ({result.eye['blinks_per_min']:.1f}/min)", 128)

    txt("─" * 36, 145, (80,80,80))

    e = result.emotions
    dom = result.dominant
    txt(f"EMOTION  {dom.upper()}", 168, (180,255,180), 0.62, 2)
    for i, (name, val) in enumerate(sorted(e.items(), key=lambda x: -x[1])):
        bar_w = int(val * 120)
        y0 = 180 + i * 20
        cv2.rectangle(frame, (8, y0), (8+bar_w, y0+14), (60,120,200), -1)
        txt(f"{name[:7]:7s} {val:.2f}", y0+12, scale=0.48)

    txt("─" * 36, 326, (80,80,80))

    hp = result.head_pose
    txt(f"Yaw {hp['yaw']:+.1f}° Pitch {hp['pitch']:+.1f}° Roll {hp['roll']:+.1f}°", 346)

    gz = result.gaze
    on = "✓" if gz["looking_at_screen"] else "✗"
    txt(f"Gaze x{gz['x']:+.2f} y{gz['y']:+.2f}  screen{on}", 368)

    txt("─" * 36, 385, (80,80,80))

    hd = result.hands
    txt(f"Hands  {hd['fidget_level'].upper()}  ({hd['movement']:.4f})", 405)

    ps = result.posture
    txt(f"Posture  lean:{ps['lean']}  tilt:{ps['shoulder_tilt']:.1f}", 428)

    txt("─" * 36, 445, (80,80,80))

    txt(f"Engage   {result.engagement:.2f}", 465, (140,220,140))
    txt(f"Confide  {result.confidence:.2f}", 488, (140,200,255))
    txt(f"Attent   {result.attention:.2f}", 511, (200,200,140))


def _state(s: float) -> str:
    if s < 4:
        return "RELAXED"
    if s < 7:
        return "SLIGHTLY NERVOUS"
    return "STRESSED"


# MediaPipe face-mesh connections (subset used by FaceLandmarker)
_FACE_OVAL = [
    (10,338),(338,297),(297,332),(332,284),(284,251),(251,389),(389,356),(356,454),
    (454,323),(323,361),(361,288),(288,397),(397,365),(365,379),(379,378),(378,400),
    (400,377),(377,152),(152,148),(148,176),(176,149),(149,150),(150,136),(136,172),
    (172,58),(58,132),(132,93),(93,234),(234,127),(127,162),(162,21),(21,54),
    (54,103),(103,67),(67,109),(109,10),
]
_FACE_LIPS = [
    (61,185),(185,40),(40,39),(39,37),(37,0),(0,267),(267,269),(269,270),(270,409),
    (409,291),(291,375),(375,321),(321,405),(405,314),(314,17),(17,84),(84,181),
    (181,91),(91,146),(146,61),
    # inner lips
    (78,191),(191,80),(80,81),(81,82),(82,13),(13,312),(312,311),(311,310),(310,415),(415,308),
    (78,95),(95,88),(88,178),(178,87),(87,14),(14,317),(317,402),(402,318),(318,324),(324,308),
]
_FACE_LEFT_BROW  = [(46,53),(53,52),(52,65),(65,55),(55,107),(107,66),(66,105),(105,63),(63,70),
                    (107,55),(55,65),(65,52),(52,53),(53,46)]
_FACE_RIGHT_BROW = [(276,283),(283,282),(282,295),(295,285),(285,336),(336,296),(296,334),(334,293),(293,300),
                    (336,285),(285,295),(295,282),(282,283),(283,276)]
_FACE_LEFT_EYE_EDGE  = [(33,7),(7,163),(163,144),(144,145),(145,153),(153,154),(154,155),(155,133),
                         (33,246),(246,161),(161,160),(160,159),(159,158),(158,157),(157,173),(173,133)]
_FACE_RIGHT_EYE_EDGE = [(362,382),(382,381),(381,380),(380,374),(374,373),(373,390),(390,249),(249,263),
                         (362,398),(398,384),(384,385),(385,386),(386,387),(387,388),(388,466),(466,263)]
_FACE_NOSE = [(168,6),(6,197),(197,195),(195,5),(5,4),(4,1),(1,19),(19,94),(94,2),
              (98,97),(97,2),(2,326),(326,327),(327,294),
              (129,102),(102,49),(49,48),(48,115),(115,220),(220,45),(45,4),
              (358,331),(331,279),(279,278),(278,344),(344,440),(440,275),(275,4)]
# Cheek / forehead tessellation — horizontal grid bands
_FACE_CHEEKS = [
    # left cheek rows
    (116,123),(123,147),(147,213),(213,192),(192,214),(214,210),(210,211),(211,32),(32,208),
    (36,142),(142,126),(126,217),(217,174),(174,198),(198,200),(200,199),(199,175),(175,152),
    # right cheek rows
    (345,352),(352,376),(376,433),(433,416),(416,434),(434,430),(430,431),(431,262),(262,428),
    (266,371),(371,355),(355,437),(437,399),(399,419),(419,420),(420,421),(421,418),(418,262),
    # cross connections
    (205,50),(50,118),(118,117),(117,111),(111,35),(35,31),
    (425,280),(280,347),(347,346),(346,340),(340,265),(265,261),
    # forehead
    (151,9),(9,8),(8,168),(21,71),(71,54),(54,103),(103,67),(67,109),
    (251,301),(301,298),(298,333),(284,251),(368,264),(264,447),(447,366),
]
_ALL_FACE_CONNECTIONS = (
    _FACE_OVAL + _FACE_LIPS + _FACE_LEFT_BROW + _FACE_RIGHT_BROW +
    _FACE_LEFT_EYE_EDGE + _FACE_RIGHT_EYE_EDGE + _FACE_NOSE + _FACE_CHEEKS
)

# Hand skeleton connections (MediaPipe 21-point hand model)
_HAND_CONNECTIONS = [
    (0,1),(1,2),(2,3),(3,4),       # thumb
    (0,5),(5,6),(6,7),(7,8),       # index
    (5,9),(9,10),(10,11),(11,12),  # middle
    (9,13),(13,14),(14,15),(15,16),# ring
    (13,17),(0,17),(17,18),(18,19),(19,20),  # pinky + palm
]

# Pose skeleton connections (MediaPipe 33-point body model)
_POSE_CONNECTIONS = [
    # face
    (0,1),(1,2),(2,3),(3,7),(0,4),(4,5),(5,6),(6,8),(9,10),
    # torso
    (11,12),(11,23),(12,24),(23,24),
    # arms
    (11,13),(13,15),(15,17),(15,19),(15,21),(17,19),
    (12,14),(14,16),(16,18),(16,20),(16,22),(18,20),
    # legs
    (23,25),(24,26),(25,27),(26,28),
    (27,29),(28,30),(29,31),(30,32),(27,31),(28,32),
]


def draw_face_mesh(frame, face_res):
    """Draw all 478 face landmark dots + dense mesh edges."""
    if not face_res or not face_res.face_landmarks:
        return
    h, w = frame.shape[:2]
    lm = face_res.face_landmarks[0]
    pts = [(int(p.x * w), int(p.y * h)) for p in lm]

    # Draw edge connections first (behind dots)
    for s, e in _ALL_FACE_CONNECTIONS:
        if s < len(pts) and e < len(pts):
            cv2.line(frame, pts[s], pts[e], (0, 200, 80), 1, cv2.LINE_AA)

    # Draw every landmark dot
    for p in pts:
        cv2.circle(frame, p, 2, (0, 220, 220), -1, cv2.LINE_AA)

    cv2.putText(frame, f"face:{len(pts)}pts", (w - 155, h - 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 220, 220), 1, cv2.LINE_AA)


def draw_hand_landmarks(frame, hand_res):
    """Draw hand skeleton for up to 2 hands (21 landmarks each)."""
    if not hand_res or not hand_res.hand_landmarks:
        return
    h, w = frame.shape[:2]
    colors = [(255, 100, 50), (50, 100, 255)]  # orange left, blue right
    for hi, hand in enumerate(hand_res.hand_landmarks):
        col = colors[hi % 2]
        pts = [(int(p.x * w), int(p.y * h)) for p in hand]
        for s, e in _HAND_CONNECTIONS:
            if s < len(pts) and e < len(pts):
                cv2.line(frame, pts[s], pts[e], col, 2, cv2.LINE_AA)
        for i, p in enumerate(pts):
            # larger circle for fingertips (4,8,12,16,20)
            r = 5 if i in (4, 8, 12, 16, 20) else 3
            cv2.circle(frame, p, r, col, -1, cv2.LINE_AA)
            cv2.circle(frame, p, r + 1, (255, 255, 255), 1, cv2.LINE_AA)  # white ring


def draw_pose_landmarks(frame, pose_res):
    """Draw body skeleton (33 pose landmarks)."""
    if not pose_res or not pose_res.pose_landmarks:
        return
    h, w = frame.shape[:2]
    lms = pose_res.pose_landmarks[0]
    pts = [(int(p.x * w), int(p.y * h)) for p in lms]
    # Draw bones
    for s, e in _POSE_CONNECTIONS:
        if s < len(pts) and e < len(pts):
            cv2.line(frame, pts[s], pts[e], (180, 60, 255), 2, cv2.LINE_AA)
    # Draw joints
    for p in pts:
        cv2.circle(frame, p, 4, (230, 150, 255), -1, cv2.LINE_AA)
        cv2.circle(frame, p, 5, (255, 255, 255), 1, cv2.LINE_AA)


# ── main loop ────────────────────────────────────────────────────────────────
pipeline = Pipeline()

# Auto-detect the first working camera index (some systems have /dev/video0
# reserved for metadata devices and the real webcam is at index 1 or higher).
cap = None
for _cam_idx in range(5):
    _c = cv2.VideoCapture(_cam_idx)
    _ok, _ = _c.read()
    if _ok:
        cap = _c
        print(f"Camera found at index {_cam_idx}")
        break
    _c.release()

if cap is None:
    print("ERROR: No usable camera found (tried indices 0-4). "
          "Connect a webcam and retry.", file=sys.stderr)
    sys.exit(1)

cap.set(cv2.CAP_PROP_FRAME_WIDTH, 960)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

from tracker import CALIBRATION_FRAMES
import mediapipe as mp

# Re-use mediapipe for hand/pose drawing (results already run inside Pipeline)
# We need raw results for drawing; expose them via a thin wrapper.
# Quick approach: run detectors again from pipeline internals isn't clean,
# so we duplicate draw-only detection using pipeline's internal landmarkers.

print("Starting MockMentor Tracker — press ESC to quit  |  L = toggle landmark dots")
frame_idx = 0
last_result = None
show_landmarks = False   # toggled with the L key

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    frame = cv2.flip(frame, 1)
    ts = time.time()

    result = pipeline.process(frame, ts)
    last_result = result

    calibrating = frame_idx < CALIBRATION_FRAMES
    draw_hud(frame, result, calibrating)

    # ── landmark overlay (toggled with L) ───────────────────────────────
    if show_landmarks:
        draw_pose_landmarks(frame, pipeline.last_pose_res)    # draw body first (back)
        draw_face_mesh(frame, pipeline.last_face_res)          # face on top
        draw_hand_landmarks(frame, pipeline.last_hand_res)     # hands on top

    # ── on-screen hint ──────────────────────────────────────────────────
    h_fr, w_fr = frame.shape[:2]
    lbl = "[L] landmarks: ON  (face+hands+body)" if show_landmarks else "[L] landmarks: OFF"
    cv2.putText(frame, lbl, (w_fr - 280, 22),
                cv2.FONT_HERSHEY_SIMPLEX, 0.48,
                (0, 220, 220) if show_landmarks else (120, 120, 120),
                1, cv2.LINE_AA)

    frame_idx += 1

    cv2.imshow("MockMentor Tracker", frame)
    key = cv2.waitKey(1) & 0xFF
    if key == 27:          # ESC — quit
        break
    elif key == ord('l') or key == ord('L'):   # L — toggle dots
        show_landmarks = not show_landmarks
        print(f"Landmarks overlay: {'ON' if show_landmarks else 'OFF'}")

pipeline.close()
cap.release()
cv2.destroyAllWindows()

if last_result:
    print("\n─── Session End ───")
    print(f"Dominant emotion : {last_result.dominant}")
    print(f"Final stress     : {last_result.stress_score:.2f}")
    print(f"Total blinks     : {last_result.eye['blink_count']}")

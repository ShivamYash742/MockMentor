"""Per-session frame aggregation — summary sent to MongoDB after interview ends."""
import time
from collections import deque
from typing import Dict, List, Optional


class SessionStorage:
    def __init__(self, max_frames: int = 5400):  # ~3 min at 30 fps
        self._frames: deque = deque(maxlen=max_frames)
        self._start: float = time.time()
        self.session_id: Optional[str] = None

    def push(self, frame: dict):
        self._frames.append(frame)

    def aggregate(self) -> Dict:
        frames = list(self._frames)
        n = len(frames)
        if n == 0:
            return {}

        emotion_keys = ["happy", "sad", "angry", "surprised", "fear", "disgust", "neutral"]

        def avg(key: str, sub: Optional[str] = None) -> float:
            vals = [f[sub][key] if sub else f[key] for f in frames]
            return round(sum(vals) / n, 4)

        emotions_avg = {k: avg(k, "emotions") for k in emotion_keys}

        # Dominant emotion histogram
        dom_counts: Dict[str, int] = {}
        for f in frames:
            d = f.get("dominant", "neutral")
            dom_counts[d] = dom_counts.get(d, 0) + 1
        dominant_histogram = {k: round(v / n, 3) for k, v in dom_counts.items()}

        # Blink max = total blinks in session (monotonic counter)
        total_blinks = max((f["eye"]["blink_count"] for f in frames), default=0)

        # Looking at screen fraction
        look_frac = round(sum(1 for f in frames if f["gaze"]["looking_at_screen"]) / n, 3)

        duration_s = time.time() - self._start
        return {
            "session_id": self.session_id,
            "duration_s": round(duration_s, 1),
            "frame_count": n,
            "emotions_avg": emotions_avg,
            "dominant_histogram": dominant_histogram,
            "stress_avg": avg("stress_score"),
            "stress_peak": round(max(f["stress_score"] for f in frames), 3),
            "engagement_avg": avg("engagement"),
            "confidence_avg": avg("confidence"),
            "attention_avg": avg("attention"),
            "attention_on_screen_frac": look_frac,
            "total_blinks": total_blinks,
            # Blinks over the whole window, as in lib/faceAnalysis.ts. Averaging each frame's
            # running rate was inflated early on (one blink in the first second reads as 60/min).
            "blinks_per_min_avg": round(total_blinks / (duration_s / 60.0), 2) if duration_s > 0 else 0.0,
        }

    def clear(self):
        self._frames.clear()
        self._start = time.time()

    def __len__(self) -> int:
        return len(self._frames)

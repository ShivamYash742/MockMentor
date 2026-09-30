"""
Server checks: per-connection isolation, the optional access token, bad frames, and that frame
processing doesn't block other requests. Run after test_pipeline.py (which downloads the models
and the test image):  python test_server.py
"""
import asyncio
import base64
import json
import os
import threading
import time
import urllib.request

os.environ["ML_ACCESS_TOKEN"] = "test-token"  # read by server.py at import

import cv2
import uvicorn
import websockets

import server
import tracker
from tracker import Models, Pipeline
from test_pipeline import FACES, load_image

PORT = 8765


def face_frame(index):
    (x, y, s), expected = FACES[index]
    return load_image()[y:y + s, x:x + s], expected


def test_pipelines_sharing_models_keep_their_own_state():
    """The server used to run every connection through one Pipeline: a frame from one user inside
    another user's 1 s emotion window got the other user's reading instead of its own."""
    models = Models()
    a, b = Pipeline(models=models), Pipeline(models=models)
    happy, _ = face_frame(0)
    angry, _ = face_frame(1)
    assert a.process(happy).dominant == "happy"
    assert b.process(angry).dominant == "angry"  # immediately after, well inside a's window
    a.reset_session()
    assert b._blink_count == 0 and b._frame_count == 1  # a's reset doesn't touch b
    a.close()
    b.close()
    assert models.face is not None  # closing a session leaves the shared models alone
    models.close()


def start_server():
    config = uvicorn.Config(server.app, host="127.0.0.1", port=PORT, log_level="warning")
    srv = uvicorn.Server(config)
    threading.Thread(target=srv.run, daemon=True).start()
    for _ in range(600):
        if srv.started:
            return srv
        time.sleep(0.1)
    raise RuntimeError("server did not start")


def jpeg_b64(frame):
    ok, buf = cv2.imencode(".jpg", cv2.resize(frame, (640, 640)), [cv2.IMWRITE_JPEG_QUALITY, 60])
    return base64.b64encode(buf.tobytes()).decode()


async def ws_session_checks():
    url = f"ws://127.0.0.1:{PORT}/ws/check"

    # Without the token the connection is refused.
    try:
        async with websockets.connect(url) as ws:
            await ws.recv()
        raise AssertionError("connected without a token")
    except websockets.exceptions.ConnectionClosed as exc:
        assert exc.rcvd.code == 1008, exc
    except websockets.exceptions.InvalidStatus:
        pass  # also a refusal

    happy, _ = face_frame(0)
    angry, _ = face_frame(1)
    async with websockets.connect(f"{url}?token=test-token", max_size=None) as a, \
            websockets.connect(f"{url}?token=test-token", max_size=None) as b:
        # Bad frames are reported and the session carries on.
        await a.send(json.dumps({"frame": "not base64!!"}))
        assert json.loads(await a.recv()) == {"error": "invalid frame"}
        await a.send(json.dumps({"frame": "A" * (server.MAX_FRAME_B64_CHARS + 4)}))
        assert json.loads(await a.recv()) == {"error": "frame too large"}

        # Two users at once, each with their own face and their own reading.
        await a.send(json.dumps({"frame": jpeg_b64(happy), "ts": 1.0}))
        await b.send(json.dumps({"frame": jpeg_b64(angry), "ts": 1.0}))
        ra, rb = json.loads(await a.recv()), json.loads(await b.recv())
        assert ra["dominant"] == "happy", ra["dominant"]
        assert rb["dominant"] == "angry", rb["dominant"]

        # Each connection's summary covers only its own frames.
        await a.send(json.dumps({"cmd": "summary"}))
        summary_a = json.loads(await a.recv())["data"]
        assert summary_a["frame_count"] == 1

        # A client-supplied ts that isn't a number doesn't break anything.
        await b.send(json.dumps({"frame": jpeg_b64(angry), "ts": "soon"}))
        assert "dominant" in json.loads(await b.recv())


async def health_stays_responsive():
    """Frame processing runs in a worker thread, so the event loop keeps answering other requests
    while a session is busy. It used to run on the loop itself and stall everything."""
    happy, _ = face_frame(0)
    payload = json.dumps({"frame": jpeg_b64(happy)})
    loop = asyncio.get_running_loop()
    latencies = []
    stop = asyncio.Event()

    async def hammer():
        async with websockets.connect(f"ws://127.0.0.1:{PORT}/ws/load?token=test-token", max_size=None) as ws:
            for _ in range(30):
                await ws.send(payload)
                await ws.recv()
        stop.set()

    def get_health():
        t0 = time.perf_counter()
        urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/health").read()
        return time.perf_counter() - t0

    async def poll():
        while not stop.is_set():
            latencies.append(await loop.run_in_executor(None, get_health))
            await asyncio.sleep(0.02)

    t0 = time.perf_counter()
    await asyncio.gather(hammer(), poll())
    per_frame = (time.perf_counter() - t0) / 30
    worst = max(latencies)
    print(f"   {per_frame * 1000:.0f} ms per frame, worst /api/health {worst * 1000:.0f} ms over {len(latencies)} polls")
    assert worst < max(0.05, per_frame * 0.8), (worst, per_frame)


def test_server():
    srv = start_server()
    try:
        asyncio.run(ws_session_checks())
        asyncio.run(health_stays_responsive())
    finally:
        srv.should_exit = True


if __name__ == "__main__":
    assert os.path.exists(os.path.join(tracker._MODEL_DIR, "_test_faces.jpg")), "run test_pipeline.py first"
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok -", name)

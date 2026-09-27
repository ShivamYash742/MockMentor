"""
MockMentor ML Sidecar — FastAPI WebSocket server.

GET  /          → browser camera preview + live tracker dashboard
GET  /api/      → JSON service info
GET  /api/health → JSON health check
WS   /ws/{session_id} → frame-in / FrameResult-out

Start: python server.py
Env:   ML_PORT (default 8001), ML_ALLOWED_ORIGIN (default *)
"""
import base64
import os
import time

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from tracker import Pipeline
from storage import SessionStorage

ALLOWED_ORIGIN = os.environ.get("ML_ALLOWED_ORIGIN", "*")

app = FastAPI(title="MockMentor ML Sidecar", version="2.0.0", docs_url="/api/docs")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_pipeline: Pipeline | None = None


def get_pipeline() -> Pipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = Pipeline()
    return _pipeline


# ─────────────────────────────────────────────────────────────────────────────
# Debug dashboard (served at /)
# ─────────────────────────────────────────────────────────────────────────────
_DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>MockMentor — ML Sidecar Monitor</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0d0d0f;color:#e2e8f0;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column}
  header{background:#111116;border-bottom:1px solid #1e1e2e;padding:12px 24px;display:flex;align-items:center;gap:12px}
  header h1{font-size:1.1rem;font-weight:700;letter-spacing:.02em}
  .dot{width:10px;height:10px;border-radius:50%;background:#22c55e;animation:pulse 1.5s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  .status-pill{font-size:.72rem;padding:3px 10px;border-radius:999px;font-weight:600;background:#1e293b;color:#94a3b8}
  .status-pill.connected{background:#14532d;color:#4ade80}
  .status-pill.error{background:#450a0a;color:#f87171}

  main{display:flex;flex:1;gap:0;overflow:hidden;height:calc(100vh - 57px)}

  /* Camera panel */
  .cam-panel{position:relative;flex:1;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden}
  #video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
  canvas#cap{display:none}

  /* Calibration overlay */
  #cal-overlay{position:absolute;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;font-size:1.1rem;color:#06b6d4;font-weight:600;pointer-events:none}
  #cal-bar-wrap{width:260px;height:6px;background:#1e293b;border-radius:999px;overflow:hidden}
  #cal-bar{height:100%;background:#06b6d4;border-radius:999px;transition:width .2s}

  /* HUD overlays on video */
  #hud{position:absolute;inset:0;pointer-events:none}
  .hud-tl{position:absolute;top:12px;left:12px;display:flex;flex-direction:column;gap:6px}
  .hud-br{position:absolute;bottom:12px;right:12px;display:flex;flex-direction:column;gap:5px;align-items:flex-end}
  .badge{font-size:.72rem;font-weight:700;padding:3px 10px;border-radius:999px;backdrop-filter:blur(8px)}
  .badge.gaze-on{background:rgba(34,197,94,.75);color:#fff}
  .badge.gaze-off{background:rgba(239,68,68,.75);color:#fff}

  /* Data panel */
  .data-panel{width:340px;background:#111116;border-left:1px solid #1e1e2e;overflow-y:auto;padding:0}

  /* Sections */
  .section{border-bottom:1px solid #1e1e2e;padding:14px 16px}
  .section-title{font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#475569;margin-bottom:10px}

  /* Stress big display */
  .stress-big{display:flex;align-items:flex-end;gap:6px;margin-bottom:8px}
  .stress-num{font-size:2.4rem;font-weight:800;line-height:1}
  .stress-label{font-size:.8rem;color:#94a3b8;margin-bottom:6px}
  .state-badge{display:inline-block;font-size:.72rem;font-weight:700;padding:3px 10px;border-radius:6px;margin-top:6px}

  /* Bars */
  .bar-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .bar-label{font-size:.7rem;color:#94a3b8;width:68px;shrink:0;text-align:right}
  .bar-track{flex:1;height:6px;background:#1e293b;border-radius:999px;overflow:hidden}
  .bar-fill{height:100%;border-radius:999px;transition:width .4s ease}
  .bar-val{font-size:.68rem;color:#64748b;width:32px;text-align:right}

  /* Emotion colors */
  .emo-happy{background:#22c55e}.emo-neutral{background:#64748b}.emo-surprised{background:#facc15}
  .emo-sad{background:#60a5fa}.emo-fear{background:#a78bfa}.emo-angry{background:#ef4444}
  .emo-disgust{background:#f97316}

  /* Meta grid */
  .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .meta-card{background:#0d0d0f;border:1px solid #1e1e2e;border-radius:8px;padding:10px}
  .meta-card .val{font-size:1.3rem;font-weight:700;color:#e2e8f0}
  .meta-card .lbl{font-size:.65rem;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-top:2px}

  /* Eye / hand / pose row */
  .kv-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #1a1a2e}
  .kv-row:last-child{border:none}
  .kv-key{font-size:.7rem;color:#64748b}
  .kv-val{font-size:.75rem;font-weight:600;color:#cbd5e1}

  /* No-face notice */
  #no-face{display:none;position:absolute;bottom:12px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.7);backdrop-filter:blur(8px);border:1px solid #ef4444;color:#f87171;font-size:.78rem;padding:6px 14px;border-radius:8px;pointer-events:none}
</style>
</head>
<body>

<header>
  <div class="dot" id="dot"></div>
  <h1>MockMentor — ML Sidecar</h1>
  <span class="status-pill" id="ws-status">Connecting…</span>
  <span style="margin-left:auto;font-size:.72rem;color:#475569" id="ws-url-label">connecting...</span>
</header>

<main>
  <!-- Camera + HUD -->
  <div class="cam-panel">
    <video id="video" autoplay playsinline muted></video>
    <canvas id="cap"></canvas>

    <div id="start-overlay" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0d0d0f;z-index:20;gap:16px">
      <p style="color:#94a3b8;font-size:.95rem">Camera access required for live analysis</p>
      <button id="start-btn" onclick="startCamera()" style="padding:12px 32px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;letter-spacing:.02em">Enable Camera</button>
      <p id="cam-err" style="color:#f87171;font-size:.8rem;display:none"></p>
    </div>

    <div id="cal-overlay">
      <span>Calibrating… sit naturally</span>
      <div id="cal-bar-wrap"><div id="cal-bar" style="width:0%"></div></div>
    </div>

    <div id="hud">
      <div class="hud-tl">
        <span class="badge gaze-on" id="gaze-badge">👁 on screen</span>
      </div>
      <div class="hud-br">
        <span class="badge" id="emotion-badge" style="background:rgba(100,116,139,.75);color:#fff">NEUTRAL</span>
      </div>
    </div>

    <div id="no-face">⚠ No face detected</div>
  </div>

  <!-- Data panel -->
  <div class="data-panel">

    <!-- Stress -->
    <div class="section">
      <div class="section-title">Stress</div>
      <div class="stress-big">
        <div class="stress-num" id="stress-num">0.0</div>
        <div class="stress-label">/ 10</div>
      </div>
      <div class="bar-track" style="height:8px">
        <div class="bar-fill" id="stress-bar" style="width:0%;background:#22c55e"></div>
      </div>
      <div class="state-badge" id="state-badge" style="background:#14532d;color:#4ade80">RELAXED</div>
    </div>

    <!-- Meta signals -->
    <div class="section">
      <div class="section-title">Meta Signals</div>
      <div class="meta-grid">
        <div class="meta-card"><div class="val" id="m-engage">1.00</div><div class="lbl">Engagement</div></div>
        <div class="meta-card"><div class="val" id="m-confid">1.00</div><div class="lbl">Confidence</div></div>
        <div class="meta-card"><div class="val" id="m-attent">1.00</div><div class="lbl">Attention</div></div>
        <div class="meta-card"><div class="val" id="m-bpm">0</div><div class="lbl">Blinks/min</div></div>
      </div>
    </div>

    <!-- Emotions -->
    <div class="section">
      <div class="section-title">Emotions</div>
      <div id="emotion-bars"></div>
    </div>

    <!-- Head pose -->
    <div class="section">
      <div class="section-title">Head Pose</div>
      <div class="kv-row"><span class="kv-key">Yaw</span><span class="kv-val" id="p-yaw">0.0°</span></div>
      <div class="kv-row"><span class="kv-key">Pitch</span><span class="kv-val" id="p-pitch">0.0°</span></div>
      <div class="kv-row"><span class="kv-key">Roll</span><span class="kv-val" id="p-roll">0.0°</span></div>
    </div>

    <!-- Gaze -->
    <div class="section">
      <div class="section-title">Gaze</div>
      <div class="kv-row"><span class="kv-key">X offset</span><span class="kv-val" id="g-x">0.00</span></div>
      <div class="kv-row"><span class="kv-key">Y offset</span><span class="kv-val" id="g-y">0.00</span></div>
      <div class="kv-row"><span class="kv-key">On screen</span><span class="kv-val" id="g-screen">✓</span></div>
    </div>

    <!-- Eye -->
    <div class="section">
      <div class="section-title">Eye / Blink</div>
      <div class="kv-row"><span class="kv-key">EAR</span><span class="kv-val" id="e-ear">0.300</span></div>
      <div class="kv-row"><span class="kv-key">Total blinks</span><span class="kv-val" id="e-count">0</span></div>
    </div>

    <!-- Hands + Posture -->
    <div class="section">
      <div class="section-title">Hands &amp; Posture</div>
      <div class="kv-row"><span class="kv-key">Fidget level</span><span class="kv-val" id="h-fidget">still</span></div>
      <div class="kv-row"><span class="kv-key">Movement</span><span class="kv-val" id="h-mov">0.00000</span></div>
      <div class="kv-row"><span class="kv-key">Lean</span><span class="kv-val" id="ps-lean">upright</span></div>
      <div class="kv-row"><span class="kv-key">Shoulder tilt</span><span class="kv-val" id="ps-tilt">0.0</span></div>
    </div>

    <!-- Frame rate -->
    <div class="section" style="border:none">
      <div class="section-title">Debug</div>
      <div class="kv-row"><span class="kv-key">Frames processed</span><span class="kv-val" id="d-frames">0</span></div>
      <div class="kv-row"><span class="kv-key">Latency</span><span class="kv-val" id="d-latency">—</span></div>
    </div>

  </div>
</main>

<script>
const EMOTION_COLORS = {
  happy:'#22c55e', neutral:'#64748b', surprised:'#facc15',
  sad:'#60a5fa', fear:'#a78bfa', angry:'#ef4444', disgust:'#f97316'
};
const EMOTION_ORDER = ['happy','neutral','surprised','sad','fear','angry','disgust'];

// Build emotion bars once
const emotionBarsEl = document.getElementById('emotion-bars');
const barEls = {};
EMOTION_ORDER.forEach(emo => {
  const row = document.createElement('div');
  row.className = 'bar-row';
  row.innerHTML = `
    <span class="bar-label">${emo}</span>
    <div class="bar-track"><div class="bar-fill emo-${emo}" id="ebar-${emo}" style="width:0%;background:${EMOTION_COLORS[emo]}"></div></div>
    <span class="bar-val" id="eval-${emo}">0.00</span>
  `;
  emotionBarsEl.appendChild(row);
  barEls[emo] = { fill: document.getElementById(`ebar-${emo}`), val: document.getElementById(`eval-${emo}`) };
});

// State
const CAL_FRAMES = 90;
let frameCount = 0;
let framesSent = 0;
let ws = null;
let sendInterval = null;
let lastSentTs = 0;

// DOM refs
const wsStatus  = document.getElementById('ws-status');
const calOverlay= document.getElementById('cal-overlay');
const calBar    = document.getElementById('cal-bar');
const gazeBadge = document.getElementById('gaze-badge');
const emotionBadge = document.getElementById('emotion-badge');
const noFace    = document.getElementById('no-face');
const dot       = document.getElementById('dot');
const video     = document.getElementById('video');
const cap       = document.getElementById('cap');
cap.width = 320; cap.height = 240;
const ctx = cap.getContext('2d');

function stressColor(s){
  if(s < 4) return '#22c55e';
  if(s < 7) return '#f59e0b';
  return '#ef4444';
}
function stressState(s){
  if(s < 4) return {label:'RELAXED', bg:'#14532d', col:'#4ade80'};
  if(s < 7) return {label:'SLIGHTLY NERVOUS', bg:'#451a03', col:'#fb923c'};
  return {label:'STRESSED', bg:'#450a0a', col:'#f87171'};
}

function update(d) {
  frameCount++;

  // Calibration bar
  if(frameCount <= CAL_FRAMES){
    calOverlay.style.display = 'flex';
    calBar.style.width = `${(frameCount/CAL_FRAMES)*100}%`;
    return;
  }
  calOverlay.style.display = 'none';

  // No face
  noFace.style.display = d.face_detected ? 'none' : 'block';
  if(!d.face_detected) return;

  // Stress
  const sc = stressColor(d.stress_score);
  const st = stressState(d.stress_score);
  document.getElementById('stress-num').textContent = d.stress_score.toFixed(1);
  document.getElementById('stress-num').style.color = sc;
  document.getElementById('stress-bar').style.width = `${Math.min(100,(d.stress_score/10)*100)}%`;
  document.getElementById('stress-bar').style.background = sc;
  const sb = document.getElementById('state-badge');
  sb.textContent = st.label; sb.style.background = st.bg; sb.style.color = st.col;

  // Meta
  document.getElementById('m-engage').textContent = d.engagement.toFixed(2);
  document.getElementById('m-confid').textContent = d.confidence.toFixed(2);
  document.getElementById('m-attent').textContent = d.attention.toFixed(2);
  document.getElementById('m-bpm').textContent    = d.eye.blinks_per_min.toFixed(1);

  // Emotions
  let dom = d.dominant;
  EMOTION_ORDER.forEach(emo => {
    const v = (d.emotions[emo] || 0);
    barEls[emo].fill.style.width = `${(v*100).toFixed(1)}%`;
    barEls[emo].val.textContent  = v.toFixed(3);
  });
  emotionBadge.textContent = dom.toUpperCase();
  emotionBadge.style.background = (EMOTION_COLORS[dom] || '#64748b') + 'cc';

  // Head pose
  document.getElementById('p-yaw').textContent   = `${d.head_pose.yaw > 0 ? '+' : ''}${d.head_pose.yaw.toFixed(1)}°`;
  document.getElementById('p-pitch').textContent = `${d.head_pose.pitch > 0 ? '+' : ''}${d.head_pose.pitch.toFixed(1)}°`;
  document.getElementById('p-roll').textContent  = `${d.head_pose.roll > 0 ? '+' : ''}${d.head_pose.roll.toFixed(1)}°`;

  // Gaze
  document.getElementById('g-x').textContent = d.gaze.x.toFixed(3);
  document.getElementById('g-y').textContent = d.gaze.y.toFixed(3);
  const onScreen = d.gaze.looking_at_screen;
  document.getElementById('g-screen').textContent = onScreen ? '✓ yes' : '✗ no';
  gazeBadge.textContent = onScreen ? '👁 on screen' : '👁 looking away';
  gazeBadge.className = `badge ${onScreen ? 'gaze-on' : 'gaze-off'}`;

  // Eye
  document.getElementById('e-ear').textContent   = d.eye.ear.toFixed(4);
  document.getElementById('e-count').textContent = d.eye.blink_count;

  // Hands + Posture
  document.getElementById('h-fidget').textContent = d.hands.fidget_level.toUpperCase();
  document.getElementById('h-mov').textContent    = d.hands.movement.toFixed(5);
  document.getElementById('ps-lean').textContent  = d.posture.lean;
  document.getElementById('ps-tilt').textContent  = d.posture.shoulder_tilt.toFixed(1);

  // Debug
  document.getElementById('d-frames').textContent = frameCount;
  const lat = d.ts ? `${((Date.now()/1000 - d.ts)*1000).toFixed(0)} ms` : '—';
  document.getElementById('d-latency').textContent = lat;
}

let _retries = 0;

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${proto}://${location.host}/ws/debug`;
  const label = document.getElementById('ws-url-label');
  if (label) label.textContent = wsUrl;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    _retries = 0; // reset on success
    wsStatus.textContent = 'Connected';
    wsStatus.className = 'status-pill connected';
    dot.style.background = '#22c55e';
    startSending();
  };

  ws.onmessage = (ev) => {
    try { update(JSON.parse(ev.data)); } catch(e){}
  };

  ws.onclose = () => {
    clearInterval(sendInterval);
    dot.style.background = '#ef4444';
    if (_retries >= 5) {
      wsStatus.textContent = 'Pipeline failed — check Render logs';
      wsStatus.className = 'status-pill error';
      return; // stop retrying
    }
    const delay = Math.min(2000 * Math.pow(2, _retries), 30000);
    _retries++;
    wsStatus.textContent = `Disconnected — retry ${_retries}/5 in ${Math.round(delay/1000)}s…`;
    wsStatus.className = 'status-pill error';
    setTimeout(connectWS, delay);
  };

  ws.onerror = () => ws.close();

  // Show server-side error messages (pipeline crash etc.)
  const _origOnMessage = ws.onmessage;
  ws.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data);
      if (d.error) {
        wsStatus.textContent = `Server error: ${d.error}`;
        wsStatus.className = 'status-pill error';
        return;
      }
    } catch(e){}
    if (_origOnMessage) _origOnMessage(ev);
  };
}

function startSending() {
  clearInterval(sendInterval);
  sendInterval = setInterval(() => {
    if(!ws || ws.readyState !== WebSocket.OPEN) return;
    if(!video.videoWidth) return;
    ctx.drawImage(video, 0, 0, 320, 240);
    const b64 = cap.toDataURL('image/jpeg', 0.6).split(',')[1];
    ws.send(JSON.stringify({ frame: b64, ts: Date.now()/1000 }));
    framesSent++;
  }, 200); // 5 fps
}

// Start camera — called by button click (requires user gesture for permission prompt)
function startCamera() {
  const btn = document.getElementById('start-btn');
  const errEl = document.getElementById('cam-err');
  if (btn) btn.textContent = 'Requesting…';
  navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false })
    .then(stream => {
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        const overlay = document.getElementById('start-overlay');
        if (overlay) overlay.style.display = 'none';
        connectWS();
      };
    })
    .catch(err => {
      console.error(err);
      if (btn) btn.textContent = 'Retry';
      if (errEl) {
        errEl.style.display = 'block';
        errEl.textContent = err.name === 'NotAllowedError'
          ? 'Permission denied — click the camera icon in your browser address bar and allow access.'
          : err.name === 'NotFoundError'
          ? 'No camera found on this device.'
          : `Error: ${err.message}`;
      }
      wsStatus.textContent = 'Camera denied';
      wsStatus.className = 'status-pill error';
    });
}
</script>
</body>
</html>"""


@app.get("/", response_class=HTMLResponse)
async def dashboard():
    return HTMLResponse(content=_DASHBOARD_HTML)


# ─────────────────────────────────────────────────────────────────────────────
# JSON API routes (all under /api/)
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/")
async def api_root():
    return {
        "service": "MockMentor ML Sidecar",
        "version": "2.0.0",
        "endpoints": {
            "dashboard":  "GET  /",
            "health":     "GET  /api/health",
            "docs":       "GET  /api/docs",
            "websocket":  "WS   /ws/{session_id}",
        },
    }


@app.get("/api/health")
async def health():
    pipeline_ok = _pipeline is not None
    return {"status": "ok", "pipeline_ready": pipeline_ok, "ts": time.time()}


@app.on_event("startup")
async def startup_event():
    """Pre-warm pipeline so crash appears in Render logs at boot, not on first WS."""
    import asyncio, concurrent.futures
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, get_pipeline)
        print("Pipeline initialised successfully.")
    except Exception as exc:
        import traceback
        print(f"FATAL: Pipeline failed to initialise — {exc}")
        traceback.print_exc()


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket — frame in, FrameResult out
# ─────────────────────────────────────────────────────────────────────────────
@app.websocket("/ws/{session_id}")
async def ws_endpoint(websocket: WebSocket, session_id: str):
    """
    Client → Server: {"frame": "<base64 JPEG>", "ts": 1234567890.123}
    Server → Client: FrameResult JSON

    Control commands:
      {"cmd": "reset"}   — reset blink/calibration counters
      {"cmd": "summary"} — return session aggregate
    """
    await websocket.accept()
    try:
        pipeline = get_pipeline()
    except Exception as init_exc:
        import traceback
        traceback.print_exc()
        await websocket.send_json({"error": f"Pipeline init failed: {init_exc}"})
        await websocket.close()
        return

    storage = SessionStorage()
    storage.session_id = session_id

    try:
        while True:
            data = await websocket.receive_json()

            cmd = data.get("cmd")
            if cmd == "reset":
                pipeline.reset_session()
                storage.clear()
                await websocket.send_json({"cmd": "reset", "ok": True})
                continue

            if cmd == "summary":
                await websocket.send_json({"cmd": "summary", "data": storage.aggregate()})
                continue

            frame_b64 = data.get("frame")
            if not frame_b64:
                continue

            jpg_bytes = base64.b64decode(frame_b64)
            np_arr = np.frombuffer(jpg_bytes, np.uint8)
            frame_bgr = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

            if frame_bgr is None:
                await websocket.send_json({"error": "invalid frame"})
                continue

            ts = data.get("ts", time.time())
            result = pipeline.process(frame_bgr, ts)
            result_dict = result.to_dict()
            storage.push(result_dict)

            await websocket.send_json(result_dict)

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await websocket.send_json({"error": str(exc)})
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", os.environ.get("ML_PORT", 8001)))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")

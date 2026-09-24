'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useFaceTracker } from '@/hooks/useFaceTracker';
import type { AggregatedSummary } from '@/lib/faceAnalysis';
import type { FaceEmotions } from '@/lib/mlSidecar';

// ── Helpers ────────────────────────────────────────────────────────────────

const EMOTION_KEYS = ['happy', 'sad', 'angry', 'surprised', 'fear', 'disgust', 'neutral'] as const;

const EMOJI: Record<string, string> = {
  happy: '😊', sad: '😢', angry: '😠', surprised: '😲',
  fear: '😨', disgust: '🤢', neutral: '😐',
};

const EMOTION_COLORS: Record<string, string> = {
  happy: '#22c55e', sad: '#60a5fa', angry: '#ef4444', surprised: '#eab308',
  fear: '#a855f7', disgust: '#f97316', neutral: '#94a3b8',
};

function fmt(v: number, d = 2): string {
  return v.toFixed(d);
}

function barPct(v: number, max = 1): number {
  return Math.min(100, (v / max) * 100);
}

function stressColor(s: number): string {
  if (s < 4) return 'bg-green-500';
  if (s < 7) return 'bg-amber-500';
  return 'bg-red-500';
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function TestFacePage() {
  const [mounted, setMounted] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const faceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [summary, setSummary] = useState<AggregatedSummary | null>(null);
  const [modelReady, setModelReady] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [showFaceOverlay, setShowFaceOverlay] = useState(true);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const frameCountRef = useRef(0);

  // ── Mount guard — prevents hydration mismatch from browser extensions ──
  useEffect(() => {
    setMounted(true);
  }, []);

  // ── Face tracker hook ────────────────────────────────────────
  const {
    lastFrame,
    isConnected,
    isSidecarAvailable,
    requestSummary,
    resetSession,
  } = useFaceTracker(videoRef, null, cameraActive);

  // Track model loading status
  useEffect(() => {
    if (isSidecarAvailable && isConnected) {
      setModelReady('ready');
    }
    if (!cameraActive) return;
    if (!isSidecarAvailable && modelReady === 'loading') {
      setModelReady('failed');
    }
  }, [isSidecarAvailable, isConnected, cameraActive, modelReady]);

  // Track calibration progress
  useEffect(() => {
    if (!lastFrame?.face_detected) return;
    frameCountRef.current += 1;
    const pct = Math.min(100, Math.round((frameCountRef.current / 90) * 100));
    setCalibrationProgress(pct);
  }, [lastFrame]);

  // ── Log helper ───────────────────────────────────────────────
  const addLog = useCallback((msg: string) => {
    const t = new Date().toLocaleTimeString();
    setLogs(prev => [`[${t}] ${msg}`, ...prev].slice(0, 100));
  }, []);

  // ── Camera control ───────────────────────────────────────────
  const startCamera = async () => {
    try {
      setCameraError(null);
      addLog('📷 Requesting camera access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
        addLog('✅ Camera started');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCameraError(msg);
      addLog(`❌ Camera error: ${msg}`);
    }
  };

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      videoRef.current!.srcObject = null;
    }
    setCameraActive(false);
    setCalibrationProgress(0);
    frameCountRef.current = 0;
    addLog('⏹️ Camera stopped');
  };

  // ── Draw face landmarks on canvas ────────────────────────────
  useEffect(() => {
    // This effect currently draws a simple border overlay
    // Full landmark rendering would require the raw landmarks from MediaPipe
    const canvas = faceCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !lastFrame?.face_detected || !showFaceOverlay) {
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw a simple face detection indicator — a circle in the center
    // This shows the face is detected without needing raw landmarks
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // Pulse ring
    const pulse = Math.sin(Date.now() / 300) * 0.5 + 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 40 + pulse * 15, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(34, 197, 94, ${0.3 + pulse * 0.3})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#22c55e';
    ctx.fill();

    // Border frame
    const w = canvas.width;
    const h = canvas.height;
    const cornerLen = 30;
    const color = '#22c55e';

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    // Top-left
    ctx.beginPath();
    ctx.moveTo(10, 10 + cornerLen);
    ctx.lineTo(10, 10);
    ctx.lineTo(10 + cornerLen, 10);
    ctx.stroke();
    // Top-right
    ctx.beginPath();
    ctx.moveTo(w - 10 - cornerLen, 10);
    ctx.lineTo(w - 10, 10);
    ctx.lineTo(w - 10, 10 + cornerLen);
    ctx.stroke();
    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(10, h - 10 - cornerLen);
    ctx.lineTo(10, h - 10);
    ctx.lineTo(10 + cornerLen, h - 10);
    ctx.stroke();
    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(w - 10 - cornerLen, h - 10);
    ctx.lineTo(w - 10, h - 10);
    ctx.lineTo(w - 10, h - 10 - cornerLen);
    ctx.stroke();
  }, [lastFrame, showFaceOverlay]);

  // ── Request summary ──────────────────────────────────────────
  const handleRequestSummary = async () => {
    const s = await requestSummary();
    setSummary(s);
    if (s) {
      addLog(`📊 Summary: ${s.frame_count} frames, ${fmt(s.duration_s, 1)}s, ${s.total_blinks} blinks`);
    } else {
      addLog('⚠️ No frames recorded yet');
    }
  };

  const handleReset = () => {
    resetSession();
    frameCountRef.current = 0;
    setCalibrationProgress(0);
    setSummary(null);
    addLog('🔄 Session reset');
  };

  // ── Emotion bar chart ────────────────────────────────────────
  function EmotionBars({ emotions }: { emotions: Record<string, number> }) {
    return (
      <div className="space-y-1.5">
        {EMOTION_KEYS.map(key => {
          const val = emotions[key] ?? 0;
          const pct = barPct(val);
          return (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span className="w-6 text-center">{EMOJI[key]}</span>
              <span className="w-16 text-slate-300 font-medium capitalize">{key}</span>
              <div className="flex-1 h-2.5 bg-slate-700/60 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${pct}%`, backgroundColor: EMOTION_COLORS[key] }}
                />
              </div>
              <span className="w-11 text-right text-slate-400 font-mono">{fmt(val, 3)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────
  const f = lastFrame;
  const emotionScores: Record<string, number> = {};
  if (f?.emotions) {
    const emotions = f.emotions as FaceEmotions;
    for (const k of EMOTION_KEYS) {
      emotionScores[k] = emotions[k] ?? 0;
    }
  }

  if (!mounted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center">
        <div className="text-slate-500 text-center">
          <p className="text-4xl mb-3">🧠</p>
          <p className="font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold text-white mb-2">
            🧠 Face Tracking Diagnostics
          </h1>
          <p className="text-slate-400">
            Real-time face analysis powered by MediaPipe (client-side)
          </p>
        </div>

        {/* Status Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">            <StatusBadge
              label="Model"
              value={
                modelReady === 'loading' ? '⏳ Loading...' :
                modelReady === 'ready' ? '✅ Loaded' :
                '❌ Failed'
              }
              color={
                modelReady === 'ready' ? 'text-green-400' :
                modelReady === 'loading' ? 'text-blue-400' :
                'text-red-400'
              }
            />
          <StatusBadge
            label="Tracker"
            value={isConnected ? '🟢 Connected' : '🔴 Disconnected'}
            color={isConnected ? 'text-green-400' : 'text-red-400'}
          />
          <StatusBadge
            label="Face Detected"
            value={f?.face_detected ? '✅ Yes' : '⏸️ No'}
            color={f?.face_detected ? 'text-green-400' : 'text-slate-400'}
          />
          <StatusBadge
            label="Calibration"
            value={calibrationProgress < 100 ? `${calibrationProgress}%` : '✅ Complete'}
            color={calibrationProgress >= 100 ? 'text-green-400' : 'text-amber-400'}
          />
        </div>

        {/* Main Layout */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
          {/* Camera feed */}
          <div className="xl:col-span-2">
            <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-slate-800/80 border-b border-slate-700/60">
                <h2 className="text-white font-semibold text-sm">📹 Camera Feed</h2>
                <div className="flex gap-2">
                  {!cameraActive ? (
                    <button
                      onClick={startCamera}
                      className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                    >
                      ▶ Start Camera
                    </button>
                  ) : (
                    <>
                      <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showFaceOverlay}
                          onChange={e => setShowFaceOverlay(e.target.checked)}
                          className="accent-green-500"
                        />
                        Overlay
                      </label>
                      <button
                        onClick={stopCamera}
                        className="px-3 py-1.5 text-xs bg-red-600/70 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
                      >
                        ⏹ Stop
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="relative bg-black aspect-[4/3] flex items-center justify-center">
                <video
                  ref={videoRef}
                  className={`w-full h-full object-contain ${cameraActive ? '' : 'hidden'}`}
                  playsInline
                  muted
                />
                <canvas
                  ref={faceCanvasRef}
                  className={`absolute inset-0 w-full h-full pointer-events-none ${showFaceOverlay ? '' : 'hidden'}`}
                  width={640}
                  height={480}
                />

                {!cameraActive && (
                  <div className="text-center p-8">
                    {cameraError ? (
                      <div className="text-red-400">
                        <p className="text-2xl mb-2">⚠️</p>
                        <p className="font-medium mb-1">Camera Error</p>
                        <p className="text-sm text-red-300/80">{cameraError}</p>
                        <button
                          onClick={startCamera}
                          className="mt-4 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm"
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      <div className="text-slate-500">
                        <p className="text-4xl mb-3">📷</p>
                        <p className="font-medium">Click &quot;Start Camera&quot; to begin</p>
                        <p className="text-sm mt-1">Allow camera permissions when prompted</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Face detected indicator — small pill in top-left of video */}
                {cameraActive && (
                  <div className="absolute top-3 left-3 flex gap-2">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full backdrop-blur-md ${
                      f?.face_detected
                        ? 'bg-green-600/80 text-white'
                        : 'bg-slate-700/80 text-slate-400'
                    }`}>
                      {f?.face_detected ? '👤 Face' : '👤 No Face'}
                    </span>
                    {f?.face_detected && f.dominant && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full backdrop-blur-md bg-black/50 text-white">
                        {EMOJI[f.dominant] ?? '😐'} {f.dominant}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Quick Stats under video */}
              {cameraActive && f?.face_detected && (
                <div className="grid grid-cols-3 gap-px bg-slate-700/40">
                  <QuickStat label="EAR" value={fmt(f.eye?.ear ?? 0, 4)} color="text-cyan-400" />
                  <QuickStat label="Blinks" value={`${f.eye?.blink_count ?? 0}`} color="text-blue-400" />
                  <QuickStat label="BPM" value={fmt(f.eye?.blinks_per_min ?? 0, 1)} color="text-indigo-400" />
                  <QuickStat label="Stress" value={fmt(f.stress_score ?? 0, 2)} color="text-red-400" />
                  <QuickStat label="Engage" value={`${Math.round((f.engagement ?? 0) * 100)}%`} color="text-green-400" />
                  <QuickStat label="Attn" value={`${Math.round((f.attention ?? 0) * 100)}%`} color="text-purple-400" />
                </div>
              )}
            </div>
          </div>

          {/* Right panel — Emotions */}
          <div className="space-y-4">
            {/* Emotions card */}
            <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4">
              <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                <span>😊 Emotions</span>
                {f?.dominant && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: EMOTION_COLORS[f.dominant] + '40', color: EMOTION_COLORS[f.dominant] }}>
                    {f.dominant.toUpperCase()}
                  </span>
                )}
              </h3>
              {f?.face_detected && Object.keys(emotionScores).length > 0 ? (
                <EmotionBars emotions={emotionScores} />
              ) : (
                <p className="text-slate-500 text-xs italic">No face detected</p>
              )}
            </div>

            {/* Head Pose + Gaze card */}
            <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4">
              <h3 className="text-white font-semibold text-sm mb-3">🎯 Head &amp; Gaze</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Head Pose</p>
                  <div className="space-y-1 text-xs font-mono">
                    <Row label="Yaw" value={`${fmt(f?.head_pose?.yaw ?? 0, 1)}°`} />
                    <Row label="Pitch" value={`${fmt(f?.head_pose?.pitch ?? 0, 1)}°`} />
                    <Row label="Roll" value={`${fmt(f?.head_pose?.roll ?? 0, 1)}°`} />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Gaze</p>
                  <div className="space-y-1 text-xs font-mono">
                    <Row label="X" value={fmt(f?.gaze?.x ?? 0, 4)} />
                    <Row label="Y" value={fmt(f?.gaze?.y ?? 0, 4)} />
                    <Row label="Screen" value={f?.gaze?.looking_at_screen ? '✅ Yes' : '❌ No'}
                      color={f?.gaze?.looking_at_screen ? 'text-green-400' : 'text-red-400'} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
          {/* Meta-signals gauge panel */}
          <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4">
            <h3 className="text-white font-semibold text-sm mb-3">📊 Meta-Signals</h3>
            <div className="space-y-3">
              <GaugeBar label="Stress" value={f?.stress_score ?? 0} max={10}
                color={stressColor(f?.stress_score ?? 0)} />
              <GaugeBar label="Engagement" value={(f?.engagement ?? 0) * 100} max={100} color="bg-blue-400" />
              <GaugeBar label="Confidence" value={(f?.confidence ?? 0) * 100} max={100} color="bg-emerald-400" />
              <GaugeBar label="Attention" value={(f?.attention ?? 0) * 100} max={100} color="bg-indigo-400" />
            </div>
          </div>

          {/* Hands + Posture */}
          <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4">
            <h3 className="text-white font-semibold text-sm mb-3">✋ Hands &amp; Posture</h3>
            {f?.face_detected ? (
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Hands</p>
                  <div className="text-xs font-mono space-y-1">
                    <Row label="Movement" value={fmt(f.hands?.movement ?? 0, 5)} />
                    <Row label="Fidget Level" value={f.hands?.fidget_level ?? 'still'}
                      color={
                        f.hands?.fidget_level === 'still' ? 'text-green-400' :
                        f.hands?.fidget_level === 'low' ? 'text-yellow-400' :
                        f.hands?.fidget_level === 'medium' ? 'text-orange-400' :
                        'text-red-400'
                      } />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Posture</p>
                  <div className="text-xs font-mono space-y-1">
                    <Row label="Lean" value={f.posture?.lean ?? 'unknown'} />
                    <Row label="Tilt" value={fmt(f.posture?.shoulder_tilt ?? 0, 2)} />
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-slate-500 text-xs italic">No face detected</p>
            )}
          </div>

          {/* Session summary */}
          <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-semibold text-sm">📋 Session</h3>
              <div className="flex gap-2">
                <button
                  onClick={handleRequestSummary}
                  disabled={!isConnected}
                  className="px-2.5 py-1 text-[11px] bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors"
                >
                  📊 Summary
                </button>
                <button
                  onClick={handleReset}
                  disabled={!cameraActive}
                  className="px-2.5 py-1 text-[11px] bg-slate-600 hover:bg-slate-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors"
                >
                  🔄 Reset
                </button>
              </div>
            </div>

            {summary ? (
              <div className="text-xs font-mono space-y-1 text-slate-300">
                <Row label="Duration" value={`${fmt(summary.duration_s, 1)}s`} />
                <Row label="Frames" value={`${summary.frame_count}`} />
                <Row label="Total Blinks" value={`${summary.total_blinks}`} />
                <Row label="Blinks/min" value={fmt(summary.blinks_per_min_avg, 1)} />
                <Row label="Avg Stress" value={fmt(summary.stress_avg, 3)} />
                <Row label="Peak Stress" value={fmt(summary.stress_peak, 3)} />
                <Row label="On Screen" value={`${Math.round(summary.attention_on_screen_frac * 100)}%`} />
                <div className="pt-2 mt-2 border-t border-slate-700/60">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Dominant Emotion</p>
                  {Object.entries(summary.dominant_histogram)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 3)
                    .map(([k, v]) => (
                      <Row key={k} label={k} value={`${Math.round(v * 100)}%`} />
                    ))
                  }
                </div>
              </div>
            ) : (
              <p className="text-slate-500 text-xs italic">
                {cameraActive ? 'Click "Summary" to view aggregated data' : 'Start camera to begin recording'}
              </p>
            )}
          </div>
        </div>

        {/* Logs */}
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60">
            <h2 className="text-white font-semibold text-sm">📋 Activity Log</h2>
            <button
              onClick={() => setLogs([])}
              className="px-2.5 py-1 text-[11px] bg-slate-600 hover:bg-slate-700 text-white rounded-lg transition-colors"
            >
              Clear
            </button>
          </div>
          <div className="h-48 overflow-y-auto p-3 font-mono text-xs">
            {logs.length === 0 ? (
              <p className="text-slate-500 italic">No logs yet...</p>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="text-slate-300 py-0.5 border-b border-slate-800/50 last:border-0">
                  {log}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Info footer */}
        <div className="mt-4 text-xs text-slate-500 text-center space-y-1">
          <p>All processing runs client-side. No data leaves your browser.</p>
          <p>Powered by MediaPipe FaceLandmarker · {isConnected ? 'Model loaded' : 'Waiting for connection'}</p>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/60 rounded-lg px-3 py-2.5">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-sm font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`font-medium ${color ?? 'text-slate-200'}`}>{value}</span>
    </div>
  );
}

function QuickStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center py-2 px-1 bg-slate-800/60">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
    </div>
  );
}

function GaugeBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-slate-400">{label}</span>
        <span className="text-white font-mono font-bold">{typeof value === 'number' ? fmt(value, value < 10 ? 2 : 0) : value}</span>
      </div>
      <div className="h-2.5 bg-slate-700/60 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

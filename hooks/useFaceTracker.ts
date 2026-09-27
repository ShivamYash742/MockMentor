'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { FaceResult } from '@/lib/mlSidecar';
import {
  eyeAspectRatio, LEFT_EYE, RIGHT_EYE,
  classifyEmotions, dominantEmotion,
  computeGaze, decomposeHeadPose,
  HandTracker, computeMetaSignals,
  EMA, WindowSmooth, aggregateSession, AggregatedSummary,
  EmotionScores,
} from '@/lib/faceAnalysis';
import { loadEmotionModel, faceCropBox, EMOTION_INPUT_SIZE, type EmotionClassifier } from '@/lib/emotionModel';

const FRAME_INTERVAL_MS = 100; // 10 fps — smoother blink detection
const CALIBRATION_FRAMES = 90;
// Emotion model sampling rate; between samples the last smoothed reading is reused.
const EMOTION_INTERVAL_MS = 1000;

interface FrameRecord {
  ts: number;
  face_detected: boolean;
  emotions: EmotionScores;
  dominant: string;
  head_pose: { yaw: number; pitch: number; roll: number };
  gaze: { x: number; y: number; looking_at_screen: boolean };
  eye: { ear: number; blink_count: number; blinks_per_min: number };
  hands: { movement: number; fidget_level: string };
  posture: { shoulder_tilt: number; lean: string };
  stress_score: number;
  engagement: number;
  confidence: number;
  attention: number;
}

export function useFaceTracker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  sessionId: string | null,
  enabled: boolean = true,
) {
  const [lastFrame, setLastFrame] = useState<FaceResult | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isSidecarAvailable, setIsSidecarAvailable] = useState(false);

  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initAttemptedRef = useRef(false);
  const frameLogRef = useRef<FrameRecord[]>([]);
  const frameErrorWarnedRef = useRef(false);
  const startTimeRef = useRef(Date.now());

  // Reset startTime when model loads so blink rate calculation is accurate
  const processingStartedRef = useRef(false);

  // Blink state
  const blinkStateRef = useRef({
    count: 0,
    eyeClosed: false,
  });

  // Smoothers
  const earSmoothRef = useRef(new WindowSmooth(3));
  const emotionEMARef = useRef(new EMA(0.25));
  const stressEMARef = useRef(new EMA(0.2));
  const headPoseEMARef = useRef(new EMA(0.3));
  const gazeEMARef = useRef(new EMA(0.3));
  const handTrackerRef = useRef(new HandTracker(8));

  // Trained emotion model (lib/emotionModel.ts). Until it loads — or if it can't — emotion comes
  // from the blendshape heuristic instead. Model samples arrive ~1/s, so they're smoothed less.
  const emotionModelRef = useRef<EmotionClassifier | null>(null);
  const emotionBusyRef = useRef(false);
  const lastEmotionAtRef = useRef(-Infinity);
  const emotionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const newEmotionEMA = () => new EMA(emotionModelRef.current ? 0.5 : 0.25);

  // Calibration
  const calRef = useRef({
    frameCount: 0,
    baselineEar: 0.28,
    baselineMovement: 0.001,
    calEarAcc: 0,
    calMovAcc: 0,
  });

  // ── Initialize MediaPipe ───────────────────────────────────────────
  useEffect(() => {
    if (!enabled || initAttemptedRef.current) return;

    initAttemptedRef.current = true;

    loadEmotionModel()
      .then((classify) => {
        emotionModelRef.current = classify;
        emotionEMARef.current = newEmotionEMA();
      })
      .catch((err) => console.warn('Emotion model unavailable, using blendshape heuristic:', err));

    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
        );

        // No local model is bundled with the app, so that path always 404'd — load from the
        // CDN directly, trying the GPU delegate first and falling back to CPU.
        const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
        const landmarkerOptions = (delegate: 'GPU' | 'CPU') => ({
          baseOptions: {
            modelAssetPath: MODEL_CDN,
            delegate,
          },
          runningMode: 'VIDEO' as const,
          numFaces: 1,
          minFaceDetectionConfidence: 0.6,
          minFacePresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });

        let landmarker: FaceLandmarker;
        try {
          landmarker = await FaceLandmarker.createFromOptions(vision, landmarkerOptions('GPU'));
        } catch {
          console.warn('GPU delegate unavailable, falling back to CPU...');
          landmarker = await FaceLandmarker.createFromOptions(vision, landmarkerOptions('CPU'));
        }

        landmarkerRef.current = landmarker;
        setIsConnected(true);
        setIsSidecarAvailable(true);
        processingStartedRef.current = false;
      } catch (err) {
        console.error('FaceLandmarker init failed:', err);
        setIsConnected(false);
        setIsSidecarAvailable(false);
      }
    })();

    return () => {
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, [enabled]);

  // ── Process a single frame ─────────────────────────────────────────
  const processFrame = useCallback(() => {
    const landmarker = landmarkerRef.current;
    if (!landmarker) return;

    const video = videoRef.current;
    if (!video || !video.srcObject || video.paused || video.videoWidth === 0) return;

    try {
      const ts = performance.now();
      const result = landmarker.detectForVideo(video, ts);

      const faceDetected = Boolean(result.faceLandmarks && result.faceLandmarks.length > 0);
      const cal = calRef.current;

      // ── EAR + blink detection ──
      let ear = 0.28;
      if (faceDetected) {
        const lm = result.faceLandmarks[0];
        const earL = eyeAspectRatio(lm, LEFT_EYE);
        const earR = eyeAspectRatio(lm, RIGHT_EYE);
        const rawEar = (earL + earR) / 2;
        ear = earSmoothRef.current.update(rawEar);

        const blinkState = blinkStateRef.current;
        const EAR_THRESH = 0.22;
        if (rawEar < EAR_THRESH && !blinkState.eyeClosed) {
          blinkState.eyeClosed = true;
        } else if (rawEar >= EAR_THRESH && blinkState.eyeClosed) {
          blinkState.count += 1;
          blinkState.eyeClosed = false;
        }
      }

      // Set start time on first process call so blink rate denominator is accurate
      if (!processingStartedRef.current) {
        processingStartedRef.current = true;
        startTimeRef.current = Date.now();
      }
      const elapsed = (Date.now() - startTimeRef.current) / 1000 + 1e-6;
      const blinksPerMin = blinkStateRef.current.count / (elapsed / 60);

      // ── Emotions ──
      const defaultEmotions: EmotionScores = {
        happy: 0, sad: 0, angry: 0, surprised: 0, fear: 0, disgust: 0, neutral: 1,
      };
      let emotions = defaultEmotions;
      const emotionModel = emotionModelRef.current;
      if (faceDetected && emotionModel) {
        if (!emotionBusyRef.current && ts - lastEmotionAtRef.current >= EMOTION_INTERVAL_MS) {
          const rgba = readFaceCrop(video, result.faceLandmarks[0]);
          if (rgba) {
            emotionBusyRef.current = true;
            lastEmotionAtRef.current = ts;
            const ema = emotionEMARef.current;
            emotionModel(rgba)
              .then((scores) => {
                if (ema === emotionEMARef.current) ema.update(scores); // drop results from before a reset
              })
              .catch((err) => {
                console.warn('Emotion model failed, switching to blendshape heuristic:', err);
                emotionModelRef.current = null;
                emotionEMARef.current = newEmotionEMA();
              })
              .finally(() => { emotionBusyRef.current = false; });
          }
        }
        emotions = (emotionEMARef.current.value as EmotionScores | null) ?? defaultEmotions;
      } else if (faceDetected && result.faceBlendshapes && result.faceBlendshapes.length > 0) {
        const rawEmotions = classifyEmotions(result.faceBlendshapes[0].categories);
        const smoothed = emotionEMARef.current.update(rawEmotions);
        emotions = smoothed ?? rawEmotions;
      } else {
        emotionEMARef.current.update(defaultEmotions);
      }

      const dom = dominantEmotion(emotions);

      // ── Head pose ──
      let headPose = { yaw: 0, pitch: 0, roll: 0 };
      if (
        faceDetected &&
        result.facialTransformationMatrixes &&
        result.facialTransformationMatrixes.length > 0
      ) {
        const rawPose = decomposeHeadPose(result.facialTransformationMatrixes[0].data as number[]);
        const updatedPose = headPoseEMARef.current.update<{ yaw: number; pitch: number; roll: number }>(rawPose);
        headPose = updatedPose ?? rawPose;
      }

      // ── Gaze ──
      let gaze = { x: 0, y: 0, looking_at_screen: true };
      if (faceDetected && result.faceLandmarks[0].length > 477) {
        const rawGaze = computeGaze(result.faceLandmarks[0]);
        const gs = gazeEMARef.current.update({ x: rawGaze.x, y: rawGaze.y });
        gaze = {
          x: Math.round(gs.x * 10000) / 10000,
          y: Math.round(gs.y * 10000) / 10000,
          looking_at_screen: rawGaze.looking_at_screen,
        };
      }

      // ── Hands (stub — no HandLandmarker loaded) ──
      const handData = handTrackerRef.current.update([]);

      // ── Posture (stub — no PoseLandmarker loaded) ──
      const posture = { shoulder_tilt: 0, lean: 'upright' as string };

      // ── Calibration ──
      cal.frameCount += 1;
      if (cal.frameCount <= CALIBRATION_FRAMES) {
        const alpha = 0.1;
        cal.calEarAcc = (1 - alpha) * cal.calEarAcc + alpha * ear;
        cal.calMovAcc = (1 - alpha) * cal.calMovAcc + alpha * handData.movement;
        if (cal.frameCount === CALIBRATION_FRAMES) {
          cal.baselineEar = cal.calEarAcc;
          cal.baselineMovement = cal.calMovAcc;
        }
      }

      // ── Meta-signals ──
      const meta = computeMetaSignals(
        ear,
        blinksPerMin,
        handData.movement,
        cal.baselineEar,
        cal.baselineMovement,
        emotions,
        gaze,
        headPose,
      );

      const smoothedStress = stressEMARef.current.update(meta.stress_score);
      const stress = Math.round((smoothedStress ?? meta.stress_score) * 1000) / 1000;

      // ── Build result ──
      const now = Date.now() / 1000;
      const frameRecord: FrameRecord = {
        ts: now,
        face_detected: faceDetected,
        emotions: { ...emotions },
        dominant: dom,
        head_pose: { ...headPose },
        gaze: { ...gaze },
        eye: {
          ear: Math.round(ear * 10000) / 10000,
          blink_count: blinkStateRef.current.count,
          blinks_per_min: Math.round(blinksPerMin * 100) / 100,
        },
        hands: handData,
        posture,
        stress_score: stress,
        engagement: meta.engagement,
        confidence: meta.confidence,
        attention: meta.attention,
      };

      frameLogRef.current.push(frameRecord);

      // Keep enough frames for a full ~3 min interview at 10fps (1800), plus headroom, so
      // raising the frame rate doesn't truncate a normal-length session mid-way through.
      if (frameLogRef.current.length > 2200) {
        frameLogRef.current = frameLogRef.current.slice(-1200);
      }

      setLastFrame(frameRecord as unknown as FaceResult);
    } catch (err) {
      // Skip bad frames, but warn once so a systematic failure isn't invisible.
      if (!frameErrorWarnedRef.current) {
        frameErrorWarnedRef.current = true;
        console.warn('Face frame processing failed:', err);
      }
    }
  }, [videoRef]);

  // Face crop from the current video frame, resized to the model's input on a reusable canvas.
  function readFaceCrop(video: HTMLVideoElement, landmarks: Array<{ x: number; y: number }>) {
    const box = faceCropBox(landmarks, video.videoWidth, video.videoHeight);
    if (!box) return null;
    const canvas = (emotionCanvasRef.current ??= Object.assign(document.createElement('canvas'), {
      width: EMOTION_INPUT_SIZE,
      height: EMOTION_INPUT_SIZE,
    }));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, box.x, box.y, box.w, box.h, 0, 0, EMOTION_INPUT_SIZE, EMOTION_INPUT_SIZE);
    return ctx.getImageData(0, 0, EMOTION_INPUT_SIZE, EMOTION_INPUT_SIZE).data;
  }

  // ── Start/stop capture interval ────────────────────────────────────
  useEffect(() => {
    if (isConnected && landmarkerRef.current) {
      intervalRef.current = setInterval(processFrame, FRAME_INTERVAL_MS);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isConnected, processFrame]);

  // ── Request summary ────────────────────────────────────────────────
  const requestSummary = useCallback(async (): Promise<AggregatedSummary | null> => {
    const frames = frameLogRef.current;
    if (frames.length === 0) return null;
    return aggregateSession(frames);
  }, []);

  // ── Reset session ──────────────────────────────────────────────────
  const resetSession = useCallback(() => {
    // Runs between questions. calRef is deliberately left alone: it's the baseline computed
    // from the first ~90 frames of the whole interview, and resetting it here made calibration
    // re-run mid-question against whatever expression the candidate happened to have — not a
    // neutral baseline.
    blinkStateRef.current = { count: 0, eyeClosed: false };
    startTimeRef.current = Date.now();
    processingStartedRef.current = false;
    frameLogRef.current = [];
    earSmoothRef.current = new WindowSmooth(3);
    emotionEMARef.current = newEmotionEMA();
    lastEmotionAtRef.current = -Infinity; // sample the next question straight away
    stressEMARef.current = new EMA(0.2);
    headPoseEMARef.current = new EMA(0.3);
    gazeEMARef.current = new EMA(0.3);
    handTrackerRef.current = new HandTracker(8);
  }, []);

  return { lastFrame, isConnected, isSidecarAvailable, requestSummary, resetSession };
}

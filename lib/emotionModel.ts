// Trained facial-emotion model run in the browser: HSEmotion enet_b2_7 (EfficientNet-B2 trained
// on AffectNet, Apache-2.0) via onnxruntime-web. Same model and preprocessing as the Python
// sidecar's EmotionModel (model/tracker/emotion.py) — model/test_pipeline.py and
// lib/emotionModel.test.ts check both against the model authors' labelled test faces.
import type { EmotionScores } from './faceAnalysis';

// Pinned to a commit so the weights can't change under us. ~30 MB, fetched once per browser.
export const EMOTION_MODEL_URL =
  'https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/520a051c64cd191521e5934655314e769a319684/models/affectnet_emotions/onnx/enet_b2_7.onnx';
// Must match the installed onnxruntime-web version.
const ORT_WASM_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';

export const EMOTION_INPUT_SIZE = 260;

// Model output order, mapped to the app's emotion keys.
const MODEL_LABELS = ['angry', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprised'] as const;
const MEAN = [0.485, 0.456, 0.406]; // ImageNet stats, RGB order
const STD = [0.229, 0.224, 0.225];

export type EmotionClassifier = (rgba: Uint8ClampedArray) => Promise<EmotionScores>;

/** Pixel box of the face from its normalized landmarks, clipped to the frame. No margin: a margin
 *  measurably lowered the model's confidence. Null if the face is entirely off-frame. */
export function faceCropBox(
  landmarks: Array<{ x: number; y: number }>,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | null {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of landmarks) {
    const x = Math.min(1, Math.max(0, p.x));
    const y = Math.min(1, Math.max(0, p.y));
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const x = Math.floor(x0 * width), y = Math.floor(y0 * height);
  const w = Math.floor(x1 * width) - x, h = Math.floor(y1 * height) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** RGBA pixels (size x size, e.g. from canvas getImageData) -> normalized CHW float tensor. */
export function toModelInput(rgba: Uint8ClampedArray | Uint8Array, size = EMOTION_INPUT_SIZE): Float32Array {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      out[c * plane + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
    }
  }
  return out;
}

/** Raw model logits -> probabilities keyed by the app's emotion names. */
export function toEmotionScores(logits: ArrayLike<number>): EmotionScores {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) max = Math.max(max, logits[i]);
  const exps = Array.from(logits, (l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  const scores: Record<string, number> = {};
  MODEL_LABELS.forEach((label, i) => { scores[label] = exps[i] / sum; });
  return scores as EmotionScores;
}

type Ort = typeof import('onnxruntime-web/wasm');

/** Builds the classifier from an onnxruntime module and the model (URL or bytes). */
export async function createEmotionClassifier(ort: Ort, model: string | Uint8Array): Promise<EmotionClassifier> {
  // Two calls rather than one: the URL and bytes forms are separate overloads.
  const session = typeof model === 'string'
    ? await ort.InferenceSession.create(model, { executionProviders: ['wasm'] })
    : await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
  const [input] = session.inputNames;
  const [output] = session.outputNames;
  return async (rgba) => {
    const tensor = new ort.Tensor('float32', toModelInput(rgba), [1, 3, EMOTION_INPUT_SIZE, EMOTION_INPUT_SIZE]);
    const result = await session.run({ [input]: tensor });
    return toEmotionScores(result[output].data as Float32Array);
  };
}

/** Loads the model in the browser. Rejects if the runtime or weights can't be fetched. */
export async function loadEmotionModel(): Promise<EmotionClassifier> {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.wasmPaths = ORT_WASM_CDN;
  // Run inference in a worker: ~140 ms/sample single-threaded (measured on a fast desktop CPU)
  // would otherwise freeze the interview UI once a second.
  ort.env.wasm.proxy = true;
  return createEmotionClassifier(ort, EMOTION_MODEL_URL);
}

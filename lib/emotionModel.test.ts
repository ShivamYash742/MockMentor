import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { faceCropBox, toModelInput, toEmotionScores, createEmotionClassifier } from './emotionModel.ts';

test('toModelInput writes normalized RGB planes in CHW order and drops alpha', () => {
  // 2x2 image: every pixel R=255, G=0, B=128, A=7
  const rgba = new Uint8ClampedArray([255, 0, 128, 7, 255, 0, 128, 7, 255, 0, 128, 7, 255, 0, 128, 7]);
  const x = toModelInput(rgba, 2);
  assert.equal(x.length, 12);
  const r = (1 - 0.485) / 0.229, g = (0 - 0.456) / 0.224, b = (128 / 255 - 0.406) / 0.225;
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(x[i] - r) < 1e-6 && Math.abs(x[4 + i] - g) < 1e-6 && Math.abs(x[8 + i] - b) < 1e-6);
  }
});

test('toEmotionScores maps the model output order to app keys and sums to 1', () => {
  // model order: angry, disgust, fear, happy, neutral, sad, surprised
  const s = toEmotionScores([0, 0, 0, 5, 0, 0, 0]);
  assert.ok(s.happy > 0.9);
  assert.ok(Math.abs(Object.values(s).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.deepEqual(Object.keys(s).sort(), ['angry', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprised']);
});

test('faceCropBox clips to the frame and rejects off-frame faces', () => {
  assert.deepEqual(faceCropBox([{ x: -0.2, y: 0.1 }, { x: 0.5, y: 1.3 }], 200, 100), { x: 0, y: 10, w: 100, h: 90 });
  assert.equal(faceCropBox([{ x: 1.5, y: 0.5 }, { x: 1.7, y: 0.6 }], 200, 100), null);
});

// Parity with the Python sidecar on the model authors' labelled faces. The fixture is written by
// `cd model && .venv/bin/python test_pipeline.py` into the gitignored model/models/; skipped without it.
const FIXTURE = 'model/models/_parity.json';
const MODEL = 'model/models/enet_b2_7.onnx';
test('matches the Python model on the reference faces', { skip: !existsSync(FIXTURE) && 'no parity fixture' }, async () => {
  // Same package and version as the browser, via its Node build (the browser build loads its glue
  // from a blob: URL, which Node can't import).
  const ort = await import('onnxruntime-web');
  const classify = await createEmotionClassifier(ort, new Uint8Array(readFileSync(MODEL)));
  const faces: Array<{ expected: string; rgba: string; scores: Record<string, number> }> =
    JSON.parse(readFileSync(FIXTURE, 'utf8'));
  for (const f of faces) {
    const got = await classify(new Uint8ClampedArray(Buffer.from(f.rgba, 'hex')));
    const top = Object.entries(got).sort((a, b) => b[1] - a[1])[0][0];
    assert.equal(top, f.expected);
    for (const k of Object.keys(f.scores)) {
      assert.ok(Math.abs(got[k] - f.scores[k]) < 1e-3, `${f.expected}/${k}: ts ${got[k]} vs py ${f.scores[k]}`);
    }
  }
});

// Pure-helper tests for www/js/ocr.js (no Capacitor runtime needed).
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../www/js/ocr.js', import.meta.url), 'utf8');
const win = {};
new Function('window', src)(win);
const OCR = win.OCR;

// available() must be false without a Capacitor bridge (browser preview).
assert.equal(OCR.available(), false);

// _splitBase64
const jpg = OCR._splitBase64('data:image/jpeg;base64,QUJD');
assert.deepEqual(jpg, { data: 'QUJD', ext: 'jpg' });
const png = OCR._splitBase64('data:image/png;base64,QUJDDEFG');
assert.deepEqual(png, { data: 'QUJDDEFG', ext: 'png' });
assert.equal(OCR._splitBase64('not-a-data-url'), null);
assert.equal(OCR._splitBase64(''), null);

// _cleanWords: list markers, dupes, whitespace
const words = OCR._cleanWords(['1. cat', '- Cat', '2) dog', '', '  hello   world ', '• dog']);
assert.deepEqual(words, ['cat', 'dog', 'hello world']);

// _enhancePixels: low-contrast striped image -> contrast increases, output grayscale.
function mkImg(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = fill(i);
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}
const striped = mkImg(4, 4, (i) => { const v = i % 2 ? 110 : 100; return [v, v, v]; });
OCR._enhancePixels(striped);
let min = 255, max = 0;
for (let i = 0; i < 16; i++) {
  const o = i * 4;
  assert.equal(striped.data[o], striped.data[o + 1]); // grayscale out
  assert.equal(striped.data[o + 1], striped.data[o + 2]);
  assert.equal(striped.data[o + 3], 255);            // alpha kept
  min = Math.min(min, striped.data[o]);
  max = Math.max(max, striped.data[o]);
}
assert(max - min > 10, `contrast should increase, got ${min}..${max}`); // input spread was 10

// Color input collapses to grayscale, mid-tone after stretch.
const red = mkImg(2, 2, () => [255, 0, 0]);
OCR._enhancePixels(red);
assert.equal(red.data[0], red.data[1]);
assert.equal(red.data[1], red.data[2]);
assert(red.data[0] > 100 && red.data[0] < 160, `expected mid gray, got ${red.data[0]}`);

// extractWords rejects without an adapter (manual chip gate stays first-class).
await assert.rejects(() => OCR.extractWords('data:image/jpeg;base64,QUJD'), /ocr-not-available/);

// _analyzeToWords: Azure Read 3.2 analyzeResult (status wrapper + nested pages).
const sample = {
  status: 'Succeeded',
  analyzeResult: {
    pages: [{
      lines: [
        { boundingBox: [0, 0, 10, 10], text: '1. cat', words: [{ text: 'cat', confidence: 0.9 }] },
        { text: 'dog', words: [{ text: 'Dog' }] },
        { text: 'broken line' }, // no words array -> falls back to line text
      ],
    }],
  },
};
assert.deepEqual(OCR._cleanWords(OCR._analyzeToWords(sample)), ['cat', 'Dog', 'broken', 'line']);
assert.deepEqual(OCR._analyzeToWords({}), []);
assert.deepEqual(OCR._analyzeToWords(null), []);
// flat analyzeResult (relay returned analyzeResult only)
assert.deepEqual(OCR._analyzeToWords({ pages: [{ lines: [{ words: [{ text: 'apple' }] }] }] }), ['apple']);

// Legacy `readResults` shape -- what our Azure F0 resource actually returns
// (field finding 2026-11-06: version 3.2 but readResults, not pages).
const legacy = {
  status: 'succeeded',
  analyzeResult: {
    version: '3.2',
    readResults: [{
      text: 'cat house\nwater',
      lines: [
        { boundingBox: '0,0,10,10', text: 'cat house', words: [{ text: 'cat' }, { text: 'house' }] },
        { boundingBox: '0,20,5,30', text: 'water' }, // handwriting lines may omit words
      ],
    }],
  },
};
assert.deepEqual(OCR._cleanWords(OCR._analyzeToWords(legacy)), ['cat', 'house', 'water']);

// No settings store in this harness => cloud disabled => local path only =>
// extractWords still rejects with ocr-not-available (manual chips stay first-class).
await assert.rejects(() => OCR.extractWords('data:image/jpeg;base64,QUJD2'), /ocr-not-available/);

// ---- relay config is deployment data, not source data ----
// _cloudSettings() decides whether the cloud channel runs at all. The address
// and token come from www/js/relay-config.js (build time) or the settings store
// (per device, wins); the published source carries neither.
async function load(windowSeed) {
  new Function('window', src)(windowSeed);
  return windowSeed.OCR;
}

// No settings store (this harness, or a browser preview) => cloud off even if a
// build configured a relay: tests stay hermetic and a device with no relay works.
const bare = await load({ WD_RELAY: { url: 'https://ocr.example.com/ocr', token: 'build-token' } });
assert.deepEqual(await bare._cloudSettings(), { enabled: false, url: '', token: '' });

// Committed template (empty relay-config.js) + a real settings store => off too,
// so the app is on-device only out of the box.
const template = await load({ Storage: { getSetting: async () => null } });
assert.deepEqual(await template._cloudSettings(), { enabled: false, url: '', token: '' });

// A build that filled in relay-config.js => cloud on, carrying that token.
const built = await load({
  WD_RELAY: { url: 'https://ocr.example.com/ocr', token: 'build-token' },
  Storage: { getSetting: async () => null },
});
assert.deepEqual(await built._cloudSettings(),
  { enabled: true, url: 'https://ocr.example.com/ocr', token: 'build-token' });

// Settings store overrides the build config per device (keys win, values trimmed).
const overridden = await load({
  WD_RELAY: { url: 'https://ocr.example.com/ocr', token: 'build-token' },
  Storage: { getSetting: async function (k) {
    const values = { ocrCloudUrl: ' https://phone-config.example/ocr ', ocrCloudToken: 'phone-token' };
    return k in values ? { key: k, value: values[k] } : null;
  } },
});
assert.deepEqual(await overridden._cloudSettings(),
  { enabled: true, url: 'https://phone-config.example/ocr', token: 'phone-token' });

// The Settings checkbox still turns the channel off on its own.
const toggled = await load({
  WD_RELAY: { url: 'https://ocr.example.com/ocr', token: 'build-token' },
  Storage: { getSetting: async function (k) { return k === 'ocrCloud' ? { key: k, value: 'off' } : null; } },
});
assert.equal((await toggled._cloudSettings()).enabled, false);

console.log('20 tests passed');

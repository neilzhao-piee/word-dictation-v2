// ocr: word recognition, cloud-first with on-device fallback (tickets 03, 08).
// Cloud: POST to the home LAN relay (ADR-0010, scripts/ocr-relay.py) which owns the
// Azure AI Vision Read key and forwards the photo in memory — stored nowhere, here
// or there (ADR-0001). Azure Read 3.2 carries handwriting support; ML Kit v2 does not.
// Fallback: ML Kit Text Recognition v2 via @capacitor-mlkit/text-recognition
// (print-tuned, offline-capable). iOS Vision adapter is a later ticket.
// On the local path the photo never persists: base64 from the camera is written to
// the cache directory, recognized, then deleted immediately.
// Candidates go to the parent-confirm chip gate unchanged; manual entry is a
// first-class path, never an error path.
(function () {
  'use strict';

  function isNative() {
    return typeof window.Capacitor !== 'undefined' && !!window.Capacitor.Plugins;
  }

  function adapterPlugins() {
    if (!isNative()) return null;
    const P = window.Capacitor.Plugins;
    if (P.TextRecognition && typeof P.TextRecognition.processImage === 'function' &&
        P.Filesystem && typeof P.Filesystem.writeFile === 'function') {
      return P;
    }
    return null;
  }

  // dataUrl -> { data: base64 without prefix, ext: 'jpg' | 'png' }, or null.
  function splitBase64(dataUrl) {
    const m = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || '').trim());
    if (!m) return null;
    const ext = /png/i.test(m[1]) ? 'png' : 'jpg';
    return { data: m[2].replace(/\s+/g, ''), ext: ext };
  }

  function cleanWords(lines) {
    const out = [];
    const seen = new Set();
    for (const raw of lines) {
      const w = String(raw).trim().replace(/\s+/g, ' ');
      if (!w) continue;
      // strip leading list markers like "1." "2)" "- "
      const stripped = w.replace(/^(\d+[.)]\s*|[-•]\s*)/, '');
      if (!stripped) continue;
      // single-word entries only for a spelling list; keep multiword as-is if it fits
      const key = stripped.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(stripped);
    }
    return out;
  }

  // Pixel enhancement (handwriting accuracy). Pure function over an
  // ImageData-shaped object {width, height, data(Uint8ClampedArray rgba)}:
  // grayscale -> 2%/98% percentile contrast stretch -> light unsharp mask.
  // Mutates and returns the same object. Exported for tests.
  function enhancePixels(img) {
    const d = img.data;
    const n = d.length / 4;
    if (n === 0) return img;

    const luma = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      luma[i] = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) | 0;
    }

    // Histogram stretch between the 2nd and 98th percentile of brightness.
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[luma[i]]++;
    let low = 0, high = 255, acc = 0;
    const wantLow = n * 0.02, wantHigh = n * 0.98;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= wantLow) { low = v; break; }
    }
    acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= wantHigh) { high = v; break; }
    }
    if (high - low < 40) { // near-uniform image: widen instead of dividing by ~0
      low = Math.max(0, low - 15);
      high = Math.min(255, high + 15);
    }
    const scale = 255 / (high - low);

    const gray = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let v = (luma[i] - low) * scale;
      gray[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }

    // Unsharp mask: out = gray + 0.7 * (gray - 3x3 box blur), edge boost for strokes.
    const w = img.width;
    const sharp = new Float32Array(n);
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= img.height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            sum += gray[yy * w + xx];
            cnt++;
          }
        }
        const g = gray[i];
        let v = g + 0.7 * (g - sum / cnt);
        sharp[i] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }

    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const v = sharp[i] | 0;
      d[o] = v; d[o + 1] = v; d[o + 2] = v; // grayscale output; keep alpha
    }
    return img;
  }

  function canCanvas() {
    return typeof document !== 'undefined' && typeof window !== 'undefined' &&
      typeof window.Image === 'function' && typeof document.createElement === 'function';
  }

  // dataUrl -> enhanced PNG dataUrl (upscale to ~2200px max side, contrast
  // stretch, sharpen). Degrades to the original dataUrl on ANY failure — the
  // OCR call itself must not break because enhancement failed.
  function enhance(dataUrl) {
    if (!canCanvas()) return Promise.resolve(dataUrl);
    return new Promise(function (resolve) {
      const img = new window.Image();
      img.onload = function () {
        try {
          const maxSide = Math.max(img.width || 0, img.height || 0);
          if (!maxSide) { resolve(dataUrl); return; }
          const scale = Math.min(2, Math.max(1, 2200 / maxSide));
          const w = Math.round((img.width || 0) * scale);
          const h = Math.round((img.height || 0) * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);
          const pixels = ctx.getImageData(0, 0, w, h);
          enhancePixels(pixels);
          ctx.putImageData(pixels, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          resolve(dataUrl);
        }
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  // ---- cloud channel (ADR-0010 / ADR-0011 / ADR-0013) ----
  // The relay is your own server: scripts/ocr-relay.py, docs/OCR-RELAY.md. It
  // owns the Azure key; the app carries only the relay URL and the shared access
  // token. Both are deployment configuration, not product defaults: set them for
  // a build in www/js/relay-config.js (committed empty), or per device in
  // Settings (keys ocrCloudUrl / ocrCloudToken win over the file). With no URL
  // configured the cloud channel is skipped and only on-device recognition runs.
  const RELAY_CONFIG = (typeof window.WD_RELAY === 'object' && window.WD_RELAY) || {};
  const DEFAULT_RELAY = String(RELAY_CONFIG.url || '').trim();
  const RELAY_TOKEN = String(RELAY_CONFIG.token || '').trim();
  const CLOUD_TIMEOUT_MS = 120000; // > relay poll budget (90 s) incl. F0 429 back-off

  // { enabled, url, token } from Settings, falling back to relay-config.js.
  // Cloud needs a URL to be worth trying; with none (no relay configured, or the
  // unit-test harness with no settings store) the local path is used, so tests
  // stay hermetic.
  function cloudSettings() {
    const S = window.Storage;
    if (!S || typeof S.getSetting !== 'function') {
      return Promise.resolve({ enabled: false, url: '', token: '' });
    }
    return Promise.all([
      S.getSetting('ocrCloud'),
      S.getSetting('ocrCloudUrl'),
      S.getSetting('ocrCloudToken'),
    ])
      .then(function (r) {
        const url = String((r[1] && r[1].value ? String(r[1].value) : DEFAULT_RELAY)).trim();
        const token = String((r[2] && r[2].value ? String(r[2].value) : RELAY_TOKEN)).trim();
        const enabled = (r[0] ? String(r[0].value) !== 'off' : true) && !!url;
        return { enabled: enabled, url: url, token: token };
      })
      .catch(function () { return { enabled: false, url: '', token: '' }; });
  }

  // Azure Read analyzeResult -> word strings in reading order. Pure; exported for tests.
  // Two shapes exist in the wild: the GA `pages` shape shown in the docs and the
  // legacy `readResults` shape our F0 resource returns -- accept both. A line with
  // no `words` array falls back to its `text`, split into tokens here (cleanWords
  // collapses spacing but never splits multi-word text into separate chips).
  function analyzeToWords(payload) {
    const res = payload && payload.analyzeResult ? payload.analyzeResult : payload;
    if (!res || typeof res !== 'object') return [];
    const out = [];
    const pages = Array.isArray(res.pages) ? res.pages
      : (Array.isArray(res.readResults) ? res.readResults : []);
    for (const p of pages) {
      const lines = Array.isArray(p && p.lines) ? p.lines : [];
      for (const l of lines) {
        const ws = Array.isArray(l && l.words) ? l.words : [];
        for (const w of ws) {
          if (w && typeof w.text === 'string') out.push(w.text);
        }
        if (!ws.length && l && typeof l.text === 'string') {
          for (const tok of l.text.split(/\s+/)) {
            if (tok) out.push(tok);
          }
        }
      }
    }
    return out;
  }

  // POSTs the ORIGINAL photo (Azure does its own preprocessing; the enhancement
  // pipeline exists for ML Kit) and maps the analyzeResult to cleaned words.
  function cloudExtract(dataUrl, cfg) {
    if (typeof fetch !== 'function') return Promise.reject(new Error('ocr-no-fetch'));
    let timer = null;
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.token) headers['X-WD-Token'] = cfg.token; // relay without WD_OCR_TOKEN: omit it
    const opts = {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ image: dataUrl }),
    };
    if (typeof AbortController === 'function') {
      const ctrl = new AbortController();
      opts.signal = ctrl.signal;
      timer = setTimeout(function () { ctrl.abort(); }, CLOUD_TIMEOUT_MS);
    }
    return fetch(cfg.url, opts)
      .then(function (r) {
        if (!r.ok) throw new Error('ocr-relay-http-' + r.status);
        return r.json();
      })
      .then(function (payload) {
        // Azure spells this both ways ('Succeeded' in docs, F0 returns 'succeeded').
        if (payload && payload.status && String(payload.status).toLowerCase() !== 'succeeded') {
          throw new Error('ocr-cloud-status');
        }
        const words = cleanWords(analyzeToWords(payload));
        if (!words.length) throw new Error('ocr-cloud-empty');
        return words;
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  // Local ML Kit pipeline (ADR-0006), unchanged: enhance -> cache file ->
  // processImage -> delete the file in all outcomes.
  function localExtract(dataUrl) {
    const P = adapterPlugins();
    if (!P) return Promise.reject(new Error('ocr-not-available'));
    const parts0 = splitBase64(dataUrl);
    if (!parts0) return Promise.reject(new Error('ocr-bad-image-data'));
    return enhance(dataUrl).then(function (enhanced) {
      const parts = splitBase64(enhanced) || parts0;
      // Cache dir keeps the photo transient (ADR-0001); deleted in all outcomes.
      const rel = 'wd-ocr-' + Date.now() + '.' + parts.ext;
      return P.Filesystem.writeFile({ path: rel, data: parts.data, directory: 'CACHE' })
        .then(function (written) {
          return P.TextRecognition
            .processImage({ path: written.uri, script: 'LATIN' })
            .then(function (r) { return cleanWords(String(r.text || '').split(/\r?\n/)); });
        })
        .finally(function () {
          return P.Filesystem.deleteFile({ path: rel, directory: 'CACHE' }).catch(function () {});
        });
    });
  }

  const OCR = {
    // Capability flag: true when the native OCR + filesystem adapters are present.
    available: function () {
      return adapterPlugins() !== null;
    },

    // extractWords(dataUrl) -> Promise<string[]>.
    // Cloud first when a relay is configured (your relay -> Azure Read, the
    // handwriting path), local ML Kit as fallback; on rejection the UI shows the
    // manual entry chips.
    extractWords: function (dataUrl) {
      const parts0 = splitBase64(dataUrl);
      if (!parts0) return Promise.reject(new Error('ocr-bad-image-data'));
      return cloudSettings().then(function (cfg) {
        if (!cfg.enabled) return localExtract(dataUrl);
        return cloudExtract(dataUrl, cfg).catch(function () {
          return localExtract(dataUrl);
        });
      });
    },

    _cleanWords: cleanWords,   // exported for tests
    _splitBase64: splitBase64, // exported for tests
    _enhancePixels: enhancePixels, // exported for tests
    _analyzeToWords: analyzeToWords, // exported for tests
    _cloudSettings: cloudSettings, // exported for tests
  };

  window.OCR = OCR;
})();

// tts: pronounce a word in the selected English variant (en-AU default, en-GB, en-US).
// Native path: Capacitor TextToSpeech plugin when present. Fallback: Web SpeechSynthesis.
// Pronunciation variant is independent from UI language. If no English voice exists,
// surface errors.tts to the caller instead of silently mis-pronouncing.
(function () {
  'use strict';

  const VARIANTS = ['en-AU', 'en-GB', 'en-US'];
  const DEFAULT_VARIANT = 'en-AU';

  function isNative() {
    return typeof window.Capacitor !== 'undefined' &&
      window.Capacitor.Plugins && window.Capacitor.Plugins.TextToSpeech;
  }

  function pickVoice(synthesis, variant) {
    const voices = synthesis.getVoices() || [];
    // exact match on language code first (e.g. "en-AU"), then any en-* as fallback
    const exact = voices.filter(function (v) { return v.lang && v.lang.replace('_', '-') === variant; });
    if (exact.length) {
      // prefer a local voice if available
      return exact.filter(function (v) { return v.localService; })[0] || exact[0];
    }
    const anyEn = voices.filter(function (v) { return v.lang && v.lang.toLowerCase().startsWith('en'); });
    return anyEn.length ? anyEn[0] : null;
  }

  function nativeSpeak(word, variant) {
    return new Promise(function (resolve, reject) {
      // @capacitor-community/text-to-speech TTSOptions: { text, lang, rate, ... }
      window.Capacitor.Plugins.TextToSpeech.speak({ text: word, lang: variant, rate: 0.9 })
        .then(resolve)
        .catch(reject);
    });
  }

  function webSpeak(synthesis, word, voice) {
    return new Promise(function (resolve, reject) {
      const utter = new SpeechSynthesisUtterance(word);
      if (voice) { utter.voice = voice; utter.lang = voice.lang; }
      utter.rate = 0.9;
      let settled = false;
      utter.onend = function () { if (!settled) { settled = true; resolve(); } };
      utter.onerror = function () { if (!settled) { settled = true; reject(new Error('tts error')); } };
      synthesis.speak(utter);
      // some engines never fire onend for very short text; safety timeout
      setTimeout(function () { if (!settled) { settled = true; resolve(); } }, 10000);
    });
  }

  const TTS = {
    VARIANTS: VARIANTS,
    DEFAULT_VARIANT: DEFAULT_VARIANT,

    // Resolve a variant code: validate against known list.
    resolveVariant: function (stored) {
      return VARIANTS.includes(stored) ? stored : DEFAULT_VARIANT;
    },

    // speak(word, variant) -> Promise. Rejects only if no voice path works at all.
    speak: function (word, variant) {
      variant = this.resolveVariant(variant);
      if (isNative()) {
        return nativeSpeak(word, variant).catch(function () {
          return TTS._webSpeak(word, variant); // native failed -> try web
        });
      }
      return this._webSpeak(word, variant);
    },

    _webSpeak: function (word, variant) {
      if (typeof speechSynthesis === 'undefined') {
        return Promise.reject(new Error('no-tts'));
      }
      const synth = speechSynthesis;
      return new Promise(function (resolve, reject) {
        function go() {
          const voice = pickVoice(synth, variant);
          if (!voice) { reject(new Error('no-english-voice')); return; }
          webSpeak(synth, word, voice).then(resolve, reject);
        }
        // getVoices can be async on some engines
        if (synth.getVoices().length) go();
        else {
          synth.onvoiceschanged = function () { go(); };
          setTimeout(go, 500);
        }
      });
    },

    // For the settings screen: list whether an exact voice exists for each variant.
    probe: function () {
      if (isNative()) {
        return Promise.resolve(VARIANTS.map(function (v) { return { variant: v, exact: true, native: true }; }));
      }
      if (typeof speechSynthesis === 'undefined') {
        return Promise.resolve(VARIANTS.map(function (v) { return { variant: v, exact: false, native: false }; }));
      }
      return new Promise(function (resolve) {
        function build() {
          const voices = speechSynthesis.getVoices() || [];
          resolve(VARIANTS.map(function (v) {
            const exact = voices.some(function (vo) { return vo.lang && vo.lang.replace('_', '-') === v; });
            return { variant: v, exact: exact, native: false };
          }));
        }
        if (speechSynthesis.getVoices().length) build();
        else { speechSynthesis.onvoiceschanged = build; setTimeout(build, 500); }
      });
    },
  };

  window.TTS = TTS;
})();

// i18n: load JSON locale bundles, detect language, t() with {name} interpolation.
// `en` is the source language; every lookup falls back to en when a key is missing.
(function () {
  'use strict';

  const LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'];
  const SOURCE = 'en';

  const bundles = {};      // code -> dict
  let current = SOURCE;

  function detectLocale(stored) {
    if (stored && LOCALES.includes(stored)) return stored;
    const nav = (navigator.language || 'en').replace('_', '-');
    if (LOCALES.includes(nav)) return nav;
    if (nav.startsWith('zh')) {
      // zh-TW / zh-HK / zh-Hant -> Traditional; otherwise Simplified
      if (nav === 'zh-TW' || nav === 'zh-HK' || nav.includes('Hant')) return 'zh-TW';
      return 'zh-CN';
    }
    const base = nav.split('-')[0];
    if (LOCALES.includes(base)) return base;
    return SOURCE;
  }

  async function loadLocale(code) {
    if (bundles[code]) return bundles[code];
    const res = await fetch('js/i18n/' + code + '.json');
    if (!res.ok) throw new Error('i18n load failed: ' + code);
    bundles[code] = await res.json();
    return bundles[code];
  }

  async function setLocale(code) {
    const wanted = LOCALES.includes(code) ? code : SOURCE;
    await loadLocale(wanted);
    await loadLocale(SOURCE);
    current = wanted;
    document.documentElement.lang = wanted;
    applyToDOM(document);
  }

  function t(key, vars) {
    let s = (bundles[current] && bundles[current][key]) || bundles[SOURCE][key] || key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (_, name) {
        return vars[name] !== undefined ? String(vars[name]) : '{' + name + '}';
      });
    }
    return s;
  }

  function applyToDOM(root) {
    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
  }

  window.I18N = {
    LOCALES: LOCALES,
    detectLocale: detectLocale,
    setLocale: setLocale,
    t: t,
    applyToDOM: applyToDOM,
    current: function () { return current; },
  };
})();

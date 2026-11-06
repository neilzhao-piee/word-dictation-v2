// app: hash router + views. Product rules enforced here:
// 1. dictation never starts before the parent confirms the word chips;
// 2. one word at a time — TTS speaks, next word waits for a confirm click;
// 3. everything local (storage.js), no network calls outside i18n JSON.
(function () {
  'use strict';

  const t = function (k, v) { return window.I18N.t(k, v); };
  const $main = document.getElementById('view');

  // ---- tiny helpers ----
  function el(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    return tpl.content.firstElementChild;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function applyI18n(root) { window.I18N.applyToDOM(root); }

  // ISO week label (Monday start) in the configured timezone.
  function isoWeekLabel(ts, timeZone) {
    const d = new Date(ts);
    // render date parts in the target zone, then compute ISO week on those parts
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('-');
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    const day = (date.getDay() + 6) % 7; // Mon=0
    date.setDate(date.getDate() - day + 3); // nearest Thursday = ISO year week 1
    const firstThursday = new Date(date.getFullYear(), 0, 4);
    const fday = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - fday + 3);
    const week = 1 + Math.round((date - firstThursday) / (7 * 86400000));
    return date.getFullYear() + '-W' + String(week).padStart(2, '0');
  }

  // ---- settings access ----
  // Build-time relay config (www/js/relay-config.js); the settings store wins
  // over it per device. Empty url = no relay, cloud channel off (ADR-0011).
  const RELAY_CONFIG = (typeof window.WD_RELAY === 'object' && window.WD_RELAY) || {};

  async function getSettings() {
    const [lang, voice, tz, ocrCloud, ocrCloudUrl, ocrCloudToken] = await Promise.all([
      window.Storage.getSetting('language'),
      window.Storage.getSetting('voiceVariant'),
      window.Storage.getSetting('timezone'),
      window.Storage.getSetting('ocrCloud'),
      window.Storage.getSetting('ocrCloudUrl'),
      window.Storage.getSetting('ocrCloudToken'),
    ]);
    return {
      language: lang ? lang.value : null,
      voiceVariant: window.TTS.resolveVariant(voice ? voice.value : null),
      timezone: tz ? tz.value : 'Australia/Perth',
      ocrCloud: ocrCloud ? String(ocrCloud.value) !== 'off' : true,
      ocrCloudUrl: String((ocrCloudUrl && ocrCloudUrl.value) || RELAY_CONFIG.url || '').trim(),
      ocrCloudToken: String((ocrCloudToken && ocrCloudToken.value) || RELAY_CONFIG.token || '').trim(),
    };
  }

  // ---- current child profile (ADR-0012) ----
  // One phone can hold several children; every list/session/wrong-book row is
  // tagged with the profile that was current when it was written.
  let profilePromise = null;
  function resetProfileCache() { profilePromise = null; }
  function currentProfile() {
    if (!profilePromise) {
      profilePromise = window.Storage.ensureProfile().then(function (pid) {
        return window.Storage.allProfiles().then(function (list) {
          const i = list.findIndex(function (p) { return p.id === pid; });
          const n = (i < 0 ? 0 : i) + 1;
          const p = i < 0 ? null : list[i];
          return {
            id: pid,
            raw: p,
            name: (p && p.name) || t('settings.profileDefaultName', { n: n }),
            count: list.length,
          };
        });
      });
    }
    return profilePromise;
  }

  // ---- working dictation state (in memory, persisted on finish) ----
  let draft = null; // { words: string[], index: number, listId }

  // ============ views ============

  async function viewHome() {
    const [wrong, lists, prof] = await Promise.all([window.Storage.allWrongWords(), window.Storage.allLists(), currentProfile()]);
    const v = el('<div>' +
      '<div class="card"><h1 data-i18n="app.name"></h1><p class="muted" data-i18n="app.tagline"></p>' +
      '<p class="muted">' + esc(t('home.profile', { name: prof.name })) + '</p></div>' +
      '<div class="grid">' +
      '<a class="btn primary big" href="#/new" data-i18n="home.newDictation"></a>' +
      '<a class="btn" href="#/review" data-i18n="home.reviewWrong"></a>' +
      '<a class="btn" href="#/history" data-i18n="home.history"></a>' +
      '</div>' +
      (wrong.length ? '<p class="muted" style="margin-top:12px">' + esc(t('home.wrongCount', { n: wrong.length })) + '</p>' : '') +
      '</div>');
    applyI18n(v);
    return v;
  }

  // Camera capture: Capacitor Camera on native, file input in the browser.
  // Photos stay transient in memory — nothing is ever persisted to storage (ADR-0001).
  function capturePhoto(source) {
    return new Promise(function (resolve, reject) {
      const Plugins = window.Capacitor && window.Capacitor.Plugins;
      if (Plugins && Plugins.Camera && Plugins.Camera.getPhoto) {
        Plugins.Camera.getPhoto({
          quality: 85,
          width: 2200,
          height: 2200,
          // Capacitor 8 enums are STRINGS, and the native camera plugin parses
          // them as Java enum names: call.getString("source") -> CameraSource.valueOf(...)
          // with values "CAMERA" / "PHOTOS" / "PROMPT" (uppercase). A missing or
          // unparseable value falls back to PROMPT, which shows the plugin's
          // bottom-sheet "From Photos / Take Picture" chooser in the SYSTEM
          // language. Passing explicit source removes that chooser:
          // CAMERA -> ACTION_IMAGE_CAPTURE directly, PHOTOS -> system photo picker.
          source: source === 'gallery' ? 'PHOTOS' : 'CAMERA',
          resultType: 'dataUrl',
          allowEdit: false,
        }).then(function (photo) {
          if (photo.dataUrl) resolve(photo.dataUrl);
          else if (photo.base64String) resolve('data:image/jpeg;base64,' + photo.base64String);
          else if (photo.base64) resolve('data:image/jpeg;base64,' + photo.base64);
          else reject(new Error('photo-missing-data'));
        }).catch(reject);
        return;
      }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      if (source !== 'gallery') input.capture = 'environment';
      input.onchange = function () {
        const f = input.files && input.files[0];
        if (!f) { reject(new Error('USER_CANCELED')); return; }
        const reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result)); };
        reader.onerror = function () { reject(reader.error || new Error('photo-read-failed')); };
        reader.readAsDataURL(f);
      };
      input.oncancel = function () { reject(new Error('USER_CANCELED')); };
      input.click();
    });
  }

  function userCanceled(e) {
    return /cancel/i.test(String((e && e.message) || ''));
  }

  function showPhotoPreview(v, sel, alt) {
    const box = v.querySelector(sel);
    box.hidden = false;
    box.innerHTML = '<img alt="' + esc(alt) + '">';
    return box.querySelector('img');
  }

  async function viewNew() {
    const v = el('<div>' +
      '<div class="card"><h1 data-i18n="new.title"></h1>' +
      '<p class="muted" data-i18n="new.step1"></p>' +
      '<button class="btn" id="photoList" data-i18n="new.takeListPhoto"></button>' +
      '<button class="btn" id="galleryList" data-i18n="new.choosePhoto"></button>' +
      '<div class="photo-preview" id="listPhotoPreview" hidden></div>' +
      '<p class="notice" id="ocrNotice" hidden></p>' +
      '<p class="muted" data-i18n="new.step2"></p>' +
      '<div class="word-chips" id="chips"></div>' +
      '<div class="form-row"><input type="text" id="addWord" data-i18n-placeholder="new.addWord"><button class="btn" id="addBtn" data-i18n="common.confirm"></button></div>' +
      '<p class="muted" data-i18n="new.manualHint"></p>' +
      '</div>' +
      '<div class="card"><p class="muted" data-i18n="new.confirmWords"></p>' +
      '<button class="btn primary big" id="startBtn" data-i18n="new.startDictation"></button></div>' +
      '</div>');
    applyI18n(v);

    const words = draft ? draft.words.slice() : [];
    const chipsBox = v.querySelector('#chips');

    function renderChips() {
      chipsBox.innerHTML = '';
      words.forEach(function (w, i) {
        const chip = el('<span class="chip"><input value="' + esc(w) + '" aria-label="word"><button class="x" aria-label="remove">×</button></span>');
        chip.querySelector('input').addEventListener('input', function (e) { words[i] = e.target.value; });
        chip.querySelector('.x').addEventListener('click', function () { words.splice(i, 1); renderChips(); });
        chipsBox.appendChild(chip);
      });
      if (words.length) {
        chipsBox.insertAdjacentHTML('afterend', '');
      }
    }
    renderChips();

    const notice = v.querySelector('#ocrNotice');
    function listPhoto(source) {
      return async function () {
        let dataUrl;
        try {
          dataUrl = await capturePhoto(source);
        } catch (e) {
          if (!userCanceled(e)) {
            notice.hidden = false;
            notice.textContent = t('errors.camera');
          }
          return;
        }
        showPhotoPreview(v, '#listPhotoPreview', 'word list photo').src = dataUrl;
        try {
          const found = await window.OCR.extractWords(dataUrl);
          found.forEach(function (w) { if (!words.some(function (x) { return x.toLowerCase() === w.toLowerCase(); })) words.push(w); });
          notice.hidden = true;
          renderChips();
        } catch (e) {
          // No OCR adapter yet: photo is previewed, parent types the words (chip gate).
          notice.hidden = false;
          notice.textContent = t('errors.ocr');
        }
      };
    }
    v.querySelector('#photoList').addEventListener('click', listPhoto('camera'));
    v.querySelector('#galleryList').addEventListener('click', listPhoto('gallery'));

    v.querySelector('#addBtn').addEventListener('click', function () {
      const inp = v.querySelector('#addWord');
      const w = inp.value.trim();
      if (!w) return;
      if (!words.some(function (x) { return x.toLowerCase() === w.toLowerCase(); })) words.push(w);
      inp.value = '';
      renderChips();
    });

    // Gate: dictation starts only from the parent-confirmed chip list.
    v.querySelector('#startBtn').addEventListener('click', async function () {
      const confirmed = words.map(function (w) { return w.trim(); }).filter(Boolean);
      if (!confirmed.length) {
        notice.hidden = false;
        notice.textContent = t('errors.noWords');
        return;
      }
      const list = await window.Storage.saveList({ words: confirmed, source: 'manual' });
      draft = { words: confirmed, index: 0, listId: list.id };
      location.hash = '#/dict';
    });

    return v;
  }

  async function viewDict() {
    if (!draft || draft.index >= draft.words.length) {
      location.hash = draft ? '#/check' : '#/new';
      return el('<div></div>');
    }
    const settings = await getSettings();
    const word = draft.words[draft.index];
    const v = el('<div><div class="card word-card">' +
      '<p class="progress-line">' + esc(t('dict.progress', { done: Math.min(draft.index + 1, draft.words.length), total: draft.words.length })) + '</p>' +
      '<div class="word">' + esc(word) + '</div>' +
      '</div>' +
      '<div class="grid">' +
      '<button class="btn" id="hear" data-i18n="dict.tapToHear"></button>' +
      '<button class="btn primary big" id="next" data-i18n="common.confirm"></button>' +
      '<button class="btn" id="skip" data-i18n="dict.skip"></button>' +
      '</div>' +
      '<p class="notice" id="ttsErr" hidden></p></div>');
    applyI18n(v);

    const err = v.querySelector('#ttsErr');
    function speak() {
      window.TTS.speak(word, settings.voiceVariant).catch(function () {
        err.hidden = false;
        err.textContent = t('errors.tts');
      });
    }
    // auto-speak once on arrival, parent controls the pace from here
    speak();
    v.querySelector('#hear').addEventListener('click', speak);
    v.querySelector('.word-card .word').addEventListener('click', speak);

    function advance(skipped) {
      if (skipped) draft.skipped = draft.skipped || [];
      if (skipped) draft.skipped.push(word);
      draft.index += 1;
      go(draft.index >= draft.words.length ? '#/check' : '#/dict');
    }
    v.querySelector('#next').addEventListener('click', function () { advance(false); });
    v.querySelector('#skip').addEventListener('click', function () { advance(true); });
    return v;
  }

  async function viewCheck() {
    if (!draft) { location.hash = '#/new'; return el('<div></div>'); }
    const v = el('<div><div class="card"><h1 data-i18n="check.title"></h1>' +
      '<button class="btn" id="photoAnswer" data-i18n="new.takeAnswerPhoto"></button>' +
      '<button class="btn" id="galleryAnswer" data-i18n="new.choosePhoto"></button>' +
      '<div class="photo-preview" id="answerPhotoPreview" hidden></div>' +
      '<p class="notice" id="answerOcrNotice" hidden></p>' +
      '<label class="muted" data-i18n="check.answers"></label>' +
      '<div class="word-chips" id="answerChips"></div>' +
      '<div class="form-row"><input type="text" id="addAnswer" data-i18n-placeholder="new.addWord"><button class="btn" id="addAnswerBtn" data-i18n="common.confirm"></button></div>' +
      '<button class="btn primary big" id="checkBtn" data-i18n="check.run"></button>' +
      '</div><div id="result"></div></div>');
    applyI18n(v);

    // Answers are a list of editable words (not a textarea): the child's sheet is
    // OCR'd word by word, and any misread word can be fixed before grading.
    let answerWords = [];
    const chipsBox = v.querySelector('#answerChips');
    function renderAnswerChips() {
      chipsBox.innerHTML = '';
      answerWords.forEach(function (w, i) {
        const chip = el('<span class="chip"><input value="' + esc(w) + '" aria-label="answer word"><button class="x" aria-label="remove">×</button></span>');
        chip.querySelector('input').addEventListener('input', function (e) { answerWords[i] = e.target.value; });
        chip.querySelector('.x').addEventListener('click', function () { answerWords.splice(i, 1); renderAnswerChips(); });
        chipsBox.appendChild(chip);
      });
    }
    renderAnswerChips();
    v.querySelector('#addAnswerBtn').addEventListener('click', function () {
      const inp = v.querySelector('#addAnswer');
      // Pasting "cat dog bird" adds all three, so a failed OCR is still quick to fix.
      inp.value.split(/\s+/).forEach(function (w) {
        w = w.trim();
        if (w) answerWords.push(w);
      });
      inp.value = '';
      renderAnswerChips();
    });

    // Answer-sheet photo: OCR fills the editable word list (parent can still fix it).
    function answerPhoto(source) {
      return async function () {
        const aNotice = v.querySelector('#answerOcrNotice');
        const checkBtn = v.querySelector('#checkBtn');
        let dataUrl;
        try {
          dataUrl = await capturePhoto(source);
        } catch (e) {
          if (!userCanceled(e)) {
            aNotice.hidden = false;
            aNotice.className = 'notice';
            aNotice.textContent = t('errors.camera');
          }
          return;
        }
        showPhotoPreview(v, '#answerPhotoPreview', 'answer sheet photo').src = dataUrl;
        aNotice.hidden = true;
        checkBtn.disabled = true;
        try {
          const found = await window.OCR.extractWords(dataUrl);
          answerWords = found.slice();
          renderAnswerChips();
          aNotice.hidden = false;
          aNotice.className = 'notice ok';
          aNotice.textContent = t('new.wordsFound', { n: found.length });
        } catch (e) {
          aNotice.hidden = false;
          aNotice.className = 'notice';
          aNotice.textContent = t('errors.ocr');
        } finally {
          checkBtn.disabled = false;
        }
      };
    }
    v.querySelector('#photoAnswer').addEventListener('click', answerPhoto('camera'));
    v.querySelector('#galleryAnswer').addEventListener('click', answerPhoto('gallery'));

    v.querySelector('#checkBtn').addEventListener('click', async function () {
      // An empty answer used to grade as "0/N correct" *and* "All correct" at the
      // same time (empty `given` -> no mistakes). Refuse to grade nothing.
      const given = answerWords.map(function (w) { return String(w).trim(); }).filter(Boolean);
      if (!given.length) {
        const n = v.querySelector('#answerOcrNotice');
        n.hidden = false;
        n.className = 'notice';
        n.textContent = t('check.noAnswer');
        return;
      }
      const out = window.Grade.gradeAnswers(draft.words, given);
      const res = v.querySelector('#result');
      res.innerHTML = '';
      const card = el('<div class="card"><div class="score">' + esc(t('check.score', { correct: out.correct, total: out.total })) + '</div></div>');
      res.appendChild(card);
      if (out.mistakes.length) {
        const mc = el('<div class="card"><h2 data-i18n="check.mistakes"></h2></div>');
        applyI18n(mc);
        out.mistakes.forEach(function (m) {
          mc.appendChild(el('<div class="mistake-row"><span class="given">' + esc(m.given) + '</span><span class="muted">' + esc(m.expected || '—') + '</span></div>'));
        });
        const saveBtn = el('<button class="btn" data-i18n="check.saveToWrongBook"></button>');
        applyI18n(saveBtn);
        saveBtn.addEventListener('click', async function () {
          for (const m of out.mistakes) {
            await window.Storage.upsertWrongWord(m.expected || m.given, { listId: draft.listId });
          }
          saveBtn.disabled = true;
        });
        mc.appendChild(saveBtn);
        res.appendChild(mc);
      } else {
        res.appendChild(el('<div class="card"><p class="notice ok" data-i18n="check.noMistakes"></p></div>'));
        applyI18n(res);
      }
      // Graduation rule (GLOSSARY): a wrong-book word written exactly correct here is retired.
      for (const r of out.results) {
        if (r.status === 'exact') {
          await window.Storage.removeWrongWord(r.expected);
        }
      }
      await window.Storage.saveSession({
        listId: draft.listId,
        words: draft.words,
        given: given,
        correct: out.correct,
        total: out.total,
        mistakes: out.mistakes,
      });
      draft = null;
      const done = el('<a class="btn primary big" href="#/history" data-i18n="home.history"></a>');
      applyI18n(done);
      res.appendChild(done);
    });
    return v;
  }

  async function viewHistory() {
    const settings = await getSettings();
    const sessions = (await window.Storage.allSessions()).sort(function (a, b) { return b.createdAt - a.createdAt; });
    const v = el('<div><div class="card"><h1 data-i18n="history.title"></h1></div></div>');
    applyI18n(v);
    if (!sessions.length) {
      v.appendChild(el('<div class="card"><p class="muted" data-i18n="history.empty"></p></div>'));
      applyI18n(v);
      return v;
    }
    const byWeek = new Map();
    for (const s of sessions) {
      const wk = isoWeekLabel(s.createdAt, settings.timezone);
      if (!byWeek.has(wk)) byWeek.set(wk, []);
      byWeek.get(wk).push(s);
    }
    for (const [wk, list] of byWeek) {
      const correct = list.reduce(function (a, s) { return a + s.correct; }, 0);
      const total = list.reduce(function (a, s) { return a + s.total; }, 0);
      const pct = total ? Math.round(correct / total * 100) : 0;
      const w = el('<div class="week"><strong>' + esc(t('history.week', { week: wk })) + '</strong>' +
        '<div class="muted">' + esc(t('history.accuracy', { pct: pct })) + ' · ' + list.length + '</div></div>');
      v.appendChild(w);
    }
    return v;
  }

  async function viewReview() {
    const wrong = (await window.Storage.allWrongWords()).sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    const v = el('<div><div class="card"><h1 data-i18n="review.title"></h1></div></div>');
    applyI18n(v);
    if (!wrong.length) {
      v.appendChild(el('<div class="card"><p class="muted" data-i18n="review.empty"></p></div>'));
      applyI18n(v);
      return v;
    }
    v.appendChild(el('<div class="card"><p class="muted" data-i18n="review.practice"></p><div class="word-chips">' +
      wrong.map(function (w) { return '<span class="chip">' + esc(w.word) + (w.count > 1 ? ' ×' + w.count : '') + '</span>'; }).join('') +
      '</div><a class="btn primary" href="#/new" data-i18n="review.practice"></a></div>'));
    applyI18n(v);
    return v;
  }

  async function viewSettings() {
    const settings = await getSettings();
    const [profiles, cur] = await Promise.all([window.Storage.allProfiles(), currentProfile()]);
    const profileOptions = profiles.map(function (p, i) {
      const name = p.name || t('settings.profileDefaultName', { n: i + 1 });
      return '<option value="' + esc(p.id) + '"' + (p.id === cur.id ? ' selected' : '') + '>' + esc(name) + '</option>';
    }).join('');
    const v = el('<div><div class="card"><h1 data-i18n="settings.title"></h1>' +
      '<label class="muted" data-i18n="settings.profile"></label><br>' +
      '<select id="profile">' + profileOptions + '</select>' +
      ' <button class="btn" id="profileAdd" data-i18n="settings.profileAdd"></button>' +
      ' <button class="btn" id="profileRename" data-i18n="settings.profileRename"></button><br><br>' +
      '<label class="muted" data-i18n="settings.language"></label><br>' +
      '<select id="lang">' + window.I18N.LOCALES.map(function (l) {
        return '<option value="' + l + '"' + (window.I18N.current() === l ? ' selected' : '') + '>' + l + '</option>';
      }).join('') + '</select><br><br>' +
      '<label class="muted" data-i18n="settings.voiceVariant"></label><br>' +
      '<select id="voice">' + window.TTS.VARIANTS.map(function (vr) {
        return '<option value="' + vr + '"' + (settings.voiceVariant === vr ? ' selected' : '') + '>' + esc(t('voice.' + vr)) + '</option>';
      }).join('') + '</select><br><br>' +
      '<button class="btn" id="testVoice" data-i18n="settings.testVoice"></button>' +
      '<p class="notice" id="probe" hidden></p><br>' +
      '<label class="muted" data-i18n="settings.ocr"></label><br>' +
      '<label><input type="checkbox" id="ocrCloud"' + (settings.ocrCloud ? ' checked' : '') + '><span data-i18n="settings.ocrCloud"></span></label><br>' +
      '<label class="muted" data-i18n="settings.ocrCloudUrl"></label>' +
      '<div class="form-row"><input type="text" id="ocrCloudUrl" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://ocr.example.com/ocr" value="' + esc(settings.ocrCloudUrl) + '"></div>' +
      '<label class="muted" data-i18n="settings.ocrCloudToken"></label>' +
      '<div class="form-row"><input type="password" id="ocrCloudToken" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(settings.ocrCloudToken) + '"></div>' +
      '<p class="muted" data-i18n="settings.ocrCloudHint"></p>' +
      '<p class="muted" data-i18n="app.tagline"></p>' +
      '</div></div>');
    applyI18n(v);

    v.querySelector('#profile').addEventListener('change', async function (e) {
      await window.Storage.setCurrentProfileId(e.target.value);
      resetProfileCache();
      renderRoute();
    });
    v.querySelector('#profileAdd').addEventListener('click', async function () {
      const list = await window.Storage.allProfiles();
      const def = t('settings.profileDefaultName', { n: list.length + 1 });
      const name = (window.prompt(t('settings.profileNamePrompt'), def) || '').trim();
      if (!name) return;
      // Random suffix: two devices creating a profile in the same millisecond
      // would otherwise collide, and ids are the isolation key.
      const p = { id: 'P' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name };
      await window.Storage.putProfile(p);
      await window.Storage.setCurrentProfileId(p.id);
      resetProfileCache();
      renderRoute();
    });
    v.querySelector('#profileRename').addEventListener('click', async function () {
      const prof = await currentProfile();
      const name = (window.prompt(t('settings.profileNamePrompt'), prof.name) || '').trim();
      if (!name) return;
      await window.Storage.putProfile({ id: prof.id, name: name, createdAt: (prof.raw && prof.raw.createdAt) || Date.now() });
      resetProfileCache();
      renderRoute();
    });
    v.querySelector('#lang').addEventListener('change', async function (e) {
      await window.Storage.setSetting('language', e.target.value);
      await window.I18N.setLocale(e.target.value);
      document.getElementById('brandTitle').textContent = t('app.name');
      renderRoute(); // re-render current view with new locale
    });
    v.querySelector('#voice').addEventListener('change', async function (e) {
      await window.Storage.setSetting('voiceVariant', e.target.value);
    });
    v.querySelector('#ocrCloud').addEventListener('change', async function (e) {
      await window.Storage.setSetting('ocrCloud', e.target.checked ? 'on' : 'off');
    });
    // Relay address/token are saved on commit (blur/Enter), not per keystroke.
    v.querySelector('#ocrCloudUrl').addEventListener('change', async function (e) {
      await window.Storage.setSetting('ocrCloudUrl', e.target.value.trim());
    });
    v.querySelector('#ocrCloudToken').addEventListener('change', async function (e) {
      await window.Storage.setSetting('ocrCloudToken', e.target.value.trim());
    });
    v.querySelector('#testVoice').addEventListener('click', async function () {
      const variant = v.querySelector('#voice').value;
      const probe = v.querySelector('#probe');
      try {
        await window.TTS.speak('hello', variant);
        probe.hidden = false;
        probe.className = 'notice ok';
        const info = await window.TTS.probe();
        const miss = info.filter(function (i) { return !i.exact; }).map(function (i) { return i.variant; });
        probe.textContent = miss.length ? 'voice fallback: ' + miss.join(', ') : 'ok';
      } catch (e2) {
        probe.hidden = false;
        probe.className = 'notice';
        probe.textContent = t('errors.tts');
      }
    });
    return v;
  }

  // ============ router ============

  const routes = {
    '': viewHome, '#': viewHome,
    '#/new': viewNew, '#/dict': viewDict, '#/check': viewCheck,
    '#/history': viewHistory, '#/review': viewReview, '#/settings': viewSettings,
  };

  // Navigating to the *current* hash fires no hashchange, so the view would never
  // re-render (confirm/skip looked dead). Re-render explicitly in that case.
  function go(hash) {
    if (location.hash === hash) renderRoute();
    else location.hash = hash;
  }

  async function renderRoute() {
    const hash = location.hash || '#';
    const fn = routes[hash] || viewHome;
    const view = await fn();
    $main.innerHTML = '';
    $main.appendChild(view);
    document.querySelectorAll('nav.tabs a').forEach(function (a) {
      const target = a.getAttribute('href');
      const active = (target === '#/' && (hash === '' || hash === '#' || hash === '#/')) || target === hash;
      a.classList.toggle('active', active);
    });
  }

  // ============ boot ============

  (async function boot() {
    try {
      const settings = await getSettings();
      await window.I18N.setLocale(settings.language);
    } catch (e) {
      await window.I18N.setLocale('en');
    }
    await currentProfile(); // make sure a profile exists before the first write
    document.getElementById('brandTitle').textContent = t('app.name');
    // Android 15+ (targetSdk 36) forces edge-to-edge: the WebView starts under the
    // status bar, so the top bar's links sat in the system's tap zone.
    // setOverlaysWebView is unavailable there; instead measure the bar and push our
    // content below it via a CSS variable (CSS max() also covers env insets).
    const bar = window.Capacitor && window.Capacitor.Plugins.StatusBar;
    if (bar) {
      try {
        const info = await bar.getInfo();
        if (info && info.height) {
          document.documentElement.style.setProperty('--statusbar-h', info.height + 'px');
        }
      } catch (e) { /* fall back to env(safe-area-inset-top) alone */ }
    }
    window.addEventListener('hashchange', renderRoute);
    await renderRoute();
  })();
})();

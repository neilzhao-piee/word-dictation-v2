// storage: IndexedDB wrapper. Stores: profiles, lists, sessions, wrongWords, settings.
// All data stays on the device. JSON export for backup (import in a later phase).
//
// v2 (2026-11-06): child profiles. Every list / session / wrong-book entry carries
// a profileId, so two children on the same phone never see each other's records.
// Reads default to the *current* profile; pass an explicit id to read another one.
(function () {
  'use strict';

  const DB_NAME = 'worddict-v2';
  const DB_VERSION = 2;
  const DEFAULT_PROFILE_ID = 'default'; // legacy rows (no profileId) belong here
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        const oldVersion = e.oldVersion || 0;
        if (!db.objectStoreNames.contains('profiles')) {
          db.createObjectStore('profiles', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('lists')) {
          db.createObjectStore('lists', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (oldVersion >= 1 && db.objectStoreNames.contains('wrongWords')) {
          // v1 keyed the wrong book by `word` alone; v2 keys it by
          // `<profileId>:<word>` so two children can each own the same word.
          const oldStore = e.target.transaction.objectStore('wrongWords');
          const got = oldStore.getAll();
          got.onsuccess = function (ev) {
            const rows = ev.target.result || [];
            db.deleteObjectStore('wrongWords');
            const ws = db.createObjectStore('wrongWords', { keyPath: 'id' });
            ws.createIndex('profileId', 'profileId');
            ws.createIndex('updatedAt', 'updatedAt');
            rows.forEach(function (r) {
              const word = String(r.word || '').trim().toLowerCase();
              if (!word) return;
              ws.put({
                id: DEFAULT_PROFILE_ID + ':' + word,
                profileId: DEFAULT_PROFILE_ID,
                word: word,
                count: r.count || 1,
                updatedAt: r.updatedAt || Date.now(),
                lastListId: r.lastListId,
              });
            });
          };
        } else if (!db.objectStoreNames.contains('wrongWords')) {
          const ws = db.createObjectStore('wrongWords', { keyPath: 'id' });
          ws.createIndex('profileId', 'profileId');
          ws.createIndex('updatedAt', 'updatedAt');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(storeName, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(storeName, mode);
        const store = t.objectStore(storeName);
        const result = fn(store);
        t.oncomplete = function () { resolve(result && result.result !== undefined ? result.result : undefined); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  // Rows written before profiles existed have no profileId; they belong to the
  // default profile, which is the only one that can exist at that point.
  function ownedBy(row, pid) {
    return (row.profileId || DEFAULT_PROFILE_ID) === pid;
  }

  const Storage = {
    // ---- profiles ----
    currentProfileId: function () {
      return tx('settings', 'readonly', function (s) { return s.get('profileId'); })
        .then(function (r) { return r && r.value ? String(r.value) : ''; });
    },
    setCurrentProfileId: function (id) {
      return tx('settings', 'readwrite', function (s) { return s.put({ key: 'profileId', value: id }); })
        .then(function () { return id; });
    },
    allProfiles: function () {
      return tx('profiles', 'readonly', function (s) { return s.getAll(); })
        .then(function (rows) { return (rows || []).sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); }); });
    },
    putProfile: function (p) {
      if (!p.createdAt) p.createdAt = Date.now();
      return tx('profiles', 'readwrite', function (s) { return s.put(p); }).then(function () { return p; });
    },
    // Guarantees at least one profile exists and that the current one is valid.
    ensureProfile: function () {
      return Promise.all([Storage.allProfiles(), Storage.currentProfileId()]).then(function (r) {
        const list = r[0];
        const cur = r[1];
        if (list.length) {
          if (cur && list.some(function (p) { return p.id === cur; })) return cur;
          return Storage.setCurrentProfileId(list[0].id);
        }
        const p = { id: DEFAULT_PROFILE_ID, name: '', createdAt: Date.now() };
        return Storage.putProfile(p).then(function () { return Storage.setCurrentProfileId(p.id); });
      });
    },

    // ---- lists ----
    saveList: function (list) {
      list.updatedAt = Date.now();
      if (!list.id) list.id = 'L' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      return Storage.ensureProfile().then(function (pid) {
        list.profileId = list.profileId || pid;
        return tx('lists', 'readwrite', function (s) { return s.put(list); }).then(function () { return list; });
      });
    },
    getList: function (id) { return tx('lists', 'readonly', function (s) { return s.get(id); }); },
    allLists: function (profileId) {
      return Promise.all([Storage.currentProfileId(), tx('lists', 'readonly', function (s) { return s.getAll(); })])
        .then(function (r) {
          const pid = profileId || r[0] || DEFAULT_PROFILE_ID;
          return (r[1] || []).filter(function (x) { return ownedBy(x, pid); });
        });
    },
    deleteList: function (id) { return tx('lists', 'readwrite', function (s) { return s.delete(id); }); },

    // ---- sessions (one per dictation run) ----
    saveSession: function (session) {
      session.createdAt = session.createdAt || Date.now();
      if (!session.id) session.id = 'S' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      return Storage.ensureProfile().then(function (pid) {
        session.profileId = session.profileId || pid;
        return tx('sessions', 'readwrite', function (s) { return s.put(session); }).then(function () { return session; });
      });
    },
    allSessions: function (profileId) {
      return Promise.all([Storage.currentProfileId(), tx('sessions', 'readonly', function (s) { return s.getAll(); })])
        .then(function (r) {
          const pid = profileId || r[0] || DEFAULT_PROFILE_ID;
          return (r[1] || []).filter(function (x) { return ownedBy(x, pid); });
        });
    },

    // ---- wrongWords ----
    upsertWrongWord: function (word, meta) {
      return Storage.ensureProfile().then(function (pid) {
        const w = String(word).trim().toLowerCase();
        const id = pid + ':' + w;
        return tx('wrongWords', 'readwrite', function (s) {
          const rec = { id: id, profileId: pid, word: w, count: 0 };
          const req = s.get(id);
          req.onsuccess = function () {
            const existing = req.result;
            const next = existing || rec;
            next.count = (next.count || 0) + 1;
            next.updatedAt = Date.now();
            if (meta && meta.listId) next.lastListId = meta.listId;
            s.put(next);
          };
          return req;
        });
      });
    },
    allWrongWords: function (profileId) {
      return Promise.all([Storage.currentProfileId(), tx('wrongWords', 'readonly', function (s) { return s.getAll(); })])
        .then(function (r) {
          const pid = profileId || r[0] || DEFAULT_PROFILE_ID;
          return (r[1] || []).filter(function (x) { return ownedBy(x, pid); });
        });
    },
    removeWrongWord: function (word) {
      return Storage.ensureProfile().then(function (pid) {
        const w = String(word).trim().toLowerCase();
        return tx('wrongWords', 'readwrite', function (s) { return s.delete(pid + ':' + w); });
      });
    },

    // ---- settings ----
    getSetting: function (key) {
      return tx('settings', 'readonly', function (s) { return s.get(key); });
    },
    setSetting: function (key, value) {
      return tx('settings', 'readwrite', function (s) { return s.put({ key: key, value: value }); });
    },

    // ---- backup: JSON export (import lands in a later phase) ----
    exportJson: function () {
      return Promise.all([this.allLists(), this.allSessions(), this.allWrongWords(), this.allProfiles()]).then(function (r) {
        return JSON.stringify({
          app: 'word-dictation-v2',
          version: 2,
          exportedAt: new Date().toISOString(),
          profiles: r[3],
          lists: r[0],
          sessions: r[1],
          wrongWords: r[2],
        });
      });
    },
  };

  window.Storage = Storage;
})();

// storage: profile isolation + the v1 -> v2 wrong-book migration.
// Runs under plain Node with fake-indexeddb (no browser needed).
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
function test(name, fn) {
  return fn().then(function () { passed++; console.log('ok - ' + name); });
}

// Load the browser script the way the WebView does: a classic script that
// assigns window.Storage. `indexedDB` comes from fake-indexeddb/auto.
function loadStorage() {
  const win = { indexedDB: globalThis.indexedDB };
  const src = readFileSync(new URL('../www/js/storage.js', import.meta.url), 'utf8');
  new Function('window', src)(win);
  return win.Storage;
}

function freshDb() {
  return new Promise(function (resolve, reject) {
    const req = indexedDB.deleteDatabase('worddict-v2');
    req.onsuccess = function () { resolve(); };
    req.onerror = function () { reject(req.error); };
    req.onblocked = function () { resolve(); };
  });
}

// Build a v1 database exactly like the shipped v1 schema, with one wrong word.
function seedV1() {
  return new Promise(function (resolve, reject) {
    const req = indexedDB.open('worddict-v2', 1);
    req.onupgradeneeded = function () {
      const db = req.result;
      db.createObjectStore('lists', { keyPath: 'id' });
      db.createObjectStore('sessions', { keyPath: 'id' });
      const w = db.createObjectStore('wrongWords', { keyPath: 'word' });
      w.createIndex('updatedAt', 'updatedAt');
      db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = function () {
      const db = req.result;
      const t = db.transaction('wrongWords', 'readwrite');
      t.objectStore('wrongWords').put({ word: 'apple', count: 2, updatedAt: 1000 });
      t.oncomplete = function () { db.close(); resolve(); };
      t.onerror = function () { reject(t.error); };
    };
    req.onerror = function () { reject(req.error); };
  });
}

(async function main() {
  await freshDb();
  await seedV1();
  const S = loadStorage();

  await test('v1 wrong book survives the v2 upgrade, owned by the default profile', async function () {
    const rows = await S.allWrongWords();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].word, 'apple');
    assert.equal(rows[0].count, 2);
    assert.equal(rows[0].profileId, 'default');
  });

  await test('ensureProfile creates the default profile exactly once', async function () {
    assert.equal(await S.ensureProfile(), 'default');
    assert.equal(await S.ensureProfile(), 'default');
    const list = await S.allProfiles();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'default');
    assert.equal(await S.currentProfileId(), 'default');
  });

  await test('wrong book is per profile: same word, separate rows', async function () {
    await S.putProfile({ id: 'P2', name: 'Bob' });
    await S.setCurrentProfileId('P2');
    await S.upsertWrongWord('apple', {});
    await S.upsertWrongWord('banana', {});
    const bob = await S.allWrongWords();
    assert.deepEqual(bob.map(function (r) { return r.word; }).sort(), ['apple', 'banana']);
    assert.equal(bob.find(function (r) { return r.word === 'apple'; }).count, 1);

    await S.setCurrentProfileId('default');
    const mine = await S.allWrongWords();
    assert.equal(mine.length, 1, 'the other profile must not leak in');
    assert.equal(mine[0].count, 2, 'the original count is untouched');
  });

  await test('removing a word only removes it from the current profile', async function () {
    await S.setCurrentProfileId('P2');
    await S.removeWrongWord('apple');
    assert.deepEqual((await S.allWrongWords()).map(function (r) { return r.word; }), ['banana']);
    await S.setCurrentProfileId('default');
    assert.equal((await S.allWrongWords()).length, 1);
  });

  await test('sessions and lists are scoped to the profile that was current', async function () {
    await S.setCurrentProfileId('default');
    await S.saveSession({ words: ['cat'], given: ['cat'], correct: 1, total: 1 });
    await S.saveList({ words: ['cat'] });
    assert.equal((await S.allSessions()).length, 1);
    assert.equal((await S.allLists()).length, 1);

    await S.setCurrentProfileId('P2');
    assert.equal((await S.allSessions()).length, 0);
    assert.equal((await S.allLists()).length, 0);

    await S.saveSession({ words: ['dog'], given: ['dog'], correct: 1, total: 1 });
    assert.equal((await S.allSessions()).length, 1);
    await S.setCurrentProfileId('default');
    assert.equal((await S.allSessions()).length, 1);
    assert.equal((await S.allSessions())[0].words[0], 'cat');
  });

  await test('rows without a profileId (legacy) still belong to the default profile', async function () {
    // Simulate a session written by a build that predates profiles.
    const db = await new Promise(function (resolve) { const r = indexedDB.open('worddict-v2', 2); r.onsuccess = function () { resolve(r.result); }; });
    await new Promise(function (resolve, reject) {
      const t = db.transaction('sessions', 'readwrite');
      t.objectStore('sessions').put({ id: 'legacy', words: ['old'], correct: 0, total: 1 });
      t.oncomplete = resolve;
      t.onerror = function () { reject(t.error); };
    });
    db.close();
    await S.setCurrentProfileId('default');
    const rows = await S.allSessions();
    assert.ok(rows.some(function (r) { return r.id === 'legacy'; }));
    await S.setCurrentProfileId('P2');
    assert.ok(!(await S.allSessions()).some(function (r) { return r.id === 'legacy'; }));
  });

  await test('exportJson reports version 2 with profiles', async function () {
    const data = JSON.parse(await S.exportJson());
    assert.equal(data.version, 2);
    assert.ok(data.profiles.length >= 2);
  });

  console.log(passed + ' tests passed');
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});

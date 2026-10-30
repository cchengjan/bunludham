/**
 * Automated Regression & Storage v3 Test Suite (Phases B, G1, G2).
 *
 * Covers:
 * - All 16 tests defined in `test_runner.html` (10 original + 6 Storage v3 browser tests)
 * - Deterministic v2 -> v3 migration, backup creation, and non-destructive legacy preservation
 * - Corrupt v2 / v3 JSON resilience
 * - Cross-tab `storage` listener on `pfs_frames_v3`, unrelated key filtering, v2 protection, and duplicate listener guard
 * - Backup v3.0 export, v3.0 & legacy v2.0 restore, strict schema validation, and atomic rollback
 * - Reset Defaults + reload persistence + preservation of unrelated LocalStorage keys
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function createStorageSandbox() {
  const store = new Map();
  const listeners = new Map();

  class MockStorageEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.key = init.key !== undefined ? init.key : null;
      this.newValue = init.newValue !== undefined ? init.newValue : null;
      this.oldValue = init.oldValue !== undefined ? init.oldValue : null;
    }
  }

  class MockCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const localStorage = {
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(String(k), String(v));
    },
    removeItem(k) {
      store.delete(String(k));
    },
    clear() {
      store.clear();
    },
    key(idx) {
      return Array.from(store.keys())[idx] ?? null;
    },
    get length() {
      return store.size;
    }
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    StorageEvent: MockStorageEvent,
    CustomEvent: MockCustomEvent,
    localStorage,
    location: { hostname: 'localhost', href: 'http://localhost:8080/test_runner.html' },
    document: {
      readyState: 'complete',
      querySelector: () => null,
      getElementById: () => ({
        style: {},
        innerHTML: '',
        textContent: '',
        appendChild: () => {}
      }),
      createElement: () => ({
        className: '',
        innerHTML: '',
        style: {}
      })
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      listeners.set(type, arr.filter((f) => f !== fn));
    },
    dispatchEvent(evt) {
      const arr = [...(listeners.get(evt.type) || [])];
      for (const fn of arr) fn(evt);
      return true;
    },
    fetch: async (relUrl) => {
      const cleanRel = String(relUrl).split('?')[0];
      const filePath = path.join(repoRoot, cleanRel);
      if (!fs.existsSync(filePath)) {
        return { ok: false, status: 404, json: async () => null };
      }
      const txt = fs.readFileSync(filePath, 'utf8');
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(txt),
        text: async () => txt
      };
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(repoRoot, 'shared/storage.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(repoRoot, 'shared/drive-sync.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(repoRoot, 'config.js'), 'utf8'), ctx);

  return { sandbox, ctx, store, listeners, MockStorageEvent };
}

describe('Regression Suite (`test_runner.html`) & Storage v3 Fixes', () => {
  it('executes all 16 browser tests inside test_runner.html with 100% pass rate', async () => {
    const { sandbox, ctx } = createStorageSandbox();
    const html = fs.readFileSync(path.join(repoRoot, 'test_runner.html'), 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1, 'Expected inline test script in test_runner.html');

    // Run inline script without scheduling setTimeout(runAll, 300) race
    const scriptBody = scripts[0][1].replace('setTimeout(runAll, 300);', 'window.__testArray = tests;');
    vm.runInContext(scriptBody, ctx);

    assert.ok(Array.isArray(sandbox.__testArray));
    assert.equal(sandbox.__testArray.length, 16);

    for (const testCase of sandbox.__testArray) {
      const ok = await testCase.test();
      assert.equal(ok, true, `test_runner.html failed on: ${testCase.name}`);
    }
  });

  it('migrates valid pfs_frames_v2 to pfs_frames_v3, backs up v2, and never auto-deletes v2', async () => {
    const { sandbox, store } = createStorageSandbox();
    const legacyV2 = [
      {
        id: 'custom-v2-1',
        name: 'กรอบบุญรุ่น v2',
        category: 'งานบุญ',
        filename: 'assets/frames/kathin-118.png',
        status: 'ACTIVE',
        photoArea: { x: 0, y: 0, width: 1024, height: 1024, borderRadius: 0 }
      }
    ];
    const rawV2 = JSON.stringify(legacyV2);
    store.set('pfs_frames_v2', rawV2);

    const frames = await sandbox.FrameStore.getAll();
    assert.equal(frames.some((f) => f.id === 'custom-v2-1'), true);
    assert.equal(store.get('pfs_frames_v2'), rawV2, 'Legacy pfs_frames_v2 must remain untouched');
    assert.equal(store.get('pfs_frames_v2_backup'), rawV2, 'Backup key pfs_frames_v2_backup must be created');
    assert.ok(store.get('pfs_frames_v3'), 'Canonical pfs_frames_v3 must be populated');

    // Second call is idempotent and prefers canonical v3
    const secondMig = sandbox.FrameStore.migrateFromV2();
    assert.equal(secondMig.migrated, false);
    assert.equal(secondMig.status, 'preserved_v3');
  });

  it('handles corrupted pfs_frames_v2 JSON safely and falls back to seed frames', async () => {
    const { sandbox, store } = createStorageSandbox();
    store.set('pfs_frames_v2', '{corrupted_json_payload');

    const mig = sandbox.FrameStore.migrateFromV2();
    assert.equal(mig.migrated, false);
    assert.equal(mig.status, 'rejected_corrupt_json');

    const frames = await sandbox.FrameStore.getAll();
    assert.ok(frames.length >= 5, 'Should safely initialize default seed frames');
  });

  it('syncs cross-tab events on pfs_frames_v3, ignores unrelated keys & stale v2, and prevents duplicate listeners', async () => {
    const { sandbox, MockStorageEvent } = createStorageSandbox();
    await sandbox.FrameStore.getAll();

    // Singleton guard check
    assert.equal(sandbox.bindCrossTabSync(), false);

    let frameUpdates = 0;
    let quoteUpdates = 0;
    let activityUpdates = 0;
    sandbox.addEventListener('pfs:frames_updated', () => { frameUpdates++; });
    sandbox.addEventListener('pfs:quotes_updated', () => { quoteUpdates++; });
    sandbox.addEventListener('pfs:activities_updated', () => { activityUpdates++; });

    // Unrelated key ignored
    sandbox.dispatchEvent(new MockStorageEvent('storage', { key: 'unrelated_key', newValue: 'abc' }));
    assert.equal(frameUpdates, 0);

    // Legacy v2 event ignored because valid v3 exists
    sandbox.dispatchEvent(new MockStorageEvent('storage', { key: 'pfs_frames_v2', newValue: '[]' }));
    assert.equal(frameUpdates, 0);

    // Canonical v3 event triggers refresh
    sandbox.dispatchEvent(new MockStorageEvent('storage', { key: 'pfs_frames_v3', newValue: '[]' }));
    assert.equal(frameUpdates, 1);

    // Quotes & Activities cross-tab events trigger refresh
    sandbox.dispatchEvent(new MockStorageEvent('storage', { key: 'pfs_quotes_v2', newValue: '[]' }));
    sandbox.dispatchEvent(new MockStorageEvent('storage', { key: 'pfs_activities_v2', newValue: '[]' }));
    assert.equal(quoteUpdates, 1);
    assert.equal(activityUpdates, 1);
  });

  it('rejects malformed, unsupported-version, or unsafe-URL backups without corrupting existing data', async () => {
    const { sandbox, store } = createStorageSandbox();
    const initialFrames = await sandbox.FrameStore.getAll();
    const snapshotV3 = store.get('pfs_frames_v3');

    await assert.rejects(
      () => sandbox.StorageBackup.restoreBackup('{bad json'),
      /ไม่ใช่รูปแบบ JSON ที่ถูกต้อง/
    );

    await assert.rejects(
      () => sandbox.StorageBackup.restoreBackup(JSON.stringify({
        version: '99.0',
        frames: initialFrames
      })),
      /ไม่รองรับเวอร์ชันของไฟล์สำรองข้อมูล/
    );

    await assert.rejects(
      () => sandbox.StorageBackup.restoreBackup(JSON.stringify({
        version: '3.0',
        frames: [{ id: 'bad', name: 'Bad', filename: 'x.png', photoArea: { x: 2, y: 0, width: 0, height: 1 } }]
      })),
      /ไม่ถูกต้องตามโครงสร้าง/
    );

    await assert.rejects(
      () => sandbox.StorageBackup.restoreBackup(JSON.stringify({
        version: '3.0',
        frames: initialFrames,
        settings: { gasWebAppUrl: 'javascript:alert(1)' }
      })),
      /Google Apps Script ต้องขึ้นต้นด้วย https/
    );

    assert.equal(store.get('pfs_frames_v3'), snapshotV3, 'Canonical v3 data must remain intact');
  });

  it('resets canonical v3 frames, quotes, and activities to defaults, preserves unrelated keys, and persists across reload', async () => {
    const { sandbox, store } = createStorageSandbox();
    store.set('pfs_admin_pin', '9999');
    store.set('custom_user_preference', 'preserve_me');

    await sandbox.FrameStore.duplicate('kathin-118');
    await sandbox.ActivityStore.addSubmission({
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      caption: 'ภาพก่อนรีเซ็ต',
      eventName: 'กฐิน ๑๑๘ ปี'
    });

    const beforeReset = await sandbox.FrameStore.getAll();
    assert.ok(beforeReset.some((f) => f.name.includes('(สำเนา)')));

    await sandbox.StorageBackup.resetAllDefaults();

    // Simulate full browser reload by invalidating all in-memory store caches
    sandbox.FrameStore.invalidateCache();
    sandbox.QuoteStore.invalidateCache();
    sandbox.ActivityStore.invalidateCache();

    const afterFrames = await sandbox.FrameStore.getAll();
    const afterActivities = await sandbox.ActivityStore.getAll();
    const afterQuotes = await sandbox.QuoteStore.getAll();

    assert.ok(afterFrames.length >= 5);
    assert.equal(afterFrames.some((f) => f.name.includes('(สำเนา)')), false);
    assert.equal(afterActivities.length, 0);
    assert.ok(afterQuotes.length > 0);
    assert.equal(store.get('pfs_admin_pin'), '9999');
    assert.equal(store.get('custom_user_preference'), 'preserve_me');
  });
});

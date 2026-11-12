import assert from 'node:assert/strict';
import test from 'node:test';
import { createExtensionStorage, STATE_KEY } from '../storage/local.ts';
import { configureApplicationStorage, recoverApplicationRestore } from '../../src/services/application-storage.ts';
import { StorageManager } from '../../src/services/storage.ts';
import { exportWorkbench } from '../../src/services/import-export/workbench.ts';

function fixture(initial = {}, reorder = false) {
  let disk = structuredClone(initial);
  let failure;
  let readFailure = false;
  let verifyFailure = false;
  let tail = Promise.resolve();
  const listeners = new Set();
  const area = {
    async get(key) {
      if (readFailure) throw new Error('Read failed');
      return Object.hasOwn(disk, key) ? { [key]: structuredClone(disk[key]) } : {};
    },
    async set(values) {
      if (failure) throw failure;
      const old = disk[STATE_KEY];
      disk = { ...disk, ...structuredClone(values) };
      if (reorder) disk = JSON.parse(JSON.stringify(disk, (_key, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
          : value));
      for (const listener of listeners) listener({
        [STATE_KEY]: { oldValue: old, newValue: disk[STATE_KEY] },
      }, 'local');
      if (verifyFailure) readFailure = true;
    },
  };
  const locks = {
    request(_name, action) {
      const result = tail.then(action);
      tail = result.catch(() => {});
      return result;
    },
  };
  const legacy = new Map([
    ['jipage_settings_v1', '{"language":"en"}'],
    ['jipage_bookmarks_v1', '[]'],
    ['jigeqiu_onboarding_v1', '{"version":1}'],
    ['jigeqiu-extension-privacy-acknowledged', 'old-privacy'],
    ['unrelated', 'private'],
  ]);
  const source = {
    get length() { return legacy.size; },
    key(index) { return [...legacy.keys()][index] ?? null; },
    getItem(key) { return legacy.get(key) ?? null; },
  };
  const create = () => createExtensionStorage({
    area, locks, legacy: () => source,
    changes: { addListener(listener) { listeners.add(listener); } },
  });
  return {
    create, legacy, area,
    disk: () => structuredClone(disk),
    fail: (value) => { failure = value; },
    failRead: () => { readFailure = true; },
    failVerification: () => { verifyFailure = true; },
  };
}

test('migration copies only application data and retains the original values', async () => {
  const f = fixture();
  const driver = f.create();
  await driver.initialize();
  assert.equal(driver.storage.getItem('jipage_settings_v1'), '{"language":"en"}');
  assert.equal(driver.storage.getItem('jigeqiu-extension-privacy-acknowledged'), 'old-privacy');
  assert.equal(driver.storage.getItem('jigeqiu_onboarding_v1'), '{"version":1}');
  assert.equal(driver.storage.getItem('unrelated'), null);
  assert.equal(f.legacy.get('jipage_settings_v1'), '{"language":"en"}');
  assert.equal(f.disk()[STATE_KEY].version, 1);
});

test('verification compares contents when Chrome reorders object properties', async () => {
  const f = fixture({}, true);
  const driver = f.create();
  await driver.initialize();
  await driver.mutate(() => {
    driver.storage.setItem('jipage_z', 'last');
    driver.storage.setItem('jipage_a', 'first');
  });
  assert.equal(driver.storage.getItem('jipage_z'), 'last');
  assert.equal(f.disk()[STATE_KEY].data.jipage_a, 'first');
});

test('restart reads Chrome rather than reimporting stale legacy values', async () => {
  const f = fixture();
  const first = f.create();
  await first.initialize();
  await first.mutate(() => first.storage.setItem('jipage_settings_v1', '{"language":"zh"}'));
  const second = f.create();
  await second.initialize();
  assert.equal(second.storage.getItem('jipage_settings_v1'), '{"language":"zh"}');
  assert.equal(f.legacy.get('jipage_settings_v1'), '{"language":"en"}');
});

test('failed migration never marks completion or removes old data', async () => {
  const f = fixture();
  f.fail(new Error('QUOTA_EXCEEDED'));
  await assert.rejects(f.create().initialize(), /QUOTA_EXCEEDED/);
  assert.equal(f.disk()[STATE_KEY], undefined);
  assert.equal(f.legacy.get('jipage_settings_v1'), '{"language":"en"}');
});

test('failed reads and malformed snapshots do not fall back to legacy or empty data', async () => {
  const f = fixture();
  f.failRead();
  await assert.rejects(f.create().initialize(), /Read failed/);
  assert.deepEqual(f.disk(), {});
  const damaged = fixture({ [STATE_KEY]: { version: 999, data: {} } });
  await assert.rejects(damaged.create().initialize(), /CORRUPT_DATA/);
  assert.equal(damaged.disk()[STATE_KEY].version, 999);
});

test('writes cannot happen outside a mutation and failed writes discard drafts', async () => {
  const f = fixture();
  const driver = f.create();
  await driver.initialize();
  assert.throws(() => driver.storage.setItem('jipage_settings_v1', '{}'), /MUTATION_REQUIRED/);
  f.fail(new Error('QUOTA_EXCEEDED'));
  await assert.rejects(driver.mutate(() =>
    driver.storage.setItem('jipage_settings_v1', '{}')), /QUOTA_EXCEEDED/);
  assert.equal(driver.storage.getItem('jipage_settings_v1'), '{"language":"en"}');
  assert.equal(f.disk()[STATE_KEY].data.jipage_settings_v1, '{"language":"en"}');
});

test('a resolved mutation is already durable, including removals', async () => {
  const f = fixture();
  const driver = f.create();
  await driver.initialize();
  const result = await driver.mutate(() => {
    driver.storage.setItem('jipage_settings_v1', '{"language":"zh"}');
    driver.storage.removeItem('jipage_bookmarks_v1');
    return 'saved';
  });
  assert.equal(result, 'saved');
  assert.equal(f.disk()[STATE_KEY].data.jipage_settings_v1, '{"language":"zh"}');
  assert.equal(f.disk()[STATE_KEY].data.jipage_bookmarks_v1, undefined);
});

test('two tabs serialize mutations and read the latest committed values', async () => {
  const f = fixture();
  const a = f.create(), b = f.create();
  await Promise.all([a.initialize(), b.initialize()]);
  await Promise.all([
    a.mutate(() => a.storage.setItem('jipage_recent_used_v1', '["a"]')),
    b.mutate(() => {
      assert.equal(b.storage.getItem('jipage_recent_used_v1'), '["a"]');
      b.storage.setItem('jipage_recent_searches_v1', '["b"]');
    }),
  ]);
  assert.equal(f.disk()[STATE_KEY].data.jipage_recent_used_v1, '["a"]');
  assert.equal(a.storage.getItem('jipage_recent_searches_v1'), '["b"]');
});

test('unverifiable persistence blocks further writes until reload', async () => {
  const f = fixture();
  const driver = f.create();
  await driver.initialize();
  f.failVerification();
  await assert.rejects(driver.mutate(() =>
    driver.storage.setItem('jipage_settings_v1', '{}')), /COMMIT_UNCERTAIN/);
  await assert.rejects(driver.mutate(() => {}), /COMMIT_UNCERTAIN/);
});

test('mutation does not resolve before Chrome finishes persisting', async () => {
  const f = fixture();
  const driver = f.create();
  await driver.initialize();
  const original = f.area.set;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  f.area.set = async values => { await pending; await original(values); };
  let resolved = false;
  const commit = driver.mutate(() => driver.storage.setItem('jipage_settings_v1', '{}'))
    .then(() => { resolved = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resolved, false);
  assert.equal(driver.storage.getItem('jipage_settings_v1'), '{"language":"en"}');
  release();
  await commit;
  assert.equal(f.disk()[STATE_KEY].data.jipage_settings_v1, '{}');
});

const bookmarkInput = {
  title: 'Test', url: 'https://example.org/', domain: 'example.org',
  category: 'cat-inbox', pinnedToDesktop: false, order: 0, collectionIds: [],
};

test('workbench restore uses the real extension transaction and discards all staged records on quota failure', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    locks: { request: async (_name, action) => action() },
  } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else Reflect.deleteProperty(globalThis, 'navigator');
  });
  const f = fixture();
  const driver = f.create();
  await driver.initialize();
  configureApplicationStorage(driver);
  try {
    const manager = new StorageManager();
    const backup = exportWorkbench({
      assets: { bookmarks: [{ ...bookmarkInput, id: 'restored', createdAt: 1, updatedAt: 1 }], folders: [], collections: [] },
      layout: { shortcuts: [], folders: [{ id: 'empty-desktop', name: 'Empty', shortcutIds: [] }],
        root: [{ kind: 'desktop-folder', id: 'empty-desktop' }], dock: [] },
      taskbar: ['restored'],
      search: { engines: [{ id: 'restored-engine', name: 'Synthetic', keyword: 'syn', icon: 'Search', isDefault: true,
        isEnabled: true, urlTemplate: 'https://example.test/?q={query}' }], defaultEngineId: 'restored-engine' },
    }, 10);
    const preview = manager.previewWorkbenchRestore(backup);
    const before = f.disk();
    f.fail(new Error('QUOTA_EXCEEDED'));
    await assert.rejects(manager.restoreWorkbench(preview), /QUOTA_EXCEEDED/);
    assert.deepEqual(f.disk(), before);
    assert.equal(driver.storage.getItem('jipage_library_v2'), null);
    f.fail(undefined);
    await manager.restoreWorkbench(preview);
    const data = f.disk()[STATE_KEY].data;
    assert.equal(JSON.parse(data.jipage_library_v2).bookmarks[0].id, 'restored');
    assert.deepEqual(JSON.parse(data.jipage_library_v2).dockBookmarkIds, ['restored']);
    assert.equal(JSON.parse(data.jipage_search_engines_v1)[0].id, 'restored-engine');
    assert.equal(JSON.parse(data.jipage_settings_v1).language, 'en');
    assert.equal(JSON.parse(data.jipage_settings_v1).defaultSearchEngineId, 'restored-engine');
    assert.equal(data.jipage_workbench_restore_v1, undefined);
  } finally { configureApplicationStorage(undefined); }
});

test('a migrated unfinished Web restore is recovered through the extension driver', async () => {
  const f = fixture();
  f.legacy.set('jipage_settings_v1', '{"language":"zh"}');
  f.legacy.set('jipage_workbench_restore_v1', JSON.stringify({ version: 1, records: [
    { key: 'jipage_settings_v1', before: '{"language":"en"}', after: '{"language":"zh"}' },
  ] }));
  const driver = f.create();
  await driver.initialize();
  configureApplicationStorage(driver);
  try {
    await recoverApplicationRestore();
    assert.equal(driver.storage.getItem('jipage_settings_v1'), '{"language":"en"}');
    assert.equal(f.disk()[STATE_KEY].data.jipage_workbench_restore_v1, undefined);
  } finally { configureApplicationStorage(undefined); }
});

test('stale library edits reject rather than overwriting another page', async () => {
  const f = fixture();
  const driver = f.create();
  await driver.initialize();
  configureApplicationStorage(driver);
  try {
    const first = new StorageManager(), stale = new StorageManager();
    first.getBookmarks();
    stale.getBookmarks();
    await first.mutate(() => first.saveManualBookmark(bookmarkInput));
    await assert.rejects(stale.mutate(() => stale.saveManualBookmark({
      ...bookmarkInput, title: 'Stale', url: 'https://example.org/stale',
    })), /CONFLICT/);
    assert.equal(JSON.parse(f.disk()[STATE_KEY].data.jipage_library_v2).bookmarks.length, 1);
  } finally { configureApplicationStorage(undefined); }
});

test('queued edits restore failed baselines before the next transaction', async () => {
  const f = fixture();
  const driver = f.create();
  await driver.initialize();
  configureApplicationStorage(driver);
  try {
    const manager = new StorageManager();
    manager.getBookmarks();
    const first = manager.mutate(() => {
      f.fail(new Error('QUOTA_EXCEEDED'));
      manager.saveManualBookmark(bookmarkInput);
    });
    const second = manager.mutate(() => {
      f.fail(undefined);
      manager.saveManualBookmark(bookmarkInput);
    });
    const results = await Promise.allSettled([first, second]);
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].status, 'fulfilled');
    await manager.mutate(() => manager.saveManualBookmark({
      ...bookmarkInput, title: 'Next', url: 'https://example.org/next',
    }));
    assert.equal(JSON.parse(f.disk()[STATE_KEY].data.jipage_library_v2).bookmarks.length, 2);
  } finally { configureApplicationStorage(undefined); }
});

test('StorageManager rolls back baselines after quota failure and retries successfully', async () => {
  const f = fixture();
  const driver = f.create();
  await driver.initialize();
  configureApplicationStorage(driver);
  try {
    const manager = new StorageManager();
    manager.getBookmarks();
    const input = {
      title: 'Test', url: 'https://example.org/', domain: 'example.org',
      category: 'cat-inbox', pinnedToDesktop: false, order: 0, collectionIds: [],
    };
    f.fail(new Error('QUOTA_EXCEEDED'));
    await assert.rejects(manager.mutate(() => manager.saveManualBookmark(input)), /QUOTA_EXCEEDED/);
    assert.deepEqual(manager.getBookmarks(), []);
    f.fail(undefined);
    await manager.mutate(() => manager.saveManualBookmark(input));
    assert.equal(JSON.parse(f.disk()[STATE_KEY].data.jipage_library_v2).bookmarks[0].title, 'Test');
  } finally {
    configureApplicationStorage(undefined);
  }
});

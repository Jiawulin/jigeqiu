import assert from 'node:assert/strict';
import test from 'node:test';
import { exportWorkbench, parseWorkbench, previewWorkbench } from '../../src/services/import-export/workbench';
import { commitRestoreRecords, recoverRestoreRecords, RESTORE_JOURNAL } from '../../src/services/restore-journal';
import { StorageManager } from '../../src/services/storage';
import { MemoryStorage } from '../support/memory-storage';
import { configureApplicationStorage } from '../../src/services/application-storage';

const assets = {
  bookmarks: [{ id: 'bm', title: 'Example', url: 'https://example.org/', domain: 'example.org',
    order: 0, createdAt: 1, updatedAt: 1, category: '', tags: [], collectionIds: [],
    pinnedToDesktop: false, keywords: [], iconMode: 'text' as const }],
  folders: [], collections: [],
};
const layout = { shortcuts: [{ id: 'shortcut', bookmarkId: 'bm' }],
  folders: [{ id: 'desktop-folder', name: 'Empty', shortcutIds: [] }],
  root: [{ kind: 'shortcut' as const, id: 'shortcut' }, { kind: 'desktop-folder' as const, id: 'desktop-folder' }], dock: [] };
const engines = [{ id: 'search', name: 'Search', keyword: 's', urlTemplate: 'https://example.org/?q={query}', isEnabled: true, icon: '', isDefault: true }];
const current = () => ({ assets, layout, taskbar: ['bm'], search: { engines, defaultEngineId: 'search' } });

test('workbench backup preserves stable identities, empty desktop folders, pins and engines', () => {
  const file = exportWorkbench(current(), 10);
  const restored = parseWorkbench(file);
  assert.deepEqual(restored.desktop, layout);
  assert.deepEqual(restored.taskbar, ['bm']);
  assert.deepEqual(restored.search, current().search);
  assert.equal(restored.assets.bookmarks[0].id, 'bm');
  assert.ok(!file.includes('recentSearches'));
  const preview = previewWorkbench(restored, current(), { desktop: true, taskbar: true, search: true });
  assert.equal(preview.next.assets.bookmarks[0].id, 'bm');
});

test('missing backup sections preserve valid local entries; explicit empty sections clear them', () => {
  const file = JSON.parse(exportWorkbench(current(), 10));
  delete file.desktop;
  delete file.taskbar;
  const missing = previewWorkbench(parseWorkbench(JSON.stringify(file)), current(), { desktop: false, taskbar: false, search: false });
  assert.deepEqual(missing.next.layout, layout);
  assert.deepEqual(missing.next.taskbar, ['bm']);
  file.desktop = { shortcuts: [], folders: [], root: [], dock: [] };
  file.taskbar = [];
  const empty = previewWorkbench(parseWorkbench(JSON.stringify(file)), current(), { desktop: true, taskbar: true, search: false });
  assert.equal(empty.next.layout.shortcuts.length, 0);
  assert.deepEqual(empty.next.taskbar, []);
});

test('backup rejects dangling references, duplicate engines, bad templates and trash conflicts', () => {
  const file = JSON.parse(exportWorkbench(current(), 10));
  file.taskbar = ['missing'];
  assert.throws(() => parseWorkbench(JSON.stringify(file)));
  file.taskbar = ['bm'];
  file.search.engines.push(file.search.engines[0]);
  assert.throws(() => parseWorkbench(JSON.stringify(file)));
  file.search.engines = [{ ...engines[0], urlTemplate: 'javascript:{query}' }];
  assert.throws(() => parseWorkbench(JSON.stringify(file)));
  assert.throws(() => previewWorkbench(parseWorkbench(exportWorkbench(current(), 10)), {
    ...current(), trashIds: ['bm'],
  }, { desktop: true, taskbar: true, search: true }), /TRASH_ID_CONFLICT/);
});

function memory() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear(),
  } satisfies Storage;
}
test('restore journal rolls back partial writes and can recover after interruption', () => {
  const store = memory();
  store.setItem('jipage_library_v2', 'before');
  let fail = true;
  const set = store.setItem;
  store.setItem = (key, value) => {
    if (key === 'jipage_search_engines_v1' && fail) { fail = false; throw new Error('quota'); }
    set(key, value);
  };
  assert.throws(() => commitRestoreRecords(store, [
    { key: 'jipage_library_v2', before: 'before', after: 'after' },
    { key: 'jipage_search_engines_v1', before: null, after: 'engines' },
  ]), /quota/);
  assert.equal(store.getItem('jipage_library_v2'), 'before');
  assert.equal(store.getItem(RESTORE_JOURNAL), null);
  store.setItem(RESTORE_JOURNAL, JSON.stringify({ version: 1, records: [
    { key: 'jipage_library_v2', before: 'before', after: 'after' },
  ] }));
  store.setItem('jipage_library_v2', 'after');
  recoverRestoreRecords(store);
  assert.equal(store.getItem('jipage_library_v2'), 'before');
});

test('journal refuses to overwrite concurrent edits and refuses invalid journal keys', () => {
  const store = memory();
  store.setItem(RESTORE_JOURNAL, JSON.stringify({ version: 1, records: [
    { key: 'jipage_library_v2', before: 'before', after: 'after' },
  ] }));
  store.setItem('jipage_library_v2', 'other-edit');
  assert.throws(() => recoverRestoreRecords(store), /RESTORE_RECOVERY_REQUIRED/);
  assert.equal(store.getItem('jipage_library_v2'), 'other-edit');
  assert.ok(store.getItem(RESTORE_JOURNAL));
  store.setItem(RESTORE_JOURNAL, JSON.stringify({ version: 1, records: [{ key: 'other', before: null, after: 'x' }] }));
  assert.throws(() => recoverRestoreRecords(store), /RESTORE_RECOVERY_REQUIRED/);
});

function setup() {
  const store = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    locks: { request: async (_: string, action: () => unknown) => action() },
  } });
  return { store, manager: new StorageManager() };
}
test('manager restore replaces assets and pins, preserves preferences and refreshes baselines', async () => {
  const { store, manager } = setup();
  store.setItem('jipage_settings_v1', JSON.stringify({ language: 'en', appearanceMode: 'dark', showDock: false }));
  const file = exportWorkbench(current(), 10);
  const preview = manager.previewWorkbenchRestore(file);
  assert.equal(store.getItem('jipage_library_v2'), null, 'Preview never writes');
  await manager.restoreWorkbench(preview);
  assert.deepEqual(manager.getDesktopLayout(), layout);
  assert.deepEqual(manager.getUserSettings().dockBookmarkIds, ['bm']);
  assert.equal(manager.getUserSettings().defaultSearchEngineId, 'search');
  assert.equal(manager.getUserSettings().showDock, false);
  assert.equal(manager.getSearchEngines()[0].id, 'search');
  assert.equal(store.getItem(RESTORE_JOURNAL), null);
  assert.equal(parseWorkbench(manager.exportWorkbenchBackup()).assets.bookmarks[0].id, 'bm');
  await assert.rejects(manager.restoreWorkbench(preview), /PREVIEW_STALE/);
});
test('manager rejects preview mutation, concurrent settings changes and cancelled queued work', async () => {
  const { store, manager } = setup();
  const file = exportWorkbench(current(), 10);
  const modified = manager.previewWorkbenchRestore(file);
  modified.next.taskbar = [];
  await assert.rejects(manager.restoreWorkbench(modified), /PREVIEW_STALE/);
  const preview = manager.previewWorkbenchRestore(file);
  store.setItem('jipage_settings_v1', '{"language":"en"}');
  await assert.rejects(manager.restoreWorkbench(preview), /CONFLICT/);
  const cancelled = manager.previewWorkbenchRestore(file);
  await assert.rejects(manager.restoreWorkbench(cancelled, () => false), /CANCELLED/);
  assert.equal(store.getItem('jipage_library_v2'), null);
});
test('full backup merged as bookmarks leaves engines, desktop and taskbar unchanged', () => {
  const { store, manager } = setup();
  const file = exportWorkbench(current(), 10);
  const taskbarBefore = manager.getUserSettings().dockBookmarkIds;
  const preview = manager.previewJsonAssetImport(file);
  manager.commitJsonAssetImport(preview);
  assert.equal(manager.getBookmarks().length, 1);
  assert.equal(manager.getDesktopLayout().shortcuts.length, 0);
  assert.equal(store.getItem('jipage_search_engines_v1'), null);
  assert.deepEqual(manager.getUserSettings().dockBookmarkIds, taskbarBefore);
});
test('retained layouts list invalid entries before replacement', () => {
  const backup = parseWorkbench(exportWorkbench({ ...current(), assets: { bookmarks: [], folders: [], collections: [] },
    layout: { shortcuts: [], folders: [], root: [], dock: [] }, taskbar: [] }, 10));
  const preview = previewWorkbench(backup, current(), { desktop: false, taskbar: false, search: false });
  assert.deepEqual(preview.removed.desktop, [{ id: 'bm', title: 'Example' }]);
  assert.deepEqual(preview.removed.taskbar, [{ id: 'bm', title: 'Example' }]);
  assert.equal(preview.next.layout.folders.length, 1);
});
test('restore journal quota refusal leaves all original records intact and pending recovery blocks writes', async () => {
  const { store, manager } = setup();
  const preview = manager.previewWorkbenchRestore(exportWorkbench(current(), 10));
  store.failWrites = true;
  await assert.rejects(manager.restoreWorkbench(preview), /quota|denied/i);
  store.failWrites = false;
  assert.equal(store.getItem('jipage_library_v2'), null);
  assert.equal(store.getItem(RESTORE_JOURNAL), null);
  store.setItem(RESTORE_JOURNAL, 'invalid');
  assert.throws(() => manager.saveSearchEngines(engines), /RESTORE_RECOVERY_REQUIRED/);
});
test('extension-style driver gets a single staged mutation without a web journal', async () => {
  const { store, manager } = setup();
  let mutations = 0;
  configureApplicationStorage({
    storage: store, mutate: async action => { mutations++; return action(); },
  });
  try {
    await manager.restoreWorkbench(manager.previewWorkbenchRestore(exportWorkbench(current(), 10)));
    assert.equal(mutations, 1);
    assert.equal(store.getItem(RESTORE_JOURNAL), null);
  } finally { configureApplicationStorage(undefined); }
});
test('backup preserves icon styling and legacy metadata but excludes usage history', () => {
  const state = current();
  Object.assign(state.assets.bookmarks[0], { iconBg: '#123456', notes: 'note', lastUsedAt: 99 });
  const backup = parseWorkbench(exportWorkbench(state, 10));
  assert.equal(backup.assets.bookmarks[0].iconBg, '#123456');
  assert.equal(backup.assets.bookmarks[0].notes, 'note');
  assert.equal(backup.assets.bookmarks[0].lastUsedAt, undefined);
  delete (state.assets.bookmarks[0] as { lastUsedAt?: number }).lastUsedAt;
});

test('strict restore rejects duplicate collection content identities and slash-equivalent commands', () => {
  const backup = JSON.parse(exportWorkbench(current(), 10));
  const collection = (id: string) => ({
    id, title: id, description: '', category: '', authorId: 'user-me', authorName: 'Me',
    visibility: 'private', isPinnedToDesktop: false, createdAt: 1, updatedAt: 1, items: [],
    assetContent: { cover: null, provenance: [], sections: [{ id: 'shared-section', title: '', description: '', items: [] }] },
  });
  backup.assets.collections = [collection('c-one'), collection('c-two')];
  assert.throws(() => parseWorkbench(JSON.stringify(backup)));
  backup.assets.collections = [];
  backup.search.engines.push({ ...engines[0], id: 'other', keyword: '/S' });
  assert.throws(() => parseWorkbench(JSON.stringify(backup)));
});

test('restore refuses missing locks, invalid defaults and corrupt export data without writes', async () => {
  const { store, manager } = setup();
  const file = exportWorkbench(current(), 10);
  const preview = manager.previewWorkbenchRestore(file);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  await assert.rejects(manager.restoreWorkbench(preview), /LOCK_UNAVAILABLE/);
  assert.equal(store.getItem('jipage_library_v2'), null);
  const invalidDefault = JSON.parse(file);
  invalidDefault.search.defaultEngineId = 'missing';
  assert.throws(() => parseWorkbench(JSON.stringify(invalidDefault)));
  store.setItem('jipage_search_engines_v1', '{invalid');
  assert.throws(() => manager.exportWorkbenchBackup(), /CORRUPT_DATA/);
});

test('recovery keeps its journal when a concurrent edit appears during rollback', () => {
  const store = memory();
  const changes = [
    { key: 'jipage_library_v2', before: 'old-library', after: 'new-library' },
    { key: 'jipage_settings_v1', before: 'old-settings', after: 'new-settings' },
  ];
  changes.forEach(r => store.setItem(r.key, r.after));
  store.setItem(RESTORE_JOURNAL, JSON.stringify({ version: 1, records: changes }));
  const set = store.setItem;
  store.setItem = (key, value) => {
    set(key, value);
    if (key === 'jipage_settings_v1') set('jipage_library_v2', 'concurrent');
  };
  assert.throws(() => recoverRestoreRecords(store), /RESTORE_RECOVERY_REQUIRED/);
  assert.equal(store.getItem('jipage_library_v2'), 'concurrent');
  assert.ok(store.getItem(RESTORE_JOURNAL));
});

test('changing ordinary preferences on a fresh install still permits an empty workbench backup', () => {
  const { store, manager } = setup();
  manager.saveUserSettings({ appearanceMode: 'dark-glass' });
  const before = store.getItem('jipage_settings_v1');
  const backup = parseWorkbench(manager.exportWorkbenchBackup());
  assert.deepEqual(backup.taskbar, []);
  assert.equal(backup.assets.bookmarks.length, 0);
  assert.equal(store.getItem('jipage_settings_v1'), before, 'Backup does not repair or rewrite settings');
});

test('legacy taskbar demo defaults do not invalidate actual pins while corrupt explicit pins still fail', () => {
  const { store, manager } = setup();
  store.setItem('jipage_bookmarks_v1', JSON.stringify(assets.bookmarks));
  manager.saveUserSettings({ language: 'en' });
  const settings = JSON.parse(store.getItem('jipage_settings_v1')!);
  settings.dockBookmarkIds.push('bm');
  store.setItem('jipage_settings_v1', JSON.stringify(settings));
  assert.deepEqual(parseWorkbench(manager.exportWorkbenchBackup()).taskbar, ['bm']);
  const pinManager = new StorageManager();
  const pins = pinManager.getUserSettings().dockBookmarkIds!;
  pinManager.saveUserSettings({ dockBookmarkIds: [...pins] });
  assert.deepEqual(parseWorkbench(manager.exportWorkbenchBackup()).taskbar, ['bm'], 'An explicit pin saves inherited demo placeholders too');
  store.setItem('jipage_library_v2', JSON.stringify({ version: 1, ...assets, dockBookmarkIds: ['unknown-pin'] }));
  assert.throws(() => manager.exportWorkbenchBackup());
});

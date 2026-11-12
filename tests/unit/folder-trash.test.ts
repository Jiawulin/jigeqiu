import assert from 'node:assert/strict';
import test from 'node:test';
import { StorageManager } from '../../src/services/storage';
import { MemoryStorage } from '../support/memory-storage';

const key = 'jipage_library_v2';
function setup() {
  const memory = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memory });
  const manager = new StorageManager();
  const parent = manager.createFolder('Parent');
  const folder = manager.createFolder('Work', [], parent.id);
  const child = manager.createFolder('Nested', [], folder.id);
  manager.createFolder('Empty', [], child.id);
  const add = (title: string, folderId: string) => manager.saveManualBookmark({
    title, url: `https://${title.toLowerCase()}.example/`, domain: 'example',
    folderId, category: '', order: 1, pinnedToDesktop: false, collectionIds: [], keywords: ['kept'],
  });
  const first = add('First', folder.id);
  const second = add('Second', child.id);
  manager.executeDesktop([
    { type: 'desktop.pin', bookmarkId: first.id, shortcutId: 'pinned', to: { kind: 'root', index: 0 } },
    { type: 'desktop.pin', bookmarkId: second.id, shortcutId: 'nested-shortcut', to: { kind: 'root', index: 1 } },
    { type: 'desktop.folder.create', id: 'desktop-parent', name: 'Parent',
      shortcutIds: ['pinned', 'nested-shortcut'], index: 0 },
  ]);
  manager.saveUserSettings({ dockBookmarkIds: [second.id] });
  return { memory, manager, parent, folder, child, first, second };
}

test('dissolve only removes the chosen directory, lifts immediate children and writes once', () => {
  const { memory, manager, parent, folder, child, first, second } = setup();
  const layout = manager.getDesktopLayout();
  const original = memory.setItem.bind(memory);
  let writes = 0;
  memory.setItem = (k, v) => { writes++; original(k, v); };
  manager.deleteFolder(folder.id);
  assert.equal(writes, 1);
  assert.equal(manager.getFolders().some(item => item.id === folder.id), false);
  assert.equal(manager.getFolders().find(item => item.id === child.id)?.parentId, parent.id);
  assert.equal(manager.getBookmarks().find(item => item.id === first.id)?.folderId, parent.id);
  assert.equal(manager.getBookmarks().find(item => item.id === second.id)?.folderId, child.id);
  assert.deepEqual(manager.getFolders().find(item => item.id === parent.id)?.bookmarkIds, [first.id]);
  assert.deepEqual(manager.getDesktopLayout(), layout);
  assert.deepEqual(manager.getUserSettings().dockBookmarkIds, [second.id]);
});

test('trash subtree is one atomic batch including empty descendants, restoration keeps identities but not shortcuts', () => {
  const { memory, manager, parent, folder, first, second } = setup();
  const before = manager.readLibrary();
  const original = memory.setItem.bind(memory);
  let writes = 0;
  memory.setItem = (k, v) => { writes++; original(k, v); };
  manager.trashFolder(folder.id);
  assert.equal(writes, 1);
  assert.deepEqual(manager.getBookmarks(), []);
  assert.deepEqual(manager.getFolders().map(item => item.id), [parent.id]);
  const entry = manager.getFolderTrash()[0];
  assert.equal(entry.folders.length, 3);
  assert.equal(entry.bookmarks.length, 2);
  assert.deepEqual(manager.getUserSettings().dockBookmarkIds, []);
  assert.deepEqual(manager.getDesktopLayout()?.shortcuts, []);
  manager.restoreTrashedFolder(entry.id);
  assert.deepEqual(manager.getFolders().map(item => item.id), before.folders.map(item => item.id));
  assert.deepEqual(manager.getBookmarks().map(item => item.id), before.bookmarks.map(item => item.id));
  assert.deepEqual(manager.getBookmarks().map(item => item.keywords), [['kept'], ['kept']]);
  assert.equal(manager.getBookmarks().some(item => item.pinnedToDesktop), false);
  assert.deepEqual(manager.getDesktopLayout()?.shortcuts, []);
  assert.deepEqual(manager.getUserSettings().dockBookmarkIds, []);
  assert.deepEqual(manager.getFolderTrash(), []);
  assert.ok(manager.getBookmarks().find(item => item.id === first.id));
  assert.ok(manager.getBookmarks().find(item => item.id === second.id));
});

test('restore missing parent to root and purge only the requested folder batch', () => {
  const { manager, parent, folder } = setup();
  manager.trashFolder(folder.id);
  manager.deleteFolder(parent.id);
  manager.restoreTrashedFolder(manager.getFolderTrash()[0].id);
  assert.equal(manager.getFolders().find(item => item.id === folder.id)?.parentId, undefined);
  manager.trashFolder(folder.id);
  manager.purgeTrashedFolder(manager.getFolderTrash()[0].id);
  assert.deepEqual(manager.getFolderTrash(), []);
  assert.deepEqual(manager.getBookmarks(), []);
});

test('dissolve/trash/restore/purge write failures preserve every persisted byte and allow retries', () => {
  for (const kind of ['dissolve', 'trash', 'restore', 'purge']) {
    const { manager, memory, folder } = setup();
    if (kind === 'restore' || kind === 'purge') manager.trashFolder(folder.id);
    const action = kind === 'dissolve' ? () => manager.deleteFolder(folder.id)
      : kind === 'trash' ? () => manager.trashFolder(folder.id)
      : kind === 'restore' ? () => manager.restoreTrashedFolder(manager.getFolderTrash()[0].id)
      : () => manager.purgeTrashedFolder(manager.getFolderTrash()[0].id);
    const before = memory.getItem(key);
    memory.failWrites = true;
    assert.throws(action);
    assert.equal(memory.getItem(key), before);
    memory.failWrites = false;
    action();
  }
});

test('stale trash reader and duplicate restoration refuse without losing the batch', () => {
  const { manager, memory, folder, first } = setup();
  const stale = new StorageManager();
  stale.getFolderTrash();
  manager.trashFolder(folder.id);
  const raw = memory.getItem(key);
  assert.throws(() => stale.purgeTrashedFolder(manager.getFolderTrash()[0].id), /CONFLICT/);
  assert.equal(memory.getItem(key), raw);
  manager.saveManualBookmark({ ...first, folderId: undefined });
  const before = memory.getItem(key);
  assert.throws(() => manager.restoreTrashedFolder(manager.getFolderTrash()[0].id), /DUPLICATE/);
  assert.equal(memory.getItem(key), before);
});

test('ordinary JSON excludes folder trash but unrelated edits and imports preserve it', () => {
  const { manager, folder } = setup();
  manager.trashFolder(folder.id);
  const trash = manager.getFolderTrash();
  const json = manager.exportJsonBackup();
  assert.ok(!json.includes('First'));
  manager.commitJsonAssetImport(manager.previewJsonAssetImport(json));
  manager.createFolder('Unrelated');
  assert.deepEqual(manager.getFolderTrash(), trash);
});

test('unrelated malformed legacy URLs do not prevent atomic folder restoration', () => {
  const { manager, folder, first } = setup();
  manager.trashFolder(folder.id);
  const legacy = manager.addBookmark({ ...first, url: 'https://', folderId: undefined });
  manager.restoreTrashedFolder(manager.getFolderTrash()[0].id);
  const fresh = new StorageManager();
  assert.ok(fresh.getFolders().some(item => item.id === folder.id));
  assert.ok(fresh.getBookmarks().some(item => item.id === first.id));
  assert.equal(fresh.getBookmarks().find(item => item.id === legacy.id)?.url, 'https://');
  assert.deepEqual(fresh.getFolderTrash(), []);
});

test('corrupt folder trash and invalid legacy subtree cannot be persisted', () => {
  const { manager, memory, folder, first } = setup();
  manager.updateBookmark(first.id, { url: 'file:///unsafe' });
  const before = memory.getItem(key);
  assert.throws(() => manager.trashFolder(folder.id));
  assert.equal(memory.getItem(key), before);
  const data = JSON.parse(before!);
  data.folderTrash = [{ id: 'broken' }];
  memory.setItem(key, JSON.stringify(data));
  assert.throws(() => new StorageManager().getFolderTrash(), /CORRUPT_DATA/);
  assert.throws(() => manager.createFolder('No write'), /CORRUPT_DATA/);
});

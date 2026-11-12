import assert from 'node:assert/strict';
import test from 'node:test';
import { StorageManager } from '../../src/services/storage';
import { MemoryStorage } from '../support/memory-storage';

const key = 'jipage_library_v2';
function setup() {
  const memory = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memory });
  const manager = new StorageManager();
  const folder = manager.createFolder('Archive');
  const bookmark = manager.saveManualBookmark({
    title: 'Keep', url: 'https://keep.example/', domain: 'keep.example', category: 'cat-inbox',
    order: 1, collectionIds: [], keywords: ['work'], pinnedToDesktop: false, folderId: folder.id,
  });
  manager.executeDesktop([
    { type: 'desktop.pin', bookmarkId: bookmark.id, shortcutId: 'shortcut', to: { kind: 'root', index: 0 } },
    { type: 'desktop.folder.create', id: 'desktop-archive', name: 'Archive', shortcutIds: ['shortcut'], index: 0 },
  ]);
  manager.saveUserSettings({ dockBookmarkIds: [bookmark.id] });
  return { memory, manager, folder, bookmark };
}
test('delete atomically trashes bookmark and removes archive, desktop and legacy Dock references', () => {
  const { memory, manager, bookmark } = setup();
  const original = memory.setItem.bind(memory);
  let writes = 0;
  memory.setItem = (key, value) => { writes++; original(key, value); };
  manager.deleteBookmark(bookmark.id);
  assert.equal(writes, 1);
  assert.deepEqual(manager.getBookmarks(), []);
  assert.deepEqual(manager.getFolders()[0].bookmarkIds, []);
  assert.deepEqual(manager.getDesktopLayout()?.shortcuts, []);
  assert.deepEqual(manager.getUserSettings().dockBookmarkIds, []);
  assert.equal(manager.getBookmarkTrash()[0].bookmark.id, bookmark.id);
});
test('restore preserves identity/keywords and original folder but never shortcuts or Dock', () => {
  const { manager, bookmark, folder } = setup();
  manager.deleteBookmark(bookmark.id);
  const entry = manager.getBookmarkTrash()[0];
  manager.restoreTrashedBookmark(entry.id);
  const fresh = new StorageManager();
  assert.equal(fresh.getBookmarks()[0].id, bookmark.id);
  assert.equal(fresh.getBookmarks()[0].folderId, folder.id);
  assert.deepEqual(fresh.getBookmarks()[0].keywords, ['work']);
  assert.deepEqual(fresh.getDesktopLayout()?.shortcuts, []);
  assert.deepEqual(fresh.getUserSettings().dockBookmarkIds, []);
  assert.deepEqual(fresh.getBookmarkTrash(), []);
  fresh.saveUserSettings({ dockBookmarkIds: [bookmark.id] });
  assert.deepEqual(new StorageManager().getUserSettings().dockBookmarkIds, [bookmark.id]);
});
test('restore to root when original folder is missing, then permanent purge removes only trash', () => {
  const { manager, bookmark } = setup();
  manager.deleteBookmark(bookmark.id);
  manager.saveFolders([]);
  manager.restoreTrashedBookmark(manager.getBookmarkTrash()[0].id);
  assert.equal(manager.getBookmarks()[0].folderId, undefined);
  manager.deleteBookmark(bookmark.id);
  manager.purgeTrashedBookmark(manager.getBookmarkTrash()[0].id);
  assert.deepEqual(manager.getBookmarkTrash(), []);
  assert.deepEqual(manager.getBookmarks(), []);
});
test('failed delete, restore and purge preserve all persisted bytes and can retry', () => {
  const { manager, memory, bookmark } = setup();
  for (const operation of [
    () => manager.deleteBookmark(bookmark.id),
    () => manager.restoreTrashedBookmark(manager.getBookmarkTrash()[0].id),
    () => manager.purgeTrashedBookmark(manager.getBookmarkTrash()[0].id),
  ]) {
    const before = memory.getItem(key);
    memory.failWrites = true;
    assert.throws(operation);
    assert.equal(memory.getItem(key), before);
    memory.failWrites = false;
    operation();
    if (manager.getBookmarks().length) manager.deleteBookmark(bookmark.id);
  }
});
test('duplicate URL restoration is rejected without losing the trash entry', () => {
  const { manager, memory, bookmark } = setup();
  manager.deleteBookmark(bookmark.id);
  manager.saveManualBookmark({ ...bookmark, folderId: undefined });
  const before = memory.getItem(key);
  assert.throws(() => manager.restoreTrashedBookmark(manager.getBookmarkTrash()[0].id), /DUPLICATE/);
  assert.equal(memory.getItem(key), before);
});

test('an unrelated unsupported legacy URL cannot prevent restoring a valid bookmark', () => {
  const { manager, bookmark } = setup();
  manager.deleteBookmark(bookmark.id);
  const legacy = manager.addBookmark({
    ...bookmark, title: 'Legacy local document', url: 'file:///legacy-document', folderId: undefined,
  });
  const entry = manager.getBookmarkTrash()[0];
  manager.restoreTrashedBookmark(entry.id);
  const fresh = new StorageManager();
  assert.ok(fresh.getBookmarks().some(item => item.id === bookmark.id));
  assert.equal(fresh.getBookmarks().find(item => item.id === legacy.id)?.url, 'file:///legacy-document');
  assert.deepEqual(fresh.getBookmarkTrash(), []);
});

test('trash is excluded from ordinary export and survives JSON imports and unrelated edits', () => {
  const { manager, memory, bookmark } = setup();
  manager.deleteBookmark(bookmark.id);
  const before = manager.getBookmarkTrash();
  const exported = manager.exportJsonBackup();
  assert.ok(!exported.includes(bookmark.url));
  manager.commitJsonAssetImport(manager.previewJsonAssetImport(exported));
  manager.createFolder('Unrelated');
  assert.deepEqual(manager.getBookmarkTrash(), before);
  assert.equal(JSON.parse(memory.getItem(key)!).bookmarkTrash.length, 1);
});

test('collection snapshots survive but bookmark associations stay detached after restoration', () => {
  const { memory, bookmark } = setup();
  const data = JSON.parse(memory.getItem(key)!);
  const collection = { id: 'collection', title: 'Independent', items: [{
    bookmarkId: bookmark.id, title: bookmark.title, url: bookmark.url, recommendationReason: 'Keep snapshot',
  }], assetContent: { sections: [{ id: 'section', title: 'Section', items: [{
    id: 'entry', bookmarkId: bookmark.id, title: bookmark.title, url: bookmark.url,
  }] }] } };
  data.collections = [collection];
  memory.setItem(key, JSON.stringify(data));
  const manager = new StorageManager();
  manager.deleteBookmark(bookmark.id);
  const detached = structuredClone(collection);
  detached.items[0].bookmarkId = '';
  detached.assetContent.sections[0].items[0].bookmarkId = null as any;
  assert.deepEqual(JSON.parse(memory.getItem(key)!).collections, [detached]);
  manager.restoreTrashedBookmark(manager.getBookmarkTrash()[0].id);
  assert.deepEqual(JSON.parse(memory.getItem(key)!).collections, [detached]);
  manager.deleteBookmark(bookmark.id);
  manager.purgeTrashedBookmark(manager.getBookmarkTrash()[0].id);
  assert.deepEqual(JSON.parse(memory.getItem(key)!).collections, [detached]);
});

test('unsupported legacy URLs refuse deletion before writing an unreadable envelope', () => {
  const { manager, memory, bookmark } = setup();
  manager.updateBookmark(bookmark.id, { url: 'file:///legacy-document' });
  const before = memory.getItem(key);
  assert.throws(() => manager.deleteBookmark(bookmark.id), /CORRUPT_DATA|UNSUPPORTED_URL/);
  assert.equal(memory.getItem(key), before);
  assert.equal(new StorageManager().getBookmarks().length, 1);
});

test('restoration returns a bookmark to its original array position as well as folder position', () => {
  const { manager, bookmark, folder } = setup();
  manager.saveManualBookmark({ ...bookmark, title: 'After', url: 'https://after.example/', folderId: folder.id });
  const before = manager.getBookmarks().map(item => item.id);
  manager.deleteBookmark(bookmark.id);
  manager.restoreTrashedBookmark(manager.getBookmarkTrash()[0].id);
  assert.deepEqual(manager.getBookmarks().map(item => item.id), before);
});

test('a stale settings reader cannot overwrite a newer Dock even without an upgraded desktop', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });
  const first = new StorageManager();
  const second = new StorageManager();
  first.getUserSettings();
  second.getUserSettings();
  first.saveUserSettings({ dockBookmarkIds: ['first'] });
  assert.throws(() => second.saveUserSettings({ dockBookmarkIds: ['second'] }), /CONFLICT/);
  assert.deepEqual(new StorageManager().getUserSettings().dockBookmarkIds, ['first']);
});

test('trash rejects malformed searchable text fields and invalid HTTP URLs', () => {
  const { manager, memory, bookmark } = setup();
  manager.deleteBookmark(bookmark.id);
  const valid = JSON.parse(memory.getItem(key)!);
  for (const patch of [{ notes: 7 }, { tags: [3] }, { url: 'https://' }]) {
    const data = structuredClone(valid);
    Object.assign(data.bookmarkTrash[0].bookmark, patch);
    memory.setItem(key, JSON.stringify(data));
    assert.throws(() => new StorageManager().getBookmarkTrash(), /CORRUPT_DATA/);
  }
});

test('corrupt trash refuses reading or writes instead of silently discarding recovery data', () => {
  const { manager, memory } = setup();
  const data = JSON.parse(memory.getItem(key)!);
  data.bookmarkTrash = [{ id: 'broken' }];
  const raw = JSON.stringify(data);
  memory.setItem(key, raw);
  assert.throws(() => new StorageManager().getBookmarkTrash(), /CORRUPT_DATA/);
  assert.throws(() => manager.createFolder('Must not write'), /CORRUPT_DATA/);
  assert.equal(memory.getItem(key), raw);
});

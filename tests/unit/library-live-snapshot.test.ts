import assert from 'node:assert/strict';
import test from 'node:test';
import { StorageManager } from '../../src/services/storage';
import { MemoryStorage } from '../support/memory-storage';
import { configureApplicationStorage } from '../../src/services/application-storage';

test('accepting a fresh snapshot updates all baselines without any writes', () => {
  const memory = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memory });
  const first = new StorageManager();
  first.getBookmarks(); first.getFolders(); first.getDesktopLayout();
  const other = new StorageManager();
  other.createFolder('Remote folder');
  assert.equal(first.hasLibraryChanges(), true);
  const before = memory.getItem('jipage_library_v2');
  const snapshot = first.acceptLibrarySnapshot();
  assert.equal(snapshot.folders[0].name, 'Remote folder');
  assert.equal(first.hasLibraryChanges(), false);
  assert.equal(memory.getItem('jipage_library_v2'), before);
  assert.doesNotThrow(() => first.createFolder('Local after sync'));
});

test('invalid remote snapshots do not advance previously rendered baselines', () => {
  const memory = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memory });
  const first = new StorageManager();
  first.createFolder('Existing');
  memory.setItem('jipage_library_v2', '{"version":999}');
  assert.throws(() => first.acceptLibrarySnapshot());
  assert.equal(first.hasLibraryChanges(), true);
});

test('a queued mutation keeps its baseline until it settles', async () => {
  const memory = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memory });
  const first = new StorageManager();
  first.getBookmarks();
  const other = new StorageManager();
  other.createFolder('Remote while waiting');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  configureApplicationStorage({ storage: memory as Storage, async mutate(action) {
    await gate;
    return action();
  } });
  try {
    const waiting = first.mutate(() => first.createFolder('Queued local write'));
    assert.throws(() => first.acceptLibrarySnapshot(), /CONFLICT/);
    release();
    await assert.rejects(waiting, /CONFLICT/);
    assert.equal(first.acceptLibrarySnapshot().folders[0].name, 'Remote while waiting');
  } finally {
    release();
    configureApplicationStorage(undefined);
  }
});

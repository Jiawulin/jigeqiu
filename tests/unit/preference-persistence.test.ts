import assert from 'node:assert/strict';
import test from 'node:test';
import { StorageManager } from '../../src/services/storage';
import { DEFAULT_SEARCH_ENGINES } from '../../src/data/defaultData';
import { MemoryStorage } from '../support/memory-storage';

function setup() {
  const memory = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memory });
  return { memory, manager: new StorageManager() };
}

test('fresh settings follow browser preferences without persisting a detected default', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true, value: { languages: ['fr-FR', 'en-GB'], language: 'fr-FR' },
    });
    const { memory, manager } = setup();
    assert.equal(manager.getUserSettings().language, 'en');
    assert.equal(memory.getItem('jipage_settings_v1'), null);
    memory.setItem('jipage_settings_v1', '{"language":"zh","showDock":false}');
    assert.equal(manager.getUserSettings().language, 'zh');
    assert.equal(manager.getUserSettings().showDock, false);
    assert.equal(memory.getItem('jipage_settings_v1'), '{"language":"zh","showDock":false}');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true, value: { languages: [], language: 'en-AU' },
    });
    memory.removeItem('jipage_settings_v1');
    assert.equal(manager.getUserSettings().language, 'en');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

test('settings write denial propagates and preserves previously saved preferences', () => {
  const { memory, manager } = setup();
  manager.saveUserSettings({ language: 'zh' });
  const before = memory.getItem('jipage_settings_v1');
  memory.failWrites = true;
  assert.throws(() => manager.saveUserSettings({ language: 'en' }),
    (error: unknown) => error instanceof DOMException && error.name === 'SecurityError');
  assert.equal(memory.getItem('jipage_settings_v1'), before);
});

test('search engine creation reports quota failure without mutating shared defaults', () => {
  const { memory, manager } = setup();
  const before = JSON.stringify(DEFAULT_SEARCH_ENGINES);
  memory.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  assert.throws(() => manager.createSearchEngine('Draft', '/draft', 'https://draft.example/?q={query}'),
    (error: unknown) => error instanceof DOMException && error.name === 'QuotaExceededError');
  assert.equal(JSON.stringify(DEFAULT_SEARCH_ENGINES), before);
  assert.equal(memory.getItem('jipage_search_engines_v1'), null);
});

test('updating a default engine on failed save does not mutate the fallback array', () => {
  const { memory, manager } = setup();
  const before = JSON.stringify(DEFAULT_SEARCH_ENGINES);
  memory.failWrites = true;
  assert.throws(() => manager.updateSearchEngine(DEFAULT_SEARCH_ENGINES[0].id, { name: 'Not saved' }));
  assert.equal(JSON.stringify(DEFAULT_SEARCH_ENGINES), before);
});

test('settings and engine writes verify readback and surface uncertain outcomes', () => {
  for (const key of ['jipage_settings_v1', 'jipage_search_engines_v1']) {
    const { memory, manager } = setup();
    const original = memory.setItem.bind(memory);
    memory.setItem = (name, value) => { original(name, `${value} `); };
    assert.throws(() => key === 'jipage_settings_v1'
      ? manager.saveUserSettings({ language: 'en' })
      : manager.saveSearchEngines([]), /COMMIT_UNCERTAIN/);
  }
});

test('successful preference saves survive a fresh manager without changing library bytes', () => {
  const { memory, manager } = setup();
  manager.createFolder('Keep');
  const before = memory.getItem('jipage_library_v2');
  manager.saveUserSettings({ language: 'en', showDock: false });
  manager.createSearchEngine('Saved', '/saved', 'https://saved.example/?q={query}');
  const fresh = new StorageManager();
  assert.equal(fresh.getUserSettings().language, 'en');
  assert.equal(fresh.getUserSettings().showDock, false);
  assert.ok(fresh.getSearchEngines().some(engine => engine.name === 'Saved'));
  assert.equal(memory.getItem('jipage_library_v2'), before);
});

test('wallpaper always covers without rewriting legacy or invalid preferences', () => {
  for (const fit of [undefined, 'contain', 'cover', 'stretch', null, 12, { size: 'cover' }]) {
    const { memory, manager } = setup();
    memory.setItem('jipage_settings_v1', JSON.stringify({
      wallpaperPreset: 'custom', customWallpaperId: 'kept', customWallpaperFit: fit,
    }));
    const before = memory.getItem('jipage_settings_v1');
    assert.equal(manager.getUserSettings().customWallpaperFit, 'cover');
    assert.equal(memory.getItem('jipage_settings_v1'), before);
  }
});

test('legacy fitting cannot change cover behavior or image and bookmark assets', () => {
  const { memory, manager } = setup();
  manager.createFolder('Keep');
  manager.saveUserSettings({ wallpaperPreset: 'custom', customWallpaperId: 'kept' });
  const before = memory.getItem('jipage_library_v2');
  for (const fit of ['cover', 'contain'] as const) {
    manager.saveUserSettings({ customWallpaperFit: fit });
    const fresh = new StorageManager().getUserSettings();
    assert.equal(fresh.customWallpaperFit, 'cover');
    assert.equal(fresh.customWallpaperId, 'kept');
    assert.equal(fresh.wallpaperPreset, 'custom');
    assert.equal(memory.getItem('jipage_library_v2'), before);
  }
});

test('taskbar write succeeds but subsequent baseline read fails: report uncertain, not unsaved', () => {
  const { memory, manager } = setup();
  const set = memory.setItem.bind(memory);
  const get = memory.getItem.bind(memory);
  let readsAfterWrite = -1;
  memory.setItem = (name, value) => { set(name, value); readsAfterWrite = 0; };
  memory.getItem = name => {
    if (readsAfterWrite >= 0 && ++readsAfterWrite === 2) {
      throw new DOMException('Baseline blocked', 'SecurityError');
    }
    return get(name);
  };
  assert.throws(() => manager.saveUserSettings({ dockBookmarkIds: ['kept'] }), /COMMIT_UNCERTAIN/);
  assert.deepEqual(JSON.parse(get('jipage_library_v2')!).dockBookmarkIds, ['kept']);
});

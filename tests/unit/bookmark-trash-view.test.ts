import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { afterEach, beforeEach } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import type { Bookmark, Folder } from '../../src/types';
import type { BookmarkTrashViewProps } from '../../src/components/account/BookmarkTrashView';
import { preferenceSaveError } from '../../src/services/preference-save-error';

const noop = () => {};
let previousNavigator: PropertyDescriptor | undefined;
beforeEach(() => {
  previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    locks: { request: (_name: string, action: () => unknown) => Promise.resolve(action()) },
  } });
});
afterEach(() => {
  if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
  else Reflect.deleteProperty(globalThis, 'navigator');
});
const bookmark: Bookmark = {
  id: 'bookmark', title: 'Example tools', url: 'https://example.com/tools',
  domain: 'example.com', category: '', keywords: ['Needle'], tags: ['Research'],
  notes: 'Saved reference', folderId: 'work', pinnedToDesktop: false,
  order: 0, collectionIds: [], createdAt: 1, updatedAt: 1,
};
const folder: Folder = {
  id: 'work', name: 'Work', bookmarkIds: ['bookmark'], pinnedToDesktop: false,
  order: 0, createdAt: 1, updatedAt: 1,
};
const entry = { id: 'trash-entry', deletedAt: Date.UTC(2026, 9, 28, 12), bookmark, folderIndex: 0 };
const defaults: BookmarkTrashViewProps = { entries: [entry], folders: [folder], onRestore: noop, onPurge: noop };

// Follow the existing Node-only UI tests: real JSX/callbacks, in-memory hook state.
function harness(overrides: Partial<BookmarkTrashViewProps> = {}) {
  const path = new URL('../../src/components/account/BookmarkTrashView.tsx', import.meta.url);
  const require = createRequire(path);
  const state: unknown[] = [];
  const cleanups: Array<() => void> = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value: any) => {
        state[index] = typeof value === 'function' ? value(state[index]) : value;
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useMemo: (compute: () => unknown) => compute(),
    useEffect(effect: () => void | (() => void)) {
      const index = cursor++;
      if (index in state) return;
      state[index] = true;
      const cleanup = effect();
      if (cleanup) cleanups.push(cleanup);
    },
  };
  const compiled = transformSync(readFileSync(path, 'utf8'), { loader: 'tsx', format: 'cjs' }).code;
  const module = { exports: {} as { BookmarkTrashView: (props: object) => React.ReactElement } };
  new Function('require', 'module', 'exports', compiled)(
    (id: string) => id === 'react' ? hooks : require(id), module, module.exports,
  );
  const props = { ...defaults, ...overrides };
  return {
    props,
    render() { cursor = 0; return module.exports.BookmarkTrashView(props); },
    unmount() { cleanups.splice(0).forEach(cleanup => cleanup()); },
  };
}

function elements(tree: React.ReactNode): React.ReactElement<any>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return [];
  return [tree, ...elements(tree.props.children)];
}
const html = (view: ReturnType<typeof harness>) => renderToStaticMarkup(view.render());
function button(view: ReturnType<typeof harness>, label: string) {
  const node = elements(view.render()).find(node => node.type === 'button' && node.props['aria-label'] === label);
  assert.ok(node, `Missing button: ${label}`);
  return node;
}
function modal(view: ReturnType<typeof harness>) {
  const node = elements(view.render()).find(node =>
    typeof node.type === 'function' && node.type.name === 'Modal');
  assert.ok(node);
  return node;
}

test('shows bookmark, original folder and deletion time; missing folders fall back to root', () => {
  const view = harness({ language: 'en-US' });
  assert.match(html(view), /Example tools/);
  assert.match(html(view), /https:\/\/example.com\/tools/);
  assert.match(html(view), /Work/);
  assert.match(html(view), /<time[^>]*dateTime="2026-10-28T12:00:00.000Z"/);
  view.props.folders = [];
  assert.match(html(view), /Root folder/);
  assert.doesNotMatch(html(view), />Work</);
});

test('search matches title, URL and keywords case-insensitively and has a distinct no-result state', () => {
  const view = harness({ language: 'en' });
  for (const query of [' EXAMPLE TOOLS ', 'example.com/tools', 'nEeDlE', 'Research', 'Saved reference']) {
    elements(view.render()).find(node => node.type === 'input')!.props.onChange({ target: { value: query } });
    assert.match(html(view), /Example tools/);
  }
  elements(view.render()).find(node => node.type === 'input')!.props.onChange({ target: { value: 'unmatched' } });
  assert.doesNotMatch(html(view), /Example tools/);
  assert.match(html(view), /No matching bookmarks/);
});

test('empty state is localized with no bulk or automatic cleanup actions', () => {
  const zh = html(harness({ entries: [] }));
  assert.match(zh, /回收站为空/);
  assert.doesNotMatch(zh, /清空|批量|自动清理/);
  const en = html(harness({ entries: [], language: 'en-US' }));
  assert.match(en, /Trash is empty/);
  assert.doesNotMatch(en, /Clear all|Delete all|Automatically/);
});

test('trash paginates bookmarks and folder batches together and resets search/page size', () => {
  const entries = Array.from({ length: 16 }, (_, index) => ({
    ...entry, id: `entry-${index}`, bookmark: { ...bookmark, id: `bm-${index}`, title: `Bookmark ${index}` },
  }));
  const view = harness({ entries });
  assert.equal(elements(view.render()).filter(node => node.type === 'li').length, 15);
  const pagination = () => {
    const node = elements(view.render()).find(node => typeof node.type === 'function' && node.type.name === 'Pagination');
    assert.ok(node, 'Trash must use the shared Pagination component');
    return node;
  };
  assert.equal(pagination().props.total, 16);
  pagination().props.onPageChange(2);
  assert.equal(elements(view.render()).filter(node => node.type === 'li').length, 1);
  elements(view.render()).find(node => node.type === 'input')!.props.onChange({ target: { value: 'Bookmark 0' } });
  assert.equal(pagination().props.page, 1);
  assert.equal(pagination().props.total, 1);
  elements(view.render()).find(node => node.type === 'input')!.props.onChange({ target: { value: '' } });
  pagination().props.onPageChange(2);
  pagination().props.onPageSizeChange(30);
  assert.equal(pagination().props.page, 1);
  assert.equal(elements(view.render()).filter(node => node.type === 'li').length, 16);
});

test('shrinking trash clamps the current page without hiding remaining entries', () => {
  const entries = Array.from({ length: 16 }, (_, index) => ({
    ...entry, id: `entry-${index}`, bookmark: { ...bookmark, id: `bm-${index}` },
  }));
  const view = harness({ entries });
  const pagination = () => elements(view.render()).find(node =>
    typeof node.type === 'function' && node.type.name === 'Pagination')!;
  assert.ok(pagination(), 'Expected shared pagination');
  pagination().props.onPageChange(2);
  view.props.entries = entries.slice(0, 15);
  assert.equal(pagination().props.page, 1);
  assert.equal(elements(view.render()).filter(node => node.type === 'li').length, 15);
});

test('restore awaits persistence, prevents duplicate submissions, and keeps parent-owned entries', async () => {
  const calls: string[] = [];
  let finish!: () => void;
  const view = harness({ language: 'en', onRestore: (id: string) => {
    calls.push(id);
    return new Promise<void>(resolve => { finish = resolve; });
  } });
  const restore = button(view, 'Restore bookmark');
  const first = restore.props.onClick();
  await restore.props.onClick();
  assert.deepEqual(calls, ['trash-entry']);
  assert.equal(button(view, 'Permanently delete bookmark').props.disabled, true);
  finish();
  await first;
  assert.match(html(view), /Example tools/);
  view.props.entries = [];
  assert.match(html(view), /Trash is empty/);
});

test('restore rejection shows an error, preserves the row and permits retry', async () => {
  let fail = true;
  const view = harness({ onRestore: () => { if (fail) throw new Error('disk failed'); } });
  await button(view, '恢复收藏').props.onClick();
  assert.match(html(view), /role="alert"/);
  assert.match(html(view), /恢复失败/);
  assert.match(html(view), /Example tools/);
  assert.equal(button(view, '恢复收藏').props.disabled, false);
  fail = false;
  await button(view, '恢复收藏').props.onClick();
  assert.doesNotMatch(html(view), /role="alert"/);
});

for (const language of ['zh', 'en']) {
  test(`duplicate restoration explains the conflict instead of suggesting blind retry (${language})`, async () => {
    const view = harness({ language, onRestore: () => { throw new Error('DUPLICATE'); } });
    await button(view, language === 'en' ? 'Restore bookmark' : '恢复收藏').props.onClick();
    assert.match(html(view), language === 'en' ? /same URL or ID/ : /相同网址或标识/);
    assert.match(html(view), /Example tools/);
    assert.doesNotMatch(html(view), language === 'en' ? /Please try again/ : /请重试/);
  });
  test(`folder duplicate restoration explains that the entire batch is retained (${language})`, async () => {
    const view = harness({ language, entries: [], folderEntries: [folderBatch],
      onRestoreFolder: () => { throw { code: 'DUPLICATE' }; } });
    await button(view, language === 'en' ? 'Restore folder' : '恢复目录').props.onClick();
    assert.match(html(view), language === 'en' ? /entire folder batch remains in Trash/ : /整个目录批次仍保留在回收站/);
    assert.match(html(view), /Archived projects/);
  });
}

test('purge requires a contained confirmation, warns that it cannot be undone, and supports cancellation', () => {
  const purged: string[] = [];
  const view = harness({ language: 'en', onPurge: id => { purged.push(id); } });
  button(view, 'Permanently delete bookmark').props.onClick();
  assert.deepEqual(purged, []);
  assert.equal(modal(view).props.isOpen, true);
  assert.equal(modal(view).props.contained, true);
  assert.match(html(view), /cannot be undone/i);
  button(view, 'Cancel').props.onClick();
  assert.equal(modal(view).props.isOpen, false);
  assert.deepEqual(purged, []);
});

test('purge failure stays in confirmation with the entry intact; retry closes only after success', async () => {
  const purged: string[] = [];
  let fail = true;
  const view = harness({ language: 'en', onPurge: async id => {
    purged.push(id);
    if (fail) throw new Error('disk failed');
  } });
  button(view, 'Permanently delete bookmark').props.onClick();
  await button(view, 'Confirm permanent deletion').props.onClick();
  assert.equal(modal(view).props.isOpen, true);
  assert.match(html(view), /role="alert"/);
  assert.match(html(view), /Deletion failed/);
  assert.match(html(view), /Example tools/);
  fail = false;
  await button(view, 'Confirm permanent deletion').props.onClick();
  assert.deepEqual(purged, ['trash-entry', 'trash-entry']);
  assert.equal(modal(view).props.isOpen, false);
});

test('a removed confirmation target cannot be purged and pending confirmation cannot be dismissed', async () => {
  let finish!: () => void;
  const view = harness({ language: 'en', onPurge: () => new Promise<void>(resolve => { finish = resolve; }) });
  button(view, 'Permanently delete bookmark').props.onClick();
  const pending = button(view, 'Confirm permanent deletion').props.onClick();
  modal(view).props.onClose();
  assert.equal(modal(view).props.isOpen, true);
  finish();
  await pending;
  button(view, 'Permanently delete bookmark').props.onClick();
  view.props.entries = [];
  assert.equal(modal(view).props.isOpen, false);
});

const folderBatch = {
  id: 'folder-trash', deletedAt: entry.deletedAt, rootId: 'root',
  folders: [
    { folder: { ...folder, id: 'child', name: 'Nested resources', parentId: 'root' }, index: 0 },
    { folder: { ...folder, id: 'root', name: 'Archived projects', parentId: 'work' }, index: 1 },
  ],
  bookmarks: [{ bookmark, index: 0 }],
};

test('folder batches share the same page limit as individual bookmarks', () => {
  const entries = Array.from({ length: 14 }, (_, index) => ({
    ...entry, id: `entry-${index}`, bookmark: { ...bookmark, id: `bm-${index}` },
  }));
  const view = harness({ entries, folderEntries: [folderBatch, { ...folderBatch, id: 'second-folder' }] });
  assert.equal(elements(view.render()).filter(node => node.type === 'li').length, 15);
  const pagination = elements(view.render()).find(node =>
    typeof node.type === 'function' && node.type.name === 'Pagination')!;
  assert.equal(pagination.props.total, 16);
  pagination.props.onPageChange(2);
  const rows = elements(view.render()).filter(node => node.type === 'li');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, 'folder:second-folder');
});

test('folder batches render once with root name, subtree counts, original parent and combined count', () => {
  const view = harness({ folderEntries: [folderBatch], language: 'en-US' });
  const nodes = elements(view.render());
  assert.equal(nodes.filter(node => node.type === 'li').length, 2);
  const header = nodes.find(node => node.type === 'header')!;
  assert.match(renderToStaticMarkup(header), />2<\/span>/);
  assert.match(html(view), /Archived projects/);
  assert.match(html(view), /2 folders/);
  assert.match(html(view), /1 bookmark\b/);
  assert.match(html(view), /Original parent: Work/);
  assert.equal(button(view, 'Restore bookmark').props.disabled, false);
  view.props.folders = [];
  assert.match(html(view), /Original parent: Root folder/);
  const zh = html(harness({ entries: [], folderEntries: [folderBatch] }));
  assert.match(zh, /2 个目录/);
  assert.match(zh, /1 条收藏/);
  assert.doesNotMatch(zh, /回收站为空/);
});

test('folder search matches root, nested folder and bookmark title, URL and keywords without exposing child rows', () => {
  const view = harness({ entries: [], folderEntries: [folderBatch], language: 'en' });
  for (const query of ['ARCHIVED', ' Nested Resources ', 'Example tools', 'example.com/tools', 'nEeDlE']) {
    elements(view.render()).find(node => node.type === 'input')!.props.onChange({ target: { value: query } });
    assert.match(html(view), /Archived projects/);
    assert.equal(elements(view.render()).filter(node => node.type === 'li').length, 1);
  }
  elements(view.render()).find(node => node.type === 'input')!.props.onChange({ target: { value: 'no-match' } });
  assert.match(html(view), /No matching/);
  assert.doesNotMatch(html(view), /Trash is empty/);
});

test('folder restore uses its own callback, shares busy lock and preserves the batch after rejection', async () => {
  const calls: string[] = [];
  let reject!: (cause: Error) => void;
  const view = harness({
    folderEntries: [folderBatch], language: 'en',
    onRestore: () => { throw Error('wrong callback'); },
    onRestoreFolder: id => {
      calls.push(id);
      return new Promise<void>((_, fail) => { reject = fail; });
    },
  });
  const restore = button(view, 'Restore folder');
  const pending = restore.props.onClick();
  await restore.props.onClick();
  assert.equal(button(view, 'Restore bookmark').props.disabled, true);
  assert.equal(button(view, 'Permanently delete folder').props.disabled, true);
  assert.deepEqual(calls, ['folder-trash']);
  reject(Error('disk failed'));
  await pending;
  assert.match(html(view), /role="alert"/);
  assert.match(html(view), /folder batch is kept/i);
  assert.match(html(view), /Archived projects/);
  assert.equal(button(view, 'Restore folder').props.disabled, false);
  view.props.onRestoreFolder = () => {};
  await button(view, 'Restore folder').props.onClick();
  assert.doesNotMatch(html(view), /role="alert"/);
  assert.match(html(view), /Archived projects/);
});

test('folder purge confirms the entire subtree, keeps failed batches and closes only after success', async () => {
  const calls: string[] = [];
  let fail = true;
  const view = harness({
    folderEntries: [folderBatch], language: 'en',
    onPurge: () => { throw Error('wrong callback'); },
    onPurgeFolder: async id => { calls.push(id); if (fail) throw Error('disk failed'); },
  });
  button(view, 'Permanently delete folder').props.onClick();
  assert.deepEqual(calls, []);
  assert.equal(modal(view).props.contained, true);
  assert.match(html(view), /all its subfolders and bookmarks/i);
  assert.match(html(view), /cannot be undone/i);
  assert.match(html(view), /Archived projects/);
  button(view, 'Cancel').props.onClick();
  assert.equal(modal(view).props.isOpen, false);
  button(view, 'Permanently delete folder').props.onClick();
  await button(view, 'Confirm permanent folder deletion').props.onClick();
  assert.equal(modal(view).props.isOpen, true);
  assert.match(html(view), /role="alert"/);
  assert.match(html(view), /folder batch is kept/i);
  fail = false;
  await button(view, 'Confirm permanent folder deletion').props.onClick();
  assert.deepEqual(calls, ['folder-trash', 'folder-trash']);
  assert.equal(modal(view).props.isOpen, false);
  assert.match(html(view), /Archived projects/);
});

test('folder actions without callbacks are disabled and stale confirmation cannot delete a same-ID bookmark', async () => {
  let purged = false;
  const view = harness({ folderEntries: [{ ...folderBatch, id: entry.id }], language: 'en',
    onPurge: () => { purged = true; } });
  assert.equal(button(view, 'Restore folder').props.disabled, true);
  assert.equal(button(view, 'Permanently delete folder').props.disabled, true);
  view.props.onPurgeFolder = noop;
  button(view, 'Permanently delete folder').props.onClick();
  const confirm = button(view, 'Confirm permanent folder deletion');
  view.props.folderEntries = [];
  assert.equal(modal(view).props.isOpen, false);
  await button(view, 'Confirm permanent folder deletion').props.onClick();
  assert.equal(purged, false);
  assert.ok(confirm);
});

test('Chinese folder confirmation warns about the whole batch and restore errors remain localized', async () => {
  const view = harness({ entries: [], folderEntries: [folderBatch],
    onRestoreFolder: () => { throw Error('disk failed'); }, onPurgeFolder: noop });
  await button(view, '恢复目录').props.onClick();
  assert.match(html(view), /恢复失败/);
  assert.match(html(view), /目录批次仍保留/);
  button(view, '彻底删除目录').props.onClick();
  assert.match(html(view), /所有子目录和收藏/);
  assert.match(html(view), /无法恢复/);
  assert.ok(button(view, '确认彻底删除目录'));
});

test('empty folder batches remain visible and use singular folder and zero bookmark counts', () => {
  const view = harness({ entries: [], language: 'en', folderEntries: [{
    ...folderBatch, folders: [folderBatch.folders[1]], bookmarks: [],
  }] });
  assert.match(html(view), /1 folder · 0 bookmarks/);
  assert.match(html(view), /Archived projects/);
  assert.doesNotMatch(html(view), /Trash is empty/);
});

const saveFailures = [
  { name: 'uncertain', cause: { code: 'COMMIT_UNCERTAIN' } },
  { name: 'conflict', cause: { code: 'CONFLICT' } },
  { name: 'quota DOMException', cause: new DOMException('full', 'QuotaExceededError') },
  { name: 'security DOMException', cause: new DOMException('blocked', 'SecurityError') },
  { name: 'lock unavailable', cause: new Error('LOCK_UNAVAILABLE') },
  { name: 'quota code', cause: { code: 'QUOTA_EXCEEDED' } },
  { name: 'storage unavailable', cause: { code: 'STORAGE_UNAVAILABLE' } },
  { name: 'invalid reference', cause: { code: 'INVALID_REFERENCE' } },
];

for (const language of ['en-US', 'zh-CN']) {
  for (const kind of ['bookmark', 'folder'] as const) {
    for (const action of ['restore', 'purge'] as const) {
      for (const { name, cause } of saveFailures) {
        test(`${language} ${kind} ${action}: ${name} reports library feedback and preserves pending/input`, async () => {
          const en = language.startsWith('en');
          const labels = kind === 'bookmark'
            ? en ? ['Restore bookmark', 'Permanently delete bookmark', 'Confirm permanent deletion']
              : ['恢复收藏', '彻底删除收藏', '确认彻底删除']
            : en ? ['Restore folder', 'Permanently delete folder', 'Confirm permanent folder deletion']
              : ['恢复目录', '彻底删除目录', '确认彻底删除目录'];
          let calls = 0;
          let reject!: (cause: unknown) => void;
          const callback = () => {
            calls++;
            return new Promise<void>((_, fail) => { reject = fail; });
          };
          const view = harness({
            language, folderEntries: [folderBatch],
            onRestore: callback, onPurge: callback,
            onRestoreFolder: callback, onPurgeFolder: callback,
          });
          const input = () => elements(view.render()).find(node => node.type === 'input')!;
          input().props.onChange({ target: { value: 'Needle' } });
          if (action === 'purge') button(view, labels[1]).props.onClick();
          const submit = button(view, labels[action === 'restore' ? 0 : 2]);
          const pending = submit.props.onClick();
          await submit.props.onClick();
          assert.equal(calls, 1);
          assert.equal(button(view, labels[0]).props.disabled, true);
          assert.equal(button(view, labels[1]).props.disabled, true);
          if (action === 'purge') {
            assert.equal(button(view, labels[2]).props.disabled, true);
            assert.equal(button(view, en ? 'Cancel' : '取消').props.disabled, true);
            modal(view).props.onClose();
            assert.equal(modal(view).props.isOpen, true);
          }
          reject(cause);
          await pending;
          const alert = elements(view.render()).find(node => node.props.role === 'alert');
          assert.ok(alert);
          assert.equal(alert.props.children, preferenceSaveError(cause, language, 'library'));
          assert.doesNotMatch(String(alert.props.children), /kept in Trash|Please try again|仍保留在回收站/);
          assert.equal(input().props.value, 'Needle');
          assert.equal(button(view, labels[0]).props.disabled, false);
          assert.equal(view.props.entries[0], entry);
          assert.equal(view.props.folderEntries![0], folderBatch);
          assert.equal(calls, 1);
          if (action === 'purge') assert.equal(modal(view).props.isOpen, true);
        });
      }
    }
  }
}

test('uncertain purge feedback remains visible if the parent removes the committed target', async () => {
  const view = harness({ language: 'en', onPurge: () => { throw { code: 'COMMIT_UNCERTAIN' }; } });
  button(view, 'Permanently delete bookmark').props.onClick();
  await button(view, 'Confirm permanent deletion').props.onClick();
  view.props.entries = [];
  assert.equal(modal(view).props.isOpen, false);
  assert.match(html(view), /Trash is empty/);
  assert.match(html(view), /role="alert"[^>]*>The data save result is uncertain/);
  assert.doesNotMatch(html(view), /kept in Trash/);
});

for (const kind of ['bookmark', 'folder'] as const) {
  for (const action of ['restore', 'purge'] as const) {
    const label = action === 'restore' ? `Restore ${kind}` : kind === 'folder'
      ? 'Confirm permanent folder deletion' : 'Confirm permanent deletion';
    function begin(view: ReturnType<typeof harness>) {
      if (action === 'purge') button(view, `Permanently delete ${kind}`).props.onClick();
      return button(view, label).props.onClick();
    }
    test(`${kind} ${action} fails safely when Web Locks are unavailable`, async () => {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
      let calls = 0;
      const callback = () => { calls++; };
      const view = harness({
        language: 'en', folderEntries: [folderBatch],
        onRestore: callback, onPurge: callback, onRestoreFolder: callback, onPurgeFolder: callback,
      });
      await begin(view);
      assert.equal(calls, 0);
      const alert = elements(view.render()).find(node => node.props.role === 'alert');
      assert.ok(alert);
      assert.equal(alert.props.children, preferenceSaveError(new Error('LOCK_UNAVAILABLE'), 'en', 'library'));
      assert.equal(button(view, label).props.disabled, false);
    });

    for (const unmount of [false, true]) {
      test(`${kind} ${action} waits for one shared lock and ${unmount ? 'cancels after unmount' : 'awaits persistence'}`, async () => {
        const names: string[] = [];
        let grant!: () => void;
        Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
          request: (name: string, callback: () => unknown) => {
            names.push(name);
            return new Promise((resolve, reject) => {
              grant = () => { Promise.resolve().then(callback).then(resolve, reject); };
            });
          },
        } } });
        let calls = 0;
        let finish!: () => void;
        const callback = () => {
          calls++;
          return new Promise<void>(resolve => { finish = resolve; });
        };
        const view = harness({
          language: 'en', folderEntries: [folderBatch],
          onRestore: callback, onPurge: callback, onRestoreFolder: callback, onPurgeFolder: callback,
        });
        const pending = begin(view);
        await button(view, label).props.onClick();
        assert.equal(calls, 0);
        assert.deepEqual(names, ['jigeqiu:prototype:library-import']);
        assert.equal(button(view, label).props.disabled, true);
        if (action === 'purge') {
          modal(view).props.onClose();
          assert.equal(modal(view).props.isOpen, true);
        }
        if (unmount) view.unmount();
        grant();
        await Promise.resolve();
        assert.equal(calls, unmount ? 0 : 1);
        if (!unmount) {
          assert.equal(button(view, label).props.disabled, true);
          finish();
        }
        await pending;
        assert.equal(calls, unmount ? 0 : 1);
        if (!unmount) assert.equal(button(view, `Restore ${kind}`).props.disabled, false);
      });
    }
  }
}

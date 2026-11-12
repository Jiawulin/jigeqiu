import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import { transformSync } from 'esbuild';
import type { BookmarkDialogProps } from '../../src/components/common/BookmarkDialog';

const noop = () => {};
function elements(tree: React.ReactNode): React.ReactElement<any>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return [];
  return [tree, ...elements(tree.props.children)];
}
function content(tree: React.ReactNode): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(content).join('');
  return React.isValidElement<{ children?: React.ReactNode }>(tree) ? content(tree.props.children) : '';
}
function harness(overrides: Partial<BookmarkDialogProps> = {}) {
  const path = new URL('../../src/components/common/BookmarkDialog.tsx', import.meta.url);
  const require = createRequire(path);
  const state: unknown[] = [];
  const cleanups: (() => void)[] = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value: any) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useEffect(effect: () => void | (() => void)) {
      const index = cursor++;
      if (index in state) return;
      state[index] = true;
      const cleanup = effect();
      if (cleanup) cleanups.push(cleanup);
    },
  };
  const source = `${readFileSync(path, 'utf8')}\nexport { BookmarkDialogSession };`;
  const compiled = transformSync(source, { loader: 'tsx', format: 'cjs' }).code;
  const module = { exports: {} as { BookmarkDialogSession: (props: object) => React.ReactElement } };
  new Function('require', 'module', 'exports', compiled)(
    (id: string) => id === 'react' ? hooks : require(id), module, module.exports,
  );
  const props: BookmarkDialogProps = {
    isOpen: true, folders: [], existingBookmarks: [], initialUrl: 'https://example.com',
    language: 'en', onSave: noop, onClose: noop, ...overrides,
  };
  const render = () => { cursor = 0; return module.exports.BookmarkDialogSession(props); };
  return {
    props, render, unmount: () => cleanups.splice(0).forEach(cleanup => cleanup()),
    nodes: () => elements(render()),
    submit: () => elements(render()).find(node => node.type === 'form')!.props.onSubmit({ preventDefault: noop }),
  };
}
type View = ReturnType<typeof harness>;
test('captured page titles prefill the form with a fallback for empty titles', () => {
  const view = harness({ initialTitle: ' Page title <example> ' });
  assert.equal(view.nodes().find(node => node.props.id === 'bookmark-title')!.props.value, 'Page title <example>');
  view.unmount();
  const fallback = harness({ initialTitle: '  ' });
  assert.ok(fallback.nodes().find(node => node.props.id === 'bookmark-title')!.props.value);
  fallback.unmount();
});
function button(view: View, label: string) {
  const node = view.nodes().find(node => node.type === 'button' && content(node) === label);
  assert.ok(node, `Missing button: ${label}`);
  return node;
}
function change(view: View, id: string, value: string) {
  const node = view.nodes().find(node => node.props.id === id);
  assert.ok(node);
  node.props.onChange({ target: { value } });
}
function child(view: View, name: string) {
  const node = view.nodes().find(node => typeof node.type === 'function' && node.type.name === name);
  assert.ok(node);
  return node;
}
async function locks(run: (grant: () => Promise<void>, names: string[]) => Promise<void>, available = true) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const names: string[] = [];
  const queue: (() => Promise<void>)[] = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: available ? {
    request(name: string, action: () => unknown) {
      names.push(name);
      return new Promise((resolve, reject) => queue.push(async () => {
        try { resolve(await action()); } catch (cause) { reject(cause); }
      }));
    },
  } : undefined } });
  try {
    await run(async () => { const next = queue.shift(); assert.ok(next); await next(); }, names);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
}

test('save waits for the shared lock and async persistence, freezes fields and blocks repeated submits/close', async () => {
  await locks(async (grant, names) => {
    const calls: unknown[] = [];
    let finish!: () => void;
    const view = harness({ onSave: (input, pin) => {
      calls.push([input, pin]);
      return new Promise<void>(resolve => { finish = resolve; });
    }, onClose: () => { calls.push('close'); } });
    const pending = view.submit();
    await view.submit();
    assert.deepEqual(calls, []);
    assert.deepEqual(names, ['jigeqiu:prototype:library-import']);
    assert.equal(view.nodes().find(node => node.type === 'fieldset')?.props.disabled, true);
    assert.equal(button(view, 'Add bookmark').props.disabled, true);
    (view.render().props as { onClose(): void }).onClose();
    button(view, 'Cancel').props.onClick();
    assert.deepEqual(calls, []);
    const granted = grant();
    await Promise.resolve();
    assert.equal(calls.length, 1);
    assert.equal(view.nodes().find(node => node.type === 'form')!.props['aria-busy'], true);
    finish();
    await granted;
    await pending;
    assert.equal(calls.at(-1), 'close');
  });
});

test('unmounted queued sessions never call save, even when a new editor opens', async () => {
  await locks(async grant => {
    let saves = 0, closes = 0;
    const view = harness({ onSave: () => { saves++; }, onClose: () => { closes++; } });
    const pending = view.submit();
    view.unmount();
    const reopened = harness();
    await grant();
    await pending;
    assert.equal(saves, 0);
    assert.equal(closes, 0);
    assert.equal(reopened.nodes().some(node => node.props.role === 'alert'), false);
  });
});

test('synchronous save may unmount the parent dialog without a second close or a false failure', async () => {
  await locks(async grant => {
    let closes = 0;
    const view = harness({ onSave: () => { view.unmount(); }, onClose: () => { closes++; } });
    const pending = view.submit();
    await grant();
    await pending;
    assert.equal(closes, 0);
  });
});

test('CONFLICT keeps raw draft fields and shows localized guidance and download instead of closing', async () => {
  for (const language of ['en-US', 'zh']) await locks(async grant => {
    let closes = 0;
    const view = harness({ language, onSave: async () => { throw { code: 'CONFLICT' }; }, onClose: () => { closes++; } });
    change(view, 'bookmark-url', ' draft.example/path ');
    change(view, 'bookmark-title', ' My draft ');
    child(view, 'FolderTreeSelect').props.onChange('chosen');
    child(view, 'BookmarkKeywordsInput').props.onChange(['KEY', 'private']);
    child(view, 'SiteIconPicker').props.onChange({ icon: 'https://icon.example/custom.png', iconMode: 'custom' });
    view.nodes().find(node => node.type === 'input' && node.props.type === 'checkbox')!.props.onChange({ target: { checked: true } });
    const pending = view.submit();
    await grant();
    await pending;
    assert.equal(closes, 0);
    assert.equal(view.nodes().find(node => node.props.id === 'bookmark-title')!.props.value, ' My draft ');
    assert.equal(view.nodes().find(node => node.props.id === 'bookmark-url')!.props.value, ' draft.example/path ');
    assert.deepEqual(child(view, 'BookmarkKeywordsInput').props.value, ['KEY', 'private']);
    assert.equal(child(view, 'FolderTreeSelect').props.value, 'chosen');
    assert.equal(child(view, 'SiteIconPicker').props.value.iconMode, 'custom');
    const alert = view.nodes().find(node => node.props.role === 'alert');
    assert.ok(alert);
    assert.match(content(alert), language === 'zh' ? /其他标签页|其他页面/ : /another tab|other tab/i);
    assert.match(content(view.render()), language === 'zh' ? /不是可导入备份/ : /not an importable backup/i);
    assert.ok(button(view, language === 'zh' ? '下载当前草稿' : 'Download current draft'));
    assert.equal(button(view, language === 'zh' ? '添加收藏' : 'Add bookmark').props.disabled, false);
  });
});

test('uncertain bookmark saves keep the draft and tell both languages to refresh, not retry blindly', async () => {
  for (const language of ['en-US', 'zh']) await locks(async grant => {
    let closed = false;
    const view = harness({ language, onSave: () => { throw new Error('COMMIT_UNCERTAIN'); },
      onClose: () => { closed = true; } });
    change(view, 'bookmark-title', 'Preserve me');
    const pending = view.submit();
    await grant();
    await pending;
    const alert = view.nodes().find(node => node.props.role === 'alert');
    assert.ok(alert);
    assert.match(content(alert), language === 'zh' ? /结果无法确认.*刷新/ : /uncertain.*Refresh/);
    assert.doesNotMatch(content(alert), language === 'zh' ? /未保存/ : /was not saved|Saving failed/);
    assert.equal(view.nodes().find(node => node.props.id === 'bookmark-title')!.props.value, 'Preserve me');
    assert.equal(closed, false);
  });
});

test('draft download includes only this bookmark and releases its Blob URL on unmount', async () => {
  await locks(async grant => {
    const view = harness({
      bookmark: {
        id: 'existing', title: 'Original', url: 'https://example.com', domain: 'example.com',
        keywords: ['old'], iconMode: 'text', category: 'secret-category', notes: 'DO NOT EXPORT',
        collectionIds: ['other-record'], pinnedToDesktop: true, order: 0, createdAt: 1, updatedAt: 1,
      },
      onSave: () => { throw new Error('CONFLICT'); },
    });
    change(view, 'bookmark-title', ' Draft title ');
    change(view, 'bookmark-url', ' draft.example ');
    child(view, 'FolderTreeSelect').props.onChange('target-folder');
    child(view, 'BookmarkKeywordsInput').props.onChange(['raw keyword']);
    child(view, 'SiteIconPicker').props.onChange({ icon: 'https://icon.example/custom.png', iconMode: 'custom' });
    const pending = view.submit(); await grant(); await pending;
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    let blob!: Blob, clicked = false;
    const revoked: string[] = [];
    const anchor = { href: '', download: '', click() { clicked = true; }, remove: noop };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
      createElement: () => anchor, body: { appendChild: noop },
    } });
    URL.createObjectURL = value => { blob = value as Blob; return 'blob:draft'; };
    URL.revokeObjectURL = value => { revoked.push(value); };
    try {
      button(view, 'Download current draft').props.onClick();
      assert.equal(clicked, true);
      assert.equal(anchor.href, 'blob:draft');
      assert.match(anchor.download, /\.json$/);
      assert.equal(blob.type, 'application/json');
      assert.deepEqual(JSON.parse(await blob.text()), {
        format: 'jigeqiu-bookmark-draft', schemaVersion: 1,
        draft: {
          id: 'existing', title: ' Draft title ', url: ' draft.example ', folderId: 'target-folder',
          keywords: ['raw keyword'], icon: 'https://icon.example/custom.png', iconMode: 'custom', pinnedToDesktop: true,
        },
      });
      view.unmount();
      assert.deepEqual(revoked, ['blob:draft']);
    } finally {
      URL.createObjectURL = create; URL.revokeObjectURL = revoke;
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
      else Reflect.deleteProperty(globalThis, 'document');
    }
  });
});

test('missing locks or async save failures retain the editor and release pending state for retry', async () => {
  await locks(async () => {
    let saves = 0;
    const view = harness({ onSave: () => { saves++; } });
    await view.submit();
    assert.equal(saves, 0);
    assert.match(content(view.render()), /Web Locks|supported browser/i);
    assert.equal(button(view, 'Add bookmark').props.disabled, false);
  }, false);
  await locks(async grant => {
    const view = harness({ onSave: async () => { throw Error('STORAGE_WRITE_FAILED'); } });
    const pending = view.submit(); await grant(); await pending;
    assert.ok(view.nodes().find(node => node.props.role === 'alert'));
    assert.equal(button(view, 'Add bookmark').props.disabled, false);
  });
});

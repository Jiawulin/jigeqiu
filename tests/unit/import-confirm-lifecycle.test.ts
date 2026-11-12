import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { after, before } from 'node:test';
import React from 'react';
import { transformSync } from 'esbuild';

function nodes(tree: React.ReactNode): React.ReactElement<any>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return React.isValidElement<{ children?: React.ReactNode }>(tree)
    ? [tree, ...nodes(tree.props.children)] : [];
}
function text(tree: React.ReactNode): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join('');
  return React.isValidElement<{ children?: React.ReactNode }>(tree) ? text(tree.props.children) : '';
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
before(() => {
  if (!originalNavigator) Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
});
after(() => {
  if (!originalNavigator) Reflect.deleteProperty(globalThis, 'navigator');
});

function harness(kind: 'chrome' | 'json', refreshFailure = false, commitFailure?: Error) {
  const name = kind === 'chrome' ? 'PrototypeChromeImport' : 'JsonAssetTransfer';
  const path = new URL(`../../src/components/account/${name}.tsx`, import.meta.url);
  const require = createRequire(path);
  const state: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let cursor = 0;
  let refCursor = 0;
  let mounted = true;
  let lateStateWrites = 0;
  const cleanups: (() => void)[] = [];
  let effectCursor = 0;
  const registeredEffects = new Set<number>();
  let writes = 0;
  let notifications = 0;
  const preview = {
    base: { bookmarks: [], folders: [] }, library: { bookmarks: [], folders: [] },
    counts: { bookmarks: 1, folders: 0, skipped: 0, invalid: 0, collections: 0 }, notices: [],
  };
  const commit = () => { writes++; if (commitFailure) throw commitFailure; };
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value: any) => {
        if (!mounted) lateStateWrites++;
        state[index] = typeof value === 'function' ? value(state[index]) : value;
      }];
    },
    useRef(current: unknown) { return refs[refCursor++] ?? (refs[refCursor - 1] = { current }); },
    useEffect(effect: () => (() => void) | undefined) {
      const index = effectCursor++;
      if (!registeredEffects.has(index)) {
        const cleanup = effect();
        if (cleanup) cleanups.push(cleanup);
        registeredEffects.add(index);
      }
    },
  };
  const module = { exports: {} as Record<string, (props: object) => React.ReactElement> };
  new Function('require', 'module', 'exports',
    transformSync(readFileSync(path, 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)(
    (id: string) => id === 'react' ? hooks
      : id === '../../services/storage' ? { storage: {
        mutate: async (action: () => unknown) => action(),
        readLibrary: () => preview.base, previewJsonAssetImport: () => preview,
        commitImportedLibrary: commit, commitJsonAssetImport: commit,
      } }
      : id === '../../services/import-export/prototype-import'
        ? { prepareChromeLibraryImport: () => ({ ok: true, value: preview }) }
        : require(id),
    module, module.exports,
  );
  const props = { language: 'en-US', onImported() {
    notifications++;
    if (refreshFailure) throw new Error('refresh failed');
  } };
  const render = () => { cursor = 0; refCursor = 0; effectCursor = 0; return module.exports[name](props); };
  const find = (predicate: (node: React.ReactElement<any>) => boolean) => {
    const node = nodes(render()).find(predicate);
    assert.ok(node, 'Missing control');
    return node;
  };
  const confirm = () => find(node => node.type === 'button'
    && ['Import bookmarks', '确认导入收藏'].includes(text(node)));
  return {
    props, render, confirm,
    async choose() {
      await find(node => node.type === 'input' && node.props.type === 'file').props.onChange({
        target: { files: [{ name: 'backup', size: 1, text: async () => 'backup' }], value: '' },
      });
    },
    unmount() { mounted = false; cleanups.forEach(cleanup => cleanup()); },
    stats: () => ({ writes, notifications, lateStateWrites }),
  };
}

for (const kind of ['chrome', 'json'] as const) {
  test(`${kind}: leaving while waiting for the lock prevents writes, notifications, and state updates`, async t => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'locks');
    let run: (() => void) | undefined;
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: (_: string, callback: () => void) => new Promise<void>(resolve => {
        run = () => { callback(); resolve(); };
      }),
    } });
    t.after(() => { if (original) Object.defineProperty(navigator, 'locks', original); else Reflect.deleteProperty(navigator, 'locks'); });
    const view = harness(kind);
    await view.choose();
    view.confirm().props.onClick();
    assert.ok(run);
    view.unmount();
    run();
    await settle();
    assert.deepEqual(view.stats(), { writes: 0, notifications: 0, lateStateWrites: 0 });
  });

  test(`${kind}: leaving after commit but before lock completion suppresses refresh and state updates`, async t => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'locks');
    let release: (() => void) | undefined;
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: (_: string, callback: () => void) => new Promise<void>(resolve => {
        callback();
        release = resolve;
      }),
    } });
    t.after(() => { if (original) Object.defineProperty(navigator, 'locks', original); else Reflect.deleteProperty(navigator, 'locks'); });
    const view = harness(kind);
    await view.choose();
    view.confirm().props.onClick();
    assert.equal(view.stats().writes, 1);
    view.unmount();
    assert.ok(release);
    release();
    await settle();
    assert.deepEqual(view.stats(), { writes: 1, notifications: 0, lateStateWrites: 0 });
  });

  test(`${kind}: failed parent refresh is bilingual uncertain with one write and no retry`, async t => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'locks');
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: async (_: string, callback: () => void) => callback(),
    } });
    t.after(() => { if (original) Object.defineProperty(navigator, 'locks', original); else Reflect.deleteProperty(navigator, 'locks'); });
    const view = harness(kind, true);
    await view.choose();
    const staleConfirm = view.confirm().props.onClick;
    staleConfirm();
    await settle();
    assert.match(text(view.render()), /save result is uncertain/);
    assert.doesNotMatch(text(view.render()), /Saving failed|Operation failed/);
    assert.equal(view.confirm().props.disabled, true);
    view.confirm().props.onClick();
    staleConfirm();
    await settle();
    assert.deepEqual(view.stats(), { writes: 1, notifications: 1, lateStateWrites: 0 });
    view.props.language = 'zh';
    assert.match(text(view.render()), /保存结果无法确认/);
    assert.doesNotMatch(text(view.render()), /保存失败|操作未完成/);
    assert.equal(view.confirm().props.disabled, true);
  });

  test(`${kind}: storage rejection retains its conflict semantics without notifying the parent`, async t => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'locks');
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: async (_: string, callback: () => void) => callback(),
    } });
    t.after(() => { if (original) Object.defineProperty(navigator, 'locks', original); else Reflect.deleteProperty(navigator, 'locks'); });
    const view = harness(kind, false, new Error('CONFLICT'));
    await view.choose();
    view.confirm().props.onClick();
    await settle();
    assert.match(text(view.render()), /Local assets changed/);
    assert.doesNotMatch(text(view.render()), /uncertain/);
    assert.equal(view.stats().notifications, 0);
    assert.equal(view.stats().writes, 1);
  });
}

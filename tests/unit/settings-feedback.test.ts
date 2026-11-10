import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import { transformSync } from 'esbuild';
import type { Bookmark } from '../../src/types';
import { preferenceSaveError } from '../../src/services/preference-save-error';

test('library scope gives actionable bilingual data errors without settings-specific wording', async () => {
  const cases = [
    [new DOMException('full', 'QuotaExceededError'), /空间不足/, /storage is full/i],
    [{ code: 'QUOTA_EXCEEDED' }, /空间不足/, /storage is full/i],
    [new DOMException('denied', 'SecurityError'), /权限/, /permissions/i],
    [new Error('STORAGE_UNAVAILABLE'), /存储.*不可用/, /storage.*unavailable/i],
    [new Error('CONFLICT'), /其他标签页.*刷新/, /another tab.*refresh/i],
    [{ code: 'COMMIT_UNCERTAIN' }, /无法确认.*刷新.*检查/, /uncertain.*refresh.*check/i],
    [new Error('LOCK_UNAVAILABLE'), /HTTPS.*Web Locks/, /HTTPS.*Web Locks/],
    [new Error('INVALID_REFERENCE'), /目录.*不存在|目标.*不存在/, /folder.*no longer exists|target.*no longer exists/i],
    [new Error('UNKNOWN'), /保存失败/, /could not save/i],
  ] as const;
  for (const [cause, zh, en] of cases) {
    const chinese = preferenceSaveError(cause, 'zh', 'library');
    const english = preferenceSaveError(cause, 'en-US', 'library');
    assert.match(chinese, zh);
    assert.match(english, en);
    assert.doesNotMatch(chinese, /设置/);
    assert.doesNotMatch(english, /settings/i);
    assert.equal(preferenceSaveError(cause, 'en'), preferenceSaveError(cause, 'en', 'settings'));
  }
  const uncertain = preferenceSaveError(new Error('COMMIT_UNCERTAIN'), 'en', 'library');
  assert.match(uncertain, /do not retry blindly/i);
  assert.doesNotMatch(uncertain, /not saved|not applied|then try again/i);
});

const noop = () => {};
const appSource = () => readFileSync(new URL('../../src/PrototypeApp.tsx', import.meta.url), 'utf8');
function appHandlers(failure?: unknown, language = 'zh', ids: string[] = []) {
  const source = appSource();
  const start = source.indexOf('  const handleUpdateSettings =');
  const end = source.indexOf('  // Delete bookmark', start);
  assert.ok(start >= 0 && end > start);
  const body = transformSync(source.slice(start, end), { loader: 'ts', format: 'cjs' }).code;
  const calls: unknown[][] = [];
  const next = { dockBookmarkIds: ['bm'], language };
  const require = createRequire(new URL('../../src/PrototypeApp.tsx', import.meta.url));
  // Bind the same error helper imported by the app, without loading its other UI.
  const helperImport = source.match(/import \{ preferenceSaveError \} from '([^']+)'/);
  const preferenceSaveError = helperImport ? require(helperImport[1]).preferenceSaveError : undefined;
  const handlers = new Function('storage', 'setSettings', 'showToast', 'settings', 'bookmarks', 'preferenceSaveError',
    `${body}\nreturn { update: handleUpdateSettings, toggle: handleToggleDockBookmark };`)(
    { mutate: async (action: () => unknown) => action(),
      saveUserSettings(updates: unknown) { calls.push(['save', updates]); if (failure) throw failure; return next; } },
    (value: unknown) => calls.push(['state', value]),
    (message: string) => calls.push(['toast', message]),
    { language, dockBookmarkIds: ids }, [{ id: 'bm', title: 'Example' }], preferenceSaveError,
  ) as { update(updates: object): Promise<boolean>; toggle(id: string): Promise<boolean> };
  return { ...handlers, calls, next };
}

test('parent settings handler returns success only after persistence and never publishes failed settings', async () => {
  const ok = appHandlers();
  assert.equal(await ok.update({ dockIconSize: 60 }), true);
  assert.deepEqual(ok.calls, [['save', { dockIconSize: 60 }], ['state', ok.next]]);
  for (const [language, cause, expected] of [
    ['zh', new DOMException('full', 'QuotaExceededError'), /空间不足/],
    ['en', new DOMException('denied', 'SecurityError'), /permission|blocked|unavailable/i],
    ['en', new Error('COMMIT_UNCERTAIN'), /refresh.*check|reload.*check/i],
    ['zh', { code: 'COMMIT_UNCERTAIN' }, /刷新.*检查|重新载入.*检查/],
  ] as const) {
    const view = appHandlers(cause, language);
    assert.equal(await view.update({ showDock: false }), false);
    assert.equal(view.calls.filter(call => call[0] === 'state').length, 0);
    assert.equal(view.calls.filter(call => call[0] === 'toast').length, 1);
    assert.match(String(view.calls.at(-1)![1]), expected);
    if (String(cause instanceof Error ? cause.message : cause.code) === 'COMMIT_UNCERTAIN') {
      assert.doesNotMatch(String(view.calls.at(-1)![1]), /then try again|后重试/);
    }
  }
});

test('parent pin and unpin announce success only after a successful settings write', async () => {
  for (const ids of [[], ['bm']]) {
    const fail = appHandlers(new Error('COMMIT_UNCERTAIN'), 'en', ids);
    assert.equal(await fail.toggle('bm'), false);
    assert.equal(fail.calls.filter(call => call[0] === 'toast').length, 1);
    assert.doesNotMatch(String(fail.calls.at(-1)![1]), /^(Pinned|Unpinned)/);
    assert.match(String(fail.calls.at(-1)![1]), /library/i);
    assert.doesNotMatch(String(fail.calls.at(-1)![1]), /settings/i);
    const ok = appHandlers(undefined, 'en', ids);
    assert.equal(await ok.toggle('bm'), true);
    assert.deepEqual(ok.calls.map(call => call[0]), ['save', 'state', 'toast']);
    assert.match(String(ok.calls.at(-1)![1]), ids.length ? /^Unpinned/ : /^Pinned/);
  }
});

const bookmark = (id: string): Bookmark => ({
  id, title: id, url: `https://${id}.example/`, domain: `${id}.example`, category: '',
  order: 0, pinnedToDesktop: true, collectionIds: [], createdAt: 1, updatedAt: 1,
});
function nodes(tree: React.ReactNode): React.ReactElement<any>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
function content(tree: React.ReactNode): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(content).join('');
  return React.isValidElement<{ children?: React.ReactNode }>(tree) ? content(tree.props.children) : '';
}
function dockHarness(options: {
  callback?: (updates: any) => boolean | void; failure?: unknown; language?: string; readBlocked?: () => boolean;
} = {}) {
  const path = new URL('../../src/components/dock/BottomDock.tsx', import.meta.url);
  const require = createRequire(path);
  const state: unknown[] = [];
  const events = new Map<string, (...args: any[]) => void>();
  const calls: unknown[][] = [];
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
    useEffect: noop, useLayoutEffect: noop, useMemo: (compute: () => unknown) => compute(),
  };
  const compiled = transformSync(readFileSync(path, 'utf8'), { loader: 'tsx', format: 'cjs' }).code;
  const module = { exports: {} as { BottomDock: (props: object) => React.ReactElement } };
  new Function('require', 'module', 'exports', compiled)(
    (id: string) => id === 'react' ? hooks : id === '../../services/storage' ? { storage: {
      mutate: async (action: () => unknown) => action(),
      getUserSettings: () => {
        if (options.readBlocked?.()) throw new DOMException('denied', 'SecurityError');
        return { language: options.language ?? 'en' };
      },
      saveUserSettings(updates: unknown) { calls.push(['local', updates]); if (options.failure) throw options.failure; return updates; },
    } } : require(id), module, module.exports,
  );
  const render = () => {
    cursor = 0;
    return module.exports.BottomDock({
      bookmarks: [bookmark('one'), bookmark('two')], dockBookmarkIds: ['one', 'two'], dockIconSize: 60,
      onOpenBookmark: noop, onOpenTool: noop, onQuickAdd: noop, showTools: false,
      onUpdateDockSettings: options.callback ? (updates: unknown) => {
        calls.push(['parent', updates]); return options.callback!(updates);
      } : undefined,
      onShowToast: (message: string) => calls.push(['toast', message]),
    });
  };
  const all = () => nodes(render());
  const open = () => all().find(node => node.type === 'aside')!.props.onContextMenu({
    preventDefault: noop, stopPropagation: noop, clientX: 200, clientY: 400,
  });
  const button = (label: string) => {
    const found = all().find(node => node.type === 'button' && content(node) === label);
    assert.ok(found, label); return found;
  };
  return {
    calls, all, open, button, events,
    async run(action: () => void | Promise<void>) {
      const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
      Object.defineProperty(globalThis, 'window', { configurable: true, value: {
        innerWidth: 1000, addEventListener: (name: string, fn: any) => events.set(name, fn),
        removeEventListener: (name: string) => events.delete(name),
      } });
      try { await action(); } finally {
        if (previous) Object.defineProperty(globalThis, 'window', previous);
        else Reflect.deleteProperty(globalThis, 'window');
      }
    },
  };
}

test('Dock slider/reset/hide/reorder delegate exactly once without local writes when parent supplied', async () => {
  const view = dockHarness({ callback: () => true });
  await view.run(async () => {
    view.open();
    await view.all().find(node => node.props.type === 'range')!.props.onChange({ target: { value: '70' } });
    await view.button('恢复默认大小 (48px)').props.onClick();
    view.open(); await view.button('Hide Taskbar').props.onClick();
    const items = view.all().filter(node => node.props.draggable);
    items[0].props.onDragStart({ dataTransfer: { setData: noop } });
    view.all().filter(node => node.props.draggable)[1].props.onDrop({ preventDefault: noop });
    assert.deepEqual(view.calls, [
      ['parent', { dockIconSize: 70 }], ['parent', { dockIconSize: 48 }],
      ['parent', { showDock: false }], ['parent', { dockBookmarkIds: ['two', 'one'] }],
    ]);
  });
});

test('Dock rejected parent result keeps committed size/menu and never falls back to a second write', async () => {
  const view = dockHarness({ callback: () => false });
  await view.run(async () => {
    view.open();
    await view.all().find(node => node.props.type === 'range')!.props.onChange({ target: { value: '70' } });
    assert.equal(view.all().find(node => node.props.type === 'range')!.props.value, 60);
    await view.button('恢复默认大小 (48px)').props.onClick();
    assert.equal(view.all().find(node => node.props.type === 'range')!.props.value, 60);
    await view.button('Hide Taskbar').props.onClick();
    assert.ok(view.button('Hide Taskbar'));
    assert.equal(view.calls.some(call => call[0] === 'local'), false);
  });
});

test('Dock drag resize rolls its preview back when delegated persistence fails', async () => {
  const view = dockHarness({ callback: () => false });
  await view.run(async () => {
    const grip = view.all().find(node => node.props.onMouseDown && node.props.onDoubleClick)!;
    grip.props.onMouseDown({ preventDefault: noop, stopPropagation: noop, clientY: 200 });
    view.events.get('mousemove')!({ clientY: 180 });
    view.all();
    await view.events.get('mouseup')!();
    view.open();
    assert.equal(view.all().find(node => node.props.type === 'range')!.props.value, 60);
    assert.deepEqual(view.calls, [['parent', { dockIconSize: 74 }]]);
  });
});

test('Dock standalone saves locally once, catches failure and retains size with localized uncertainty guidance', async () => {
  const ok = dockHarness();
  await ok.run(async () => {
    ok.open(); await ok.all().find(node => node.props.type === 'range')!.props.onChange({ target: { value: '70' } });
    assert.deepEqual(ok.calls, [['local', { dockIconSize: 70 }]]);
    assert.equal(ok.all().find(node => node.props.type === 'range')!.props.value, 70);
  });
  for (const language of ['zh', 'en']) {
    const view = dockHarness({ failure: new Error('COMMIT_UNCERTAIN'), language });
    await view.run(async () => {
      view.open(); await view.all().find(node => node.props.type === 'range')!.props.onChange({ target: { value: '70' } });
      assert.equal(view.all().find(node => node.props.type === 'range')!.props.value, 60);
      const alert = view.all().find(node => node.props.role === 'alert');
      assert.ok(alert);
      assert.match(content(alert), language === 'en' ? /refresh.*check/i : /刷新.*检查/);
      assert.equal(view.calls.filter(call => call[0] === 'local').length, 1);
    });
  }
});

test('Dock still renders failure feedback if storage permissions also block language reads', async () => {
  let blocked = false;
  const view = dockHarness({
    readBlocked: () => blocked, failure: new DOMException('denied', 'SecurityError'),
  });
  await view.run(async () => {
    view.open();
    const slider = view.all().find(node => node.props.type === 'range')!;
    blocked = true;
    await slider.props.onChange({ target: { value: '70' } });
    const alert = view.all().find(node => node.props.role === 'alert');
    assert.ok(alert);
    assert.match(content(alert), /权限|permission/i);
  });
});

test('Dock keeps legacy void parent callbacks compatible and catches throwing parent callbacks without fallback writes', async () => {
  const legacy = dockHarness({ callback: noop });
  await legacy.run(async () => {
    legacy.open();
    await legacy.all().find(node => node.props.type === 'range')!.props.onChange({ target: { value: '70' } });
    assert.equal(legacy.all().find(node => node.props.type === 'range')!.props.value, 70);
    assert.deepEqual(legacy.calls, [['parent', { dockIconSize: 70 }]]);
  });
  const failed = dockHarness({ callback: () => { throw new DOMException('full', 'QuotaExceededError'); } });
  await failed.run(async () => {
    failed.open();
    await failed.button('恢复默认大小 (48px)').props.onClick();
    assert.equal(failed.all().find(node => node.props.type === 'range')!.props.value, 60);
    assert.ok(failed.all().find(node => node.props.role === 'alert'));
    assert.equal(failed.calls.some(call => call[0] === 'local'), false);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import { transformSync } from 'esbuild';
import type { Bookmark } from '../../src/types';
import type { Layout } from '../../src/domain/assets/model';

const noop = () => {};
const bookmarks: Bookmark[] = ['one', 'two'].map((id, order) => ({
  id, title: id, url: `https://${id}.example/`, domain: `${id}.example`,
  category: '', order, collectionIds: [], pinnedToDesktop: true, createdAt: 1, updatedAt: 1,
}));
function layout(): Layout {
  return {
    shortcuts: [{ id: 's-one', bookmarkId: 'one' }, { id: 's-two', bookmarkId: 'two' }],
    folders: [{ id: 'group', name: 'Group', shortcutIds: [] }],
    root: [{ kind: 'shortcut', id: 's-one' }, { kind: 'shortcut', id: 's-two' },
      { kind: 'desktop-folder', id: 'group' }], dock: [],
  };
}
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
function harness(kind: 'desktop' | 'dock', overrides: Record<string, unknown> = {}) {
  const path = new URL(kind === 'desktop'
    ? '../../src/components/desktop/DesktopView.tsx' : '../../src/components/dock/BottomDock.tsx', import.meta.url);
  const require = createRequire(path);
  const state: unknown[] = [];
  let cursor = 0;
  const calls: unknown[][] = [];
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], (value: any) => {
        state[index] = typeof value === 'function' ? value(state[index]) : value;
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useEffect: noop, useLayoutEffect: noop,
    useMemo: (compute: () => unknown) => compute(),
    useCallback: (callback: unknown) => callback,
  };
  const module = { exports: {} as Record<string, (props: object) => React.ReactElement> };
  new Function('require', 'module', 'exports', 'document', 'window', 'innerWidth', 'innerHeight',
    transformSync(readFileSync(path, 'utf8'), { loader: 'tsx', format: 'cjs' }).code)(
    (id: string) => id === 'react' ? hooks
      : id === 'react-dom' ? { createPortal: (child: unknown) => child }
      : id.endsWith('.css') ? {}
      : id === './DesktopIconLabel' ? { DesktopIconLabel: () => null }
      : id === '../../services/storage' ? { storage: {
        getUserSettings: () => ({ language: 'en' }),
        saveUserSettings: (value: unknown) => { calls.push(['local-write', value]); return value; },
        saveManualBookmark: (value: unknown) => { calls.push(['bookmark-write', value]); return value; },
        createFolder: (name: string) => { calls.push(['folder-write', name]); return { id: 'created', name }; },
      } } : require(id),
    module, module.exports, { body: {} }, { matchMedia: () => ({ matches: false }) }, 1440, 1000,
  );
  const props = {
    bookmarks, folders: [], plugins: [], viewMode: 'icon', language: 'en',
    desktopLayout: layout(), dockBookmarkIds: ['one', 'two'], showTools: false,
    onChangeViewMode: noop, onOpenBookmark: noop, onOpenTool: noop, onQuickAdd: noop,
    onUnpinFromDesktop: (id: string) => calls.push(['legacy-unpin', id]),
    onDesktopAction: ((actions: unknown) => { calls.push(['desktop', actions]); }) as ((actions: unknown) => void) | undefined,
    onToggleDockBookmark: noop,
    onShowToast: (message: string) => calls.push(['toast', message]),
    ...overrides,
  };
  const render = () => {
    cursor = 0;
    return module.exports[kind === 'desktop' ? 'DesktopView' : 'BottomDock'](props);
  };
  const all = () => nodes(render());
  const find = (predicate: (node: React.ReactElement<any>) => boolean) => {
    const node = all().find(predicate);
    assert.ok(node, 'Expected rendered control'); return node;
  };
  const button = (label: string) => find(node =>
    node.props['aria-label'] === label || node.props.title === label || (node.type === 'button' && content(node) === label));
  const item = (id: string) => find(node => node.props['data-desktop-id'] === id);
  const event = () => ({
    preventDefault: noop, stopPropagation: noop, clientX: 200, clientY: 200,
    currentTarget: { focus: noop, getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 50, width: 96 }) },
    dataTransfer: { setData: noop, setDragImage: noop },
  });
  const menu = async (id: string, action: string) => {
    item(id).props.onContextMenu(event());
    await button(action).props.onClick();
  };
  return { all, find, button, item, event, menu, props, calls };
}

test('desktop single unpin uses one desktop command, never the legacy unpin callback', async () => {
  const view = harness('desktop');
  await view.menu('one', 'Remove from desktop');
  view.find(node => !!node.props.confirmation).props.confirmation.action();
  assert.deepEqual(view.calls, [['desktop', [{ type: 'desktop.unpin', bookmarkId: 'one' }]]]);
});

for (const operation of ['save', 'create-folder'] as const) {
  test(`desktop bookmark ${operation} marks post-commit refresh failure uncertain without another write`, async () => {
    let refreshes = 0;
    const view = harness('desktop', {
      onLibraryChanged: () => { refreshes++; throw new Error('READ_FAILED'); },
    });
    await view.menu('one', 'Edit bookmark');
    const form = view.find(node => !!node.props.onSave && !!node.props.bookmark);
    await assert.rejects(async () => operation === 'save'
      ? form.props.onSave({ title: 'Changed' })
      : form.props.onCreateFolder('New archive folder'), /COMMIT_UNCERTAIN/);
    assert.equal(refreshes, 1);
    assert.equal(view.calls.filter(call => /-write$/.test(String(call[0]))).length, 1);
    assert.equal(view.calls.some(call => call[0] === 'toast'), false);
  });
}

test('desktop taskbar membership never derives from legacy desktop flags', async () => {
  for (const [ids, label] of [[[], 'Pin to Taskbar'], [undefined, 'Pin to Taskbar']] as const) {
    const view = harness('desktop', { dockBookmarkIds: ids });
    view.item('one').props.onContextMenu(view.event());
    assert.ok(view.button(label));
  }
});

test('desktop creation without a mutation owner cannot report a successful create', async () => {
  const view = harness('desktop', { onDesktopAction: undefined });
  await view.button('New desktop folder').props.onClick();
  const dialog = view.all().find(node => !!node.props.onCreate);
  if (dialog) assert.throws(() => dialog.props.onCreate('Kept input'));
  assert.equal(view.all().some(node => !!node.props.onCreate), false);
  assert.match(content(view.find(node => node.props.role === 'alert')), /unavailable|cannot|not available/i);
  assert.equal(view.calls.some(call => call[0] === 'desktop'), false);
});

test('unavailable desktop layout never renders legacy pinned assets or allows unprotected creation', async () => {
  const view = harness('desktop', { desktopLayout: null });
  assert.equal(view.all().filter(node => node.props['data-desktop-id']).length, 0);
  await view.button('New desktop folder').props.onClick();
  assert.equal(view.all().some(node => !!node.props.onCreate), false);
  assert.equal(view.calls.some(call => call[0] === 'desktop' || call[0] === 'legacy-unpin'), false);
  assert.match(content(view.find(node => node.props.role === 'alert')), /unavailable/i);
});

test('desktop folder rename with no mutation owner retains the edit form and input', async () => {
  const view = harness('desktop');
  await view.menu('group', 'Rename folder');
  view.find(node => node.type === 'input' && node.props['aria-label'] === '文件夹名称')
    .props.onChange({ target: { value: 'My draft' } });
  view.props.onDesktopAction = undefined;
  await view.find(node => node.type === 'form' && node.props['aria-label'] === 'Rename folder').props.onSubmit(view.event());
  assert.equal(view.find(node => node.type === 'input').props.value, 'My draft');
  assert.match(content(view.find(node => node.props.role === 'alert')), /unavailable|cannot|not available/i);
});

test('desktop folder create delegates exactly one command', async () => {
  const view = harness('desktop');
  await view.button('New desktop folder').props.onClick();
  view.find(node => !!node.props.onCreate).props.onCreate('New group');
  assert.equal(view.calls.length, 1);
  const [owner, actions] = view.calls[0] as [string, Record<string, unknown>[]];
  assert.equal(owner, 'desktop');
  assert.equal(actions.length, 1);
  assert.deepEqual({ ...actions[0], id: 'generated' }, {
    type: 'desktop.folder.create', id: 'generated', name: 'New group', shortcutIds: [], index: 0,
  });
});

test('desktop folder rename delegates once and closes only after success', async () => {
  const view = harness('desktop');
  await view.menu('group', 'Rename folder');
  await view.find(node => node.type === 'input').props.onChange({ target: { value: 'Renamed' } });
  await view.find(node => node.type === 'form').props.onSubmit(view.event());
  assert.deepEqual(view.calls, [['desktop', [{ type: 'desktop.folder.rename', id: 'group', name: 'Renamed' }]]]);
  assert.equal(view.all().some(node => node.type === 'form'), false);
});

test('desktop shortcut move delegates once and closes only after success', async () => {
  const view = harness('desktop');
  await view.menu('one', 'Move to desktop folder…');
  await view.find(node => node.type === 'form').props.onSubmit(view.event());
  assert.deepEqual(view.calls, [['desktop', [{
    type: 'desktop.move', ref: { kind: 'shortcut', id: 's-one' },
    to: { kind: 'folder', folderId: 'group', index: 0 },
  }]]]);
  assert.equal(view.all().some(node => node.type === 'form'), false);
});

for (const [label, mode] of [
  ['Dissolve desktop folder', 'dissolve'],
  ['Remove desktop folder and shortcuts…', 'remove-shortcuts'],
] as const) {
  test(`desktop ${mode} confirmation delegates once`, async () => {
    const view = harness('desktop');
    await view.menu('group', label);
    view.find(node => !!node.props.confirmation).props.confirmation.action();
    assert.deepEqual(view.calls, [['desktop', [{ type: 'desktop.folder.remove', id: 'group', mode }]]]);
  });
}

for (const [cause, expected] of [
  [new Error('CONFLICT'), /library.*another tab/i],
  [new Error('COMMIT_UNCERTAIN'), /uncertain.*refresh.*library/i],
  [new DOMException('full', 'QuotaExceededError'), /storage is full/i],
] as const) {
  test(`desktop drag reorder ${cause.message} calls owner once, keeps layout and uses library feedback`, async () => {
    const calls: unknown[] = [];
    const view = harness('desktop', { onDesktopAction: (actions: unknown) => { calls.push(actions); throw cause; } });
    const before = structuredClone(view.props.desktopLayout);
    view.item('one').props.onDragStart(view.event());
    const grid = view.find(node => node.props['data-testid'] === 'desktop-grid');
    grid.props.onDragOver({ ...view.event(), clientX: 950, clientY: 300 });
    await view.find(node => node.props['data-testid'] === 'desktop-grid').props.onDrop(view.event());
    assert.equal(calls.length, 1);
    assert.deepEqual(view.props.desktopLayout, before);
    const message = content(view.find(node => node.props.role === 'alert'));
    assert.match(message, expected);
    if (cause.message === 'COMMIT_UNCERTAIN') assert.doesNotMatch(message, /not saved|not applied|then try again/i);
  });
}

test('taskbar reorder invokes parent once and displays no optimistic reorder on false', async () => {
  const calls: unknown[] = [];
  const view = harness('dock', { onUpdateDockSettings: (updates: unknown) => { calls.push(updates); return false; } });
  view.all().filter(node => node.props.draggable)[0].props.onDragStart(view.event());
  view.all().filter(node => node.props.draggable)[1].props.onDrop(view.event());
  assert.deepEqual(calls, [{ dockBookmarkIds: ['two', 'one'] }]);
  assert.deepEqual(view.all().filter(node => node.props.draggable).map(node => node.key), ['one', 'two']);
  assert.equal(view.calls.some(call => call[0] === 'local-write'), false);
});

test('taskbar reorder throwing uncertainty uses library feedback and does not fall back to another write', async () => {
  let count = 0;
  const view = harness('dock', {
    onUpdateDockSettings: () => { count++; throw new Error('COMMIT_UNCERTAIN'); },
  });
  view.all().filter(node => node.props.draggable)[0].props.onDragStart(view.event());
  view.all().filter(node => node.props.draggable)[1].props.onDrop(view.event());
  assert.equal(count, 1);
  assert.deepEqual(view.all().filter(node => node.props.draggable).map(node => node.key), ['one', 'two']);
  const message = content(view.find(node => node.props.role === 'alert'));
  assert.match(message, /uncertain.*refresh.*library/i);
  assert.doesNotMatch(message, /settings|not saved|not applied/i);
  assert.equal(view.calls.some(call => call[0] === 'local-write'), false);
});

test('taskbar size failure remains settings scoped', async () => {
  const view = harness('dock', {
    onUpdateDockSettings: () => { throw new Error('COMMIT_UNCERTAIN'); },
  });
  view.find(node => node.type === 'aside').props.onContextMenu(view.event());
  await view.find(node => node.props.type === 'range').props.onChange({ target: { value: '70' } });
  assert.match(content(view.find(node => node.props.role === 'alert')), /settings.*uncertain/i);
});

test('taskbar unpin uncertainty uses library feedback and invokes its owner once', async () => {
  let count = 0;
  const view = harness('dock', {
    onToggleDockBookmark: () => { count++; throw new Error('COMMIT_UNCERTAIN'); },
  });
  view.find(node => node.type === 'button' && !!node.props.onContextMenu).props.onContextMenu(view.event());
  await view.button('Unpin from Taskbar').props.onClick();
  assert.equal(count, 1);
  assert.match(content(view.find(node => node.props.role === 'alert')), /uncertain.*refresh.*library/i);
  assert.equal(view.calls.some(call => call[0] === 'local-write'), false);
});

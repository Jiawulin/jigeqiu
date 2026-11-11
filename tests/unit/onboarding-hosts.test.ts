import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import { transformSync } from 'esbuild';

const noop = () => {};
type Node = React.ReactElement<Record<string, any>>;
function elements(tree: React.ReactNode): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return [];
  return [tree as Node, ...elements(tree.props.children)];
}
function TaskHint() { return null; }
function harness(file: string, name: string, props: Record<string, any>, overrides: Record<string, any> = {}) {
  const path = new URL(`../../src/components/${file}.tsx`, import.meta.url);
  const require = createRequire(path);
  const state: any[] = [];
  const effects: (() => void)[] = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial: any) {
      const at = cursor++;
      if (!(at in state)) state[at] = typeof initial === 'function' ? initial() : initial;
      return [state[at], (value: any) => { state[at] = typeof value === 'function' ? value(state[at]) : value; }];
    },
    useRef(initial: any) {
      const at = cursor++;
      if (!(at in state)) state[at] = { current: initial };
      return state[at];
    },
    useMemo(factory: () => any) { cursor++; return factory(); },
    useEffect(effect: () => void, deps?: any[]) {
      const at = cursor++;
      if (!(at in state) || !deps || deps.some((dep, i) => !Object.is(dep, state[at]?.[i]))) {
        state[at] = deps;
        effects.push(effect);
      }
    },
    useLayoutEffect() { cursor++; },
  };
  const source = readFileSync(path, 'utf8') + (name === 'BookmarkDialogSession' ? '\nexport { BookmarkDialogSession };' : '');
  const module = { exports: {} as Record<string, (props: any) => React.ReactNode> };
  const loadGestureHook = () => {
    const hookPath = new URL('../../src/components/desktop/use-launchpad-gestures.ts', import.meta.url);
    const hookRequire = createRequire(hookPath);
    const hookModule = { exports: {} };
    new Function('require', 'module', 'exports', transformSync(readFileSync(hookPath, 'utf8'), {
      loader: 'ts', format: 'cjs',
    }).code)((id: string) => id === 'react' ? hooks : hookRequire(id), hookModule, hookModule.exports);
    return hookModule.exports;
  };
  new Function('require', 'module', 'exports', transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)(
    (id: string) => id === 'react' ? hooks : id === './use-launchpad-gestures' ? loadGestureHook()
      : id === '../onboarding/TaskHint' ? { TaskHint }
      : id.endsWith('.css') ? {} : overrides[id]
        ?? (/\/(?:DesktopConfirmPopover|DesktopIconLabel|FaviconImage|LaunchpadMark|MenuActionLabel)$/.test(id)
          ? new Proxy({}, { get: () => () => null }) : require(id)), module, module.exports,
  );
  const render = () => {
    cursor = 0;
    const tree = module.exports[name](props);
    effects.splice(0).forEach(effect => effect());
    return elements(tree);
  };
  return { render, props, hint: () => render().find(node => node.type === TaskHint) };
}

test('add hints follow real URL validation and exit teaching without closing or notifying', () => {
  let exits = 0, closes = 0;
  const events: unknown[] = [];
  const view = harness('common/BookmarkDialog', 'BookmarkDialogSession', {
    isOpen: true, folders: [], existingBookmarks: [], onSave: noop,
    onClose: () => { closes++; },
    onboarding: { task: 'add', onExit: () => { exits++; }, onEvent: (event: unknown) => events.push(event) },
  });
  assert.equal(view.hint()?.props.message, 'onboardingAddUrl');
  const change = (value: string) => view.render().find(node => node.props.id === 'bookmark-url')!.props.onChange({ target: { value } });
  change('example.com');
  assert.equal(view.hint()?.props.message, 'onboardingAddDetails');
  change('javascript:alert(1)');
  assert.equal(view.hint()?.props.message, 'onboardingAddUrl');
  view.hint()!.props.onDismiss();
  assert.equal(exits, 1);
  assert.equal(closes, 0);
  assert.deepEqual(events, []);
  view.props.onboarding = undefined;
  assert.equal(view.hint(), undefined);
});

test('quick add defaults to pinning but accepts an explicit false and forwards onboarding', () => {
  const onboarding = { task: 'add', onExit: noop, onEvent: noop };
  const view = harness('desktop/QuickAddModal', 'QuickAddModal', {
    onSaveBookmark: noop, onCreateFolderInline: noop, onboarding,
  }, { '../common/BookmarkDialog': { BookmarkDialog: () => null } });
  assert.equal(view.render()[0].props.defaultPinToDesktop, true);
  view.props.defaultPinToDesktop = false;
  assert.equal(view.render()[0].props.defaultPinToDesktop, false);
  assert.equal(view.render()[0].props.onboarding, onboarding);
});

test('HTML import reports stages, cancellation and success only after parent refresh returns', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    locks: { request: async (_: string, action: () => void) => action() },
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else Reflect.deleteProperty(globalThis, 'navigator');
  });
  for (const throws of [false, true]) {
    const events: any[] = [];
    const preview = { base: {}, library: {}, counts: { bookmarks: 1, folders: 0, skipped: 0, invalid: 0 } };
    const view = harness('account/PrototypeChromeImport', 'PrototypeChromeImport', {
      onImported: () => { events.push('refreshed'); if (throws) throw new Error('refresh'); },
      onboarding: { task: 'import', onExit: noop, onEvent: (event: unknown) => events.push(event) },
    }, {
      '../../services/storage': { storage: {
        mutate: async (action: () => unknown) => action(),
        readLibrary: () => ({}), commitImportedLibrary: noop,
      } },
      '../../services/import-export/prototype-import': { prepareChromeLibraryImport: () => ({ ok: true, value: preview }) },
    });
    assert.equal(view.hint()?.props.message, 'onboardingImportFile');
    const choose = () => view.render().find(node => node.props.type === 'file')!.props.onChange({
      target: { files: [{ size: 10, name: 'synthetic.html', text: async () => '<html />' }], value: '' },
    });
    await choose();
    assert.equal(view.hint()?.props.message, 'onboardingImportPreview');
    assert.deepEqual(events, [{ type: 'import-stage', stage: 'reading' }, { type: 'import-stage', stage: 'preview' }]);
    view.render().find(node => node.type === 'button' && node.props.onClick.name === 'cancel')!.props.onClick();
    assert.deepEqual(events.at(-1), { type: 'import-stage', stage: 'cancel' });
    await choose();
    await view.render().filter(node => node.type === 'button').at(-1)!.props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(events.some(event => event.type === 'import-success'), !throws);
    if (!throws) assert.deepEqual(events.slice(-2), ['refreshed', { type: 'import-success' }]);
  }
});

test('launchpad emits query/menu changes once even with recreated callbacks and replaces teaching unpin', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    activeElement: null, addEventListener: noop, removeEventListener: noop,
  } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener: noop, removeEventListener: noop } });
  try {
    const events: any[] = [];
    const bookmark = { id: 'one', title: 'Example', url: 'https://example.com', domain: 'example.com', pinnedToDesktop: true, createdAt: 1, updatedAt: 1 };
    const view = harness('desktop/Launchpad', 'Launchpad', {
      isOpen: true, bookmarks: [bookmark], folders: [], onClose: noop, onOpenBookmark: noop,
      onTogglePinDesktop: () => { throw new Error('must not unpin'); },
      onRevealDesktop: (id: string) => events.push(id),
      onboarding: { task: 'pin', onExit: noop, onEvent: (event: unknown) => events.push(event) },
    }, { '../../i18n': { createTranslator: () => (key: string) => key === 'onboardingViewShortcut' ? 'View pinned shortcut' : key } });
    assert.equal(view.hint()?.props.message, 'onboardingPinSearch');
    const before = events.length;
    view.props.onboarding = { ...view.props.onboarding, onEvent: (event: unknown) => events.push(event) };
    view.render();
    assert.equal(events.length, before);
    view.render().find(node => node.props.type === 'search')!.props.onChange({ target: { value: 'Example' } });
    assert.equal(view.hint()?.props.message, 'onboardingPinChoose');
    assert.deepEqual(events.at(-1), { type: 'pin-query', firstId: 'one', hasQuery: true });
    view.render().find(node => node.props['data-onboarding'] === 'pin-more')!.props.onClick({
      preventDefault: noop, stopPropagation: noop, clientX: 0, clientY: 0,
    });
    assert.equal(view.hint()?.props.message, 'onboardingPinAction');
    assert.deepEqual(events.at(-1), { type: 'pin-menu', bookmarkId: 'one' });
    const reveal = view.render().find(node => node.props.role === 'menuitem' && /查看|View/.test(node.props['aria-label']));
    assert.ok(reveal);
    await reveal.props.onClick();
    assert.ok(events.includes('one'));
    assert.equal(view.hint()?.props.message, 'onboardingPinChoose');
    assert.deepEqual(events.at(-1), { type: 'pin-menu', bookmarkId: null });
    view.render().find(node => node.props.type === 'search')!.props.onChange({ target: { value: 'no match' } });
    view.render();
    assert.deepEqual(events.at(-1), { type: 'pin-query', firstId: null, hasQuery: true });
    assert.equal(view.render().some(node => node.props['data-onboarding'] === 'pin-more'), false);
    view.props.onboarding = undefined;
    const eventCount = events.length;
    assert.equal(view.hint(), undefined);
    assert.equal(events.length, eventCount);
    view.props.isOpen = false;
    view.render();
    assert.equal(view.hint(), undefined);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('host anchors and import forwarding live on actual controls', () => {
  const read = (file: string) => readFileSync(new URL(`../../src/components/${file}.tsx`, import.meta.url), 'utf8');
  assert.match(read('account/UserCenterView'), /<PrototypeChromeImport[^>]*onboarding=\{onboarding\}/);
  assert.match(read('account/PrototypeChromeImport'), /<section[^>]*data-onboarding="html-import"/);
  assert.match(read('account/PrototypeChromeImport'), /<input[^>]*data-onboarding="import-file"/);
  assert.match(read('account/JsonAssetTransfer'), /<button[^>]*data-onboarding="json-export"[^>]*onClick=\{exportAssets\}/);
  assert.match(read('common/BookmarkDialog'), /<input[^>]*data-onboarding="add-url"/);
  assert.match(read('common/BookmarkDialog'), /<input[^>]*data-onboarding="add-title"/);
});

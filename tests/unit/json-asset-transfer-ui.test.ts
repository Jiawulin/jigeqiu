import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { JsonAssetTransfer } from '../../src/components/account/JsonAssetTransfer';
import type { JsonAssetPreview } from '../../src/services/import-export/prototype-json';

const path = new URL('../../src/components/account/JsonAssetTransfer.tsx', import.meta.url);
const preview: Pick<JsonAssetPreview, 'counts' | 'notices'> = {
  counts: { bookmarks: 2, folders: 1, collections: 3, skipped: 4 },
  notices: [
    { code: 'IGNORED_NON_ASSET_FIELD', details: { field: 'settings' } },
    { code: 'IMPORT_BOOKMARK_SKIPPED', details: { differences: [{ notes: 'different note' }] } },
    { code: 'IMPORT_BOOKMARK_LINK_DETACHED', details: { itemId: 'detached-item' } },
  ],
};
function nodes(tree: React.ReactNode): React.ReactElement<any>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
function harness(language = 'en', result: Pick<JsonAssetPreview, 'counts' | 'notices'> = preview) {
  const states: unknown[] = [], refs: { current: any }[] = [], cleanups: (() => void)[] = [];
  let stateIndex = 0, refIndex = 0;
  const calls: unknown[][] = [];
  let failure = false;
  let previewFailure = '';
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value: any) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useRef(initial: unknown) { return refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }); },
    useEffect(effect: () => (() => void) | void) {
      if (!cleanups.length) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
    },
  };
  const storage = {
    mutate: async (action: () => unknown) => action(),
    previewJsonAssetImport(text: string, copies: boolean) {
      calls.push(['preview', text, copies]);
      if (previewFailure) throw new Error(previewFailure);
      return result;
    },
    commitJsonAssetImport(value: unknown) { calls.push(['commit', value]); if (failure) throw new Error('CONFLICT'); },
    exportJsonBackup() { calls.push(['export']); return '{"assets":true}'; },
  };
  const require = createRequire(path);
  const module = { exports: {} as { JsonAssetTransfer: (props: object) => React.ReactElement } };
  const code = transformSync(readFileSync(path, 'utf8'), { loader: 'tsx', format: 'cjs' }).code;
  new Function('require', 'module', 'exports', code)((id: string) => {
    if (id === 'react') return hooks;
    if (id === '../../services/storage') return { storage };
    return require(id);
  }, module, module.exports);
  const props = { language, onImported: () => calls.push(['imported']) };
  const render = () => { stateIndex = 0; refIndex = 0; return module.exports.JsonAssetTransfer(props); };
  const find = (label: string) => nodes(render()).find(node =>
    node.props['aria-label'] === label || (node.type === 'button' && nodes(node).some(child => child.props.children === label)))!;
  return {
    render, calls, find, fail: () => { failure = true; },
    failPreview: (code = 'IMPORT_INVALID') => { previewFailure = code; }, unmount: () => cleanups.forEach(fn => fn()),
    choose: async (file: object) => {
      await find(language === 'zh' ? 'JSON 资产文件' : 'JSON asset file').props.onChange({ target: { files: [file], value: 'x' } });
    },
  };
}
test('SSR exposes localized asset-only import and export controls without decorative section cards', () => {
  for (const [language, label] of [['en', 'Export bookmark assets only'], ['zh', '仅导出收藏资产']] as const) {
    const html = renderToStaticMarkup(React.createElement(JsonAssetTransfer, { language, onImported() {} }));
    assert.match(html, new RegExp(label));
    assert.match(html, /type="file"/);
    assert.match(html, /accept="[^"]*\.json/);
    assert.doesNotMatch(html, /liquid-glass|rounded-(?:2xl|3xl)/);
    assert.match(html, language === 'zh' ? /私人备注.*妥善保管/ : /private notes.*secure/i);
  }
});
test('preview is read-only, displays all counts and notice details, and toggles duplicate policy', async () => {
  const h = harness();
  await h.choose({ name: 'assets.json', size: 20, text: async () => 'source' });
  assert.deepEqual(h.calls, [['preview', 'source', false]]);
  const html = renderToStaticMarkup(h.render());
  for (const value of ['2', '1', '3', '4', 'settings', 'different note', 'detached-item']) assert.ok(html.includes(value), value);
  await h.find('Keep duplicate copies').props.onChange({ target: { checked: true } });
  assert.deepEqual(h.calls[1], ['preview', 'source', true]);
  h.find('Cancel').props.onClick();
  assert.equal(h.calls.length, 2);
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /different note/);
});
test('oversized file fails before reading and canceled reads cannot restore previews', async () => {
  const h = harness();
  await h.choose({ name: 'huge.json', size: Number.MAX_SAFE_INTEGER, text: () => { throw new Error('must not read'); } });
  assert.equal(h.calls.length, 0);
  assert.match(renderToStaticMarkup(h.render()), /role="alert"/);
  let finish!: (text: string) => void;
  const pending = h.choose({ name: 'later.json', size: 20, text: () => new Promise(resolve => { finish = resolve; }) });
  h.find('Cancel').props.onClick();
  finish('late');
  await pending;
  assert.equal(h.calls.length, 0);
});
test('commit holds shared lock, failure preserves preview, and unmount suppresses queued writes and callbacks', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    locks: { async request(name: string, callback: () => void) {
      assert.equal(name, 'jigeqiu:prototype:library-import');
      await callback();
    } },
  } });
  try {
    const h = harness();
    await h.choose({ name: 'assets.json', size: 20, text: async () => 'source' });
    h.fail();
    await h.find('Import bookmarks').props.onClick();
    assert.match(renderToStaticMarkup(h.render()), /different note/);
    assert.match(renderToStaticMarkup(h.render()), /role="alert"/);
    assert.ok(!h.calls.some(call => call[0] === 'imported'));
    const fresh = harness();
    await fresh.choose({ name: 'assets.json', size: 20, text: async () => 'source' });
    let release!: () => void;
    (globalThis.navigator.locks.request as any) = async (_name: string, callback: () => void) => {
      await new Promise<void>(resolve => { release = resolve; }); await callback();
    };
    const pending = fresh.find('Import bookmarks').props.onClick();
    fresh.unmount();
    release();
    await pending;
    assert.ok(!fresh.calls.some(call => call[0] === 'commit' || call[0] === 'imported'));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

test('successful import commits exactly once inside the lock and only then refreshes', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const h = harness();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    locks: { async request(_name: string, callback: () => void) {
      h.calls.push(['locked']);
      await callback();
      h.calls.push(['unlocked']);
    } },
  } });
  try {
    await h.choose({ name: 'assets.json', size: 20, text: async () => 'source' });
    await h.find('Import bookmarks').props.onClick();
    assert.deepEqual(h.calls, [['preview', 'source', false], ['locked'], ['commit', preview], ['unlocked'], ['imported']]);
    assert.doesNotMatch(renderToStaticMarkup(h.render()), /different note/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

test('export downloads asset JSON and releases the generated object URL', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  const calls: string[] = [];
  const anchor = { href: '', download: '', click() { calls.push('click'); }, remove() { calls.push('remove'); } };
  URL.createObjectURL = blob => {
    assert.ok(blob instanceof Blob);
    assert.equal(blob.type, 'application/json;charset=utf-8');
    return 'blob:assets';
  };
  URL.revokeObjectURL = url => { assert.equal(url, 'blob:assets'); calls.push('revoke'); };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement() { return anchor; }, body: { appendChild() { calls.push('append'); } },
  } });
  try {
    const h = harness();
    h.find('Export bookmark assets only').props.onClick();
    assert.deepEqual(h.calls, [['export']]);
    assert.equal(anchor.href, 'blob:assets');
    assert.match(anchor.download, /^jigeqiu-assets-\d{4}-\d{2}-\d{2}\.json$/);
    assert.deepEqual(calls, ['append', 'click', 'remove', 'revoke']);
  } finally {
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('failed re-preview retains prior counts but disables confirmation until a valid preview exists', async () => {
  const h = harness();
  await h.choose({ name: 'assets.json', size: 20, text: async () => 'source' });
  h.failPreview();
  h.find('Keep duplicate copies').props.onChange({ target: { checked: true } });
  assert.match(renderToStaticMarkup(h.render()), /different note/);
  assert.match(renderToStaticMarkup(h.render()), /role="alert"/);
  assert.equal(h.find('Import bookmarks').props.disabled, true);
  await h.find('Import bookmarks').props.onClick();
  assert.ok(!h.calls.some(call => call[0] === 'commit'));
});

test('missing Web Locks never writes and retains the preview for recovery', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  try {
    const h = harness();
    await h.choose({ name: 'assets.json', size: 20, text: async () => 'source' });
    await h.find('Import bookmarks').props.onClick();
    assert.match(renderToStaticMarkup(h.render()), /Safe saving is unavailable/);
    assert.match(renderToStaticMarkup(h.render()), /different note/);
    assert.ok(!h.calls.some(call => call[0] === 'commit' || call[0] === 'imported'));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

test('unmount during a file read prevents previewing and refreshing', async () => {
  const h = harness();
  let finish!: (text: string) => void;
  const pending = h.choose({ name: 'later.json', size: 20, text: () => new Promise(resolve => { finish = resolve; }) });
  h.unmount();
  finish('late');
  await pending;
  assert.deepEqual(h.calls, []);
});

test('notices summarize duplicate differences and ignored fields with optional collapsed technical details', async () => {
  const result: Pick<JsonAssetPreview, 'counts' | 'notices'> = {
    counts: preview.counts,
    notices: [
      { code: 'IGNORED_NON_ASSET_FIELD', details: { field: 'settings' } },
      { code: 'IMPORT_BOOKMARK_SKIPPED', details: {
        sourceId: 'source-bookmark', targetId: 'target-bookmark',
        differences: [{ title: true, notes: true, keywords: true, icon: true, url: false }],
      } },
      { code: 'IMPORT_BOOKMARK_LINK_DETACHED', details: { itemId: 'detached-item' } },
      { code: 'FUTURE_NOTICE', details: { secretDetail: 'raw-detail-only' } },
    ],
  };
  for (const language of ['zh', 'en']) {
    const h = harness(language, result);
    await h.choose({ name: 'assets.json', size: 20, text: async () => 'source' });
    const tree = h.render();
    const html = renderToStaticMarkup(tree);
    assert.match(html, language === 'zh' ? /名称、私人备注、关键词、图标/ : /title, private notes, keywords, icon/);
    assert.match(html, language === 'zh' ? /已忽略设置/ : /Settings were ignored/);
    assert.match(html, language === 'zh' ? /条目保留.*关联已断开/ : /item is kept.*association is detached/);
    const details = nodes(tree).filter(node => node.type === 'details');
    assert.equal(details.length, 4);
    assert.ok(details.every(node => !node.props.open));
    const expandedOnly = new Set(details.flatMap(node => nodes(node)));
    assert.ok(nodes(tree).filter(node => node.type === 'pre').every(node => expandedOnly.has(node)));
    const outsideDetails = nodes(tree).filter(node => !expandedOnly.has(node) && typeof node.props.children === 'string')
      .map(node => node.props.children).join(' ');
    assert.doesNotMatch(outsideDetails, /raw-detail-only|FUTURE_NOTICE/);
    const ids = nodes(tree).find(node => typeof node.props.children === 'string' && node.props.children.includes('source-bookmark'));
    assert.ok(ids?.props.className.includes('text-slate-500'));
  }
});

test('long notice lists show twenty initially, report total, and expose every remaining notice on demand', async () => {
  const h = harness('en', {
    counts: preview.counts,
    notices: Array.from({ length: 43 }, (_, i) => ({
      code: 'IGNORED_NON_ASSET_FIELD', details: { field: `field-${i}` },
    })),
  });
  await h.choose({ name: 'assets.json', size: 20, text: async () => 'source' });
  assert.equal(nodes(h.render()).filter(node => node.type === 'li').length, 20);
  assert.match(renderToStaticMarkup(h.render()), /Showing 20 of 43 notices/);
  h.find('Show More Notices').props.onClick();
  assert.equal(nodes(h.render()).filter(node => node.type === 'li').length, 40);
  h.find('Show More Notices').props.onClick();
  assert.equal(nodes(h.render()).filter(node => node.type === 'li').length, 43);
  assert.match(renderToStaticMarkup(h.render()), /field-42/);
});

test('file version errors identify unsupported backup packages rather than local migration state', async () => {
  for (const language of ['zh', 'en']) for (const code of ['LEGACY_REQUIRES_PREVIEW', 'UNSUPPORTED_VERSION']) {
    const h = harness(language);
    h.failPreview(code);
    await h.choose({ name: 'old.json', size: 20, text: async () => 'source' });
    const html = renderToStaticMarkup(h.render());
    assert.match(html, language === 'zh' ? /不支持.*备份文件/ : /backup file.*not supported/i);
    if (code === 'LEGACY_REQUIRES_PREVIEW') assert.match(html, /1\.0\.0/);
    assert.doesNotMatch(html, /尚未迁移|migration preview|本机数据来自其他版本/);
  }
});

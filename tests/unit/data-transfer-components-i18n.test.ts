import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import { transformSync } from 'esbuild';
import { describeAssetError } from '../../src/services/import-export/ui-errors';

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
function harness(file: string, name: string, services: Record<string, unknown> = {}) {
  const path = new URL(`../../src/components/${file}.tsx`, import.meta.url);
  const require = createRequire(path);
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let cursor = 0;
  let refCursor = 0;
  const hooks = { ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value: any) => {
        states[index] = typeof value === 'function' ? value(states[index]) : value;
      }];
    },
    useRef(current: unknown) { return refs[refCursor++] ?? (refs[refCursor - 1] = { current }); },
    useEffect() {},
    useSyncExternalStore: () => false,
  };
  const module = { exports: {} as Record<string, (props: any) => React.ReactElement> };
  new Function('require', 'module', 'exports',
    transformSync(readFileSync(path, 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)(
    (id: string) => id === 'react' ? hooks : services[id] ?? require(id), module, module.exports,
  );
  const props = { language: 'en-US', onImported() {}, visible: true, onReload() {} };
  const render = () => { cursor = 0; refCursor = 0; return module.exports[name](props); };
  const find = (predicate: (node: React.ReactElement<any>) => boolean) => {
    const result = nodes(render()).find(predicate);
    assert.ok(result, 'Missing control');
    return result;
  };
  return { props, render, find };
}

test('Chrome import uses real translations and rerenders a file error after language changes', async () => {
  const view = harness('account/PrototypeChromeImport', 'PrototypeChromeImport');
  assert.equal((view.render().props as Record<string, unknown>)['aria-label'], 'Chrome bookmark import');
  await view.find(node => node.type === 'input').props.onChange({
    target: { files: [{ name: 'bad.html', size: 1, text: async () => { throw new Error('read'); } }], value: '' },
  });
  assert.match(text(view.render()), /Cannot read the file or local bookmarks/);
  view.props.language = 'zh';
  assert.match(text(view.render()), /无法读取文件或本机收藏，请保留原数据后重试。/);
});

test('JSON import retains error identity while switching locales', async () => {
  const view = harness('account/JsonAssetTransfer', 'JsonAssetTransfer', {
    '../../services/storage': { storage: { previewJsonAssetImport() { throw new Error('IMPORT_INVALID'); } } },
  });
  assert.equal((view.render().props as Record<string, unknown>)['aria-label'], 'Bookmark asset JSON');
  await view.find(node => node.type === 'input' && node.props.type === 'file').props.onChange({
    target: { files: [{ name: 'bad.json', size: 1, text: async () => '{}' }], value: '' },
  });
  assert.match(text(view.render()), /Invalid asset JSON/);
  view.props.language = 'zh';
  assert.match(text(view.render()), /无法识别此文件，请选择有效的 JSON 资产备份。/);
});

test('icon settings rerender failed saves and successful cache clearing in the current language', async () => {
  const view = harness('common/IconCacheSettings', 'IconCacheSettings', {
    '../../services/site-icons': {
      setThirdPartyIconsEnabled() { throw new Error('STORAGE_WRITE_FAILED'); },
      clearSiteIconCache: async () => {}, subscribeIconPreferences() {}, getThirdPartyIconsEnabled: () => false,
    },
  });
  assert.equal((view.render().props as Record<string, unknown>)['aria-label'], 'Website icons');
  view.find(node => node.props.role === 'switch').props.onChange({ target: { checked: true } });
  assert.match(text(view.render()), /Could not save icon preferences/);
  view.props.language = 'zh';
  assert.match(text(view.render()), /无法保存图标偏好，请检查浏览器存储权限/);
  await view.find(node => node.type === 'button').props.onClick();
  assert.match(text(view.render()), /图标缓存已清除，收藏数据未改变/);
  view.props.language = 'en-US';
  assert.match(text(view.render()), /Icon cache cleared. Bookmarks unchanged./);
});

test('library notice confirmation translates without discarding its open state', () => {
  const view = harness('common/LibraryChangeNotice', 'LibraryChangeNotice');
  assert.match(text(view.render()), /Another tab changed your library/);
  view.find(node => node.type === 'button' && text(node) === 'Reload').props.onClick();
  assert.ok(view.find(node => node.props.title === 'Reload the latest library?').props.isOpen);
  view.props.language = 'zh';
  assert.ok(view.find(node => node.props.title === '重新载入最新收藏库？').props.isOpen);
});

test('asset errors use the real translator with Chinese defaults, en-US, and uncertain outcomes', () => {
  assert.equal(describeAssetError('COMMIT_UNCERTAIN'), '保存结果无法确认，已停止后续写入。请刷新检查，不要清空浏览器数据。');
  assert.match(describeAssetError('COMMIT_UNCERTAIN', 'en-US'), /uncertain/);
  assert.match(describeAssetError('IMPORT_INVALID', 'en-US', 'json'), /Invalid asset JSON/);
});

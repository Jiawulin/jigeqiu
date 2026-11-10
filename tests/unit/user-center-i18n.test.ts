import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createTranslator } from '../../src/i18n';
import { managementMessages } from '../../src/i18n/management';
import { preferenceSaveError } from '../../src/services/preference-save-error';
import type { UserCenterView } from '../../src/components/account/UserCenterView';

type UserCenterViewProps = React.ComponentProps<typeof UserCenterView>;

const bookmark = {
  id: 'bm-1', title: 'Reference', url: 'https://example.com/reference', domain: 'example.com',
  category: '', folderId: 'folder-1', collectionIds: [], pinnedToDesktop: false, order: 0, createdAt: 1, updatedAt: 1,
};
const folder = {
  id: 'folder-1', name: 'Work', bookmarkIds: ['bm-1'], pinnedToDesktop: false, order: 0, createdAt: 1, updatedAt: 1,
};
const engine = {
  id: 'google', name: 'Google', keyword: 'g', urlTemplate: 'https://google.com/search?q={query}',
  icon: 'Search', isEnabled: true, isDefault: false, isCustom: true,
};

function harness(language: string | undefined, initialTab: 'bookmarks' | 'engines' | 'appearance' | 'import-export') {
  const path = new URL('../../src/components/account/UserCenterView.tsx', import.meta.url);
  const require = createRequire(path);
  const state: unknown[] = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
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
    useEffect: () => {},
  };
  const storage = {
    mutate: async (action: () => unknown) => action(),
    getSearchEngines: () => [engine],
    updateSearchEngine: () => {},
    deleteSearchEngine: () => {},
    deleteFolder: () => {},
    trashFolder: () => {},
    getFolders: () => [folder],
    createSearchEngine: (..._args: unknown[]) => engine,
    createFolder: (name: string) => ({ ...folder, id: 'created', name }),
    updateFolder: () => folder,
    moveBookmarks: () => {},
    deleteBookmarks: () => [bookmark],
    exportHtmlBookmarks: () => '<html/>',
    saveManualBookmark: () => bookmark,
  };
  const moduleMocks: Record<string, unknown> = {
    '../common/FaviconImage': { FaviconImage: () => null },
    '../common/BookmarkDialog': { BookmarkDialog: () => null },
    '../common/FolderTreeSelect': { FolderTreeSelect: ({ label }: { label: string }) => React.createElement('label', null, label) },
    '../common/folder-tree': require('../common/folder-tree'),
    '../common/IconCacheSettings': { IconCacheSettings: () => null },
    '../../services/storage': { storage },
    '../../services/search-engine-mutation': {
      withSearchEngineMutation: (action: () => unknown) => {
        try { return Promise.resolve(action()); } catch (error) { return Promise.reject(error); }
      },
    },
    '../common/Modal': { Modal: ({ children, title }: { children?: React.ReactNode; title?: string }) =>
      React.createElement('div', { 'data-modal-title': title }, children) },
    './PrototypeChromeImport': { PrototypeChromeImport: () => null },
    './JsonAssetTransfer': { JsonAssetTransfer: () => null },
    '../../services/folder-trash': require('../../services/folder-trash'),
    '../../services/collection-mutation': { withCollectionMutation: async (action: () => unknown) => action() },
    '../../services/preference-save-error': require('../../services/preference-save-error'),
    '../../services/library-mutation': require('../../services/library-mutation'),
    '../../i18n': { createTranslator },
  };
  const code = transformSync(readFileSync(path, 'utf8'), { loader: 'tsx', format: 'cjs' }).code;
  const module = { exports: {} as { UserCenterView: (props: UserCenterViewProps) => React.ReactElement } };
  new Function('require', 'module', 'exports', code)((id: string) => {
    if (id === 'react') return hooks;
    return moduleMocks[id] ?? require(id);
  }, module, module.exports);
  const toasts: string[] = [];
  const props: UserCenterViewProps = {
    initialTab, bookmarks: [bookmark], folders: [folder], searchEngines: [engine],
    userSettings: {
      language: language as UserCenterViewProps['userSettings']['language'],
      defaultSearchEngineId: 'other', dockBookmarkIds: [], showDock: true, dockIconSize: 48,
      appearanceMode: 'light-glass', wallpaperPreset: 'cyan-lake',
      desktopViewMode: 'icon', confirmBatchOpen: true, reduceMotion: false,
    },
    onSearchEnginesChanged: () => {},
    onUpdateSettings: () => true,
    onShowToast: message => toasts.push(message),
    onLibraryChanged: () => {},
    onSetDesktopPins: () => {},
  };
  return {
    props, toasts, storage,
    render() { cursor = 0; return module.exports.UserCenterView(props); },
  };
}

function elements(node: React.ReactNode): React.ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
  if (typeof node.type === 'function' && node.type.name === 'Pagination') {
    return [node, ...elements((node.type as (props: object) => React.ReactNode)(node.props))];
  }
  return [node, ...elements(node.props.children)];
}
function textContent(node: React.ReactNode): string {
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return '';
  return textContent(node.props.children);
}
const html = (view: ReturnType<typeof harness>) => renderToStaticMarkup(view.render());
function findButton(view: ReturnType<typeof harness>, name: string) {
  const button = elements(view.render()).find(node => node.type === 'button'
    && (node.props.title === name || node.props['aria-label'] === name || textContent(node.props.children) === name));
  assert.ok(button, `Missing button ${name}`);
  return button;
}

test('bookmark manager and folder creation modal render localized navigation, actions, search and fields', () => {
  for (const language of ['en-US', 'zh-CN']) {
    const en = language === 'en-US';
    const view = harness(language, 'bookmarks');
    const markup = html(view);
    assert.match(markup, en ? /Bookmark folders/ : /书签文件夹目录/);
    assert.match(markup, en ? /All bookmarks/ : /全部收藏/);
    assert.match(markup, en ? /Search by name, URL, or keywords/ : /按名称、网址或关键词搜索/);
    assert.match(markup, en ? /Add bookmark to this folder/ : /添加收藏到此目录/);
    findButton(view, en ? 'New folder' : '新建文件夹').props.onClick();
    const modalMarkup = html(view);
    assert.match(modalMarkup, en ? /Create bookmark folder/ : /新建书签文件夹/);
    assert.match(modalMarkup, en ? /Folder name/ : /文件夹名称/);
    assert.match(modalMarkup, en ? /Parent folder/ : /上级父文件夹/);
    assert.match(modalMarkup, en ? /Create folder/ : /创建文件夹/);
  }
});

test('search-engine help, list controls and add form are localized including validation guidance', () => {
  for (const language of ['en-US', 'zh-CN']) {
    const en = language === 'en-US';
    const view = harness(language, 'engines');
    const markup = html(view);
    assert.match(markup, en ? /Custom search engine management/ : /自定义搜索引擎管理/);
    assert.match(markup, en ? /Create search rules, enable or disable engines/ : /支持自定义搜索规则、启用与停用/);
    assert.match(markup, en ? /Command switching and search rules/ : /指令切换与搜索规则/);
    assert.match(markup, en ? /Set as default/ : /设为默认/);
    findButton(view, en ? 'Custom engine' : '自定义引擎').props.onClick();
    const form = html(view);
    assert.match(form, en ? /Search engine name/ : /搜索引擎名称/);
    assert.match(form, en ? /Command keyword \/ prefix/ : /指令关键字 \/ 前缀/);
    assert.match(form, en ? /Search URL template/ : /搜索 URL 规则模板/);
    assert.match(form, en ? /keep the \{query\} variable/i : /必须保留 \{query\} 变量/);
    assert.match(form, en ? /in desktop search to switch to this engine/ : /在桌面搜索框输入/);
    assert.match(form, en ? /Quick-fill a popular search engine/ : /常用引擎模板快速填入/);
  }
});

test('appearance, import/export descriptions and page actions use the selected locale', () => {
  const en = html(harness('en-US', 'appearance'));
  assert.match(en, /Appearance and wallpaper/);
  assert.match(en, /Taskbar preferences/);
  assert.match(en, /When hidden, the Taskbar no longer appears/);
  assert.match(en, /Compact \(34px\)/);
  assert.match(en, /Day mode/);
  assert.match(en, /Night mode/);
  assert.doesNotMatch(en, /Reduced transparency|Light glass|Dark glass/);
  assert.match(en, /Desktop wallpaper/);
  assert.match(en, /Standard \(48px\)/);
  const zh = html(harness('zh-CN', 'appearance'));
  assert.match(zh, /外观与壁纸个性化/);
  assert.match(zh, /任务栏偏好/);
  assert.match(zh, /大图标 \(74px\)/);
  assert.match(zh, /日间模式/);
  assert.match(zh, /夜间模式/);
  assert.doesNotMatch(zh, /降低透明度|浅色玻璃|深色玻璃/);
  assert.match(zh, /默认标准 \(48px\)/);
  assert.match(html(harness('en-US', 'import-export')), /Export standard HTML bookmarks \(Chrome \/ Edge\)/);
  assert.match(html(harness('zh-CN', 'import-export')), /导出标准 HTML 书签文件 \(Chrome \/ Edge 适用\)/);
});

test('engine and desktop pin actions announce localized success and guard messages', async () => {
  const view = harness('en-US', 'engines');
  await findButton(view, 'Click to disable this search engine').props.onClick();
  assert.deepEqual(view.toasts, ['Disabled search engine "Google"']);
  const defaultEngine = harness('zh-CN', 'engines');
  defaultEngine.props.userSettings.defaultSearchEngineId = 'google';
  findButton(defaultEngine, '点击停用该搜索引擎').props.onClick();
  assert.deepEqual(defaultEngine.toasts, ['默认搜索引擎不能停用，请先将其他引擎设为默认']);

  const bookmarks = harness('en-US', 'bookmarks');
  await findButton(bookmarks, 'Pin to desktop').props.onClick();
  assert.deepEqual(bookmarks.toasts, ['Shortcut "Reference" sent to desktop']);
});

test('engine entry labels use Lucide icons and search examples use the same Chinese sample in both locales', () => {
  for (const language of ['zh', 'en']) {
    const en = language === 'en';
    const view = harness(language, 'engines');
    const library = findButton(view, en ? 'Engine library' : '引擎库');
    const custom = findButton(view, en ? 'Custom engine' : '自定义引擎');
    assert.match(renderToStaticMarkup(library), /lucide-library/);
    assert.match(renderToStaticMarkup(custom), /lucide-plus/);
    const markup = html(view);
    assert.match(markup, /gh 记个球/);
    assert.match(markup, /bili 记个球/);
    findButton(view, en ? 'Test search' : '测试搜索体验').props.onClick();
    const input = elements(view.render()).find(node => node.type === 'input'
      && node.props['aria-label'] === (en ? 'Test keywords' : '测试关键词'));
    assert.equal(input?.props.value, '记个球');
    const t = createTranslator(language);
    assert.equal(t('managerTestQueryFallback'), '记个球');
    assert.equal(t('managerSearchQueryFallback'), '记个球');
  }
});

test('engine deletion uses the shared modal, does not delete before confirmation and retains failed confirmation', async () => {
  for (const language of ['zh', 'en']) {
    const en = language === 'en';
    const view = harness(language, 'engines');
    let deletes = 0;
    let fail = false;
    view.storage.deleteSearchEngine = () => {
      deletes++;
      if (fail) throw new DOMException('Full', 'QuotaExceededError');
    };
    findButton(view, en ? 'Delete this search engine' : '删除该引擎').props.onClick();
    assert.equal(deletes, 0);
    const modal = elements(view.render()).find(node => node.props.isOpen
      && node.props.title === (en ? 'Delete search engine "Google"?' : '确定删除搜索引擎「Google」吗？'));
    assert.ok(modal);
    assert.equal(modal.props.contained, true);
    assert.equal(modal.props.maxWidth, 'sm');
    fail = true;
    await findButton(view, en ? 'Delete engine' : '删除引擎').props.onClick();
    assert.equal(deletes, 1);
    assert.ok(elements(view.render()).some(node => node.props.role === 'alert'));
    fail = false;
    await findButton(view, en ? 'Delete engine' : '删除引擎').props.onClick();
    assert.equal(deletes, 2);
    assert.ok(view.toasts.includes(en ? 'Deleted search engine "Google"' : '已删除搜索引擎「Google」'));
    assert.ok(!elements(view.render()).some(node => node.props.isOpen && node.props.title === modal.props.title));
  }
});

test('folder edit, batch move, pagination and empty states use the selected locale', () => {
  for (const language of ['en-US', 'zh-CN']) {
    const en = language === 'en-US';
    const view = harness(language, 'bookmarks');
    findButton(view, en ? 'Rename or change folder hierarchy' : '重命名或调整层级')
      .props.onClick({ stopPropagation() {} });
    assert.match(html(view), en ? /Edit folder properties/ : /编辑文件夹属性/);
    const selectAll = elements(view.render()).find(node => node.type === 'input'
      && node.props['aria-label'] === (en ? 'Select all bookmarks on this page' : '选择当前页全部书签'));
    assert.ok(selectAll);
    selectAll.props.onChange();
    findButton(view, en ? 'Move to folder' : '转移文件夹').props.onClick();
    assert.match(html(view), en ? /Move 1 bookmarks to a folder/ : /将 1 个书签转移至文件夹/);
    assert.match(html(view), en ? /Destination folder/ : /目标文件夹/);
    assert.equal(textContent(findButton(view, en ? 'Next page' : '下一页')), en ? 'Next page' : '下一页');
    const search = elements(view.render()).find(node => node.type === 'input'
      && node.props.value === '' && node.props.placeholder);
    assert.ok(search);
    search.props.onChange({ target: { value: 'missing' } });
    assert.match(html(view), en ? /No bookmarks in this folder/ : /当前文件夹暂无书签/);
  }
});

test('engine URL validation keeps literal query syntax and all English manager surfaces avoid Chinese UI copy', () => {
  const view = harness('en-US', 'engines');
  findButton(view, 'Custom engine').props.onClick();
  for (const [label, value] of [
    ['Search engine name', 'Reference search'],
    ['Command keyword / prefix', 'ref'],
    ['Search URL template', 'https://example.com/search'],
  ]) {
    const input = elements(view.render()).find(node => node.type === 'input' && node.props['aria-label'] === label);
    assert.ok(input);
    input.props.onChange({ target: { value } });
  }
  const form = elements(view.render()).find(node => node.type === 'form');
  assert.ok(form);
  form.props.onSubmit({ preventDefault() {} });
  assert.match(html(view), /The search URL must contain the \{query\} placeholder/);
  assert.doesNotMatch(html(view).replaceAll('记个球', ''), /[\u4e00-\u9fff]/,
    'Only the explicitly requested shared sample may remain Chinese in English search UI');
  for (const tab of ['bookmarks', 'appearance', 'import-export'] as const) {
    assert.doesNotMatch(html(harness('en-US', tab)), /[\u4e00-\u9fff]/);
  }
});

test('HTML export failure uses localized feedback without claiming library mutation', () => {
  for (const language of ['en-US', 'zh-CN']) {
    const view = harness(language, 'import-export');
    view.storage.exportHtmlBookmarks = () => { throw new Error('read failed'); };
    findButton(view, language === 'en-US'
      ? 'Export standard HTML bookmarks (Chrome / Edge)'
      : '导出标准 HTML 书签文件 (Chrome / Edge 适用)').props.onClick();
    assert.match(html(view), language === 'en-US'
      ? /No library data was changed/ : /收藏库数据未修改/);
    assert.deepEqual(view.toasts, []);
  }
});

test('management dictionary provides matching placeholders and nonempty entries in both locales', () => {
  const slots = (value: string) => [...new Set([...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();
  for (const [key, value] of Object.entries(managementMessages)) {
    assert.ok(value.zh.trim() && value.en.trim(), key);
    assert.deepEqual(slots(value.zh), slots(value.en), key);
  }
});

const alertText = (view: ReturnType<typeof harness>) =>
  elements(view.render()).filter(node => node.props.role === 'alert').map(textContent).join('\n');
function setField(view: ReturnType<typeof harness>, label: string, value: string) {
  const input = elements(view.render()).find(node => node.type === 'input' && node.props['aria-label'] === label);
  assert.ok(input, `Missing field ${label}`);
  input.props.onChange({ target: { value } });
}
async function submitForm(view: ReturnType<typeof harness>) {
  const form = elements(view.render()).find(node => node.type === 'form');
  assert.ok(form);
  await form.props.onSubmit({ preventDefault() {} });
}
function expectRelocalizedCause(view: ReturnType<typeof harness>, cause: unknown, scope: 'settings' | 'library') {
  assert.equal(alertText(view), preferenceSaveError(cause, 'en', scope));
  view.props.userSettings.language = 'zh';
  assert.equal(alertText(view), preferenceSaveError(cause, 'zh', scope));
  view.props.userSettings.language = 'en';
  assert.equal(alertText(view), preferenceSaveError(cause, 'en', scope));
}

test('folder removal and bookmark deletion failures relocalize without resubmitting or closing', async () => {
  for (const operation of ['folder', 'bookmark'] as const) {
    const view = harness('en', 'bookmarks');
    const cause = new Error('COMMIT_UNCERTAIN');
    let attempts = 0;
    if (operation === 'folder') {
      view.storage.deleteFolder = () => { attempts++; throw cause; };
      findButton(view, 'Remove library folder…').props.onClick({ stopPropagation() {} });
      await findButton(view, 'Dissolve; keep contents').props.onClick();
    } else {
      view.storage.deleteBookmarks = () => { attempts++; throw cause; };
      findButton(view, 'Delete bookmark…').props.onClick();
      await findButton(view, 'Move to recycle bin').props.onClick();
    }
    expectRelocalizedCause(view, cause, 'library');
    assert.equal(attempts, 1);
    assert.deepEqual(view.toasts, []);
    assert.equal(view.props.bookmarks.length, 1);
  }
});

test('create, rename and batch move failures relocalize and retain folder drafts and selection', async () => {
  for (const operation of ['create', 'rename', 'move'] as const) {
    const view = harness('en', 'bookmarks');
    const cause = new DOMException('storage full', 'QuotaExceededError');
    let attempts = 0;
    if (operation === 'create') {
      view.storage.createFolder = () => { attempts++; throw cause; };
      findButton(view, 'New folder').props.onClick();
      setField(view, 'Folder name', 'Draft folder');
      await submitForm(view);
    } else if (operation === 'rename') {
      view.storage.updateFolder = () => { attempts++; throw cause; };
      findButton(view, 'Rename or change folder hierarchy').props.onClick({ stopPropagation() {} });
      setField(view, 'Folder name', 'Draft folder');
      await submitForm(view);
    } else {
      view.storage.moveBookmarks = () => { attempts++; throw cause; };
      const checkbox = elements(view.render()).find(node => node.props['aria-label'] === 'Select all bookmarks on this page');
      assert.ok(checkbox);
      checkbox.props.onChange();
      findButton(view, 'Move to folder').props.onClick();
      await findButton(view, 'Move bookmarks').props.onClick();
    }
    expectRelocalizedCause(view, cause, 'library');
    assert.equal(attempts, 1);
    if (operation === 'move') assert.match(html(view), /1 bookmarks selected/);
    else assert.match(html(view), /value="Draft folder"/);
    assert.deepEqual(view.toasts, []);
  }
});

test('engine template validation and save failures relocalize while keeping all draft fields', async () => {
  for (const validation of [true, false]) {
    const view = harness('en', 'engines');
    const cause = new DOMException('blocked', 'SecurityError');
    let attempts = 0;
    view.storage.createSearchEngine = () => { attempts++; throw cause; };
    findButton(view, 'Custom engine').props.onClick();
    setField(view, 'Search engine name', 'Draft search');
    setField(view, 'Command keyword / prefix', 'draft');
    const url = validation ? 'https://example.com/' : 'https://example.com/?q={query}';
    setField(view, 'Search URL template', url);
    await submitForm(view);
    if (validation) {
      assert.equal(alertText(view), createTranslator('en')('managerEngineUrlRequired', { query: '{query}' }));
      view.props.userSettings.language = 'zh';
      assert.equal(alertText(view), createTranslator('zh')('managerEngineUrlRequired', { query: '{query}' }));
      view.props.userSettings.language = 'en';
    } else expectRelocalizedCause(view, cause, 'settings');
    assert.match(html(view), /value="Draft search"/);
    assert.match(html(view), /value="draft"/);
    assert.ok(elements(view.render()).some(node => node.type === 'input' && node.props.value === url));
    assert.equal(attempts, validation ? 0 : 1);
    assert.deepEqual(view.toasts, []);
  }
});

test('HTML export failure and Chrome import locale follow a language change immediately', () => {
  const view = harness('en', 'import-export');
  let attempts = 0;
  view.storage.exportHtmlBookmarks = () => { attempts++; throw new Error('failed'); };
  findButton(view, 'Export standard HTML bookmarks (Chrome / Edge)').props.onClick();
  assert.equal(alertText(view), createTranslator('en')('managerHtmlExportFailed'));
  view.props.userSettings.language = 'zh';
  assert.equal(alertText(view), createTranslator('zh')('managerHtmlExportFailed'));
  const importer = elements(view.render()).find(node =>
    typeof node.type === 'function' && node.type.name === 'PrototypeChromeImport');
  assert.ok(importer);
  assert.equal(importer.props.language, 'zh');
  assert.equal(attempts, 1);
});

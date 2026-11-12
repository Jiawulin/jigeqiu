import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { captureScreenshots, layoutCases } from './helpers/layout-cases.mjs';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
const bookmark = (id, order) => ({
  id, title: `Synthetic ${id}`, url: `https://example.test/${id}`, domain: 'example.test',
  order, createdAt: 1, updatedAt: 2, category: '', tags: [], collectionIds: [],
  pinnedToDesktop: false, iconMode: 'text', iconBg: '#123456', notes: 'Synthetic note',
});
const core = {
  version: 1, bookmarks: [bookmark('one', 1), { ...bookmark('two', 0), folderId: 'library-folder' }],
  folders: [{ id: 'library-folder', name: 'Library', bookmarkIds: ['two'], order: 0, createdAt: 1, updatedAt: 2, pinnedToDesktop: false }],
  collections: [],
  desktopLayout: {
    shortcuts: [{ id: 'shortcut-one', bookmarkId: 'one' }, { id: 'shortcut-two', bookmarkId: 'two' }],
    folders: [{ id: 'desktop-folder', name: 'Desktop folder', shortcutIds: ['shortcut-two'] },
      { id: 'empty-folder', name: 'Empty folder', shortcutIds: [] }],
    root: [{ kind: 'desktop-folder', id: 'empty-folder' }, { kind: 'shortcut', id: 'shortcut-one' },
      { kind: 'desktop-folder', id: 'desktop-folder' }], dock: [],
  },
  dockBookmarkIds: ['two', 'one'],
};
const engines = [
  { id: 'custom-two', name: 'Second', keyword: 'two', urlTemplate: 'https://example.test/?q={query}', icon: 'Search', isDefault: false, isEnabled: false, isCustom: true },
  { id: 'custom-one', name: 'First', keyword: 'one', urlTemplate: 'https://example.test/search/{query}', icon: 'https://example.test/icon.png', isDefault: true, isEnabled: true, isCustom: true },
];
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  async function fresh(settings = { language: 'zh' }, seed) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await context.route('https://**/*', route => route.fulfill({ body: '' }));
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.evaluate(({ settings, seed }) => {
      localStorage.clear();
      localStorage.setItem('jipage_settings_v1', JSON.stringify(settings));
      if (seed) {
        localStorage.setItem('jipage_library_v2', JSON.stringify(seed.core));
        localStorage.setItem('jipage_search_engines_v1', JSON.stringify(seed.engines));
      }
    }, { settings, seed });
    await page.reload();
    return { context, page };
  }
  async function openTransfer(page, en = false) {
    await page.getByRole('banner').getByRole('button', { name: en ? 'Manage' : '管理中心', exact: true }).click();
    if (page.viewportSize().width < 768) {
      await page.getByRole('combobox', { name: en ? 'Management section' : '管理中心小节' }).selectOption('import-export');
    } else {
      await page.getByRole('navigation', { name: en ? 'Management navigation' : '管理中心导航' })
        .getByRole('button', { name: en ? 'Import & export' : '导入与导出', exact: true }).click();
    }
  }
  const { page: source } = await fresh({ language: 'zh', defaultSearchEngineId: 'custom-one' }, { core, engines });
  await openTransfer(source);
  assert.equal(await source.getByRole('tab', { name: '收藏导入导出', exact: true }).getAttribute('aria-selected'), 'true');
  await source.getByRole('tab', { name: '收藏导入导出', exact: true }).focus();
  await source.keyboard.press('End');
  await source.getByRole('region', { name: '资产与工作台', exact: true }).waitFor();
  assert.equal(await source.getByRole('term').filter({ hasText: /^历史网址单$/ }).count(), 0);
  await source.getByRole('term').filter({ hasText: /^收藏文件夹$/ }).waitFor();
  const downloadPending = source.waitForEvent('download');
  await source.getByRole('button', { name: '导出资产备份', exact: true }).click();
  const download = await downloadPending;
  const text = await readFile(await download.path(), 'utf8');
  const file = JSON.parse(text);
  assert.equal(file.format, 'jigeqiu-workbench');
  assert.deepEqual(file.desktop, core.desktopLayout);
  assert.deepEqual(file.taskbar, core.dockBookmarkIds);
  assert.deepEqual(file.search.engines, engines);
  assert.equal('settings' in file, false);
  const { page } = await fresh({ language: 'zh', wallpaperPreset: 'cyan-lake', reduceMotion: true, showDock: false });
  await openTransfer(page);
  await page.getByRole('tab', { name: '资产备份恢复', exact: true }).click();
  const state = () => page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
  const initial = await state();
  const choose = data => page.getByLabel('选择资产备份 JSON 文件', { exact: true }).setInputFiles({
    name: 'synthetic-backup.json', mimeType: 'application/json',
    buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
  });
  await choose(text);
  await page.getByRole('definition').filter({ hasText: '0 → 2' }).first().waitFor();
  assert.equal(await state(), initial, 'Preview is read-only');
  assert.equal(await page.getByRole('button', { name: '确认恢复并替换', exact: true }).isDisabled(), true);
  await page.getByRole('tab', { name: '收藏导入导出', exact: true }).click();
  const discard = page.getByRole('dialog', { name: '放弃当前文件预览？', exact: true });
  await discard.waitFor();
  await discard.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('checkbox', { name: /我已备份当前数据/ }).check();
  await page.evaluate(() => {
    const request = navigator.locks.request.bind(navigator.locks);
    const wait = new Promise(resolve => { window.releaseRestore = resolve; });
    navigator.locks.request = async (name, ...args) => {
      if (name === 'jigeqiu:prototype:library-import') await wait;
      return request(name, ...args);
    };
  });
  await page.getByRole('button', { name: '确认恢复并替换', exact: true }).click();
  assert.equal(await page.getByRole('tab', { name: '收藏导入导出', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('tab', { name: '资产备份恢复', exact: true }).isDisabled(), true);
  assert.equal(await state(), initial, 'Queued restore does not write before the lock');
  await page.evaluate(() => window.releaseRestore());
  await page.getByText('资产备份已恢复。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: '资产备份恢复', exact: true }).getAttribute('aria-selected'), 'true');
  const restored = await page.evaluate(() => ({
    core: JSON.parse(localStorage.getItem('jipage_library_v2')),
    engines: JSON.parse(localStorage.getItem('jipage_search_engines_v1')),
    settings: JSON.parse(localStorage.getItem('jipage_settings_v1')),
    journal: localStorage.getItem('jipage_workbench_restore_v1'),
  }));
  assert.deepEqual(restored.core.bookmarks, core.bookmarks);
  assert.deepEqual(restored.core.folders, core.folders);
  assert.deepEqual(restored.core.desktopLayout, core.desktopLayout);
  assert.deepEqual(restored.core.dockBookmarkIds, core.dockBookmarkIds);
  assert.deepEqual(restored.engines, engines);
  assert.equal(restored.settings.defaultSearchEngineId, 'custom-one');
  assert.equal(restored.settings.reduceMotion, true);
  assert.equal(restored.settings.showDock, false);
  assert.equal(restored.journal, null);
  // A full backup on the bookmark tab requires an explicit, workspace-free merge.
  await page.getByRole('tab', { name: '收藏导入导出', exact: true }).click();
  await page.getByRole('group', { name: '导入格式', exact: true }).getByRole('radio', { name: '记个球收藏 · JSON', exact: true }).check();
  const json = page.getByRole('region', { name: '收藏资产 JSON', exact: true });
  await json.getByLabel('JSON 资产文件', { exact: true }).setInputFiles({
    name: 'full.json', mimeType: 'application/json', buffer: Buffer.from(text),
  });
  await json.getByRole('status').filter({ hasText: '识别到资产备份 JSON，不是仅收藏 JSON。' }).waitFor();
  await json.getByRole('button', { name: '前往资产备份恢复', exact: true }).waitFor();
  const beforeBadJson = await state();
  await json.getByLabel('JSON 资产文件', { exact: true }).setInputFiles({
    name: 'jigeqiu-assets.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"unknown"}'),
  });
  await json.getByRole('alert').waitFor();
  assert.equal(await json.getByRole('status', { name: '导入预览', exact: true }).count(), 0,
    'Replacing a valid file with an invalid file must clear the old preview');
  assert.equal(await json.getByRole('button', { name: '确认导入收藏', exact: true }).isDisabled(), true);
  assert.equal(await state(), beforeBadJson);
  await json.getByLabel('JSON 资产文件', { exact: true }).setInputFiles({
    name: 'jigeqiu-assets.json', mimeType: 'application/json', buffer: Buffer.from(text),
  });
  await json.getByRole('status').filter({ hasText: '识别到资产备份 JSON，不是仅收藏 JSON。' }).waitFor();
  await json.getByRole('checkbox', { name: '保留重复副本', exact: true }).check();
  assert.equal(await json.getByRole('button', { name: '确认导入收藏', exact: true }).isDisabled(), true);
  await json.getByRole('checkbox', { name: '仅合并其中的收藏资产', exact: true }).check();
  await json.getByRole('button', { name: '确认导入收藏', exact: true }).click();
  await page.getByRole('button', { name: '查看收藏', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')).desktopLayout), core.desktopLayout);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')).dockBookmarkIds), core.dockBookmarkIds);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_search_engines_v1'))), engines);
  // Deselect workspace sections: preserve engines and remove only invalid retained entries.
  await page.getByRole('tab', { name: '资产备份恢复', exact: true }).click();
  const empty = { ...file, assets: { bookmarks: [], folders: [], collections: [] }, desktop: { shortcuts: [], folders: [], root: [], dock: [] }, taskbar: [] };
  await choose(empty);
  for (const name of ['桌面图标', '任务栏固定项', '搜索引擎']) await page.getByRole('checkbox', { name, exact: true }).uncheck();
  await page.getByText(/未恢复布局中将移除的失效入口（2）/).first().waitFor();
  await page.getByRole('checkbox', { name: /我已备份当前数据/ }).check();
  await page.getByRole('button', { name: '确认恢复并替换', exact: true }).click();
  await page.getByText('资产备份已恢复。', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')).dockBookmarkIds), []);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')).desktopLayout.folders.length), 2);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_search_engines_v1'))), engines);
  // Wrong-file guidance never writes, and switching requires explicit discard.
  const beforeWrongFile = await state();
  await choose({ format: 'jigeqiu-assets', schemaVersion: 1 });
  await page.getByRole('alert').filter({ hasText: '识别到收藏 JSON，不是资产备份。' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '确认恢复并替换', exact: true }).isDisabled(), true);
  assert.equal(await state(), beforeWrongFile, 'Wrong JSON type must never write');
  const beforeWrongSwitch = await state();
  await page.getByRole('button', { name: '前往收藏导入导出', exact: true }).click();
  await discard.getByRole('button', { name: '放弃预览并切换', exact: true }).click();
  assert.equal(await state(), beforeWrongSwitch);
  // Bookmark-panel layouts belong to transfer-formats; this suite owns restore previews.
  const layouts = layoutCases();
  const screenshots = captureScreenshots();
  if (screenshots) await mkdir('test-results/screenshots', { recursive: true });
  for (const { language, appearanceMode, width } of layouts) {
    await page.evaluate(({ language, appearanceMode }) => {
      const settings = JSON.parse(localStorage.getItem('jipage_settings_v1'));
      localStorage.setItem('jipage_settings_v1', JSON.stringify({ ...settings, language, appearanceMode }));
    }, { language, appearanceMode });
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.reload();
    await openTransfer(page, language === 'en');
    await page.getByRole('tab', { name: language === 'en' ? 'Backup & restore' : '资产备份恢复', exact: true }).click();
    await page.getByLabel(language === 'en' ? 'Choose an asset backup JSON file' : '选择资产备份 JSON 文件', { exact: true }).setInputFiles({
      name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(text),
    });
    await page.getByRole('checkbox', { name: language === 'en' ? /I have backed up/ : /我已备份/ }).waitFor();
    assert.equal(await page.getByRole('term').filter({ hasText: language === 'en' ? /^Legacy collections$/ : /^历史网址单$/ }).count(), 0);
    assert.equal(await page.getByRole('term').filter({ hasText: language === 'en' ? /^Bookmark folders$/ : /^收藏文件夹$/ }).count(), 2);
    await page.getByRole('status').filter({ hasText: language === 'en' ? 'Asset backup JSON identified' : '已识别为资产备份 JSON' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.getByRole('tabpanel').evaluate(panel => panel.scrollWidth > panel.clientWidth), false);
    if (screenshots) await page.screenshot({ path: `test-results/screenshots/workbench-${language}-${appearanceMode}-${width}-restore.png`, fullPage: true });
  }
  // A queued restore must not write after leaving its page.
  const { page: leaving } = await fresh();
  await openTransfer(leaving);
  await leaving.getByRole('tab', { name: '资产备份恢复', exact: true }).click();
  await leaving.getByLabel('选择资产备份 JSON 文件', { exact: true }).setInputFiles({
    name: 'queued.json', mimeType: 'application/json', buffer: Buffer.from(text),
  });
  await leaving.getByRole('checkbox', { name: /我已备份/ }).check();
  await leaving.evaluate(() => {
    const request = navigator.locks.request.bind(navigator.locks);
    const wait = new Promise(resolve => { window.releaseRestore = resolve; });
    navigator.locks.request = async (name, ...args) => {
      if (name === 'jigeqiu:prototype:library-import') await wait;
      return request(name, ...args);
    };
  });
  await leaving.getByRole('button', { name: '确认恢复并替换', exact: true }).click();
  await leaving.getByRole('banner').getByRole('button', { name: '桌面', exact: true }).click();
  await leaving.evaluate(() => window.releaseRestore());
  await leaving.waitForTimeout(150);
  assert.equal(await leaving.evaluate(() => localStorage.getItem('jipage_library_v2')), null);
  // Startup rolls back a partial Web transaction before opening the desktop.
  const { page: recovery } = await fresh();
  await recovery.evaluate(core => {
    localStorage.setItem('jipage_library_v2', JSON.stringify(core));
    localStorage.setItem('jipage_workbench_restore_v1', JSON.stringify({ version: 1, records: [
      { key: 'jipage_library_v2', before: null, after: JSON.stringify(core) },
    ] }));
  }, core);
  await recovery.reload();
  await recovery.getByRole('banner').waitFor();
  assert.equal(await recovery.evaluate(() => localStorage.getItem('jipage_library_v2')), null);
  assert.equal(await recovery.evaluate(() => localStorage.getItem('jipage_workbench_restore_v1')), null);
  await recovery.evaluate(core => {
    localStorage.setItem('jipage_library_v2', JSON.stringify(core));
    localStorage.setItem('jipage_workbench_restore_v1', JSON.stringify({ version: 1, records: [
      { key: 'jipage_library_v2', before: null, after: '{"unrelated":true}' },
    ] }));
  }, core);
  await recovery.reload();
  await recovery.getByRole('heading', { name: '资产恢复需要处理', exact: true }).waitFor();
  assert.equal(await recovery.getByRole('banner').count(), 0);
  assert.deepEqual(await recovery.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2'))), core);
  assert.ok(await recovery.evaluate(() => localStorage.getItem('jipage_workbench_restore_v1')));
  assert.deepEqual(errors, []);
  console.log(`PASS workbench export/clean-context restore, stable IDs/layout/order/engines, preview/read-only, acknowledgment, queued disable/cancel, dirty tabs, bookmark-only merge, retained cleanup, wrong-file guidance, startup rollback/conflict; ${layouts.length} restore layout cases, screenshots ${screenshots ? 'on' : 'off'}`);
} finally {
  await browser?.close();
  await server.close();
}

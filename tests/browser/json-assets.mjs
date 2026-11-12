import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { captureScreenshots } from './helpers/layout-cases.mjs';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.route('https://**/*', route => route.fulfill({ body: '' }));
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('jipage_bookmarks_v1', JSON.stringify([{
      id: 'source-bm', title: 'Photo tool', url: 'https://example.test/photos?a=1#two', domain: 'example.test',
      category: 'old', folderId: 'source-folder', iconMode: 'text', notes: 'Private note',
      keywords: ['图片', '壁纸'], pinnedToDesktop: true, order: 0, collectionIds: [], createdAt: 10, updatedAt: 20,
    }]));
    localStorage.setItem('jipage_folders_v1', JSON.stringify([{
      id: 'source-folder', name: 'My resources', bookmarkIds: ['source-bm'], pinnedToDesktop: false, order: 0, createdAt: 10, updatedAt: 20,
    }, { id: 'empty', name: 'Empty folder', parentId: 'source-folder', bookmarkIds: [], pinnedToDesktop: false, order: 1, createdAt: 10, updatedAt: 20 }]));
    localStorage.setItem('jipage_collections_v1', JSON.stringify([{
      id: 'source-col', title: 'Creator toolkit', description: 'My workflow', category: 'old',
      authorId: 'user-me', authorName: 'Me', visibility: 'public', isPinnedToDesktop: true, createdAt: 10, updatedAt: 20,
      items: [{ bookmarkId: 'source-bm', title: 'Snapshot title', url: 'https://snapshot.test/', domain: 'snapshot.test', recommendationReason: 'Useful for photos', order: 0 }],
    }]));
  });
  await page.reload();
  const header = page.getByRole('banner');
  async function openTransfer() {
    await header.getByRole('button', { name: '管理中心', exact: true }).click();
    if (page.viewportSize().width < 768) await page.getByRole('combobox', { name: '管理中心小节' }).selectOption('import-export');
    else await page.getByRole('navigation', { name: '管理中心导航' })
      .getByRole('button', { name: '导入与导出', exact: true }).click();
    await page.getByRole('group', { name: '导入格式', exact: true }).getByRole('radio', { name: '记个球收藏 · JSON', exact: true }).check();
  }
  await openTransfer();
  const transfer = page.getByRole('region', { name: '收藏资产 JSON', exact: true });
  const downloadPending = page.waitForEvent('download');
  await page.getByRole('group', { name: '导出格式', exact: true }).getByRole('radio', { name: '记个球收藏 · JSON', exact: true }).check();
  await page.getByRole('region', { name: '导出收藏', exact: true }).getByRole('button', { name: '导出收藏', exact: true }).click();
  const download = await downloadPending;
  const text = await readFile(await download.path(), 'utf8');
  const exported = JSON.parse(text);
  assert.equal(exported.format, 'jigeqiu-assets');
  assert.equal(exported.library.folders.length, 2);
  for (const key of ['settings', 'searchEngines', 'layout', 'plugins', 'categories', 'tags']) assert.equal(key in exported, false);
  assert.equal(exported.library.bookmarks[0].notes, 'Private note');
  // Simulate a clean destination with different personal preferences.
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('jipage_bookmarks_v1', '[]');
    localStorage.setItem('jipage_folders_v1', '[]');
    localStorage.setItem('jipage_collections_v1', '[]');
    localStorage.setItem('jipage_settings_v1', JSON.stringify({
      language: 'zh', appearanceMode: 'dark-glass', wallpaperPreset: 'cyan-lake', desktopViewMode: 'icon',
      defaultSearchEngineId: 'engine-google', confirmBatchOpen: true, reduceMotion: true, showDock: false,
    }));
  });
  await page.reload();
  await openTransfer();
  const snapshot = () => page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
  const initial = await snapshot();
  const choose = data => transfer.getByLabel('JSON 资产文件', { exact: true }).setInputFiles({
    name: 'assets.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
  });
  const preview = transfer.getByRole('status', { name: '导入预览', exact: true });
  await choose(exported);
  await preview.waitFor();
  assert.equal(await snapshot(), initial, 'Preview is read-only');
  await transfer.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await snapshot(), initial);
  await choose({ ...exported, schemaVersion: 999 });
  await transfer.getByRole('alert').waitFor();
  assert.equal(await snapshot(), initial);
  await choose({ ...exported, settings: { language: 'en' }, searchEngines: [{ name: 'Injected' }] });
  await preview.waitFor();
  await transfer.getByText(/已忽略.*仅导入资产内容/).first().waitFor();
  assert.equal(await snapshot(), initial);
  await page.evaluate(() => {
    window.savedSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  });
  await transfer.getByRole('button', { name: '确认导入收藏', exact: true }).click();
  await transfer.getByRole('alert').filter({ hasText: '空间不足' }).waitFor();
  assert.equal(await snapshot(), initial, 'Failed commit leaves both library and collections intact');
  await page.evaluate(() => { Storage.prototype.setItem = window.savedSetItem; });
  await transfer.getByRole('button', { name: '确认导入收藏', exact: true }).click();
  await page.getByRole('button', { name: '查看收藏', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: '收藏导入导出', exact: true }).getAttribute('aria-selected'), 'true');
  const assets = await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')));
  assert.equal(assets.bookmarks.length, 1);
  assert.equal(assets.folders.length, 2);
  assert.equal(assets.collections.length, 1);
  assert.notEqual(assets.bookmarks[0].id, 'source-bm');
  assert.equal(assets.bookmarks[0].pinnedToDesktop, false);
  assert.equal(assets.collections[0].items[0].bookmarkId, assets.bookmarks[0].id);
  assert.equal(assets.collections[0].items[0].title, 'Snapshot title');
  assert.equal(assets.bookmarks[0].notes, 'Private note');
  assert.deepEqual(assets.bookmarks[0].keywords, ['图片', '壁纸']);
  assert.equal(assets.bookmarks[0].url, 'https://example.test/photos?a=1#two');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_settings_v1')).language), 'zh');
  assert.equal(await page.getByRole('navigation', { name: '管理中心导航' })
    .getByRole('button', { name: '我的网址单', exact: true }).count(), 0);
  assert.match(assets.collections[0].items[0].recommendationReason, /Useful for photos/);
  await page.reload();
  await openTransfer();
  assert.equal(await page.getByRole('group', { name: '导入格式', exact: true }).getByRole('radio', { name: '记个球收藏 · JSON', exact: true }).isChecked(), true);
  await choose(exported);
  await preview.waitFor();
  assert.equal(await transfer.getByRole('button', { name: '确认导入收藏', exact: true }).isDisabled(), true, 'Identical import is a no-op');
  await transfer.getByRole('checkbox', { name: '保留重复副本', exact: true }).check();
  assert.equal(await transfer.getByRole('button', { name: '确认导入收藏', exact: true }).isEnabled(), true);
  if (captureScreenshots()) {
    await mkdir('test-results/screenshots', { recursive: true });
    await page.screenshot({ path: 'test-results/screenshots/json-assets-desktop.png', fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  if (captureScreenshots()) await page.screenshot({ path: 'test-results/screenshots/json-assets-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await transfer.getByRole('button', { name: '确认导入收藏', exact: true }).click();
  await page.getByRole('button', { name: '查看收藏', exact: true }).waitFor();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')));
  assert.equal(after.bookmarks.length, 2);
  assert.equal(after.collections.length, 2);
  assert.deepEqual(errors, []);
  console.log('PASS asset JSON download, clean-device round trip, read-only preview/cancel, settings ignored, unsupported version, atomic quota retry, mapped collection links, duplicate skip/copies and responsive UI');
} finally {
  await browser?.close();
  await server.close();
}

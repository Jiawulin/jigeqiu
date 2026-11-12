import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
const screenshots = process.env.SCREENSHOT_DIR ?? 'test-results/screenshots';
const file = {
  name: 'chrome-bookmarks.html', mimeType: 'text/html',
  buffer: Buffer.from('<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>Chrome bar</H3><DL><DT><A HREF="https://example.org/alpha">Alpha imported</A><DT><H3>Nested</H3><DL><DT><A HREF="https://example.org/beta">Beta imported</A></DL><DT><A HREF="javascript:1">Unsafe</A></DL></DL>'),
};
const existing = {
  id: 'keep', title: 'Existing personal bookmark', url: 'https://example.org/keep', domain: 'example.org',
  category: 'cat-inbox', pinnedToDesktop: true, order: 1, collectionIds: [], createdAt: 1, updatedAt: 1,
};
let browser;
async function openImport(page) {
  await page.getByRole('banner').getByRole('button', { name: '管理中心', exact: true }).click();
  await page.getByRole('button', { name: '导入与导出', exact: true }).click();
}
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
  await context.route('https://**/*', route => route.fulfill({ status: 200, body: 'Test destination' }));
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.evaluate(existing => {
    localStorage.clear();
    localStorage.setItem('jipage_bookmarks_v1', JSON.stringify([existing]));
    localStorage.setItem('jipage_folders_v1', '[]');
    localStorage.setItem('jipage_settings_v1', JSON.stringify({
      appearanceMode: 'light-glass', wallpaperPreset: 'cyan-lake', desktopViewMode: 'icon',
      defaultSearchEngineId: 'engine-google', confirmBatchOpen: true, reduceMotion: true, showDock: true,
    }));
  }, existing);
  await page.reload();
  const initial = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
  await openImport(page);
  await page.getByLabel('浏览器书签 HTML 文件').setInputFiles(file);
  await page.getByText('2 个网址', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage)))), initial);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage)))), initial);
  await page.getByLabel('浏览器书签 HTML 文件').setInputFiles(file);
  await page.getByRole('button', { name: '确认导入收藏', exact: true }).click();
  await page.getByRole('button', { name: '查看收藏', exact: true }).click();
  await page.getByText('Alpha imported', { exact: true }).waitFor();
  const library = await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')));
  assert.equal(library.bookmarks.length, 3);
  assert.deepEqual(library.bookmarks[0], existing);
  assert.equal(library.folders[1].parentId, library.folders[0].id);
  assert.equal(library.bookmarks[1].folderId, library.folders[0].id);
  assert.equal(library.bookmarks[1].pinnedToDesktop, false);
  assert.equal(await page.evaluate(() => localStorage.getItem('jipage_bookmarks_v1')), JSON.stringify([existing]));
  await page.getByTitle('点击返回首页桌面').click();
  assert.equal(await page.locator('[data-desktop-id]').count(), 0,
    'Neither legacy pinned flags nor imported assets automatically generate desktop icons');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2'))), library,
    'Reading the desktop leaves the imported library untouched');
  await page.evaluate(async () => {
    const { StorageManager } = await import('/src/services/storage.ts');
    new StorageManager().setDesktopPins(['keep'], true);
  });
  await page.reload();
  const converted = await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')));
  assert.deepEqual(converted.bookmarks, library.bookmarks, 'Explicit pin preserves all imported bookmark fields');
  assert.deepEqual(converted.folders, library.folders, 'Explicit pin preserves nested archive folders');
  assert.deepEqual(converted.desktopLayout.shortcuts.map(shortcut => shortcut.bookmarkId), ['keep'],
    'Imported unpinned bookmarks are not automatically placed on the desktop');
  await page.getByRole('banner').getByRole('button', { name: '管理中心', exact: true }).click();
  const row = page.locator('.grid.grid-cols-12').filter({ has: page.getByText('Alpha imported', { exact: true }) });
  await row.getByTitle('固定到桌面').click();
  const pinned = await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')));
  assert.deepEqual(pinned.bookmarks, library.bookmarks, 'Pinning imported bookmarks preserves original pinnedToDesktop/order/folderId');
  assert.deepEqual(pinned.folders, library.folders, 'Pinning does not alter imported archive membership');
  const alpha = library.bookmarks.find(bookmark => bookmark.title === 'Alpha imported');
  const shortcut = pinned.desktopLayout.shortcuts.find(shortcut => shortcut.bookmarkId === alpha.id);
  assert.ok(shortcut, 'Pinning adds an independent desktop shortcut');
  assert.equal(pinned.desktopLayout.shortcuts.length, converted.desktopLayout.shortcuts.length + 1);
  assert.deepEqual(pinned.desktopLayout.root, [...converted.desktopLayout.root, { kind: 'shortcut', id: shortcut.id }]);
  assert.deepEqual(pinned.desktopLayout.folders, converted.desktopLayout.folders);
  assert.deepEqual(pinned.desktopLayout.dock, converted.desktopLayout.dock);
  assert.equal(await row.getByTitle('从桌面移除', { exact: true }).count(), 1,
    'Manager pin indicator follows independent layout rather than the original bookmark flag');
  await page.getByTitle('点击返回首页桌面').click();
  // A library folder must not hide a separately pinned shortcut.
  const desktopAlpha = page.locator('.desktop-item').filter({ hasText: 'Alpha imported' });
  await desktopAlpha.waitFor({ timeout: 5000 });
  await desktopAlpha.click({ button: 'right' });
  await page.keyboard.press('Escape');
  await page.getByTitle('启动台 · 所有应用与收藏 (桌面上滑亦可展开)').click();
  await page.getByTitle('关闭启动台 (Esc 或点击空白处)').waitFor();
  const launchAlpha = page.getByRole('dialog', { name: '启动台', exact: true })
    .getByRole('button', { name: 'Alpha imported', exact: true });
  await launchAlpha.waitFor();
  const popupPromise = context.waitForEvent('page');
  await launchAlpha.click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  assert.equal(popup.url(), 'https://example.org/alpha');
  await popup.close();
  const opened = await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')));
  const visitedAlpha = opened.bookmarks.find(bookmark => bookmark.id === alpha.id);
  assert.ok(Number.isFinite(visitedAlpha.lastUsedAt) && visitedAlpha.lastUsedAt >= alpha.createdAt,
    'Opening the bookmark records a visit time');
  assert.deepEqual(opened, {
    ...pinned,
    bookmarks: pinned.bookmarks.map(bookmark => bookmark.id === alpha.id
      ? { ...bookmark, lastUsedAt: visitedAlpha.lastUsedAt } : bookmark),
  }, 'Opening from launchpad changes only the visited bookmark lastUsedAt, not archives or layout');
  await page.reload();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2'))), opened,
    'Desktop pin and imported archives survive launchpad open and reload unchanged');
  await page.getByTitle('启动台 · 所有应用与收藏 (桌面上滑亦可展开)').click();
  await page.getByRole('dialog', { name: '启动台', exact: true })
    .getByRole('button', { name: 'Beta imported', exact: true }).waitFor();
  await page.getByTitle('关闭启动台 (Esc 或点击空白处)').click();
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: `${screenshots}/desktop-import-integrated.png`, fullPage: true });
  await openImport(page);
  await page.getByLabel('浏览器书签 HTML 文件').setInputFiles(file);
  const beforeFailure = await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')));
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  });
  await page.getByRole('button', { name: '确认导入收藏', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '空间不足' }).waitFor();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2'))), beforeFailure,
    'Failed import preserves the complete library and independent layout');
  assert.deepEqual(errors, []);
  console.log('PASS: Chrome preview/cancel/import → no implicit pins → explicit desktop pin → layout-only manager pin with unchanged archives → launchpad open → reload → quota error preserves library and layout');
} finally {
  await browser?.close();
  await server.close();
}

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>
<DL><p>
<DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
<DL><p>
<DT><A HREF="https://example.org/docs">Documentation</A>
<DT><H3>Design</H3><DL><p>
<DT><A HREF="https://example.org/photos">Photos</A>
</DL><p>
<DT><A HREF="javascript:alert(1)">Unsafe</A>
</DL><p></DL><p>`;
const file = { name: 'chrome-bookmarks.html', mimeType: 'text/html', buffer: Buffer.from(html) };
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('button', { name: '暂时跳过', exact: true }).click();
  await page.getByTitle('启动台 · 所有应用与收藏 (桌面上滑亦可展开)', { exact: true }).click({ timeout: 5000 });
  await page.getByTitle('关闭启动台 (Esc 或点击空白处)').waitFor();
  await page.getByTitle('关闭启动台 (Esc 或点击空白处)').click();
  await page.getByTitle('添加收藏', { exact: true }).first().click();
  await page.getByRole('dialog', { name: '添加收藏', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${origin}/?workspace=import`);
  await page.getByRole('button', { name: '导入 Chrome 书签', exact: true }).first().waitFor({ timeout: 5000 });
  assert.equal(await page.evaluate(() => localStorage.length), 0, 'empty installation does not seed data');
  await page.getByRole('button', { name: '导入 Chrome 书签', exact: true }).first().click();
  await page.getByLabel('Chrome 书签 HTML 文件').setInputFiles(file);
  await page.getByText('2 个网址', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.length), 0, 'preview does not write');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.length), 0, 'cancel does not write');
  await page.getByRole('button', { name: '导入 Chrome 书签', exact: true }).first().click();
  await page.getByLabel('Chrome 书签 HTML 文件').setInputFiles(file);
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await page.getByRole('link', { name: /Documentation/ }).waitFor();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jigeqiu_assets_v1')));
  assert.equal(saved.snapshot.library.bookmarks.length, 2);
  assert.equal(saved.snapshot.library.folders.length, 2);
  assert.deepEqual(saved.snapshot.layout.shortcuts, [], 'import never pins the whole library to desktop');
  assert.equal(await page.getByRole('link', { name: /Unsafe/ }).count(), 0);
  await context.route('https://example.org/**', route => route.fulfill({ body: 'Opened bookmark' }));
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('link', { name: /Documentation/ }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  assert.equal(popup.url(), 'https://example.org/docs');
  assert.equal(await popup.evaluate(() => window.opener === null), true);
  await popup.close();
  await page.reload();
  await page.getByRole('button', { name: '全部收藏', exact: true }).click();
  await page.getByRole('link', { name: /Documentation/ }).waitFor();
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('link', { name: /Photos/ }).waitFor();
  assert.equal(await page.getByRole('link', { name: /Documentation/ }).count(), 0);
  await page.getByRole('button', { name: '全部收藏', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索收藏' }).fill('Photos');
  assert.equal(await page.getByRole('link', { name: /Documentation/ }).count(), 0);
  await page.getByRole('searchbox', { name: '搜索收藏' }).fill('');
  assert.ok((await page.getByRole('region', { name: '收藏库' }).boundingBox()).width > 1000,
    'desktop workspace uses the available width instead of shrinking to its contents');
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/chrome-import-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/screenshots/chrome-import-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: empty → preview/cancel → import → folder/search/open → reload; desktop/mobile without overflow');

  const legacy = await browser.newContext({ locale: 'zh-CN' });
  await legacy.addInitScript(() => {
    if (!localStorage.getItem('jipage_bookmarks_v1')) localStorage.setItem('jipage_bookmarks_v1', '[{"id":"keep-me"}]');
  });
  const oldPage = await legacy.newPage();
  await oldPage.goto(`${origin}/?workspace=import`);
  await oldPage.getByRole('alert').filter({ hasText: '旧原型数据' }).waitFor();
  assert.equal(await oldPage.evaluate(() => localStorage.getItem('jipage_bookmarks_v1')), '[{"id":"keep-me"}]');
  assert.equal(await oldPage.evaluate(() => localStorage.getItem('jigeqiu_assets_v1')), null);
  assert.equal(await oldPage.getByRole('button', { name: '导入 Chrome 书签', exact: true }).first().isDisabled(), true);
  console.log('PASS: legacy data remains untouched with explicit recovery guidance');

  const quota = await browser.newContext({ locale: 'zh-CN' });
  await quota.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  });
  const quotaPage = await quota.newPage();
  await quotaPage.goto(`${origin}/?workspace=import`);
  await quotaPage.getByRole('button', { name: '导入 Chrome 书签', exact: true }).first().click();
  await quotaPage.getByLabel('Chrome 书签 HTML 文件').setInputFiles(file);
  await quotaPage.getByRole('button', { name: '确认导入', exact: true }).click();
  await quotaPage.getByRole('alert').filter({ hasText: '空间不足' }).waitFor();
  assert.equal(await quotaPage.getByRole('link', { name: /Documentation/ }).count(), 0);
  assert.equal(await quotaPage.evaluate(() => localStorage.length), 0);
  console.log('PASS: failed persistence shows error and never publishes unsaved bookmarks');
} finally {
  await browser?.close();
  await server.close();
}

import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
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
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.evaluate(async () => {
    localStorage.clear();
    const { StorageManager } = await import('/src/services/storage.ts');
    const manager = new StorageManager();
    await manager.mutate(() => manager.saveUserSettings({ language: 'zh', appearanceMode: 'dark-glass' }));
  });
  await page.reload();
  async function open(en = false) {
    await page.getByRole('banner').getByRole('button', { name: en ? 'Manage' : '管理中心', exact: true }).click();
    if (page.viewportSize().width < 768) await page.getByRole('combobox', { name: en ? 'Management section' : '管理中心小节' }).selectOption('import-export');
    else await page.getByRole('navigation', { name: en ? 'Management navigation' : '管理中心导航' })
      .getByRole('button', { name: en ? 'Import & export' : '导入与导出', exact: true }).click();
  }
  const snapshot = () => page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
  async function download(button) {
    const pending = page.waitForEvent('download');
    await button.click();
    return JSON.parse(await readFile(await (await pending).path(), 'utf8'));
  }
  await open();
  await page.evaluate(async () => {
    const { storage } = await import('/src/services/storage.ts');
    const original = storage.exportWorkbenchBackup.bind(storage);
    window.backupExportCalls = 0;
    storage.exportWorkbenchBackup = () => { window.backupExportCalls++; return original(); };
  });
  await page.getByRole('tab', { name: '资产备份恢复', exact: true }).click();
  await page.getByRole('definition').first().waitFor();
  assert.equal(await page.getByRole('alert').count(), 0, 'Saving preferences on an empty installation does not invalidate backup');
  assert.equal(await page.evaluate(() => window.backupExportCalls), 0, 'Inventory never runs the complete export pipeline');
  const initial = await snapshot();
  assert.deepEqual((await download(page.getByRole('button', { name: '导出资产备份', exact: true }))).taskbar, []);
  assert.equal(await page.evaluate(() => window.backupExportCalls), 1);
  assert.equal(await snapshot(), initial, 'Export does not rewrite legacy default pins');
  await page.getByRole('tab', { name: '收藏导入导出', exact: true }).click();
  const importer = page.getByRole('region', { name: '导入收藏', exact: true });
  const exporter = page.getByRole('region', { name: '导出收藏', exact: true });
  const importFormats = (en = false) => page.getByRole('group', { name: en ? 'Import format' : '导入格式', exact: true });
  const importFormat = (format, en = false) => importFormats(en).locator(`input[value="${format}"]`);
  assert.equal(await importFormats().getByRole('radio').count(), 2);
  assert.equal(await importFormat('html').isChecked(), true);
  const exportFormats = (en = false) => page.getByRole('group', { name: en ? 'Export format' : '导出格式', exact: true });
  const exportFormat = (format, en = false) => exportFormats(en).locator(`input[value="${format}"]`);
  assert.equal(await exportFormats().getByRole('radio').count(), 2);
  assert.equal(await exportFormat('html').isChecked(), true);
  assert.ok((await importer.boundingBox()).y < (await exporter.boundingBox()).y, 'Import is above export');
  assert.equal(await importer.locator('input[type=file]').count(), 1);
  assert.equal(await importer.locator('input[type=file]').getAttribute('accept'), '.html,.htm,text/html');
  const help = page.getByRole('button', { name: '导入格式说明', exact: true });
  await help.hover();
  await page.getByRole('tooltip').filter({ hasText: 'Chrome' }).waitFor();
  await help.focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('tooltip').count(), 0);
  await help.click();
  await page.getByRole('tooltip').waitFor();
  await importFormat('html').focus();
  assert.equal(await page.getByRole('tooltip').count(), 0);
  await page.keyboard.press('ArrowRight');
  assert.equal(await importFormat('json').isChecked(), true);
  assert.equal(await importFormat('html').isChecked(), false);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  assert.equal(await importFormat('html').isChecked(), true, 'Selected format cannot be unchecked');
  assert.equal(await importFormat('json').isChecked(), false);
  await exportFormat('html').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await exportFormat('json').isChecked(), true);
  assert.equal(await exportFormat('html').isChecked(), false);
  assert.equal(await importFormat('html').isChecked(), true, 'Import and export selections are independent');
  await page.keyboard.press('Space');
  assert.equal(await exportFormat('json').isChecked(), true);
  await page.keyboard.press('ArrowLeft');
  const html = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><A HREF="https://example.test/synthetic">Synthetic bookmark</A></DL>';
  await importer.getByLabel('浏览器书签 HTML 文件', { exact: true }).setInputFiles({
    name: 'synthetic.html', mimeType: 'text/html', buffer: Buffer.from(html),
  });
  await importer.getByText('1 个网址', { exact: true }).waitFor();
  const beforePreviewSwitch = await snapshot();
  await importFormat('json').click();
  const discard = page.getByRole('dialog', { name: '放弃当前文件预览？', exact: true });
  await discard.waitFor();
  await discard.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await importFormat('html').isChecked(), true);
  assert.equal(await importFormat('json').isChecked(), false);
  await importer.getByRole('button', { name: '确认导入收藏', exact: true }).click();
  await page.getByRole('button', { name: '查看收藏', exact: true }).waitFor();
  await exportFormat('json').check();
  const assets = await download(exporter.getByRole('button', { name: '导出收藏', exact: true }));
  assert.equal(assets.format, 'jigeqiu-assets');
  assert.equal(assets.library.bookmarks.length, 1);
  await importFormat('json').check();
  assert.equal(await importer.locator('input[type=file]').count(), 1);
  assert.equal(await importer.locator('input[type=file]').getAttribute('accept'), '.json,application/json');
  await importer.getByLabel('JSON 资产文件', { exact: true }).setInputFiles({
    name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(assets)),
  });
  await importer.getByRole('status', { name: '导入预览', exact: true }).waitFor();
  const beforeDiscard = await snapshot();
  await importFormat('html').click();
  await discard.getByRole('button', { name: '放弃预览并切换', exact: true }).click();
  assert.equal(await importFormat('html').isChecked(), true);
  assert.equal(await importFormat('json').isChecked(), false);
  assert.equal(await snapshot(), beforeDiscard);
  assert.notEqual(beforeDiscard, beforePreviewSwitch, 'Only confirmed bookmark import changed data');
  // Export errors belong to local data, never to the file restore form.
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('jipage_settings_v1'));
    localStorage.setItem('jipage_settings_v1', JSON.stringify({ ...settings, defaultSearchEngineId: 'missing' }));
  });
  await page.getByRole('tab', { name: '资产备份恢复', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '当前默认搜索引擎不存在或已停用' }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  let unexpectedDownloads = 0;
  page.on('download', () => unexpectedDownloads++);
  await page.getByRole('button', { name: '导出资产备份', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '当前默认搜索引擎不存在或已停用' }).waitFor();
  assert.equal(await page.getByText(/备份无效：请检查文件版本/).count(), 0);
  assert.equal(unexpectedDownloads, 0);
  await mkdir('test-results/screenshots', { recursive: true });
  for (const language of ['zh', 'en']) {
    for (const appearanceMode of ['light-glass', 'dark-glass']) {
      for (const width of [1440, 390, 320]) {
        await page.evaluate(({ language, appearanceMode }) => {
          const settings = JSON.parse(localStorage.getItem('jipage_settings_v1'));
          localStorage.setItem('jipage_settings_v1', JSON.stringify({ ...settings, language, appearanceMode, defaultSearchEngineId: 'se-google' }));
        }, { language, appearanceMode });
        await page.setViewportSize({ width, height: 900 });
        await page.reload();
        await open(language === 'en');
        for (const format of ['html', 'json']) {
          await importFormat(format, language === 'en').check();
          await exportFormat(format, language === 'en').check();
          await exportFormat(format, language === 'en').focus();
          assert.equal(await exportFormats(language === 'en').locator('input:checked').count(), 1);
          assert.equal(await importFormats(language === 'en').locator('input:checked').count(), 1);
          for (const label of await importFormats(language === 'en').locator('label').all()) {
            const bounds = await label.boundingBox();
            assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'Expanded formats fit the viewport');
          }
          await page.screenshot({ path: `test-results/screenshots/transfer-formats-options-${language}-${appearanceMode}-${width}-${format}.png`, fullPage: true });
          const tip = page.getByRole('button', { name: language === 'en' ? 'Export format help' : '导出格式说明', exact: true });
          await tip.focus();
          const tooltip = page.getByRole('tooltip');
          await tooltip.waitFor();
          const bounds = await tooltip.boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
          const helpBounds = await tip.boundingBox();
          assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= helpBounds.y,
            'Export help opens above its control without clipping or taskbar overlap');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          assert.equal(await page.getByRole('tabpanel').evaluate(panel => panel.scrollWidth > panel.clientWidth), false);
          await page.screenshot({ path: `test-results/screenshots/transfer-formats-${language}-${appearanceMode}-${width}-${format}.png`, fullPage: true });
          await page.keyboard.press('Escape');
        }
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS ordinary preference backup, no premature file error, scoped local export failure, import/export format selectors, one file picker, help hover/focus/click/Escape, dirty format cancel/discard, confirmed import, JSON export, bilingual/themes/1440/390/320');
} finally {
  await browser?.close();
  await server.close();
}

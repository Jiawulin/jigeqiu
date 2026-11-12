import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  await mkdir('/tmp/jigeqiu-i18n', { recursive: true });
  for (const language of ['zh', 'en', 'en-US']) {
    const en = language.startsWith('en');
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.route('https://**/*', route => route.fulfill({ body: '' }));
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.evaluate(async language => {
      const { StorageManager } = await import('/src/services/storage.ts');
      const manager = new StorageManager();
      const folder = manager.createFolder('Work');
      for (const title of ['First', 'Second']) manager.saveManualBookmark({
        title, url: `https://${title.toLowerCase()}.example/`, domain: `${title.toLowerCase()}.example`,
        category: '', order: 0, collectionIds: [], folderId: folder.id, pinnedToDesktop: false,
      });
      manager.saveFolders(manager.getFolders().map(folder => ({ ...folder, pinnedToDesktop: false })));
      manager.saveUserSettings({ language });
    }, language);
    await page.reload();
    await page.getByTitle(/^(添加收藏|Add bookmark)$/).first().click();
    const form = page.getByRole('dialog', { name: en ? 'Add bookmark' : '添加收藏', exact: true });
    await form.getByLabel(en ? 'Website URL' : '网址 URL', { exact: true }).fill('https://third.example/');
    await form.getByLabel(en ? 'Website name' : '网站名称', { exact: true }).fill('Third');
    await form.getByRole('group', { name: en ? 'Website icon' : '网站图标', exact: true }).waitFor();
    const keywords = form.getByLabel(en ? 'Search keywords (optional)' : '搜索关键词（可选）');
    await keywords.fill('images,wallpapers');
    await keywords.press('Enter');
    await form.getByRole('button', { name: en ? 'Remove images' : '移除关键词 images', exact: true }).waitFor();
    await form.getByRole('button', { name: en ? /^Bookmark location / : /^收藏位置 / }).click();
    await form.getByRole('searchbox', { name: en ? 'Search folders' : '搜索文件夹', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'jipage_library_v2') throw new DOMException('Full', 'QuotaExceededError');
        return window.originalSetItem.call(this, key, value);
      };
    });
    await form.getByRole('button', { name: en ? 'Add bookmark' : '添加收藏', exact: true }).click();
    await form.getByRole('alert').filter({ hasText: en ? /storage is full/ : /空间不足/ }).waitFor();
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
    await form.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true }).click();
    await page.getByRole('banner').getByRole('button', { name: /^(Manage|管理中心)$/ }).click();
    await page.getByTitle(en ? 'Edit bookmark' : '编辑收藏', { exact: true }).first().click();
    const edit = page.getByRole('dialog', { name: en ? 'Edit bookmark' : '编辑收藏', exact: true });
    await edit.getByLabel(en ? 'Website name' : '网站名称', { exact: true }).fill('First edited');
    await edit.getByRole('button', { name: en ? 'Save changes' : '保存更改', exact: true }).click();
    await edit.waitFor({ state: 'hidden' });
    await page.getByText(en ? 'Bookmark updated' : '收藏已更新', { exact: true }).waitFor();
    const rows = page.locator('[data-library-bookmark]');
    for (const row of await rows.all()) await row.getByRole('checkbox').check();
    await page.getByRole('button', { name: en ? 'Delete bookmarks…' : '删除收藏…', exact: true }).first().click();
    const deletion = page.getByRole('dialog', { name: en ? 'Delete 2 bookmarks?' : '删除 2 条收藏？', exact: true });
    await deletion.getByText(en
      ? 'Move 2 selected bookmarks to the recycle bin and remove their desktop/Taskbar shortcuts?'
      : '将选中的 2 条收藏移至回收站，并移除桌面与任务栏快捷方式？', { exact: true }).waitFor();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const box = await deletion.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 900);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `/tmp/jigeqiu-i18n/delete-${language}-${width}.png` });
    }
    await deletion.getByRole('button', { name: en ? 'Move to recycle bin' : '移至回收站', exact: true }).click();
    await deletion.waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.getByRole('navigation', { name: /^(Management navigation|管理中心导航)$/ })
      .getByRole('button', { name: /^(Recycle bin|回收站)$/ }).click();
    const trash = page.getByRole('region', { name: en ? 'Trash' : '回收站', exact: true });
    await trash.getByRole('heading', { name: en ? 'Trash' : '回收站', exact: true }).waitFor();
    await trash.getByRole('searchbox').fill('no-match');
    await trash.getByText(en ? 'No matching bookmarks' : '没有匹配的收藏', { exact: true }).waitFor();
    await trash.getByRole('searchbox').fill('');
    await trash.getByRole('button', { name: en ? 'Permanently delete bookmark' : '彻底删除收藏', exact: true }).first().click();
    const purge = page.getByRole('dialog', { name: en ? 'Permanently delete bookmark?' : '彻底删除收藏？', exact: true });
    await purge.getByText(en ? 'This bookmark will be permanently deleted. This cannot be undone.' : '此收藏将被彻底删除，无法恢复。', { exact: true }).waitFor();
    await purge.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true }).click();
    for (let count = 0; count < 2; count++) {
      await trash.getByRole('button', { name: en ? 'Restore bookmark' : '恢复收藏', exact: true }).first().click();
      await page.waitForFunction(expected => JSON.parse(localStorage.getItem('jipage_library_v2')).bookmarkTrash.length === expected, 1 - count);
    }
    await trash.getByText(en ? 'Trash is empty' : '回收站为空', { exact: true }).waitFor();
    const navigation = page.getByRole('navigation', { name: /^(Management navigation|管理中心导航)$/ });
    await navigation.getByRole('button', { name: en ? 'Search engines' : '搜索引擎', exact: true }).click();
    await page.getByRole('heading', { name: en ? 'Custom search engine management' : '自定义搜索引擎管理', exact: true }).waitFor();
    await page.getByRole('button', { name: en ? 'Custom engine' : '自定义引擎', exact: true }).click();
    const engineForm = page.getByRole('dialog', { name: en ? 'Add custom search engine' : '添加自定义搜索引擎', exact: true });
    await engineForm.locator('label').filter({ hasText: en ? 'Search engine name' : '搜索引擎名称' }).waitFor();
    await engineForm.locator('label').filter({ hasText: en ? 'Search URL template' : '搜索 URL 规则模板' }).waitFor();
    await engineForm.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true }).click();
    await page.getByRole('button', { name: en ? 'Test search' : '测试搜索体验', exact: true }).first().click();
    const engineTest = page.getByRole('dialog', { name: en ? 'Test "Google" search engine' : '测试「Google」搜索引擎', exact: true });
    assert.equal(await engineTest.getByRole('textbox', { name: en ? 'Test keywords' : '测试关键词', exact: true }).inputValue(), '记个球');
    await engineTest.getByText(/https:\/\/www.google.com\/search/).filter({ hasText: encodeURIComponent('记个球') }).waitFor();
    await engineTest.getByRole('button', { name: en ? 'Close' : '关闭', exact: true }).click();
    let nativeDialogs = 0;
    page.on('dialog', async dialog => { nativeDialogs++; await dialog.dismiss(); });
    const engineBytes = await page.evaluate(() => localStorage.getItem('jipage_search_engines_v1'));
    await page.getByRole('button', { name: en ? 'Delete this search engine' : '删除该引擎', exact: true }).first().click();
    const engineDelete = page.getByRole('dialog', { name: en ? 'Delete search engine "Bing"?' : '确定删除搜索引擎「Bing」吗？', exact: true });
    await engineDelete.waitFor();
    assert.equal(nativeDialogs, 0);
    await engineDelete.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('jipage_search_engines_v1')), engineBytes);
    await page.getByRole('button', { name: en ? 'Delete this search engine' : '删除该引擎', exact: true }).first().click();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const box = await engineDelete.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width);
      await page.screenshot({ path: `/tmp/jigeqiu-i18n/engine-delete-${language}-${width}.png` });
    }
    await engineDelete.getByRole('button', { name: en ? 'Delete engine' : '删除引擎', exact: true }).click();
    await engineDelete.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_search_engines_v1'))
      .some(engine => engine.id === 'se-bing')), false);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await navigation.getByRole('button', { name: en ? 'Import & export' : '导入与导出', exact: true }).click();
    await page.getByRole('heading', { name: en ? 'Import bookmarks' : '导入收藏', exact: true }).waitFor();
    await page.getByRole('group', { name: en ? 'Import format' : '导入格式', exact: true }).waitFor();
    await page.getByRole('heading', { name: en ? 'Export bookmarks' : '导出收藏', exact: true }).waitFor();
    await navigation.getByRole('button', { name: en ? 'Appearance' : '外观', exact: true }).click();
    await page.getByRole('heading', { name: en ? 'Taskbar preferences' : '任务栏偏好', exact: true }).waitFor();
    await page.getByRole('heading', { name: en ? 'Website icons' : '网站图标', exact: true }).waitFor();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const languageButton = page.getByRole('button', { name: en ? 'Switch to Chinese' : '切换为英文', exact: true });
      const languageBox = await languageButton.boundingBox();
      assert.ok(languageBox && languageBox.x >= 0 && languageBox.x + languageBox.width <= width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.getByRole('combobox', { name: en ? 'Management section' : '管理中心小节', exact: true }).selectOption('trash');
      await trash.getByRole('heading', { name: en ? 'Trash' : '回收站', exact: true }).waitFor();
      await page.screenshot({ path: `/tmp/jigeqiu-i18n/trash-${language}-${width}.png` });
    }
    const beforeSwitch = await page.evaluate(() => localStorage.getItem('jipage_library_v2'));
    await page.getByRole('button', { name: en ? 'Switch to Chinese' : '切换为英文', exact: true }).click();
    await page.getByRole('heading', { name: en ? '回收站' : 'Trash', exact: true, level: 2 }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('jipage_library_v2')), beforeSwitch,
      'Changing language must not rewrite the asset library');
    await page.reload();
    await page.getByRole('button', { name: en ? '切换为英文' : 'Switch to Chinese', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS zh/en/en-US forms, quota feedback, editing, batch deletion, trash, search engines, import/export, appearance, mobile navigation and visible language switch at 320/390px');
} finally {
  await browser?.close();
  await server.close();
}

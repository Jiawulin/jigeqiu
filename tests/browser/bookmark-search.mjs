import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  await mkdir('/tmp/jigeqiu-search-p0', { recursive: true });
  for (const language of ['zh', 'en']) {
    const en = language === 'en';
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('https://**/*', route => route.fulfill({ body: '' }));
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.evaluate(async language => {
      localStorage.clear();
      const { StorageManager } = await import('/src/services/storage.ts');
      const manager = new StorageManager();
      const parent = manager.createFolder('工作资料');
      const child = manager.createFolder('汽车', [], parent.id);
      for (let i = 0; i < 18; i++) manager.saveManualBookmark({
        title: `Reference ${i}`, url: `https://example.test/${i}`, domain: 'example.test',
        category: '', order: i, collectionIds: [], folderId: parent.id, pinnedToDesktop: false,
      });
      manager.saveManualBookmark({
        title: '小熊油耗', url: 'https://example.test/fuel', domain: 'example.test', notes: '私人备注',
        keywords: ['汽车'], category: '', order: 19, collectionIds: [], folderId: child.id, pinnedToDesktop: false,
      });
      manager.saveUserSettings({ language });
    }, language);
    await page.reload();
    const before = await page.evaluate(() => localStorage.getItem('jipage_library_v2'));
    await page.getByRole('button', { name: /^(打开搜索|Open search)$/ }).click();
    const spotlight = page.getByRole('dialog', { name: '全局搜索', exact: true });
    const input = spotlight.getByRole('combobox');
    const queries = [' 小熊油耗 ', 'xxyh', 'XXYH', 'ＸＸＹＨ', ' xxyh ', 'xiaoxiongyouhao', 'xxy', 'xiaoxiong', 'xx 油耗', 'xxyh qiche', 'srbz gzzl'];
    for (const query of queries) {
      await input.fill(query);
      assert.equal(await spotlight.locator('[id^="spotlight-result-bm-"]').count(), 1, query);
    }
    await input.fill('xxyh');
    assert.equal(await spotlight.locator('[role="option"][aria-selected="true"]').getAttribute('id'),
      'spotlight-result-action-search-engine', 'Initials do not auto-open the bookmark');
    await input.dispatchEvent('compositionstart');
    await input.press('Enter');
    await spotlight.waitFor();
    assert.equal(context.pages().length, 1, 'IME Enter does not open a destination');
    await input.dispatchEvent('compositionend');
    await input.fill('xxyg');
    assert.equal(await spotlight.locator('[id^="spotlight-result-bm-"]').count(), 0);
    await input.press('Escape');
    await page.getByTitle(/^(启动台 ·|Launchpad ·)/).click();
    const launchpad = page.getByRole('dialog', { name: en ? 'Launchpad' : '启动台', exact: true });
    const drawerInput = launchpad.getByRole('searchbox');
    for (const query of queries) {
      await drawerInput.fill(query);
      assert.equal(await launchpad.locator('[data-launchpad-bookmark]').count(), 1, query);
    }
    await drawerInput.press('Escape');
    await page.getByRole('banner').getByRole('button', { name: /^(Manage|管理中心)$/ }).click();
    const managerInput = page.getByRole('textbox', { name: en ? 'Search by name, URL, or keywords...' : '按名称、网址或关键词搜索...' });
    const rows = page.locator('[data-library-bookmark]');
    assert.equal(await rows.count(), 15, 'Fixture spans pages');
    for (const query of queries) {
      await managerInput.fill(query);
      assert.equal(await rows.count(), 1, query);
      await rows.getByText('小熊油耗', { exact: true }).waitFor();
    }
    await managerInput.fill('');
    await page.locator('[data-library-folder]').filter({ hasText: '工作资料' }).click();
    await managerInput.fill('xxyh');
    assert.equal(await rows.count(), 1, 'Search from a parent folder includes descendants');
    const expand = page.getByRole('button', { name: en ? 'Search all bookmarks' : '搜索全部收藏', exact: true });
    assert.equal(await expand.count(), 0, 'Search is already global');
    assert.equal(await managerInput.inputValue(), 'xxyh');
    assert.equal(await rows.count(), 1);
    await page.getByText(en ? 'Scope: All bookmarks' : '范围：全部收藏', { exact: true }).waitFor();
    for (const dark of [false, true]) {
      const themeToggle = page.getByRole('button', { name: dark ? /^(Night mode|切换夜间模式)$/ : /^(Day mode|切换日间模式)$/ });
      if (await themeToggle.count()) await themeToggle.click();
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const clear = page.getByRole('button', { name: en ? 'Clear search' : '清除搜索', exact: true });
        const fieldBox = await managerInput.boundingBox();
        const clearBox = await clear.boundingBox();
        assert.ok(fieldBox && clearBox && clearBox.x >= fieldBox.x && clearBox.x + clearBox.width <= fieldBox.x + fieldBox.width);
        await page.screenshot({ path: `/tmp/jigeqiu-search-p0/${language}-${dark ? 'dark' : 'light'}-${width}.png` });
      }
    }
    await managerInput.fill('xxyg');
    assert.equal(await rows.count(), 0);
    assert.equal(await expand.count(), 0, 'All-library zero results cannot expand further');
    assert.equal(await page.evaluate(() => localStorage.getItem('jipage_library_v2')), before, 'Search is read-only');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: en ? 'Clear search' : '清除搜索', exact: true }).click();
    assert.equal(await managerInput.inputValue(), '');
    assert.equal(await rows.count(), 15);
    assert.equal(await rows.getByText('小熊油耗', { exact: true }).count(), 0, 'Clearing restores the selected parent folder');
    await managerInput.fill('   ');
    assert.equal(await rows.count(), 15, 'Whitespace-only input still browses the selected folder');
    await managerInput.fill('');
    await page.getByRole('button', { name: en ? /Bookmarks bar \/ Unorganized/ : /书签栏 \/ 未整理/ }).click();
    assert.equal(await rows.count(), 0);
    await managerInput.fill('xxyh');
    assert.equal(await rows.count(), 1, 'Search from unorganized includes filed bookmarks');
    await page.getByRole('button', { name: en ? 'Clear search' : '清除搜索', exact: true }).click();
    assert.equal(await rows.count(), 0, 'Clearing restores unorganized');
    await managerInput.fill('xxyh');
    await rows.getByRole('button', { name: en ? 'Edit bookmark' : '编辑收藏', exact: true }).click();
    const edit = page.getByRole('dialog', { name: en ? 'Edit bookmark' : '编辑收藏', exact: true });
    await edit.getByLabel(en ? 'Website name' : '网站名称', { exact: true }).fill('中文工具');
    await edit.getByRole('button', { name: en ? 'Save changes' : '保存更改', exact: true }).click();
    await edit.waitFor({ state: 'hidden' });
    assert.equal(await rows.count(), 0, 'Old initials disappear after editing');
    await managerInput.fill('zwgj');
    assert.equal(await rows.count(), 1, 'New initials are indexed after editing');
    const parentRow = page.locator('[data-library-folder]').filter({ hasText: '工作资料' });
    await parentRow.hover();
    await parentRow.getByRole('button', { name: en ? 'Rename or change folder hierarchy' : '重命名或调整层级' }).click();
    const folderEdit = page.getByRole('dialog', { name: en ? 'Edit folder properties' : '编辑文件夹属性', exact: true });
    await folderEdit.getByLabel(en ? 'Folder name' : '文件夹名称', { exact: true }).fill('生活资料');
    await folderEdit.getByRole('button', { name: en ? 'Save changes' : '保存修改', exact: true }).click();
    await folderEdit.waitFor({ state: 'hidden' });
    await managerInput.fill('zwgj gzzl');
    assert.equal(await rows.count(), 0);
    await managerInput.fill('zwgj shzl');
    assert.equal(await rows.count(), 1, 'Folder rename refreshes path pinyin');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS P0 search across desktop, drawer and manager; scope, pagination, IME, bilingual responsive themes');
} finally {
  await browser?.close();
  await server.close();
}

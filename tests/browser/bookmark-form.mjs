import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer, preview } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const useDist = process.env.BOOKMARK_FORM_DIST === 'true';
const server = useDist
  ? await preview({ preview: { host: '127.0.0.1', port: 0 } })
  : await createServer({ server: { host: '127.0.0.1', port: 0 } });
const screenshots = process.env.SCREENSHOT_DIR ?? 'test-results/screenshots';
let browser;
try {
  if (!useDist) await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'zh-CN' });
  await context.route('https://**/*', route => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.evaluate(() => {
    localStorage.clear();
    const folders = [
      { id: 'work', name: '工作', order: 1 },
      { id: 'design', name: '设计', parentId: 'work', order: 1 },
      { id: 'dev', name: '开发', parentId: 'work', order: 2 },
    ].map(folder => ({ ...folder, bookmarkIds: [], pinnedToDesktop: false, createdAt: 1, updatedAt: 1 }));
    localStorage.setItem('jipage_bookmarks_v1', '[]');
    localStorage.setItem('jipage_folders_v1', JSON.stringify(folders));
  });
  await page.reload();
  const dialog = page.getByRole('dialog').filter({ has: page.locator('[data-bookmark-form]') });
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')));
  const checkFields = async () => {
    await dialog.getByLabel('网址 URL', { exact: true }).waitFor();
    await dialog.getByLabel('网站名称', { exact: true }).waitFor();
    await dialog.getByRole('group', { name: '网站图标', exact: true }).waitFor();
    await dialog.getByRole('button', { name: /^收藏位置 / }).waitFor();
    await dialog.getByPlaceholder('例如：图片、壁纸；按 Enter 或逗号添加').waitFor();
    assert.equal(await dialog.getByText(/私人备注|个人备注|归属分类|加入网址单/).count(), 0);
  };
  await page.getByTitle('添加收藏', { exact: true }).first().click();
  await checkFields();
  const urlInput = dialog.getByLabel('网址 URL', { exact: true });
  const titleInput = dialog.getByLabel('网站名称', { exact: true });
  let releaseSlow;
  let slowStarted;
  const started = new Promise(resolve => { slowStarted = resolve; });
  const slow = new Promise(resolve => { releaseSlow = resolve; });
  await context.route('https://title.example.test/**', async route => {
    if (route.request().resourceType() !== 'fetch') return route.abort();
    const path = new URL(route.request().url()).pathname;
    if (path === '/slow') { slowStarted(); await slow; }
    if (path === '/manual-slow') await new Promise(resolve => setTimeout(resolve, 700));
    await route.fulfill({
      contentType: 'text/html',
      headers: { 'access-control-allow-origin': '*' },
      body: `<title>${path === '/slow' ? '旧文章' : '原始文章'} - 测试站</title>${path === '/article' ? '<meta property="og:site_name" content="测试站">' : ''}`,
    }).catch(() => {});
  });
  await urlInput.fill('https://title.example.test/article');
  await page.waitForFunction(() => document.querySelector('#bookmark-title')?.value === '测试站');
  await urlInput.fill('https://title.example.test/slow');
  await started;
  await urlInput.fill('https://title.example.test/new');
  await page.waitForFunction(() => document.querySelector('#bookmark-title')?.value === '原始文章 - 测试站');
  releaseSlow();
  await page.waitForTimeout(150);
  assert.equal(await titleInput.inputValue(), '原始文章 - 测试站', 'A stale response cannot overwrite the new page title');
  const manualStarted = page.waitForRequest(request =>
    request.url() === 'https://title.example.test/manual-slow' && request.resourceType() === 'fetch');
  await urlInput.fill('https://title.example.test/manual-slow');
  await manualStarted;
  await titleInput.fill('手动命名');
  await page.waitForTimeout(850);
  assert.equal(await titleInput.inputValue(), '手动命名', 'An in-flight result cannot overwrite manual input');
  await urlInput.fill('https://title.example.test/manual');
  await page.waitForTimeout(650);
  assert.equal(await titleInput.inputValue(), '手动命名', 'Manual titles survive URL changes');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByTitle('添加收藏', { exact: true }).first().click();
  await urlInput.fill('https://blocked.example.test/');
  await page.waitForTimeout(650);
  assert.equal(await titleInput.inputValue(), 'Blocked', 'CORS failure retains the immediate domain fallback');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByTitle('添加收藏', { exact: true }).first().click();
  await dialog.getByLabel('网址 URL', { exact: true }).fill('https://unsplash.example.test/');
  await dialog.getByLabel('网站名称', { exact: true }).fill('Unsplash');
  const location = dialog.getByRole('button', { name: /^收藏位置 / });
  await location.click();
  await dialog.getByRole('button', { name: '展开: 工作', exact: true }).click();
  await dialog.getByRole('treeitem', { name: '收藏库根目录 / 工作 / 设计', exact: true }).click();
  await location.click();
  assert.equal(await dialog.getByRole('treeitem', { name: '收藏库根目录 / 工作 / 设计', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), true, 'First Escape closes folder tree, not the bookmark form');
  await dialog.getByLabel('搜索关键词（可选）').fill('图片,壁纸,图片');
  await dialog.getByLabel('搜索关键词（可选）').press('Enter');
  assert.equal(await dialog.isVisible(), true);
  assert.equal(await dialog.getByRole('button', { name: '移除关键词 图片', exact: true }).count(), 1);
  const keywordInput = dialog.getByLabel('搜索关键词（可选）');
  await keywordInput.dispatchEvent('compositionstart');
  await keywordInput.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229, bubbles: true });
  assert.equal(await dialog.isVisible(), true, 'IME confirmation cannot submit a bookmark');
  await keywordInput.dispatchEvent('compositionend', { data: '' });
  await dialog.getByRole('button', { name: '添加收藏', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  let data = await read();
  assert.equal(data.bookmarks[0].folderId, 'design');
  assert.deepEqual(data.bookmarks[0].keywords, ['图片', '壁纸']);
  assert.deepEqual(data.bookmarks[0].collectionIds, []);
  assert.ok(data.desktopLayout.shortcuts.some(item => item.bookmarkId === data.bookmarks[0].id));
  await page.getByRole('banner').getByRole('button', { name: '管理中心', exact: true }).click();
  await page.getByTitle('编辑收藏', { exact: true }).click();
  await checkFields();
  await dialog.getByLabel('网站名称', { exact: true }).fill('图片素材');
  await location.click();
  await dialog.getByRole('treeitem', { name: '收藏库根目录', exact: true }).click();
  await dialog.getByRole('button', { name: '保存更改', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  data = await read();
  assert.equal(data.bookmarks[0].folderId, undefined);
  assert.ok(data.desktopLayout.shortcuts.some(item => item.bookmarkId === data.bookmarks[0].id));
  await page.getByRole('button', { name: '添加收藏到此目录', exact: true }).click();
  await checkFields();
  assert.equal(await dialog.getByLabel('同时固定到桌面', { exact: true }).isChecked(), false);
  await dialog.getByLabel('网址 URL', { exact: true }).fill('library.example.test');
  await dialog.getByLabel('网站名称', { exact: true }).fill('Library only');
  await location.click();
  await dialog.getByRole('button', { name: '新建文件夹', exact: true }).click();
  await dialog.getByLabel('新文件夹名称', { exact: true }).fill('临时归档');
  await dialog.getByRole('button', { name: '创建文件夹', exact: true }).click();
  await dialog.getByRole('button', { name: '添加收藏', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  data = await read();
  const added = data.bookmarks.find(item => item.title === 'Library only');
  assert.equal(added.folderId, data.folders.find(folder => folder.name === '临时归档').id);
  assert.equal(data.desktopLayout.shortcuts.some(item => item.bookmarkId === added.id), false);
  await page.getByTitle('点击返回首页桌面').click();
  const desktop = page.locator('[data-desktop-id]').filter({ hasText: '图片素材' });
  await desktop.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑收藏', exact: true }).click();
  await checkFields();
  await mkdir(screenshots, { recursive: true });
  await page.getByText('已添加收藏', { exact: true }).waitFor({ state: 'hidden' });
  await location.click();
  await dialog.getByRole('button', { name: '展开: 工作', exact: true }).click();
  await page.screenshot({ path: `${screenshots}/bookmark-form-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const rect = document.querySelector('[data-bookmark-form]')?.closest('[role="dialog"]')?.getBoundingClientRect();
    return rect && rect.top >= 0 && rect.bottom <= innerHeight;
  });
  await page.screenshot({ path: `${screenshots}/bookmark-form-mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  const dockItem = page.getByTestId('bottom-dock').locator('button[title^="图片素材 ("]');
  // Pin from the desktop, then edit through the Dock and Launchpad menus.
  await desktop.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '固定到任务栏', exact: true }).click();
  await dockItem.click({ button: 'right' });
  const dockMenu = page.getByRole('menu', { name: '收藏操作', exact: true });
  assert.equal(await dockMenu.getByText(/在桌面.*打开|在窗口中打开/).count(), 0);
  await dockMenu.getByRole('menuitem', { name: '编辑收藏', exact: true }).click();
  await checkFields();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByTitle('启动台 · 所有应用与收藏 (桌面上滑亦可展开)').click();
  await page.getByRole('searchbox', { name: '搜索收藏', exact: true }).fill('图片素材');
  await page.locator('[data-launchpad-bookmark]').filter({ hasText: '图片素材' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑收藏', exact: true }).click();
  await checkFields();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(`PASS ${useDist ? 'dist' : 'dev'} original site_name/title, stale/manual protection, CORS fallback, unified add/edit fields, folder tree, pins, keywords and desktop/mobile screenshots`);
} finally {
  await browser?.close();
  if (useDist) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
  else await server.close();
}

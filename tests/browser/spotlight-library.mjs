import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
const screenshots = process.env.SCREENSHOT_DIR ?? 'test-results/screenshots';
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
  await context.route('https://**/*', route => route.fulfill({ body: 'Destination' }));
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.evaluate(() => {
    localStorage.clear();
    const folder = (id, name, parentId, order) => ({
      id, name, parentId, order, bookmarkIds: [], pinnedToDesktop: false, createdAt: 1, updatedAt: 1,
    });
    localStorage.setItem('jipage_folders_v1', JSON.stringify([
      folder('work', '工作', undefined, 0), folder('design', '设计', 'work', 0),
      folder('photo', '素材库', 'design', 0), folder('personal', '个人', undefined, 1),
      folder('other', '素材库', 'personal', 0), folder('empty', '空目录', 'photo', 0),
      folder('self', '循环目录', 'self', 2),
    ]));
    localStorage.setItem('jipage_bookmarks_v1', JSON.stringify([
      { id: 'one', folderId: 'photo', title: 'Unsplash', url: 'https://one.example.test/photos', domain: 'one.example.test', keywords: ['壁纸'] },
      { id: 'two', folderId: 'other', title: 'Unsplash', url: 'https://two.example.test/images', domain: 'two.example.test', keywords: [] },
      { id: 'root', title: 'Root resource', url: 'https://root.example.test/', domain: 'root.example.test', keywords: [] },
      { id: 'orphan', folderId: 'missing', title: 'Orphan resource', url: 'https://orphan.example.test/', domain: 'orphan.example.test', keywords: [] },
    ].map((b, order) => ({ ...b, category: 'cat-inbox', order, pinnedToDesktop: false, collectionIds: [], createdAt: 1, updatedAt: 1 }))));
  });
  await page.reload();
  const search = page.getByRole('dialog', { name: '全局搜索', exact: true });
  const input = search.getByRole('combobox');
  const open = async () => page.getByRole('button', { name: /^(打开搜索|Open search)$/ }).click();
  await open();
  await input.fill('Unsplash');
  const bookmarks = search.getByRole('option').filter({ hasText: 'Unsplash' })
    .filter({ hasText: /one\.example\.test|two\.example\.test/ });
  assert.equal(await bookmarks.count(), 2);
  await bookmarks.filter({ hasText: '全部收藏 / 工作 / 设计 / 素材库' }).waitFor();
  await bookmarks.filter({ hasText: '全部收藏 / 个人 / 素材库' }).waitFor();
  const checkMetadataRow = async () => {
    const result = bookmarks.filter({ hasText: '全部收藏 / 工作 / 设计 / 素材库' });
    const url = await result.locator('[data-result-url]').boundingBox();
    const path = await result.locator('[data-library-path]').boundingBox();
    assert.ok(Math.abs(url.y - path.y) <= 1, 'URL and path share a line');
    assert.ok(url.x + url.width <= path.x + 1, 'URL is left of the right-aligned path');
    assert.equal(await result.locator('[data-library-path]').evaluate(e => getComputedStyle(e).textAlign), 'right');
  };
  await checkMetadataRow();
  await page.setViewportSize({ width: 320, height: 720 });
  await checkMetadataRow();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await input.fill('/photos');
  // An unmatched command can be a path fragment, but cannot auto-open a bookmark.
  await search.locator('#spotlight-result-bm-one').waitFor();
  assert.equal(await search.locator('[role="option"][aria-selected="true"]').getAttribute('id'),
    'spotlight-result-action-search-engine');
  await input.fill('one.example.test/photos');
  await search.getByRole('option').filter({ hasText: 'Unsplash' }).waitFor();
  await input.fill('壁纸');
  await search.getByRole('option').filter({ hasText: '全部收藏 / 工作 / 设计 / 素材库' }).waitFor();
  await input.fill('Root resource');
  await search.getByRole('option').filter({ hasText: '全部收藏 / 未整理' }).waitFor();
  await input.fill('Orphan resource');
  await search.getByRole('option').filter({ hasText: '原文件夹不存在' }).waitFor();
  await input.fill('循环目录');
  await search.getByRole('option').filter({ hasText: '收藏库文件夹' })
    .getByText('0 个网址 · 0 个子文件夹', { exact: true }).waitFor();
  await input.fill('素材库');
  const folder = search.getByRole('option').filter({ hasText: '收藏库文件夹' })
    .filter({ has: page.getByText('全部收藏 / 工作 / 设计 / 素材库', { exact: true }) });
  await folder.getByText('1 个网址 · 1 个子文件夹', { exact: true }).waitFor();
  await mkdir(screenshots, { recursive: true });
  await search.screenshot({ path: `${screenshots}/spotlight-library.png` });
  await page.setViewportSize({ width: 320, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await search.screenshot({ path: `${screenshots}/spotlight-library-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await folder.focus();
  await page.keyboard.press('Enter');
  const managerSearch = page.getByPlaceholder('按名称、网址或关键词搜索...');
  await managerSearch.waitFor();
  assert.equal(await managerSearch.inputValue(), '');
  await page.locator('[data-library-folder="photo"][aria-current="location"]').waitFor();
  assert.equal(await page.locator('[data-library-folder="photo"]').evaluate(element => element === document.activeElement), true);
  await page.locator('[data-library-bookmark="one"]').waitFor();
  assert.equal(await page.locator('[data-library-bookmark="two"]').count(), 0);
  assert.equal(await page.getByRole('dialog').count(), 0, 'No old desktop folder dialog');
  await managerSearch.fill('no results');
  await page.getByTitle('点击返回首页桌面').click();
  await open();
  await input.fill('空目录');
  await search.getByRole('option').filter({ hasText: '收藏库文件夹' }).click();
  await page.locator('[data-library-folder="empty"][aria-current="location"]').waitFor();
  assert.equal(await managerSearch.inputValue(), '');
  assert.equal(await page.locator('[data-library-bookmark]').count(), 0);
  await page.getByTitle('点击返回首页桌面').click();
  await open();
  await input.fill('循环目录');
  await search.getByRole('option').filter({ hasText: '收藏库文件夹' }).click();
  await page.locator('[data-library-folder="self"][aria-current="location"]').waitFor();
  assert.equal(await page.locator('[data-library-folder="self"]').evaluate(element => element === document.activeElement), true);
  assert.equal(await page.getByText('子文件夹:', { exact: true }).count(), 0, 'Self-cycle is not offered as its own subfolder');
  // Menu actions use a valid library; malformed ancestry above remains a read-only navigation fixture.
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('jipage_bookmarks_v1', JSON.stringify([{
      id: 'one', title: 'Unsplash', url: 'https://one.example.test/photos', domain: 'one.example.test',
      folderId: 'photo', category: 'cat-inbox', order: 0, pinnedToDesktop: false, collectionIds: [], createdAt: 1, updatedAt: 1,
    }]));
    localStorage.setItem('jipage_folders_v1', JSON.stringify([
      { id: 'work', name: '工作' }, { id: 'design', name: '设计', parentId: 'work' },
      { id: 'photo', name: '素材库', parentId: 'design' },
    ].map((folder, order) => ({ ...folder, order, bookmarkIds: folder.id === 'photo' ? ['one'] : [], pinnedToDesktop: false, createdAt: 1, updatedAt: 1 }))));
  });
  await page.reload();
  await page.getByRole('banner').getByRole('button', { name: '桌面', exact: true }).click();
  await page.getByTitle('启动台 · 所有应用与收藏 (桌面上滑亦可展开)').click();
  const launchpad = page.getByRole('dialog', { name: '启动台', exact: true });
  const entry = launchpad.locator('[data-launchpad-bookmark="one"]');
  const checkMenu = async menu => {
    const copy = menu.getByRole('menuitem', { name: '复制网址', exact: true });
    await copy.getByText('https://one.example.test/photos', { exact: true }).waitFor();
    const locate = menu.getByRole('menuitem', { name: '在全部收藏中定位', exact: true });
    await locate.getByText('全部收藏 / 工作 / 设计 / 素材库', { exact: true }).waitFor();
    assert.equal(await menu.evaluate(e => e.scrollWidth > e.clientWidth), false);
  };
  await entry.click({ button: 'right' });
  let menu = page.getByRole('menu', { name: '收藏操作', exact: true });
  await checkMenu(menu);
  await menu.getByRole('menuitem', { name: '固定到桌面', exact: true }).click();
  await entry.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '固定到任务栏', exact: true }).click();
  await page.getByTitle('关闭启动台 (Esc 或点击空白处)').click();
  await page.locator('[data-desktop-id="one"]').click({ button: 'right' });
  menu = page.getByRole('menu', { name: '桌面菜单', exact: true });
  await checkMenu(menu);
  await menu.screenshot({ path: `${screenshots}/bookmark-menu-info.png` });
  await page.keyboard.press('Escape');
  await page.getByTitle('Unsplash (one.example.test)', { exact: true }).click({ button: 'right' });
  menu = page.getByRole('menu', { name: '收藏操作', exact: true });
  await checkMenu(menu);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('PASS library paths, same-name results, URL/keyword search, folder counts, nested and empty folder navigation, narrow layout');
} finally {
  await browser?.close();
  await server.close();
}

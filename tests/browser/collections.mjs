import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('https://**/*', route => route.fulfill({ body: '' }));
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('jipage_bookmarks_v1', JSON.stringify([{
      id: 'private-bm', title: 'Existing bookmark', url: 'https://existing.test/', domain: 'existing.test',
      iconMode: 'text', notes: 'PRIVATE NOTE', keywords: ['PRIVATE KEYWORD'],
      category: 'legacy', tags: [], order: 0, pinnedToDesktop: false, collectionIds: [], createdAt: 1, updatedAt: 1,
    }]));
    localStorage.setItem('jipage_folders_v1', '[]');
    localStorage.setItem('jipage_collections_v1', '[]');
  });
  await page.reload();
  const openCollections = async () => {
    await page.getByRole('banner').getByRole('button', { name: '管理中心', exact: true }).click();
    await page.getByRole('navigation', { name: '管理中心导航', exact: true })
      .getByRole('button', { name: '我的网址单', exact: true }).click();
  };
  await openCollections();
  await page.getByRole('button', { name: '新建网址单', exact: true }).click();
  let editor = page.getByRole('dialog', { name: '新建网址单', exact: true });
  await editor.getByRole('textbox', { name: '网址单标题', exact: true }).fill('My Toolkit');
  await editor.getByRole('textbox', { name: '简介', exact: true }).fill('A complete introduction\nSecond paragraph');
  await editor.getByRole('textbox', { name: '章节标题 1', exact: true }).fill('Chapter Alpha');
  await editor.getByRole('textbox', { name: '章节正文 1', exact: true }).fill('Full text body\nAnother paragraph <script>no execution</script>');
  await editor.getByRole('button', { name: /选择收藏网址/ }).click();
  await editor.getByRole('checkbox', { name: '选择收藏 private-bm', exact: true }).check();
  await editor.getByRole('combobox', { name: '搜索收藏网址' }).press('Escape');
  await editor.getByRole('button', { name: '从收藏选择', exact: true }).click();
  assert.equal(await editor.getByRole('textbox', { name: '条目介绍 1.1', exact: true }).inputValue(), '');
  await editor.getByRole('textbox', { name: '条目介绍 1.1', exact: true }).fill('Public experience\nIndependent recommendation');
  await editor.getByRole('button', { name: '添加章节', exact: true }).click();
  await editor.getByRole('textbox', { name: '章节标题 2', exact: true }).fill('Chapter Beta');
  await editor.getByRole('textbox', { name: '手动网址名称', exact: true }).fill('Manual tool');
  await editor.getByRole('textbox', { name: '手动网址 URL', exact: true }).fill('https://manual.test/');
  await editor.getByRole('button', { name: '手动添加网址', exact: true }).click();
  await editor.getByRole('textbox', { name: '条目介绍 2.1', exact: true }).fill('Searchable explanation');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  const search = page.getByRole('searchbox', { name: '搜索网址单', exact: true });
  await search.fill('Searchable');
  await page.getByRole('heading', { name: 'My Toolkit', exact: true }).waitFor();
  await search.fill('no-match');
  await page.getByText('未找到匹配的网址单。', { exact: true }).waitFor();
  await search.fill('');
  await page.getByRole('button', { name: '打开 My Toolkit', exact: true }).click();
  await page.getByRole('heading', { name: 'Chapter Alpha', exact: true }).waitFor();
  await page.getByText('Searchable explanation', { exact: true }).waitFor();
  assert.equal(await page.getByText(/PRIVATE NOTE|PRIVATE KEYWORD/).count(), 0);
  await page.getByRole('button', { name: '编辑 My Toolkit', exact: true }).click();
  editor = page.getByRole('dialog', { name: '编辑网址单', exact: true });
  await editor.getByRole('textbox', { name: '网址单标题', exact: true }).fill('Updated Toolkit');
  await editor.getByRole('button', { name: '上移章节 2', exact: true }).click();
  await editor.getByRole('textbox', { name: '条目介绍 1.1', exact: true }).fill('Updated public explanation');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'Updated Toolkit', exact: true }).waitFor();
  await page.getByText('Updated public explanation', { exact: true }).waitFor();
  const chapterOrder = await page.locator('section h3').allTextContents();
  assert.ok(chapterOrder.indexOf('Chapter Beta') < chapterOrder.indexOf('Chapter Alpha'));
  await page.getByRole('button', { name: '分享 Updated Toolkit', exact: true }).click();
  const share = page.getByRole('dialog', { name: '分享网址单', exact: true });
  const markdown = await share.getByRole('textbox', { name: 'Markdown', exact: true }).inputValue();
  assert.ok(markdown.includes('# Updated Toolkit'));
  assert.ok(markdown.includes('Updated public explanation'));
  assert.ok(!markdown.includes('PRIVATE'));
  assert.ok(!markdown.includes('<script>'));
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async () => { throw new Error('permission denied'); } },
  }));
  await share.getByRole('button', { name: '复制 Markdown', exact: true }).click();
  await share.getByText('复制失败，请选择下方 Markdown 手动复制。', { exact: true }).waitFor();
  const downloadPromise = page.waitForEvent('download');
  await share.getByRole('button', { name: '下载 JSON', exact: true }).click();
  const download = await downloadPromise;
  const text = await readFile(await download.path(), 'utf8');
  const json = JSON.parse(text);
  assert.equal(json.scope, 'collection');
  assert.deepEqual(json.library, { bookmarks: [], folders: [], root: [] });
  assert.equal(json.collections[0].sections[0].items[0].bookmarkId, null);
  assert.ok(!text.includes('PRIVATE'));
  await share.getByRole('button', { name: '关闭', exact: true }).click();

  // Failed writes retain the editor draft and stored data until a successful retry.
  await page.getByRole('button', { name: '编辑 Updated Toolkit', exact: true }).click();
  editor = page.getByRole('dialog', { name: '编辑网址单', exact: true });
  await editor.getByRole('textbox', { name: '网址单标题', exact: true }).fill('Retry Toolkit');
  await page.evaluate(() => {
    window.__collectionSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'jipage_library_v2') throw new DOMException('quota', 'QuotaExceededError');
      return window.__collectionSetItem.call(this, key, value);
    };
  });
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.getByRole('alert').waitFor();
  assert.equal(await editor.getByRole('textbox', { name: '网址单标题', exact: true }).inputValue(), 'Retry Toolkit');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')).collections[0].title), 'Updated Toolkit');
  await page.evaluate(() => { Storage.prototype.setItem = window.__collectionSetItem; });
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'Retry Toolkit', exact: true }).waitFor();
  await page.getByRole('button', { name: '复制 Retry Toolkit', exact: true }).click();
  await page.getByRole('button', { name: /返回网址单|返回我的网址单/, exact: true }).click();
  assert.equal(await page.locator('article').count(), 2);
  await page.getByRole('button', { name: '删除 Retry Toolkit', exact: true }).click();
  let remove = page.getByRole('dialog', { name: '删除网址单？', exact: true });
  await remove.getByText(/不可恢复，不会删除原收藏/).waitFor();
  await remove.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.locator('article').count(), 2);
  await page.getByRole('button', { name: '删除 Retry Toolkit', exact: true }).click();
  remove = page.getByRole('dialog', { name: '删除网址单？', exact: true });
  await remove.getByRole('button', { name: '确认删除', exact: true }).click();
  await remove.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('article').count(), 1);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')).bookmarks.length), 1);
  await page.reload();
  await openCollections();
  assert.equal(await page.locator('article').count(), 1);
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/collections-desktop.png', fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: /编辑 Retry Toolkit/, exact: false }).click();
    editor = page.getByRole('dialog', { name: '编辑网址单', exact: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const box = await editor.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width);
    await page.screenshot({ path: `test-results/screenshots/collections-editor-${width}.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await editor.waitFor({ state: 'hidden' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '打开 Retry Toolkit (副本)', exact: true }).click();
  for (const english of [false, true]) {
    if (english) await page.getByRole('banner').getByRole('button', { name: '切换为英文', exact: true }).click();
    for (const dark of [false, true]) {
      const name = english ? (dark ? 'Night mode' : 'Day mode') : (dark ? '切换夜间模式' : '切换日间模式');
      const theme = page.getByRole('banner').getByRole('button', { name, exact: true });
      if (await theme.count()) await theme.click();
      await page.screenshot({ path: `test-results/screenshots/collections-detail-${english ? 'en' : 'zh'}-${dark ? 'dark' : 'light'}.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
  }
  // A recipient can import the actual downloaded file without importing the author's library or preferences.
  const recipient = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await recipient.route('https://**/*', route => route.fulfill({ body: '' }));
  const received = await recipient.newPage();
  received.on('pageerror', error => errors.push(error.message));
  await received.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await received.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('jipage_bookmarks_v1', '[]');
    localStorage.setItem('jipage_folders_v1', '[]');
    localStorage.setItem('jipage_collections_v1', '[]');
  });
  await received.reload();
  await received.getByRole('banner').getByRole('button', { name: '管理中心', exact: true }).click();
  const receiverNav = received.getByRole('navigation', { name: '管理中心导航', exact: true });
  await receiverNav.getByRole('button', { name: '导入与导出', exact: true }).click();
  await received.getByRole('group', { name: '导入格式', exact: true }).getByRole('radio', { name: '记个球收藏 · JSON', exact: true }).check();
  const transfer = received.getByRole('region', { name: '收藏资产 JSON', exact: true });
  await transfer.getByLabel('JSON 资产文件', { exact: true }).setInputFiles({
    name: 'shared-collection.json', mimeType: 'application/json', buffer: Buffer.from(text),
  });
  await transfer.getByRole('status', { name: '导入预览', exact: true }).waitFor();
  await transfer.getByRole('button', { name: '确认导入收藏', exact: true }).click();
  await received.getByRole('button', { name: '查看收藏', exact: true }).click();
  await received.getByRole('heading', { name: '全部收藏', exact: true }).waitFor();
  await receiverNav.getByRole('button', { name: '我的网址单', exact: true }).click();
  await received.getByRole('button', { name: '打开 Updated Toolkit', exact: true }).click();
  await received.getByText('Updated public explanation', { exact: true }).waitFor();
  await received.getByRole('button', { name: '收藏 Manual tool', exact: true }).click();
  await received.getByRole('button', { name: '已有收藏 Manual tool', exact: true }).waitFor();
  const imported = await received.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')));
  assert.equal(imported.bookmarks.length, 1);
  assert.equal(imported.bookmarks[0].title, 'Manual tool');
  assert.equal(imported.bookmarks[0].pinnedToDesktop, false);
  assert.equal(imported.collections[0].assetContent.sections[0].title, 'Chapter Beta');
  await received.getByRole('button', { name: '编辑 Updated Toolkit', exact: true }).click();
  const receivedEditor = received.getByRole('dialog', { name: '编辑网址单', exact: true });
  await receivedEditor.getByRole('textbox', { name: '网址单标题', exact: true }).fill('Must not save after leaving');
  await received.evaluate(() => new Promise(resolve => {
    navigator.locks.request('jigeqiu:prototype:library-import', () => new Promise(release => {
      window.__releaseCollectionLock = release;
      resolve();
    }));
  }));
  await receivedEditor.getByRole('button', { name: '保存', exact: true }).click();
  await received.waitForFunction(async () => (await navigator.locks.query()).pending.length > 0);
  // Force a route-owner unmount while the modal intentionally blocks ordinary pointer navigation.
  await received.getByRole('banner').getByRole('button', { name: '桌面', exact: true }).dispatchEvent('click');
  await received.getByRole('banner').getByRole('button', { name: '管理中心', exact: true }).click();
  await received.getByRole('button', { name: '新建网址单', exact: true }).waitFor();
  await received.evaluate(() => { window.__releaseCollectionLock(); });
  await received.waitForFunction(async () => (await navigator.locks.query()).pending.length === 0);
  assert.equal(await received.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')).collections[0].title), 'Updated Toolkit');
  await recipient.close();
  assert.deepEqual(errors, []);
  console.log('PASS local collection CRUD, chapter order, private-note isolation, search, Markdown fallback, independent JSON, retry, delete and 320/390px editor');
} finally { await browser?.close(); await server.close(); }

import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('https://**/*', route => route.fulfill({ body: '' }));
  const page = await context.newPage();
  page.on('pageerror', error => console.error('Browser error:', error.message));
  page.setDefaultTimeout(8000);
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(origin);
  await page.evaluate(async () => {
    const { StorageManager } = await import('/src/services/storage.ts');
    const manager = new StorageManager();
    manager.saveUserSettings({ language: 'zh' });
    const folder = manager.createFolder('Original archive');
    const bookmark = manager.saveManualBookmark({
      title: 'Recover me', url: 'https://recover.example/', domain: 'recover.example', category: 'cat-inbox',
      folderId: folder.id, pinnedToDesktop: false, collectionIds: [], keywords: ['restore'], order: 0,
    });
    manager.executeDesktop([{ type: 'desktop.pin', bookmarkId: bookmark.id, shortcutId: 'shortcut', to: { kind: 'root', index: 0 } }]);
    manager.saveUserSettings({ dockBookmarkIds: [bookmark.id] });
  });
  await page.reload();
  const manage = async () => {
    await page.goto(`${origin}/#/library`);
    await page.reload();
  };
  const section = name => page.goto(`${origin}/#/${name === '回收站' ? 'trash' : 'library'}`);
  await manage();
  await page.waitForSelector('[data-library-bookmark]');
  await page.getByTitle('删除收藏…', { exact: true }).click();
  await page.getByRole('button', { name: '移至回收站', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await section('回收站');
  await page.getByText('Recover me', { exact: true }).waitFor();
  const snapshot = () => page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')));
  let data = await snapshot();
  assert.equal(data.bookmarks.length, 0);
  assert.equal(data.desktopLayout.shortcuts.length, 0);
  assert.deepEqual(data.dockBookmarkIds, []);
  const originalId = data.bookmarkTrash[0].bookmark.id;
  await page.reload();
  await manage();
  await section('回收站');
  await page.getByRole('button', { name: '恢复收藏', exact: true }).click();
  await page.getByText('回收站为空', { exact: true }).waitFor();
  data = await snapshot();
  assert.equal(data.bookmarks[0].id, originalId);
  assert.equal(data.bookmarks[0].folderId, data.folders[0].id);
  assert.equal(data.desktopLayout.shortcuts.length, 0);
  assert.deepEqual(data.dockBookmarkIds, []);
  await section('全部收藏');
  await page.getByTitle('删除收藏…', { exact: true }).click();
  await page.getByRole('button', { name: '移至回收站', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await section('回收站');
  await page.getByRole('button', { name: '彻底删除收藏', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await snapshot()).bookmarkTrash.length, 1);
  await mkdir('/tmp/jigeqiu-trash', { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `/tmp/jigeqiu-trash/trash-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await page.getByRole('button', { name: '彻底删除收藏', exact: true }).click();
  await page.getByRole('button', { name: '确认彻底删除', exact: true }).click();
  await page.getByText('回收站为空', { exact: true }).waitFor();
  assert.equal((await snapshot()).bookmarkTrash.length, 0);
  // Keep legacy data intact while restoring both kinds through the formal UI.
  await page.evaluate(async () => {
    const { StorageManager } = await import('/src/services/storage.ts');
    const manager = new StorageManager();
    const folder = manager.createFolder('Legacy-safe folder');
    const input = {
      title: 'Legacy-safe bookmark', url: 'https://legacy-safe.example/', domain: 'legacy-safe.example',
      category: '', pinnedToDesktop: false, collectionIds: [], order: 0,
    };
    const bookmark = manager.saveManualBookmark(input);
    manager.deleteBookmark(bookmark.id);
    manager.saveManualBookmark({ ...input, title: 'Nested restore', url: 'https://nested-restore.example/', folderId: folder.id });
    manager.trashFolder(folder.id);
    manager.addBookmark({ ...input, title: 'Unrelated legacy', url: 'file:///legacy-document' });
  });
  await page.reload();
  await manage();
  await section('回收站');
  await page.getByRole('button', { name: '恢复收藏', exact: true }).click();
  await page.getByText('Legacy-safe bookmark', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '恢复目录', exact: true }).click();
  await page.getByText('回收站为空', { exact: true }).waitFor();
  data = await snapshot();
  assert.equal(data.bookmarks.find(item => item.title === 'Unrelated legacy').url, 'file:///legacy-document');
  assert.ok(data.bookmarks.some(item => item.title === 'Legacy-safe bookmark'));
  assert.ok(data.bookmarks.some(item => item.title === 'Nested restore'));
  assert.deepEqual(data.desktopLayout.shortcuts, []);
  assert.deepEqual(data.dockBookmarkIds, []);
  await page.evaluate(async () => {
    const { StorageManager } = await import('/src/services/storage.ts');
    const manager = new StorageManager();
    const bookmark = manager.getBookmarks().find(item => item.title === 'Legacy-safe bookmark');
    manager.deleteBookmark(bookmark.id);
    manager.addBookmark({ ...bookmark, title: 'Existing copy' });
    const folder = manager.getFolders().find(item => item.name === 'Legacy-safe folder');
    const nested = manager.getBookmarks().find(item => item.title === 'Nested restore');
    manager.trashFolder(folder.id);
    manager.addBookmark({ ...nested, title: 'Existing nested copy', folderId: undefined });
  });
  await page.reload();
  await manage();
  await section('回收站');
  const beforeConflict = await snapshot();
  await page.getByRole('button', { name: '恢复收藏', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '相同网址或标识' }).waitFor();
  assert.deepEqual(await snapshot(), beforeConflict, 'Duplicate bookmark restoration leaves every byte represented by the snapshot unchanged');
  await page.getByRole('button', { name: '恢复目录', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '整个目录批次仍保留在回收站' }).waitFor();
  assert.deepEqual(await snapshot(), beforeConflict, 'Duplicate folder restoration never partially restores or discards entries');
  await page.reload();
  await manage();
  await section('回收站');
  await page.getByText('Legacy-safe bookmark', { exact: true }).waitFor();
  await page.getByText('Legacy-safe folder', { exact: true }).waitFor();
  console.log('PASS delete/reload/restore, legacy URL isolation, sequential bookmark/folder restore, explicit duplicate conflict with atomic retention, no desktop/Dock pins and 320/390px');
} finally {
  await browser?.close();
  await server.close();
}

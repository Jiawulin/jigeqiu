import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const extension = path.join(root, 'dist-extension');
const profile = await mkdtemp(path.join(os.tmpdir(), 'jigeqiu-capture-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, locale: 'en-US',
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route(/^https?:/, route => route.abort());
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  assert.equal(await worker.evaluate(async () =>
    (await globalThis.chrome.commands.getAll()).some(command => command.name === 'save-current-page')), true);
  const launcher = await context.newPage();
  await launcher.goto(worker.url().replace(/background\.js$/, 'index.html'));
  const open = async (url, title = 'Captured page') => {
    const pending = context.waitForEvent('page');
    const [page] = await Promise.all([pending, launcher.evaluate(async ({ url, title }) => {
      const { captureCurrentPage } = await import(globalThis.chrome.runtime.getURL('background.js'));
      const source = await globalThis.chrome.windows.getCurrent();
      await captureCurrentPage({ url, title, windowId: source.id });
    }, { url, title })]);
    await page.waitForLoadState();
    return page;
  };
  const first = await open('https://example.org/capture?q=private', 'Captured title');
  await first.getByRole('heading', { name: 'Privacy before you begin', exact: true }).waitFor();
  assert.doesNotMatch(first.url(), /private|example.org|Captured/);
  await first.getByRole('button', { name: 'Acknowledge and continue', exact: true }).click();
  const form = first.getByRole('dialog', { name: 'Add bookmark', exact: true });
  await form.waitFor();
  assert.equal(await form.getByLabel('Website URL', { exact: true }).inputValue(), 'https://example.org/capture?q=private');
  assert.equal(await form.getByLabel('Website name', { exact: true }).inputValue(), 'Captured title');
  const screenshots = path.join(root, 'test-results/extension');
  await mkdir(screenshots, { recursive: true });
  for (const width of [320, 390, 560]) {
    await first.setViewportSize({ width, height: 760 });
    assert.equal(await first.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth), false);
    await first.screenshot({ path: path.join(screenshots, `capture-en-${width}.png`), fullPage: true });
  }
  // Failed writes keep the form, title and request intact.
  await first.evaluate(() => {
    const original = globalThis.chrome.storage.local.set.bind(globalThis.chrome.storage.local);
    globalThis.chrome.storage.local.set = async () => {
      globalThis.chrome.storage.local.set = original;
      throw new Error('QUOTA_BYTES exceeded');
    };
  });
  await form.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  await form.getByRole('alert').waitFor();
  assert.equal(await form.getByLabel('Website name', { exact: true }).inputValue(), 'Captured title');
  const closed = first.waitForEvent('close');
  await form.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  await closed;
  const entries = async () => worker.evaluate(async () => await globalThis.chrome.storage.session.get(null));
  for (let i = 0; i < 40 && Object.keys(await entries()).length; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(await entries(), {});
  const state = await worker.evaluate(async () =>
    (await globalThis.chrome.storage.local.get('jigeqiu-extension-state-v1'))['jigeqiu-extension-state-v1']);
  const library = JSON.parse(state.data.jipage_library_v2);
  assert.equal(library.bookmarks.length, 1);
  assert.equal(library.bookmarks[0].pinnedToDesktop, false);
  assert.equal(library.bookmarks[0].title, 'Captured title');
  const duplicate = await open('https://example.org/capture?q=private');
  await duplicate.getByText('Already saved as "Captured title"', { exact: true }).waitFor();
  await duplicate.getByRole('button', { name: 'Edit existing', exact: true }).click();
  await duplicate.getByLabel('Website name', { exact: true }).fill('Updated captured title');
  const edited = duplicate.waitForEvent('close');
  await duplicate.getByRole('button', { name: 'Save changes', exact: true }).click();
  await edited;
  const a = await open('https://example.org/a', 'Draft A');
  const b = await open('https://example.org/b', 'Draft B');
  await a.getByRole('dialog', { name: 'Add bookmark', exact: true }).waitFor();
  await b.getByRole('dialog', { name: 'Add bookmark', exact: true }).waitFor();
  const aClosed = a.waitForEvent('close');
  await a.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  await aClosed;
  await b.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  await b.getByRole('alert').waitFor();
  assert.equal(await b.getByLabel('Website name', { exact: true }).inputValue(), 'Draft B');
  await b.close();
  const invalid = await open('chrome://settings/');
  await invalid.getByRole('alert').waitFor();
  assert.equal(await invalid.locator('form').count(), 0);
  await invalid.close();
  // Create/select a folder through the shared picker, then verify its membership.
  const folderPage = await open('https://example.org/folder', 'Folder capture');
  await folderPage.getByRole('button', { name: 'Bookmark location Library root', exact: true }).click();
  await folderPage.getByRole('button', { name: 'New folder', exact: true }).click();
  await folderPage.getByRole('textbox', { name: 'New folder name', exact: true }).fill('Capture folder');
  await folderPage.getByRole('button', { name: 'Create folder', exact: true }).click();
  const folderClosed = folderPage.waitForEvent('close');
  await folderPage.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  await folderClosed;
  const current = await worker.evaluate(async () =>
    (await globalThis.chrome.storage.local.get('jigeqiu-extension-state-v1'))['jigeqiu-extension-state-v1']);
  const data = JSON.parse(current.data.jipage_library_v2);
  const folderBookmark = data.bookmarks.find(bookmark => bookmark.title === 'Folder capture');
  assert.ok(data.folders.find(folder => folder.id === folderBookmark.folderId).bookmarkIds.includes(folderBookmark.id));
  // Idle workbenches update in place, but an open editor retains its draft and baseline.
  await launcher.reload();
  await launcher.getByRole('banner').waitFor();
  const skip = launcher.getByRole('button', { name: 'Skip for now', exact: true });
  if (await skip.isVisible()) await skip.click();
  await launcher.evaluate(() => { globalThis.location.hash = '/library'; globalThis.syncMarker = 'launcher'; });
  const idle = await context.newPage();
  await idle.goto(worker.url().replace(/background\.js$/, 'index.html#/library'));
  const search = idle.getByRole('searchbox', { name: 'Search by name, URL, or keywords...', exact: true });
  await search.fill('Live capture');
  await idle.evaluate(() => { globalThis.syncMarker = 'idle'; });
  await launcher.getByRole('button', { name: 'Add bookmark to this folder', exact: true }).click();
  const draft = launcher.getByRole('dialog', { name: 'Add bookmark', exact: true });
  await draft.getByLabel('Website URL', { exact: true }).fill('https://example.org/retained');
  await draft.getByLabel('Website name', { exact: true }).fill('Retained local draft');
  const live = await open('https://example.org/live', 'Live capture');
  const liveClosed = live.waitForEvent('close');
  await live.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  await liveClosed;
  await idle.getByText('Live capture', { exact: true }).first().waitFor();
  assert.equal(await search.inputValue(), 'Live capture');
  assert.equal(await idle.evaluate(() => globalThis.syncMarker), 'idle');
  assert.equal(await draft.getByLabel('Website name', { exact: true }).inputValue(), 'Retained local draft');
  await draft.getByRole('button', { name: 'Add bookmark', exact: true }).click();
  await draft.getByRole('alert').waitFor();
  assert.equal(await draft.getByLabel('Website name', { exact: true }).inputValue(), 'Retained local draft');
  await draft.getByRole('button', { name: 'Cancel', exact: true }).click();
  await launcher.getByText('Live capture', { exact: true }).first().waitFor();
  assert.equal(await launcher.evaluate(() => globalThis.syncMarker), 'launcher');
  await idle.close();
  await worker.evaluate(async () => {
    const key = 'jigeqiu-extension-state-v1';
    const state = (await globalThis.chrome.storage.local.get(key))[key];
    state.data.jipage_settings_v1 = '{"language":"zh","appearanceMode":"dark-glass"}';
    state.revision++;
    await globalThis.chrome.storage.local.set({ [key]: state });
  });
  const chinese = await open('https://example.org/chinese', '中文标题');
  await chinese.getByRole('dialog', { name: '添加收藏', exact: true }).waitFor();
  assert.equal(await chinese.locator('html').getAttribute('lang'), 'zh-CN');
  assert.match(await chinese.locator('html').getAttribute('class'), /dark/);
  await chinese.screenshot({ path: path.join(screenshots, 'capture-zh-dark.png'), fullPage: true });
  await chinese.getByRole('button', { name: '取消', exact: true }).click();
  // Readback uncertainty blocks further writes while leaving entered content visible.
  const uncertain = await open('https://example.org/uncertain', 'Uncertain draft');
  await uncertain.getByRole('dialog', { name: '添加收藏', exact: true }).waitFor();
  await uncertain.evaluate(() => {
    const set = globalThis.chrome.storage.local.set.bind(globalThis.chrome.storage.local);
    globalThis.chrome.storage.local.set = async values => {
      await set(values);
      globalThis.chrome.storage.local.get = async () => { throw new Error('Readback denied'); };
    };
  });
  await uncertain.getByRole('button', { name: '添加收藏', exact: true }).click();
  await uncertain.getByRole('alert').waitFor();
  assert.equal(await uncertain.getByLabel('网站名称', { exact: true }).inputValue(), 'Uncertain draft');
  await uncertain.close();
  await worker.evaluate(async () => {
    await globalThis.chrome.storage.local.set({ 'jigeqiu-extension-state-v1': { version: 999 } });
  });
  const corrupt = await open('https://example.org/corrupt');
  await corrupt.getByRole('heading', { name: /无法读取或迁移本地数据|Unable to read or migrate local data/ }).waitFor();
  assert.equal(await corrupt.locator('form').count(), 0);
  await corrupt.close();
  console.log('PASS: production handler invocation (not OS menu/shortcut simulation), capture privacy continuation, title/URL prefill, narrow layouts, quota draft retention, save/cleanup, duplicate and concurrent conflict, unsupported URL');
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}

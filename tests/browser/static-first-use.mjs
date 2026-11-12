import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { once } from 'node:events';

// Deliberately no Vite, Express, source transforms, API handlers or SPA fallback.
const root = resolve(process.env.STATIC_DIST ?? 'dist');
const remote = process.env.STATIC_URL ? new URL(process.env.STATIC_URL) : null;
const base = process.env.STATIC_BASE ?? remote?.pathname ?? '/';
assert.match(base, /^\/(?:[a-zA-Z0-9_-]+\/)*$/);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json',
};
const served = [];
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(base)) {
      response.writeHead(404).end('Not found'); return;
    }
    const relative = pathname.slice(base.length);
    const file = resolve(root, relative || 'index.html');
    if (!file.startsWith(root + sep) || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(403).end(); return;
    }
    if (!(await stat(file)).isFile()) throw Error('NOT_FOUND');
    const bytes = await readFile(file);
    served.push(pathname);
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    response.writeHead(404).end('Not found');
  }
});
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
let browser;
try {
  if (!remote) {
    assert.ok((await stat(resolve(root, 'index.html'))).isFile(), 'Run npm run build before this test');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  }
  const origin = remote?.origin ?? `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const errors = [], badResponses = [], backendRequests = [];
  async function device(width = 1440, locksAvailable = true) {
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width, height: 1000 }, acceptDownloads: true });
    if (!locksAvailable) await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === origin ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith(origin) && response.status() >= 400) badResponses.push(response.url());
    });
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === origin && /^\/(api|src|@vite|node_modules)(\/|$)/.test(url.pathname)) backendRequests.push(url.pathname);
    });
    await page.goto(`${origin}${base}`);
    assert.equal(await page.evaluate(() => isSecureContext && !!navigator.locks?.request), locksAvailable);
    if (locksAvailable) {
      const welcome = page.getByRole('dialog', { name: '欢迎使用记个球', exact: true });
      await welcome.waitFor();
      await welcome.getByRole('button', { name: '暂时跳过', exact: true }).click();
    }
    return page;
  }
  const page = await device();
  const library = tab => tab.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')));
  const manager = tab => tab.getByRole('banner').getByRole('button', { name: '管理中心', exact: true }).click();
  async function section(tab, id, label) {
    const mobile = tab.getByRole('combobox', { name: '管理中心小节', exact: true });
    if (await mobile.isVisible()) await mobile.selectOption(id);
    else await tab.getByRole('navigation', { name: '管理中心导航' }).getByRole('button', { name: label, exact: true }).click();
  }
  assert.equal(await library(page), null, 'First visit must not seed asset data');
  await mkdir('/tmp/jigeqiu-public-source', { recursive: true });
  for (const width of [1440, 390, 320]) {
    for (const language of ['zh', 'en']) {
      for (const appearance of ['light-glass', 'dark-glass']) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(({ language, appearance }) => {
          localStorage.setItem('jipage_settings_v1', JSON.stringify({
            ...JSON.parse(localStorage.getItem('jipage_settings_v1') ?? '{}'), language, appearanceMode: appearance,
          }));
        }, { language, appearance });
        await page.reload();
        const attribution = page.getByRole('link', { name: 'Powered by 记个球 · jiawulin.github.io', exact: true, includeHidden: true });
        await attribution.waitFor({ state: 'attached' });
        await page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, appearance === 'dark-glass');
        assert.equal(await page.getByRole('button', { name: language === 'en' ? 'Switch to Chinese' : '切换为英文', exact: true }).count(), 1);
        assert.equal(await attribution.getAttribute('href'), 'https://jiawulin.github.io/');
        assert.equal(await attribution.getAttribute('target'), '_blank');
        assert.match(await attribution.getAttribute('rel'), /noopener/);
        assert.match(await attribution.getAttribute('rel'), /noreferrer/);
        assert.equal(await attribution.isVisible(), width >= 768);
        assert.doesNotMatch(await page.locator('body').innerText(), /ICP备|JIGEQIU ·|极简轻量液态玻璃工作台/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (width >= 768) {
          await attribution.focus();
          assert.equal(await attribution.evaluate(element => element === document.activeElement), true);
          const bounds = await attribution.boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
          assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 1000);
        }
        await page.screenshot({ path: `/tmp/jigeqiu-public-source/footer-${width}-${language}-${appearance}.png` });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    localStorage.setItem('jipage_settings_v1', JSON.stringify({
      ...JSON.parse(localStorage.getItem('jipage_settings_v1') ?? '{}'), language: 'zh', appearanceMode: 'light-glass',
    }));
  });
  await page.reload();
  assert.equal(await page.getByRole('button', { name: /预览桌面转换|确认转换/ }).count(), 0);
  await manager(page);
  await page.getByRole('heading', { name: '全部收藏', exact: true }).waitFor();
  assert.equal(await page.locator('[data-library-bookmark]').count(), 0);
  await section(page, 'import-export', '导入与导出');
  const importer = page.getByRole('region', { name: 'Chrome 书签导入', exact: true });
  const file = {
    name: 'chrome-bookmarks.html', mimeType: 'text/html',
    buffer: Buffer.from('<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>Work</H3><DL><DT><A HREF="https://example.org/alpha">Alpha</A><DT><H3>Nested</H3><DL><DT><A HREF="https://example.org/beta">Beta</A></DL><DT><H3>Empty</H3><DL></DL></DL><DT><A HREF="javascript:alert(1)">Unsafe</A></DL>'),
  };
  await importer.getByLabel('浏览器书签 HTML 文件').setInputFiles(file);
  await importer.getByText('2 个网址', { exact: true }).waitFor();
  assert.equal(await library(page), null, 'Preview must not write');
  await importer.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await library(page), null);
  await importer.getByLabel('浏览器书签 HTML 文件').setInputFiles(file);
  await importer.getByRole('button', { name: '确认导入收藏', exact: true }).click();
  await page.getByRole('button', { name: '查看收藏', exact: true }).click();
  await page.getByRole('heading', { name: '全部收藏', exact: true }).waitFor();
  const imported = await library(page);
  assert.equal(imported.bookmarks.length, 2);
  assert.equal(imported.folders.length, 3);
  assert.ok(imported.bookmarks.every(bookmark => !bookmark.pinnedToDesktop));
  assert.equal(imported.desktopLayout?.shortcuts.length ?? 0, 0);
  const row = page.locator('[data-library-bookmark]').filter({ has: page.getByText('Alpha', { exact: true }) });
  await row.getByTitle('编辑收藏', { exact: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑收藏', exact: true });
  await edit.getByLabel('网站名称', { exact: true }).fill('Alpha personal');
  await edit.getByPlaceholder('例如：图片、壁纸；按 Enter 或逗号添加').fill('work');
  await edit.getByPlaceholder('例如：图片、壁纸；按 Enter 或逗号添加').press('Enter');
  await edit.getByRole('button', { name: '保存更改', exact: true }).click();
  await edit.waitFor({ state: 'hidden' });
  assert.deepEqual((await library(page)).bookmarks.find(bookmark => bookmark.title === 'Alpha personal').keywords, ['work']);
  // Import and archive edits never pin; the first explicit pin creates the layout.
  await page.getByRole('banner').getByRole('button', { name: '桌面', exact: true }).click();
  assert.equal(await page.locator('[data-desktop-id]').count(), 0, 'Imported assets are not desktop icons');
  assert.equal(await page.getByRole('button', { name: /预览桌面转换|确认转换/ }).count(), 0);
  await manager(page);
  const changed = page.locator('[data-library-bookmark]').filter({ has: page.getByText('Alpha personal', { exact: true }) });
  await changed.getByTitle('固定到桌面', { exact: true }).click();
  await page.getByRole('banner').getByRole('button', { name: '桌面', exact: true }).click();
  await page.locator('.desktop-item').filter({ hasText: 'Alpha personal' }).waitFor();
  await page.reload();
  await page.locator('.desktop-item').filter({ hasText: 'Alpha personal' }).waitFor();
  await page.getByTitle('启动台 · 所有应用与收藏 (桌面上滑亦可展开)').click();
  await page.getByRole('dialog', { name: '启动台', exact: true }).getByRole('button', { name: 'Beta', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await manager(page);
  await section(page, 'import-export', '导入与导出');
  await page.getByRole('group', { name: '导出格式', exact: true }).getByRole('radio', { name: '记个球收藏 · JSON', exact: true }).check();
  const transfer = page.getByRole('region', { name: '导出收藏', exact: true });
  const downloaded = page.waitForEvent('download');
  await transfer.getByRole('button', { name: '导出收藏', exact: true }).click();
  const download = await downloaded;
  const backup = await readFile(await download.path(), 'utf8');
  const data = JSON.parse(backup);
  assert.equal(data.format, 'jigeqiu-assets');
  assert.equal(data.library.bookmarks.length, 2);
  assert.equal(data.library.folders.length, 3);
  for (const key of ['settings', 'layout', 'desktopLayout', 'trash', 'bookmarkTrash', 'folderTrash', 'searchEngines']) {
    assert.equal(key in data, false);
    assert.equal(key in data.library, false);
  }
  const fresh = await device(390);
  assert.equal(await library(fresh), null, 'Separate profile must have its own empty library');
  await manager(fresh);
  await section(fresh, 'import-export', '导入与导出');
  await fresh.getByRole('group', { name: '导入格式', exact: true }).getByRole('radio', { name: '记个球收藏 · JSON', exact: true }).check();
  const target = fresh.getByRole('region', { name: '收藏资产 JSON', exact: true });
  const settingsBefore = await fresh.evaluate(() => localStorage.getItem('jipage_settings_v1'));
  await target.getByLabel('JSON 资产文件', { exact: true }).setInputFiles({
    name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup),
  });
  await target.getByRole('status', { name: '导入预览', exact: true }).waitFor();
  assert.equal(await library(fresh), null);
  await target.getByRole('button', { name: '确认导入收藏', exact: true }).click();
  await fresh.getByRole('button', { name: '查看收藏', exact: true }).click();
  await fresh.getByRole('heading', { name: '全部收藏', exact: true }).waitFor();
  const restored = await library(fresh);
  assert.equal(restored.bookmarks.length, 2);
  assert.equal(restored.folders.length, 3);
  const alpha = restored.bookmarks.find(bookmark => bookmark.title === 'Alpha personal');
  assert.deepEqual(alpha.keywords, ['work']);
  assert.equal(restored.folders.find(folder => folder.id === alpha.folderId).name, 'Work');
  assert.ok(restored.folders.some(folder => folder.name === 'Empty' && !folder.bookmarkIds.length));
  assert.equal(restored.desktopLayout?.shortcuts.length ?? 0, 0);
  assert.equal(await fresh.evaluate(() => localStorage.getItem('jipage_settings_v1')), settingsBefore);
  await fresh.reload();
  assert.equal((await library(fresh)).bookmarks.length, 2);
  await mkdir('/tmp/jigeqiu-static-first-use', { recursive: true });
  for (const width of [390, 320]) {
    await fresh.setViewportSize({ width, height: 900 });
    await manager(fresh);
    await fresh.screenshot({ path: `/tmp/jigeqiu-static-first-use/library-${width}.png` });
    assert.equal(await fresh.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  const unsupported = await device(390, false);
  await unsupported.keyboard.press('Control+Shift+Enter');
  const blocked = unsupported.getByRole('dialog', { name: '添加收藏', exact: true });
  await blocked.getByLabel('网址 URL', { exact: true }).fill('https://unsupported.example/');
  await blocked.getByLabel('网站名称', { exact: true }).fill('Unsaved draft');
  await blocked.getByRole('button', { name: '添加收藏', exact: true }).click();
  await blocked.getByRole('alert').filter({ hasText: 'Web Locks' }).waitFor();
  assert.equal(await library(unsupported), null);
  assert.equal(await blocked.getByLabel('网站名称', { exact: true }).inputValue(), 'Unsaved draft');
  await page.goto(`${origin}${base}#/settings/appearance`);
  await page.getByRole('heading', { name: '外观', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: '外观', exact: true }).waitFor();
  await page.goto(`${origin}${base}#/start`);
  await page.getByRole('dialog', { name: '启动台', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('dialog', { name: '启动台', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog', { name: '全局搜索', exact: true });
  await search.waitFor();
  await search.getByRole('combobox').fill('/all');
  await search.getByRole('option').filter({ hasText: '全部收藏管理' }).waitFor();
  await page.keyboard.press('Escape');
  if (!remote) {
    assert.ok(served.some(path => path.startsWith(`${base}assets/`) && path.endsWith('.js')));
    assert.ok(served.some(path => path.startsWith(`${base}assets/`) && path.endsWith('.css')));
    assert.ok(served.some(path => path.startsWith(`${base}wallpapers/`) && path.endsWith('.webp')));
  }
  assert.deepEqual(backendRequests, []);
  assert.deepEqual(badResponses, []);
  assert.deepEqual(errors, []);
  assert.doesNotMatch(await page.locator('meta[name="description"]').getAttribute('content'), /网址单/);
  console.log('PASS dist-only static host; attribution link and no filing number across 12 viewport/locale/theme combinations; external requests blocked, empty → Chrome preview/cancel/import → edit → desktop pin/reload/launchpad → JSON → clean-profile restore; 320/390px; missing locks refuse writes; no source/API requests');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

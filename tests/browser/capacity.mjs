import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { cpus, platform, release } from 'node:os';

// Synthetic fixtures only; every sample gets a new temporary browser context.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const output = resolve(process.env.CAPACITY_OUTPUT ?? '/tmp/jigeqiu-capacity');
const root = resolve('dist');
const libraryKey = 'jipage_library_v2';
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + sep) || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(403).end(); return;
    }
    const bytes = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    response.writeHead(404).end();
  }
});
function fixture(count) {
  const groups = [];
  for (let start = 0; start < count; start += 100) {
    const links = Array.from({ length: Math.min(100, count - start) }, (_, offset) => {
      const index = start + offset;
      const number = String(index).padStart(5, '0');
      return `<DT><A HREF="https://capacity.invalid/resource/${number}?source=synthetic" ADD_DATE="1700000000">资源工具 Resource ${number}</A>`;
    }).join('\n');
    groups.push(`<DT><H3>工作资源 ${start / 100}</H3><DL><DT><H3>开发工具</H3><DL>${links}</DL><DT><H3>空文件夹</H3><DL></DL></DL>`);
  }
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1><META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8"><DL>${groups.join('\n')}</DL>`;
}
function canonical(library) {
  const folders = new Map(library.folders.map(folder => [folder.id, folder]));
  const bookmarks = new Map(library.bookmarks.map(bookmark => [bookmark.id, bookmark]));
  const path = id => {
    const names = [], seen = new Set();
    while (id) {
      assert.ok(!seen.has(id), 'No cyclic fixture folder');
      seen.add(id);
      const folder = folders.get(id);
      assert.ok(folder, 'Every fixture folder reference exists');
      names.unshift(folder.name);
      id = folder.parentId;
    }
    return names.join('/');
  };
  return {
    bookmarks: library.bookmarks.map(bookmark => ({
      title: bookmark.title, url: bookmark.url, domain: bookmark.domain,
      keywords: bookmark.keywords ?? [], notes: bookmark.notes ?? '',
      icon: bookmark.icon ?? null, iconMode: bookmark.iconMode ?? 'auto',
      createdAt: bookmark.createdAt, updatedAt: bookmark.updatedAt,
      path: path(bookmark.folderId),
    })).sort((a, b) => a.url.localeCompare(b.url)),
    folders: library.folders.map(folder => ({
      path: path(folder.id), createdAt: folder.createdAt, updatedAt: folder.updatedAt,
      bookmarkUrls: folder.bookmarkIds.map(id => {
        assert.equal(bookmarks.get(id)?.folderId, folder.id);
        return bookmarks.get(id).url;
      }),
    })).sort((a, b) => a.path.localeCompare(b.path)),
    orderedChildren: [undefined, ...library.folders.map(folder => folder.id)].map(id => ({
      parent: path(id),
      children: [
        ...library.folders.filter(folder => folder.parentId === id)
          .map(folder => ({ order: folder.order, identity: `folder:${path(folder.id)}` })),
        ...library.bookmarks.filter(bookmark => bookmark.folderId === id)
          .map(bookmark => ({ order: bookmark.order, identity: `bookmark:${bookmark.url}` })),
      ].sort((a, b) => a.order - b.order).map(item => item.identity),
    })).sort((a, b) => a.parent.localeCompare(b.parent)),
  };
}
const report = {
  status: 'running',
  generatedAt: new Date().toISOString(),
  environment: { platform: platform(), release: release(), cpu: cpus()[0]?.model, node: process.version },
  conditions: 'Production dist; local static host; unthrottled headless Chromium; external requests blocked; synthetic mixed Chinese/English; cold then warm samples; Playwright end-to-end wall time, not pure algorithm time or field Web Vitals.',
  samples: [],
};
let browser;
try {
  await readFile(resolve(root, 'index.html'));
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  report.environment.browser = browser.version();
  async function device() {
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin
      ? route.continue() : route.abort());
    await context.addInitScript(() => {
      window.capacityLongTasks = [];
      if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) window.capacityLongTasks.push(entry.duration);
        }).observe({ type: 'longtask', buffered: true });
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    return { context, page, errors };
  }
  const readLibrary = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), libraryKey);
  const libraryRaw = page => page.evaluate(key => localStorage.getItem(key), libraryKey);
  async function paint(page) {
    await page.evaluate(() => new Promise(resolvePaint =>
      requestAnimationFrame(() => requestAnimationFrame(resolvePaint))));
  }
  async function timed(sample, name, page, action) {
    const before = performance.now();
    await action();
    await paint(page);
    const elapsed = Math.round(performance.now() - before);
    (sample.timingsMs[name] ??= []).push(elapsed);
    console.log(`${sample.count} ${name}: ${elapsed}ms`);
  }
  async function transfer(page) {
    await page.getByRole('banner').getByRole('button', { name: '管理中心', exact: true }).click();
    await page.getByRole('navigation', { name: '管理中心导航' })
      .getByRole('button', { name: '导入与导出', exact: true }).click();
  }
  for (const count of [1000, 5000]) {
    const sample = { count, timingsMs: {}, checks: {}, longTasks: {} };
    report.samples.push(sample);
    const { context, page, errors } = await device();
    assert.equal(await libraryRaw(page), null);
    await transfer(page);
    const html = fixture(count);
    sample.htmlBytes = Buffer.byteLength(html);
    const importer = page.getByRole('region', { name: 'Chrome 书签导入', exact: true });
    await timed(sample, 'htmlPreview', page, async () => {
      await importer.getByLabel('浏览器书签 HTML 文件').setInputFiles({
        name: `synthetic-${count}.html`, mimeType: 'text/html', buffer: Buffer.from(html),
      });
      await importer.getByText(`${count} 个网址`, { exact: true }).waitFor();
    });
    assert.equal(await libraryRaw(page), null, 'HTML preview remains read-only');
    await timed(sample, 'htmlCommitAndLibrary', page, async () => {
      await importer.getByRole('button', { name: '确认导入收藏', exact: true }).click();
      await page.getByRole('button', { name: '查看收藏', exact: true }).click();
      await page.getByRole('heading', { name: '全部收藏', exact: true }).waitFor();
      await page.locator('[data-library-bookmark]').first().waitFor();
    });
    let imported = await readLibrary(page);
    assert.equal(imported.bookmarks.length, count);
    assert.equal(imported.folders.length, count / 100 * 3);
    assert.equal(new Set(imported.bookmarks.map(bookmark => bookmark.url)).size, count);
    for (let index = 0; index < count; index++) {
      const number = String(index).padStart(5, '0');
      const bookmark = imported.bookmarks[index];
      assert.equal(bookmark.title, `资源工具 Resource ${number}`);
      assert.equal(bookmark.url, `https://capacity.invalid/resource/${number}?source=synthetic`);
    }
    assert.ok(imported.bookmarks.every(bookmark => !bookmark.pinnedToDesktop));
    sample.checks.htmlPreviewAndCommit = true;
    await page.locator('[data-library-bookmark]').first().getByTitle('编辑收藏', { exact: true }).click();
    const edit = page.getByRole('dialog', { name: '编辑收藏', exact: true });
    await edit.getByPlaceholder('例如：图片、壁纸；按 Enter 或逗号添加').fill('容量关键词');
    await edit.getByPlaceholder('例如：图片、壁纸；按 Enter 或逗号添加').press('Enter');
    await edit.getByRole('button', { name: '保存更改', exact: true }).click();
    await edit.waitFor({ state: 'hidden' });
    imported = await readLibrary(page);
    assert.deepEqual(imported.bookmarks[0].keywords, ['容量关键词']);
    sample.libraryRows = await page.locator('[data-library-bookmark]').count();
    assert.ok(sample.libraryRows > 0 && sample.libraryRows <= 100, 'Management stays paginated');
    const search = page.getByPlaceholder('按名称、网址或关键词搜索...');
    const target = `Resource ${String(count - 1).padStart(5, '0')}`;
    for (let iteration = 0; iteration < 3; iteration++) {
      await timed(sample, 'librarySearch', page, async () => {
        await search.fill(target);
        await page.waitForFunction(title => {
          const rows = document.querySelectorAll('[data-library-bookmark]');
          return rows.length === 1 && rows[0].textContent.includes(title);
        }, target);
      });
      await search.fill('');
      await page.waitForFunction(() => document.querySelectorAll('[data-library-bookmark]').length > 1);
    }
    await timed(sample, 'reloadDesktop', page, async () => {
      await page.reload();
      await page.getByRole('banner').getByRole('button', { name: '管理中心', exact: true }).waitFor();
    });
    assert.deepEqual(canonical(await readLibrary(page)), canonical(imported));
    const spotlight = page.getByRole('dialog', { name: '全局搜索', exact: true });
    for (let iteration = 0; iteration < 3; iteration++) {
      await page.getByRole('button', { name: /^(打开搜索|Open search)$/ }).click();
      await timed(sample, 'spotlightSearch', page, async () => {
        await spotlight.getByRole('combobox').fill(target);
        await spotlight.locator('[role="option"][id^="spotlight-result-bm-"]').filter({ hasText: target }).waitFor();
      });
      await page.keyboard.press('Escape');
      await spotlight.waitFor({ state: 'hidden' });
    }
    const trigger = page.getByTitle('启动台 · 所有应用与收藏 (桌面上滑亦可展开)');
    const launchpad = page.getByRole('dialog', { name: '启动台', exact: true });
    const launchSearch = launchpad.getByRole('searchbox', { name: '搜索收藏', exact: true });
    for (let iteration = 0; iteration < 3; iteration++) {
      await timed(sample, 'launchpadOpen', page, async () => {
        await trigger.click();
        await page.waitForFunction(expected => document.querySelectorAll('[data-launchpad-bookmark]').length === expected, count);
        await launchSearch.focus();
      });
      await timed(sample, 'launchpadSearch', page, async () => {
        await launchSearch.fill(target);
        await page.waitForFunction(title => {
          const items = document.querySelectorAll('[data-launchpad-bookmark]');
          return items.length === 1 && items[0].textContent.includes(title);
        }, target);
      });
      if (iteration === 0) {
        await timed(sample, 'launchpadBroadSearch', page, async () => {
          await launchSearch.fill('Resource 0');
          await page.waitForFunction(expected => document.querySelectorAll('[data-launchpad-bookmark]').length === expected, count);
        });
        await timed(sample, 'launchpadSequentialTyping', page, async () => {
          await launchSearch.pressSequentially(String(count - 1).padStart(5, '0').slice(1));
          await page.waitForFunction(title => {
            const items = document.querySelectorAll('[data-launchpad-bookmark]');
            return items.length === 1 && items[0].textContent.includes(title);
          }, target);
        });
      }
      await page.keyboard.press('Escape');
      await launchpad.waitFor({ state: 'hidden' });
    }
    sample.checks.launchpadContainsAllBookmarks = true;
    sample.longTasks.desktopAndLaunchpad = await page.evaluate(() => window.capacityLongTasks);
    await transfer(page);
    await page.getByRole('group', { name: '导出格式', exact: true }).getByRole('radio', { name: '记个球收藏 · JSON', exact: true }).check();
    const json = page.getByRole('region', { name: '导出收藏', exact: true });
    let backup;
    await timed(sample, 'jsonExport', page, async () => {
      const pending = page.waitForEvent('download');
      await json.getByRole('button', { name: '导出收藏', exact: true }).click();
      backup = await readFile(await (await pending).path(), 'utf8');
    });
    const exported = JSON.parse(backup);
    assert.equal(exported.library.bookmarks.length, count);
    sample.jsonBytes = Buffer.byteLength(backup);
    const raw = await libraryRaw(page);
    sample.storedLibrary = { codeUnits: raw.length, utf8Bytes: Buffer.byteLength(raw) };
    const restoredDevice = await device();
    const restored = restoredDevice.page;
    await restored.getByRole('banner').getByRole('button', { name: '切换为英文', exact: true }).click();
    await restored.getByRole('banner').getByRole('button', { name: 'Switch to Chinese', exact: true }).click();
    await transfer(restored);
    await restored.getByRole('group', { name: '导入格式', exact: true }).getByRole('radio', { name: '记个球收藏 · JSON', exact: true }).check();
    const targetTransfer = restored.getByRole('region', { name: '收藏资产 JSON', exact: true });
    const settingsBefore = await restored.evaluate(() => localStorage.getItem('jipage_settings_v1'));
    await timed(sample, 'jsonPreview', restored, async () => {
      await targetTransfer.getByLabel('JSON 资产文件', { exact: true }).setInputFiles({
        name: 'synthetic-backup.json', mimeType: 'application/json', buffer: Buffer.from(backup),
      });
      await targetTransfer.getByRole('status', { name: '导入预览', exact: true }).waitFor();
    });
    assert.equal(await libraryRaw(restored), null, 'JSON preview remains read-only');
    await timed(sample, 'jsonCommitAndLibrary', restored, async () => {
      await targetTransfer.getByRole('button', { name: '确认导入收藏', exact: true }).click();
      await restored.getByRole('button', { name: '查看收藏', exact: true }).click();
      await restored.getByRole('heading', { name: '全部收藏', exact: true }).waitFor();
    });
    assert.deepEqual(canonical(await readLibrary(restored)), canonical(imported));
    assert.equal(await restored.evaluate(() => localStorage.getItem('jipage_settings_v1')), settingsBefore);
    sample.checks.jsonRoundTripAndSettingsUntouched = true;
    await restored.setViewportSize({ width: 390, height: 844 });
    await restored.getByRole('banner').getByRole('button', { name: '桌面', exact: true }).click();
    await timed(sample, 'launchpadOpen390', restored, async () => {
      await restored.getByTitle('启动台 · 所有应用与收藏 (桌面上滑亦可展开)').click();
      await restored.waitForFunction(expected => document.querySelectorAll('[data-launchpad-bookmark]').length === expected, count);
    });
    assert.equal(await restored.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await restored.screenshot({ path: `${output}/launchpad-${count}-390.png` });
    await restored.keyboard.press('Escape');

    // Fill the actual browser quota, not a mocked setItem failure.
    await page.getByRole('banner').getByRole('button', { name: '桌面', exact: true }).click();
    sample.quota = await page.evaluate(() => {
      const key = 'capacity-synthetic-filler';
      let low = 0, high = 8 * 1024 * 1024;
      let observedQuota = false;
      while (high - low > 64) {
        const middle = Math.floor((low + high) / 2);
        try { localStorage.setItem(key, 'x'.repeat(middle)); low = middle; }
        catch (error) {
          if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error;
          observedQuota = true; high = middle;
        }
      }
      if (!observedQuota) throw new Error('Expected real quota boundary within 8M code units');
      return {
        fillerCodeUnits: low, remainingBracketCodeUnits: high - low,
        storedCodeUnits: Object.entries(localStorage).reduce((sum, [key, value]) => sum + key.length + value.length, 0),
        observedQuota,
      };
    });
    const beforeFailure = await libraryRaw(page);
    await page.keyboard.press('Control+Shift+Enter');
    const add = page.getByRole('dialog', { name: '添加收藏', exact: true });
    const draftUrl = `https://capacity.invalid/draft/${'x'.repeat(1500)}`;
    await add.getByLabel('网址 URL', { exact: true }).fill(draftUrl);
    await add.getByLabel('网站名称', { exact: true }).fill('Capacity unsaved draft');
    await add.getByRole('button', { name: '添加收藏', exact: true }).click();
    await add.getByRole('alert').filter({ hasText: '存储空间不足' }).waitFor();
    assert.equal(await libraryRaw(page), beforeFailure, 'Real quota failure preserves the entire library byte-for-byte');
    assert.equal(await add.getByLabel('网址 URL', { exact: true }).inputValue(), draftUrl);
    assert.equal(await add.getByLabel('网站名称', { exact: true }).inputValue(), 'Capacity unsaved draft');
    await page.evaluate(() => localStorage.removeItem('capacity-synthetic-filler'));
    await add.getByRole('button', { name: '添加收藏', exact: true }).click();
    await add.waitFor({ state: 'hidden' });
    const retried = await readLibrary(page);
    assert.equal(retried.bookmarks.length, count + 1);
    assert.equal(retried.bookmarks.filter(bookmark => bookmark.url === draftUrl).length, 1);
    assert.deepEqual(canonical({ ...retried, bookmarks: retried.bookmarks.filter(bookmark => bookmark.url !== draftUrl) }), canonical(imported));
    await page.reload();
    assert.equal((await readLibrary(page)).bookmarks.length, count + 1);
    sample.checks.actualQuotaPreservesLibraryDraftAndRetry = true;
    sample.longTasks.restoredProfile = await restored.evaluate(() => window.capacityLongTasks);
    sample.longTasks.afterQuotaRetryReload = await page.evaluate(() => window.capacityLongTasks);
    assert.deepEqual(errors, []);
    assert.deepEqual(restoredDevice.errors, []);
    await restoredDevice.context.close();
    await context.close();
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  }
  console.log(`PASS production capacity, search, launchpad, JSON round trip and real quota safety; report: ${output}/report.json`);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser?.close();
  server.closeAllConnections();
  if (server.listening) await new Promise(resolveClose => server.close(resolveClose));
}

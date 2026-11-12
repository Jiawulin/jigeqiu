import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'zh-CN' });
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const pngs = await page.evaluate(() => Object.fromEntries([16, 32, 180, 256].map(size => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = size >= 180 ? '#07866c' : '#2371c5'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#fff'; ctx.fillRect(size / 4, size / 4, size / 2, size / 2);
    return [size, c.toDataURL('image/png').split(',')[1]];
  })));
  const requests = [];
  const cdp = await context.newCDPSession(page);
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*', requestStage: 'Request' }] });
  cdp.on('Fetch.requestPaused', async event => {
    const url = new URL(event.request.url);
    requests.push(url.href);
    const root = url.pathname === '/';
    if (root && url.hostname === 'slow.example.test') await new Promise(resolve => setTimeout(resolve, 1500));
    let body, mime = 'image/png';
    if (root && url.hostname === 'svg.example.test') {
      mime = 'text/html';
      body = Buffer.from('<link rel="icon" type="image/svg+xml" href="/brand/tianmu-viewer.svg">').toString('base64');
    } else if (url.pathname === '/brand/tianmu-viewer.svg') {
      mime = 'image/svg+xml';
      body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><path fill="#07866c" d="M0 0h512v512H0z"/></svg>').toString('base64');
    } else if (url.hostname === 'svg.example.test') {
      body = undefined;
    } else if (root && url.hostname === 'icons.example.test') {
      mime = 'text/html';
      body = Buffer.from(`<script>window.iconInjected=true</script>
        <link rel="icon" href="/static/img/logo.png">
        <link rel="manifest" href="/manifest.json">
        <img src="/track.png"><iframe src="https://evil.test/iframe"></iframe>`).toString('base64');
    } else if (url.pathname === '/manifest.json') {
      mime = 'application/manifest+json';
      body = Buffer.from(JSON.stringify({ icons: [{ src: '/app-256.png', sizes: '16x16' }] })).toString('base64');
    } else if (url.pathname === '/static/img/logo.png') body = pngs[180];
    else if (url.pathname === '/app-256.png' || url.pathname === '/manual.png') body = pngs[256];
    else if (url.pathname === '/large.png') body = Buffer.concat([Buffer.from(pngs[256], 'base64'), Buffer.alloc(513 * 1024)]).toString('base64');
    else if (url.pathname === '/apple-touch-icon.png') body = pngs[180];
    else if (url.pathname === '/favicon.ico') body = pngs[16];
    else if (url.pathname === '/favicon-32x32.png') body = pngs[32];
    try {
      await cdp.send('Fetch.fulfillRequest', {
        requestId: event.requestId, responseCode: body ? 200 : 404,
        body: body ?? Buffer.from('missing').toString('base64'),
        responseHeaders: [
          { name: 'Content-Type', value: body ? mime : 'text/plain' },
          ...(url.hostname === 'blocked.example.test' && root ? [] : [{ name: 'Access-Control-Allow-Origin', value: '*' }]),
        ],
      });
    } catch (error) {
      if (!/Invalid InterceptionId|Target page, context or browser has been closed/.test(String(error))) errors.push(String(error));
    }
  });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(origin);
  await page.evaluate(() => {
    localStorage.setItem('jipage_bookmarks_v1', '[]'); localStorage.setItem('jipage_folders_v1', '[]');
  });
  await page.reload();
  const dialog = page.getByRole('dialog');
  const picker = dialog.getByRole('group', { name: '网站图标', exact: true });
  const library = () => page.evaluate(() => JSON.parse(localStorage.getItem('jipage_library_v2')).bookmarks);
  await page.getByTitle('添加收藏', { exact: true }).first().click();
  await dialog.getByLabel('网址 URL', { exact: true }).fill('https://icons.example.test/private?token=secret');
  await dialog.getByLabel('网站名称', { exact: true }).fill('中文工具');
  await picker.getByRole('button', { name: /网站图标/ }).click();
  await picker.getByRole('button', { name: '选择应用图标 256×256', exact: true }).waitFor();
  await picker.getByRole('status').filter({ hasText: /^找到/ }).waitFor();
  assert.equal(await page.evaluate(() => window.iconInjected), undefined);
  assert.deepEqual(requests.filter(url => /track\.png|evil\.test|token=secret|google\.com\/s2\//.test(url)), [],
    'No execution, unrelated resources, private paths or unconsented provider');
  const online = picker.getByRole('tabpanel', { name: '在线候选', exact: true });
  assert.equal(await online.getByRole('button').first().getAttribute('aria-label'), '选择网站图标 180×180');
  // Explicitly choose a nonrecommended declared image and preserve that decision.
  await online.getByRole('button', { name: '选择网站图标 180×180', exact: true }).filter({ has: page.locator('img[src$="/static/img/logo.png"]') }).click();
  await mkdir('test-results/screenshots', { recursive: true });
  await picker.screenshot({ path: 'test-results/screenshots/icon-picker-preview.png' });
  await page.screenshot({ path: 'test-results/screenshots/icon-picker-desktop.png', fullPage: true });
  await page.evaluate(() => {
    document.documentElement.classList.add('dark', 'dark-glass');
  });
  await page.screenshot({ path: 'test-results/screenshots/icon-picker-dark.png', fullPage: true });
  await page.evaluate(() => document.documentElement.classList.remove('dark', 'dark-glass'));
  await page.setViewportSize({ width: 390, height: 844 });
  await online.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const bounds = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
    return bounds && bounds.top >= 0 && bounds.bottom <= innerHeight;
  });
  const mobileBounds = await dialog.boundingBox();
  assert.ok(mobileBounds.y >= 0 && mobileBounds.y + mobileBounds.height <= 844,
    `Expanded picker dialog stays inside mobile viewport: ${JSON.stringify(mobileBounds)}`);
  const center = await picker.boundingBox();
  assert.equal(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[role="dialog"]')),
    { x: center.x + 10, y: Math.min(center.y + 10, 800) }), true);
  await page.screenshot({ path: 'test-results/screenshots/icon-picker-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 320, height: 844 });
  await online.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'test-results/screenshots/icon-picker-mobile-320.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await dialog.getByRole('button', { name: '添加收藏', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await library())[0].icon, 'https://icons.example.test/static/img/logo.png');
  assert.equal((await library())[0].iconMode, 'custom');
  await page.reload();
  await page.getByRole('banner').getByRole('button', { name: '管理中心', exact: true }).click();
  await page.getByTitle('编辑收藏').click();
  await picker.getByRole('button', { name: /网站图标/ }).click();
  await picker.getByRole('tab', { name: '图片链接', exact: true }).click();
  await picker.getByRole('textbox', { name: '图标图片链接' }).fill('data:image/png;base64,evil');
  assert.equal(await picker.getByRole('button', { name: '使用图片', exact: true }).isEnabled(), false);
  await picker.getByRole('textbox', { name: '图标图片链接' }).fill('https://icons.example.test/manual.png');
  await picker.getByRole('button', { name: '使用图片', exact: true }).click();
  await picker.getByRole('textbox', { name: '图标图片链接' }).fill('https://icons.example.test/large.png');
  await picker.getByRole('status').filter({ hasText: '图片无法使用' }).waitFor();
  assert.equal(await picker.getByRole('button', { name: '使用图片', exact: true }).isEnabled(), false);
  await dialog.getByRole('button', { name: '保存更改' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await library())[0].icon, 'https://icons.example.test/manual.png');
  await page.getByTitle('编辑收藏').click();
  await picker.getByRole('button', { name: /网站图标/ }).click();
  await picker.getByRole('button', { name: '文字图标', exact: true }).click();
  // Saving is independent of a malformed, unused URL draft.
  await picker.getByRole('tab', { name: '图片链接', exact: true }).click();
  await picker.getByRole('textbox', { name: '图标图片链接' }).fill('not a URL');
  await dialog.getByRole('button', { name: '保存更改' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await library())[0].iconMode, 'text');
  assert.equal((await library())[0].icon, undefined);
  await page.reload();
  await page.getByRole('main').getByText('中文工具', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-site-icon][aria-label="中文工具"] img').count(), 0);
  assert.ok(await page.locator('[data-site-icon][aria-label="中文工具"] [data-fallback-kind="han-pair"]').count());
  // Manager's own add form uses the same picker; CORS denial still yields direct image candidates.
  await page.getByRole('banner').getByRole('button', { name: '管理中心', exact: true }).click();
  await page.getByRole('button', { name: '添加收藏到此目录', exact: true }).click();
  await dialog.getByLabel('网址 URL', { exact: true }).fill('https://slow.example.test/');
  const slowDeadline = Date.now() + 5000;
  while (!requests.includes('https://slow.example.test/') && Date.now() < slowDeadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(requests.includes('https://slow.example.test/'));
  await picker.getByRole('button', { name: /网站图标/ }).click();
  await picker.getByRole('button', { name: '文字图标', exact: true }).click();
  await picker.getByRole('status').filter({ hasText: '已使用文字图标' }).waitFor();
  await dialog.getByLabel('网址 URL', { exact: true }).fill('https://blocked.example.test/');
  await dialog.getByLabel('网站名称', { exact: true }).fill('Blocked CORS');
  await picker.getByRole('button', { name: '选择网站图标 180×180', exact: true }).waitFor();
  await picker.getByRole('status').filter({ hasText: /^找到/ }).waitFor();
  assert.equal(await picker.locator('img[src*="slow.example.test"]').count(), 0, 'A replaced URL cannot publish old candidates');
  await dialog.getByRole('button', { name: '添加收藏', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await library())[1].iconMode, 'auto');
  assert.equal((await library())[1].icon, 'https://blocked.example.test/apple-touch-icon.png');
  // Saving immediately after URL replacement must not retain the prior site's image.
  await page.locator('[data-library-bookmark]').filter({ hasText: 'Blocked CORS' }).getByTitle('编辑收藏').click();
  await dialog.getByLabel('网址 URL').fill('https://new.example.test/');
  await dialog.getByRole('button', { name: '保存更改' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await library())[1].icon, undefined);
  await page.getByRole('button', { name: '添加收藏到此目录', exact: true }).click();
  await dialog.getByLabel('网址 URL', { exact: true }).fill('https://svg.example.test/private');
  await dialog.getByLabel('网站名称', { exact: true }).fill('SVG declared');
  await picker.getByRole('button', { name: /网站图标/ }).click();
  await picker.getByRole('tabpanel', { name: '在线候选', exact: true })
    .locator('img[src="https://svg.example.test/brand/tianmu-viewer.svg"]').waitFor();
  await picker.getByRole('status').filter({ hasText: /^找到/ }).waitFor();
  await dialog.getByRole('button', { name: '添加收藏', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const svgBookmark = (await library()).find(item => item.title === 'SVG declared');
  assert.equal(svgBookmark.icon, 'https://svg.example.test/brand/tianmu-viewer.svg');
  assert.equal(svgBookmark.iconMode, 'auto');
  await page.getByRole('banner').getByRole('button', { name: '桌面', exact: true }).click();
  await page.getByTitle('启动台 · 所有应用与收藏 (桌面上滑亦可展开)').click();
  const launchpad = page.getByRole('dialog', { name: '启动台', exact: true });
  const svgItem = launchpad.locator(`[data-launchpad-bookmark="${svgBookmark.id}"]`);
  const rootsBefore = requests.filter(url => url === 'https://svg.example.test/').length;
  await svgItem.click({ button: 'right' });
  await launchpad.getByRole('menuitem', { name: '刷新网站图标', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-icon-state="loading"]'));
  await svgItem.locator('img[src="https://svg.example.test/brand/tianmu-viewer.svg"]').waitFor();
  assert.ok(requests.filter(url => url === 'https://svg.example.test/').length > rootsBefore,
    'Launchpad refresh uses the same declared SVG discovery as the form');
  assert.equal(requests.some(url => /google\.com\/s2\/|svg\.example\.test\/private/.test(url)), false);
  assert.deepEqual(errors, []);
  console.log('PASS: declared/manifest and common-path frontend candidates, actual dimensions and ranking, inert HTML/privacy, manual choice/reload, custom URL validation, text mode, CORS fallback, add/edit integration and desktop/mobile screenshots');
} finally {
  await browser?.close();
  await server.close();
}

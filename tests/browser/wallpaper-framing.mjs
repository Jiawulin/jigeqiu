import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { once } from 'node:events';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const root = resolve('dist');
const output = process.env.SCREENSHOT_DIR ?? '/tmp/jigeqiu-wallpaper-framing';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
const server = createServer(async (request, response) => {
  try {
    const path = resolve(root, `.${new URL(request.url, 'http://localhost').pathname.replace(/^\/$/, '/index.html')}`);
    if (!path.startsWith(root + sep) || request.method !== 'GET') {
      response.writeHead(403).end(); return;
    }
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' })
      .end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
let browser;
try {
  await mkdir(output, { recursive: true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const appearance = async () => {
    await page.goto(`${origin}/#/settings/appearance`);
    await page.getByLabel('选择本地图片', { exact: true }).waitFor();
  };
  const ready = () => page.waitForFunction(() =>
    getComputedStyle(document.querySelector('[data-wallpaper-canvas]')).backgroundImage.includes('blob:'));
  const upload = async (width, height) => {
    const png = await page.evaluate(({ width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      for (const [start, color] of [[0, '#ee2222'], [1, '#22cc22'], [2, '#2222ee']]) {
        ctx.fillStyle = color;
        if (width > height) ctx.fillRect(start * width / 3, 0, width / 3, height);
        else ctx.fillRect(0, start * height / 3, width, height / 3);
      }
      return canvas.toDataURL('image/png').split(',')[1];
    }, { width, height });
    await page.getByLabel('选择本地图片', { exact: true }).setInputFiles({
      name: `${width}x${height}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
    });
    await page.getByRole('button', { name: `使用背景：${width}x${height}.png`, exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('input[type=file]')?.disabled);
    await ready();
    await page.waitForFunction(async ({ width, height }) => {
      const image = new Image();
      image.src = getComputedStyle(document.querySelector('[data-wallpaper-canvas]')).backgroundImage.match(/url\("(.+)"\)/)[1];
      await image.decode();
      return image.naturalWidth === width && image.naturalHeight === height;
    }, { width, height });
  };
  const filled = async (width, height) => {
    const canvas = page.locator('[data-wallpaper-canvas]');
    assert.equal(await canvas.evaluate(el => getComputedStyle(el).backgroundSize), 'cover');
    const bounds = await canvas.boundingBox();
    assert.equal(bounds.width, width);
    assert.equal(bounds.height, height);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (await page.locator('[data-panel="launchpad"]').count()) {
      assert.equal(await page.locator('[data-panel="launchpad"]').evaluate(el => getComputedStyle(el, '::before').backgroundSize), 'cover');
    }
  };
  await appearance();
  const assetsBefore = await page.evaluate(() => localStorage.getItem('jipage_library_v2'));
  await upload(3600, 1200);
  assert.equal(await page.getByRole('radio', { name: /完整显示|铺满屏幕/ }).count(), 0, 'Image fit is no longer user-selectable');
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('jipage_settings_v1'));
    localStorage.setItem('jipage_settings_v1', JSON.stringify({ ...saved, customWallpaperFit: 'contain' }));
  });
  const savedBefore = await page.evaluate(() => localStorage.getItem('jipage_settings_v1'));
  await page.goto(`${origin}/#/`);
  await ready();
  await filled(1440, 900);
  assert.equal(await page.evaluate(() => localStorage.getItem('jipage_settings_v1')), savedBefore, 'Reading legacy preferences does not rewrite them');
  for (const [width, height] of [[1440, 900], [820, 1180], [1180, 820], [390, 844], [320, 844]]) {
    await page.setViewportSize({ width, height });
    for (const mode of ['日间模式', '夜间模式']) {
      await appearance();
      await page.getByRole('button', { name: `选择外观：${mode}`, exact: true }).click();
      assert.equal(await page.locator('input[name="custom-wallpaper-fit"]').count(), 0);
      await page.goto(`${origin}/#/`);
      await ready();
      await filled(width, height);
      await page.screenshot({ path: `${output}/desktop-${width}-${mode === '日间模式' ? 'light' : 'dark'}.png` });
      await page.goto(`${origin}/#/start`);
      await page.locator('[data-panel="launchpad"]').waitFor();
      await ready();
      await filled(width, height);
      await page.screenshot({ path: `${output}/launchpad-${width}-${mode === '日间模式' ? 'light' : 'dark'}.png` });
    }
  }
  // Wide source fills a narrow screen using its center, not letterboxing.
  await page.goto(`${origin}/#/`);
  await ready();
  const screenshot = await page.screenshot();
  const edgePixels = await page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return [12, 308].map(x => Array.from(ctx.getImageData(x, 422, 1, 1).data));
  }, screenshot.toString('base64'));
  assert.ok(edgePixels.every(p => p[1] > p[0] * 2 && p[1] > p[2] * 2), 'The panorama fills screen edges with its green center');
  for (const [sourceWidth, sourceHeight] of [[1600, 900], [900, 1600]]) {
    await appearance();
    await upload(sourceWidth, sourceHeight);
    await page.reload();
    await ready();
    for (const [width, height] of [[1440, 900], [390, 844], [820, 1180], [1180, 820]]) {
      await page.setViewportSize({ width, height });
      await filled(width, height);
    }
  }
  await appearance();
  await page.getByRole('button', { name: '选择壁纸：雪山晨光', exact: true }).click();
  await filled(1180, 820);
  await page.getByRole('button', { name: '使用背景：900x1600.png', exact: true }).click();
  await ready();
  await page.getByRole('button', { name: '切换为英文', exact: true }).click();
  assert.equal(await page.getByRole('radiogroup', { name: 'Image fit', exact: true }).count(), 0);
  assert.equal(await page.getByRole('radio', { name: /Show full image|Fill screen/ }).count(), 0);
  await page.setViewportSize({ width: 320, height: 844 });
  await filled(320, 844);
  await page.screenshot({ path: `${output}/settings-320-en.png`, fullPage: true });
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('jipage_settings_v1'));
    localStorage.setItem('jipage_settings_v1', JSON.stringify({ ...saved, customWallpaperId: 'missing-image' }));
  });
  await page.reload();
  await page.getByLabel('Choose local image', { exact: true }).waitFor();
  await filled(320, 844);
  assert.equal(await page.locator('[data-custom-wallpaper]').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('jipage_library_v2')), assetsBefore);
  assert.deepEqual(errors, []);
  console.log('PASS dist-only: always-cover, no fit options, legacy contain ignored without writes, original dimensions, panorama pixels, desktop/launchpad, phone/tablet rotation, day/night, reload, saved reuse, English, missing-image fallback and assets untouched');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

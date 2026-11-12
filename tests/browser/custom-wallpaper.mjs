import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { once } from 'node:events';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const root = resolve('dist');
const output = '/tmp/jigeqiu-wallpaper-gallery';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/seed.html') { response.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>Test seed</title>'); return; }
    const path = resolve(root, `.${new URL(request.url, 'http://localhost').pathname.replace(/^\/$/, '/index.html')}`);
    if (!path.startsWith(root + sep) || request.method !== 'GET') { response.writeHead(403).end(); return; }
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }).end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
let browser;
try {
  await mkdir(output, { recursive: true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto(`${origin}/#/settings/appearance`);
  const input = page.getByLabel('选择本地图片', { exact: true });
  await input.waitFor();
  assert.equal(await page.getByRole('button', { name: /选择壁纸/ }).count(), 4);
  const before = await page.evaluate(() => localStorage.getItem('jipage_library_v2'));
  const keys = () => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('jigeqiu-wallpapers-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(['images', 'metadata'], 'readonly');
        const images = tx.objectStore('images').getAllKeys();
        const metadata = tx.objectStore('metadata').getAllKeys();
        tx.oncomplete = () => resolve({ images: images.result, metadata: metadata.result });
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
  const selectedId = () => page.evaluate(() => JSON.parse(localStorage.getItem('jipage_settings_v1')).customWallpaperId);
  const imageReady = () => page.waitForFunction(() => document.querySelector('[data-custom-wallpaper]'));
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 600;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#19a59c'; ctx.fillRect(0, 0, 400, 600);
    ctx.fillStyle = '#d94769'; ctx.fillRect(400, 0, 400, 600);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const upload = async name => {
    await input.setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.getByRole('button', { name: `使用背景：${name}`, exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('input[type=file]')?.disabled);
  };
  for (const preset of ['cyan-lake', 'arch-sky', 'coastal-dusk', 'botanic-sage']) {
    await page.evaluate(value => localStorage.setItem('jipage_settings_v1', JSON.stringify({
      ...JSON.parse(localStorage.getItem('jipage_settings_v1') ?? '{}'), wallpaperPreset: value,
    })), preset);
    await page.reload();
    await input.waitFor();
    assert.equal(await page.locator('.wallpaper-root').getAttribute('data-wallpaper'), 'snow-mountain');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_settings_v1')).wallpaperPreset), preset);
  }
  const ids = [];
  for (const name of ['one.png', 'two.png', 'three.png']) {
    await upload(name);
    await imageReady();
    ids.push(await selectedId());
  }
  assert.equal(new Set(ids).size, 3);
  assert.equal((await keys()).images.length, 3);
  assert.deepEqual((await keys()).images, (await keys()).metadata);
  assert.deepEqual(await page.locator('[data-custom-wallpaper-item] [data-wallpaper-name]').allTextContents(),
    ['three.png', 'two.png', 'one.png']);
  await page.reload();
  await imageReady();
  await page.getByRole('button', { name: '使用背景：one.png', exact: true }).click();
  await page.waitForFunction(id => JSON.parse(localStorage.getItem('jipage_settings_v1')).customWallpaperId === id, ids[0]);
  await page.getByRole('button', { name: '选择壁纸：雪山晨光', exact: true }).click();
  assert.equal((await keys()).images.length, 3);
  await page.getByRole('button', { name: '使用背景：one.png', exact: true }).click();
  await imageReady();
  const pixels = await page.evaluate(async () => {
    const image = new Image();
    image.src = getComputedStyle(document.querySelector('[data-wallpaper-canvas]')).backgroundImage.match(/url\("(.+)"\)/)[1];
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 600;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return [100, 700].map(x => Array.from(ctx.getImageData(x, 100, 1, 1).data));
  });
  assert.deepEqual(pixels, [[25, 165, 156, 255], [217, 71, 105, 255]]);
  await input.setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await page.getByRole('alert').waitFor();
  assert.equal(await selectedId(), ids[0]);
  assert.equal((await keys()).images.length, 3);
  // A failure after the image put must roll back both stores.
  await page.evaluate(() => {
    window.originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'metadata') {
        this.transaction.abort();
        throw new DOMException('Full', 'QuotaExceededError');
      }
      return window.originalPut.apply(this, args);
    };
  });
  await input.setInputFiles({ name: 'quota.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.getByText('图片未保存，请检查格式、大小或浏览器存储空间后重试。', { exact: true }).waitFor();
  assert.equal((await keys()).images.length, 3);
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; });
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'jipage_settings_v1') throw new DOMException('Full', 'QuotaExceededError');
      return window.originalSetItem.call(this, key, value);
    };
  });
  await upload('saved-not-applied.png');
  await page.getByText('图片已保存，但背景未切换，请重新选择。', { exact: true }).waitFor();
  assert.equal(await selectedId(), ids[0]);
  assert.equal((await keys()).images.length, 4);
  await page.getByRole('button', { name: '删除背景：one.png', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '删除背景', exact: true });
  await confirmation.getByRole('button', { name: '删除', exact: true }).click();
  await confirmation.getByRole('alert').waitFor();
  assert.equal((await keys()).images.length, 4, 'Failed fallback save must not delete current image');
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
  await page.getByRole('button', { name: '使用背景：saved-not-applied.png', exact: true }).click();
  await imageReady();
  await page.evaluate(() => {
    window.originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (...args) {
      if (this.name === 'metadata') { this.transaction.abort(); throw new Error('Delete denied'); }
      return window.originalDelete.apply(this, args);
    };
  });
  await page.getByRole('button', { name: '删除背景：two.png', exact: true }).click();
  await confirmation.getByRole('button', { name: '删除', exact: true }).click();
  await confirmation.getByRole('alert').waitFor();
  assert.equal((await keys()).images.length, 4);
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => { IDBObjectStore.prototype.delete = window.originalDelete; });
  const other = await context.newPage();
  await other.goto(`${origin}/#/settings/appearance`);
  await other.getByRole('button', { name: '使用背景：three.png', exact: true }).waitFor();
  await page.getByRole('button', { name: '删除背景：two.png', exact: true }).click();
  await confirmation.getByRole('button', { name: '删除', exact: true }).click();
  await confirmation.waitFor({ state: 'hidden' });
  await other.getByRole('button', { name: '使用背景：two.png', exact: true }).waitFor({ state: 'hidden' });
  await other.getByRole('button', { name: '使用背景：three.png', exact: true }).click();
  await page.waitForFunction(id => document.querySelector(`[data-custom-wallpaper-item="${id}"] button[aria-pressed="true"]`), ids[2]);
  await other.close();
  await page.getByRole('button', { name: '删除背景：three.png', exact: true }).click();
  await confirmation.getByText('删除后将恢复“雪山晨光”背景。', { exact: true }).waitFor();
  await confirmation.getByRole('button', { name: '取消', exact: true }).focus();
  await page.keyboard.press('Escape');
  await confirmation.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: '删除背景：three.png', exact: true }).evaluate(el => el === document.activeElement), true);
  await page.getByRole('button', { name: '删除背景：three.png', exact: true }).click();
  await confirmation.getByRole('button', { name: '删除', exact: true }).click();
  await confirmation.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.wallpaper-root').getAttribute('data-wallpaper'), 'snow-mountain');
  assert.equal((await keys()).images.length, 2);
  assert.deepEqual((await keys()).images, (await keys()).metadata);
  const lockPage = await context.newPage();
  await lockPage.goto(`${origin}/seed.html`);
  await lockPage.evaluate(() => new Promise(resolve => {
    void navigator.locks.request('jigeqiu-wallpapers-mutation', async () => {
      await new Promise(release => { window.releaseWallpaperLock = release; resolve(); });
    });
  }));
  await input.setInputFiles({ name: 'cancelled.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => document.querySelector('input[type=file]')?.disabled);
  await page.goto(`${origin}/#/`);
  await page.locator('input[type=file]').waitFor({ state: 'detached' });
  await lockPage.evaluate(() => window.releaseWallpaperLock());
  await lockPage.close();
  assert.equal((await keys()).images.length, 2, 'Leaving the view cancels a queued upload');
  await page.goto(`${origin}/#/settings/appearance`);
  await page.reload();
  await input.waitFor();
  for (const [preset, label] of [['misty-mountains', '云岚群山'], ['corner-tower', '角楼月色'], ['green-lake', '青山映湖']]) {
    await page.getByRole('button', { name: `选择壁纸：${label}`, exact: true }).click();
    await page.waitForFunction(preset => document.querySelector('.wallpaper-root')?.dataset.wallpaper === preset, preset);
    await page.goto(`${origin}/#/`);
    await page.locator('[data-wallpaper-canvas]').evaluate(async el => {
      const image = new Image();
      image.src = getComputedStyle(el).backgroundImage.match(/url\("(.+)"\)/)[1];
      await image.decode();
      if (image.naturalWidth !== 3840) throw new Error('Wrong desktop asset');
    });
    await page.screenshot({ path: `${output}/${preset}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-wallpaper-canvas]').evaluate(async el => {
      const image = new Image();
      image.src = getComputedStyle(el).backgroundImage.match(/url\("(.+)"\)/)[1];
      await image.decode();
      if (image.naturalWidth !== 1200 || Math.abs(image.naturalHeight - 1800) > 1) throw new Error('Wrong portrait asset');
    });
    await page.screenshot({ path: `${output}/${preset}-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/#/settings/appearance`);
    await input.waitFor();
  }
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('jipage_settings_v1'));
    localStorage.setItem('jipage_settings_v1', JSON.stringify({ ...settings, showDock: false }));
  });
  await page.reload();
  await input.waitFor();
  for (const mode of ['日间模式', '夜间模式']) {
    await page.getByRole('button', { name: `选择外观：${mode}`, exact: true }).click();
    for (const locale of ['en', 'zh']) {
      await page.getByRole('button', { name: locale === 'en' ? '切换为英文' : 'Switch to Chinese', exact: true }).click();
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `${output}/gallery-${width}-${mode === '日间模式' ? 'light' : 'dark'}-${locale}.png`, fullPage: true });
      }
    }
  }
  assert.ok(!requests.some(url => url.includes('cyan-lake')));
  assert.equal(await page.evaluate(() => localStorage.getItem('jipage_library_v2')), before);
  await context.close();
  // A real v1 database exercises legacy Blob compatibility and upgrade.
  const legacy = await browser.newContext({ locale: 'zh-CN' });
  await legacy.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const legacyPage = await legacy.newPage();
  await legacyPage.goto(`${origin}/seed.html`);
  await legacyPage.evaluate(async png => {
    const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('jigeqiu-wallpapers-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('images', 'readwrite');
    tx.objectStore('images').put(blob, 'old-blob');
    tx.objectStore('images').put(new File([blob], 'legacy.png', { type: 'image/png' }), 'old-file');
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    db.close();
    localStorage.setItem('jipage_settings_v1', JSON.stringify({ wallpaperPreset: 'custom', customWallpaperId: 'old-blob' }));
  }, png);
  await legacyPage.goto(`${origin}/#/settings/appearance`);
  await legacyPage.getByRole('button', { name: '使用背景：原有背景', exact: true }).waitFor();
  await legacyPage.getByRole('button', { name: '使用背景：legacy.png', exact: true }).waitFor();
  await legacyPage.waitForFunction(() => document.querySelector('[data-custom-wallpaper]'));
  await legacyPage.reload();
  await legacyPage.getByRole('button', { name: '使用背景：原有背景', exact: true }).waitFor();
  await legacyPage.evaluate(() => {
    window.originalOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function () { throw new DOMException('Denied', 'SecurityError'); };
    window.dispatchEvent(new Event('focus'));
  });
  await legacyPage.getByText('背景列表读取失败，请重试。', { exact: true }).waitFor();
  await legacyPage.evaluate(() => { IDBFactory.prototype.open = window.originalOpen; });
  await legacyPage.getByRole('button', { name: '重试', exact: true }).click();
  await legacyPage.getByRole('button', { name: '使用背景：legacy.png', exact: true }).waitFor();
  await legacy.close();
  const blocked = await browser.newContext({ locale: 'zh-CN' });
  const blockedPage = await blocked.newPage();
  await blockedPage.goto(`${origin}/seed.html`);
  await blockedPage.evaluate(async () => {
    window.heldWallpaperDb = await new Promise(resolve => {
      const request = indexedDB.open('jigeqiu-wallpapers-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images');
      request.onsuccess = () => resolve(request.result);
    });
  });
  const upgradePage = await blocked.newPage();
  await upgradePage.goto(`${origin}/#/settings/appearance`);
  await upgradePage.getByText('背景列表读取失败，请重试。', { exact: true }).waitFor();
  await blockedPage.evaluate(() => window.heldWallpaperDb.close());
  await upgradePage.getByRole('button', { name: '重试', exact: true }).click();
  await upgradePage.getByText('暂无自定义背景', { exact: true }).waitFor();
  await blocked.close();
  assert.deepEqual(errors, []);
  console.log('PASS dist-only: gallery upload/select/reload, pixels, atomic quota/delete rollback, saved-not-applied, active fallback, cross-tab, legacy v1, blocked upgrade, retry, four presets, narrow screens/themes/locales, assets untouched');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

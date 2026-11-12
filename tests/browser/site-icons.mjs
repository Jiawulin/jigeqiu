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
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 2, locale: 'zh-CN' });
  await context.addInitScript(() => localStorage.setItem('jigeqiu.site-icons.third-party.v1', 'true'));
  context.setDefaultTimeout(12000);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const images = await page.evaluate(() => {
    const make = (kind) => {
      const canvas = document.createElement('canvas');
      canvas.width = kind === 'logo' ? 192 : 128;
      canvas.height = kind === 'logo' ? 64 : 128;
      const ctx = canvas.getContext('2d');
      if (kind === 'circle') {
        ctx.fillStyle = '#0f946a'; ctx.beginPath(); ctx.arc(64, 64, 64, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillRect(48, 28, 32, 72);
      } else if (kind === 'logo') {
        ctx.fillStyle = '#bd244a'; ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = '#34383e'; ctx.font = 'bold 32px sans-serif'; ctx.fillText('LOGO', 70, 44);
      } else {
        ctx.fillStyle = kind === 'custom' ? '#e6b73f' : '#2371c5'; ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = '#fff'; ctx.fillRect(26, 26, 76, 76);
      }
      return canvas.toDataURL('image/png').split(',')[1];
    };
    return Object.fromEntries(['square', 'circle', 'logo', 'custom'].map(kind => [kind, make(kind)]));
  });
  const counts = new Map();
  let remoteUnavailable = false;
  let failSquare = false;
  // Playwright's route interceptor auto-aborts /favicon.ico before user handlers.
  // CDP intercepts the actual requests without changing production URL selection.
  const network = await context.newCDPSession(page);
  await network.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*', requestStage: 'Request' }] });
  network.on('Fetch.requestPaused', async event => {
    try {
      const url = new URL(event.request.url);
      counts.set(url.href, (counts.get(url.href) ?? 0) + 1);
      const kind = url.hostname.split('.')[0] === 'cdn' ? 'custom' : url.hostname.split('.')[0];
      if (remoteUnavailable || (failSquare && kind === 'square')) {
        await network.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' });
        return;
      }
      const vector = kind === 'vector';
      const opaque = kind === 'opaque';
      const body = vector
        ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><path d="M0 0h100v60H0z" fill="#b22e4b"/></svg>').toString('base64')
        : opaque || kind === 'deferred' ? images.square : images[kind];
      await network.send('Fetch.fulfillRequest', {
        requestId: event.requestId, responseCode: body ? 200 : 404,
        body: body ?? Buffer.from('Not an image').toString('base64'),
        responseHeaders: [
          { name: 'Content-Type', value: vector ? 'image/svg+xml' : body ? 'image/png' : 'text/plain' },
          ...(opaque ? [] : [{ name: 'Access-Control-Allow-Origin', value: '*' }]),
          { name: 'Cache-Control', value: 'public, max-age=604800' },
        ],
      });
    } catch (error) {
      // Policy changes or navigation may cancel a request before its fixture response arrives.
      if (!/Invalid InterceptionId|Target page, context or browser has been closed/.test(String(error))) {
        errors.push(String(error));
      }
    }
  });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const fixture = `${base}/tests/browser/site-icons.html`;
  const settled = async () => {
    await page.locator('[data-site-icon]').first().waitFor();
    if (await page.locator('[data-sample="square"]').count()) {
      await page.locator('[data-sample="square"] [data-icon-state="ready"]').waitFor();
    }
    await page.waitForFunction(() => !document.querySelector('[data-icon-state="loading"]'));
    await page.waitForFunction(() => [...document.querySelectorAll('[data-site-icon] img')].every(img => img.complete && img.naturalWidth > 0));
  };
  await page.goto(fixture);
  await settled();
  assert.equal(counts.has('https://deferred.icons.test/favicon.ico'), false,
    'An offscreen icon must not fetch before it approaches its scroll viewport');
  const offscreen = page.getByRole('region', { name: 'Offscreen icon', exact: true });
  await offscreen.scrollIntoViewIfNeeded();
  await offscreen.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await offscreen.locator('[data-icon-state="ready"]').waitFor();
  assert.equal(counts.get('https://deferred.icons.test/favicon.ico'), 1, 'Scrolling a deferred icon into view loads it');
  await page.evaluate(() => scrollTo(0, 0));
  for (const id of ['square', 'circle', 'logo', 'custom']) {
    const root = page.locator(`[data-sample="${id}"] [data-site-icon]`);
    assert.equal(await root.getAttribute('data-icon-state'), 'ready', `${id} uses actual image`);
    const styles = await root.evaluate(element => {
      const s = getComputedStyle(element);
      const img = element.querySelector('img');
      const i = getComputedStyle(img);
      return { background: s.backgroundColor, radius: s.borderRadius, overflow: s.overflow, fit: i.objectFit, imageRadius: i.borderRadius, width: element.clientWidth, height: element.clientHeight };
    });
    assert.deepEqual(styles, { background: 'rgba(0, 0, 0, 0)', radius: '0px', overflow: 'visible', fit: 'contain', imageRadius: '0px', width: 64, height: 64 });
  }
  const wide = await page.locator('[data-sample="logo"] img').evaluate(img => [img.naturalWidth, img.naturalHeight]);
  assert.deepEqual(wide, [192, 64], 'A wide logo is retained, not cropped or rasterized square');
  const cornerPixel = async locator => {
    const bytes = await locator.screenshot();
    return page.evaluate(async encoded => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return [...context.getImageData(2, 2, 1, 1).data];
    }, bytes.toString('base64'));
  };
  assert.deepEqual(await cornerPixel(page.locator('[data-sample="square"] [data-site-icon]')), [35, 113, 197, 255],
    'Square artwork retains its actual corners');
  assert.deepEqual(await cornerPixel(page.locator('[data-sample="circle"] [data-site-icon]')), [255, 255, 255, 255],
    'Transparent circle corners reveal the white page, not a generated colored plate');
  for (const [size, px] of [['xs', 16], ['sm', 24], ['md', 40], ['lg', 64], ['xl', 80]]) {
    const icon = page.locator(`[data-fallback-row="中文工具"] [data-size="${size}"] [data-site-icon]`);
    assert.equal(await icon.locator('[data-fallback-kind="han-pair"]').count(), 1);
    assert.equal(await icon.locator('text[data-half="right"]').textContent(), '中');
    assert.equal(await icon.locator('text[data-half="left"]').textContent(), '文');
    const halfRects = await icon.locator('clipPath rect').evaluateAll(elements => elements.map(e => [e.getAttribute('x'), e.getAttribute('width')]));
    assert.deepEqual(halfRects, [['0', '32'], ['32', '32']]);
    const geometry = await icon.locator('svg').evaluate(svg => {
      const fontSize = parseFloat(getComputedStyle(svg).fontSize);
      const centers = [...svg.querySelectorAll('text')].map(text => Number(text.getAttribute('x')));
      return { fontSize, centers };
    });
    assert.equal(geometry.fontSize, 52, 'Two-Han glyphs leave more breathing room inside the circle');
    assert.deepEqual(geometry.centers, [5.2, 58.8]);
    assert.ok(Math.abs((geometry.centers[0] + geometry.fontSize / 2) / geometry.fontSize - 0.6) < 0.001);
    assert.ok(Math.abs((64 - geometry.centers[1] + geometry.fontSize / 2) / geometry.fontSize - 0.6) < 0.001);
    assert.equal(Math.round((await icon.boundingBox()).width), px);
    assert.equal(Math.round((await icon.boundingBox()).height), px);
  }
  assert.equal(counts.get('https://square.icons.test/favicon.ico'), 1);
  assert.equal(counts.get('https://cdn.icons.test/custom.png'), 1);
  assert.equal(counts.has('https://custom.icons.test/favicon.ico'), false, 'Explicit icon wins');
  assert.equal([...counts.keys()].some(url => url.includes('google.com') || url.includes('secret')), false, 'No default third-party lookup or page-path leakage');
  const beforeRemount = [...counts];
  await page.getByRole('button', { name: 'Unmount icons', exact: true }).click();
  await page.getByRole('button', { name: 'Mount icons', exact: true }).click();
  await settled();
  assert.deepEqual([...counts], beforeRemount, 'Remount uses shared successful and failed records');
  await page.reload();
  await settled();
  assert.deepEqual([...counts], beforeRemount, 'Reload restores blobs and failure records without remote re-probing');
  remoteUnavailable = true;
  await page.reload();
  await settled();
  assert.equal(await page.locator('[data-sample="square"] [data-icon-state="ready"]').count(), 1, 'Readable persisted icon works with remote network unavailable');
  assert.deepEqual([...counts], beforeRemount);
  remoteUnavailable = false;
  failSquare = true;
  await page.getByRole('button', { name: 'Refresh square', exact: true }).click();
  await page.getByText('Refresh failed; previous icon kept', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-sample="square"] [data-icon-state="ready"]').count(), 1);
  failSquare = false;
  await page.getByRole('button', { name: 'Refresh square', exact: true }).click();
  await page.getByText('Refreshed', { exact: true }).waitFor();

  const assets = { bookmarks: [{ title: 'Keep', url: 'https://keep.example/' }], folders: [] };
  await page.evaluate(value => localStorage.setItem('icon-test-assets', JSON.stringify(value)), assets);
  assert.equal(await page.getByRole('switch', { name: '允许 Google 图标服务', exact: true }).count(), 0);
  await page.getByRole('button', { name: '清除图标缓存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '图标缓存已清除' }).waitFor();
  await settled();
  assert.deepEqual([...counts].filter(([url]) => url.includes('google.com')), [], 'Legacy opt-in cannot enable provider requests');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('icon-test-assets'))), assets);

  await mkdir(screenshots, { recursive: true });
  const fallbackAppearance = () => page.locator('[data-fallback-row] [data-size="lg"] .site-icon-fallback').evaluateAll(elements =>
    elements.map(element => {
      const style = getComputedStyle(element);
      const luminance = color => {
        const channels = color.match(/\d+/g).slice(0, 3).map(Number).map(value => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const bg = luminance(style.backgroundColor);
      const fg = luminance(style.color);
      return {
        tone: element.getAttribute('data-fallback-tone'), bg: style.backgroundColor, fg: style.color,
        brightness: bg, contrast: (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05),
        radius: style.borderRadius, overflow: style.overflow,
      };
    }));
  const lightFallbacks = await fallbackAppearance();
  assert.equal(new Set(lightFallbacks.map(icon => icon.tone)).size, 6, 'All color palettes are exercised');
  for (const icon of lightFallbacks) {
    assert.equal(icon.radius, '50%');
    assert.equal(icon.overflow, 'hidden');
    assert.ok(icon.contrast >= 4.5, `Light palette ${icon.tone} has legible foreground/background contrast`);
  }
  assert.deepEqual(await cornerPixel(page.locator('[data-fallback-row="中文工具"] [data-size="lg"] [data-site-icon]')),
    [255, 255, 255, 255], 'Circular fallback clips artwork at the corners');
  await page.getByRole('region', { name: 'Artwork', exact: true }).screenshot({ path: `${screenshots}/site-icons-preview.png` });
  await page.screenshot({ path: `${screenshots}/site-icons-light.png`, fullPage: true });
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  assert.equal(await page.locator('h1').evaluate(element => getComputedStyle(element).color), 'rgb(255, 255, 255)',
    'Dark-mode fixture uses the same dark-glass theme class as the application');
  const darkFallbacks = await fallbackAppearance();
  for (const [index, icon] of darkFallbacks.entries()) {
    assert.equal(icon.tone, lightFallbacks[index].tone);
    assert.notEqual(icon.fg, lightFallbacks[index].fg);
    assert.ok(icon.brightness < lightFallbacks[index].brightness, 'Night mode lowers background luminance');
    assert.ok(icon.contrast >= 4.5, `Dark palette ${icon.tone} has legible foreground/background contrast`);
  }
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  assert.deepEqual(await fallbackAppearance(), lightFallbacks, 'Switching back restores the exact day palette');
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await page.screenshot({ path: `${screenshots}/site-icons-dark.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${screenshots}/site-icons-mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  // Integrate with the actual app: desktop, Dock, Launchpad, manager, settings.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.clear();
    const names = ['Square', '中文工具', 'Circle', 'Wide logo'];
    const domains = ['square', 'missing', 'circle', 'logo'];
    localStorage.setItem('jipage_bookmarks_v1', JSON.stringify(names.map((title, i) => ({
      id: `icon-${i}`, title, url: `https://${domains[i]}.icons.test/`, domain: `${domains[i]}.icons.test`,
      category: 'cat-inbox', keywords: [], pinnedToDesktop: true, iconBg: '#ff00ff',
      order: i, collectionIds: [], createdAt: 1, updatedAt: 2,
    }))));
    localStorage.setItem('jipage_folders_v1', '[]');
    localStorage.setItem('jipage_settings_v1', JSON.stringify({
      appearanceMode: 'light-glass', wallpaperPreset: 'cyan-lake', desktopViewMode: 'icon',
      language: 'zh', showDock: true, dockIconSize: 48, dockBookmarkIds: ['icon-0', 'icon-1'],
    }));
  });
  await page.evaluate(async () => {
    const { StorageManager } = await import('/src/services/storage.ts');
    new StorageManager().setDesktopPins(Array.from({ length: 4 }, (_, i) => `icon-${i}`), true);
  });
  await page.reload();
  await settled();
  const bookmarkBytes = await page.evaluate(() => localStorage.getItem('jipage_library_v2'));
  assert.deepEqual(await cornerPixel(page.locator('[data-desktop-id="icon-0"] [data-site-icon]')), [35, 113, 197, 255]);
  await page.locator('[data-desktop-id="icon-0"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '刷新网站图标', exact: true }).click();
  await settled();
  assert.equal(await page.evaluate(() => localStorage.getItem('jipage_library_v2')), bookmarkBytes);
  await page.screenshot({ path: `${screenshots}/site-icons-desktop.png`, fullPage: true });
  await page.getByTitle('启动台 · 所有应用与收藏 (桌面上滑亦可展开)').click();
  const launchpad = page.getByRole('dialog', { name: '启动台', exact: true });
  await launchpad.locator('[data-launchpad-bookmark="icon-1"] [data-fallback-kind="han-pair"]').waitFor();
  await launchpad.locator('[data-launchpad-bookmark="icon-0"]').click({ button: 'right' });
  await launchpad.getByRole('menuitem', { name: '刷新网站图标', exact: true }).click();
  await settled();
  await page.keyboard.press('Escape');
  await page.getByRole('banner').getByRole('button', { name: '管理中心', exact: true }).click();
  await page.locator('[data-library-bookmark="icon-1"] [data-fallback-kind="han-pair"]').waitFor();
  await page.getByRole('navigation', { name: '管理中心导航', exact: true })
    .getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('region', { name: '网站图标', exact: true }).waitFor();
  assert.equal(await page.getByRole('switch', { name: '允许 Google 图标服务' }).count(), 0);
  await page.getByRole('button', { name: '清除图标缓存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '图标缓存已清除' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('jipage_library_v2')), bookmarkBytes);
  for (const kind of ['vector', 'opaque']) {
    const state = await page.evaluate(async kind => {
      const api = await import('/src/services/site-icons.ts');
      const request = { url: `https://${kind}.icons.test/`, icon: `https://${kind}.icons.test/icon.${kind === 'vector' ? 'svg' : 'png'}` };
      return new Promise(resolve => {
        const off = api.watchSiteIcon(request, state => {
          if (state.status !== 'loading') queueMicrotask(() => { off(); resolve(state); });
        });
      });
    }, kind);
    assert.equal(state.status, 'ready', `${kind} source can display`);
    assert.equal(state.src, `https://${kind}.icons.test/icon.${kind === 'vector' ? 'svg' : 'png'}`,
      'SVG and CORS-unreadable sources stay external Image URLs, not persisted Blob URLs');
  }
  const binarySources = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('jigeqiu-site-icons-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('icons', 'readonly');
      const read = transaction.objectStore('icons').getAll();
      read.onsuccess = () => resolve(read.result.filter(record => record.blob).map(record => record.source));
      transaction.oncomplete = () => db.close();
    };
  }));
  assert.equal(binarySources.some(source => source.includes('vector.icons.test') || source.includes('opaque.icons.test')), false);
  await page.evaluate(async () => {
    const api = await import('/src/services/site-icons.ts');
    await api.refreshSiteIcon({ url: 'https://square.icons.test/' });
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('jigeqiu-site-icons-v1', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('icons', 'readwrite');
        const store = transaction.objectStore('icons');
        const read = store.getAll();
        read.onsuccess = () => {
          const record = read.result.find(record => record.key === JSON.stringify([false, ['https://square.icons.test/favicon.ico'], null]));
          if (!record) { transaction.abort(); reject(new Error('Missing corruption fixture')); return; }
          store.put({ ...record, blob: { size: 1 } });
        };
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
  });
  await page.reload();
  await page.getByRole('banner').getByRole('button', { name: '桌面', exact: true }).click();
  await page.locator('[data-desktop-id="icon-0"] [data-icon-state="ready"]').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('jipage_library_v2')), bookmarkBytes,
    'Corrupt image cache recovers without touching bookmark storage');
  for (const surface of ['collection', 'detail', 'platform', 'folder']) {
    await page.goto(`${fixture}?surface=${surface}`);
    if (surface === 'platform') await page.locator('input').fill('Custom site');
    const icons = page.getByRole('img', { name: 'Custom site', exact: true });
    await icons.first().locator('img').waitFor();
    assert.deepEqual(await cornerPixel(icons.first()), [230, 183, 63, 255],
      `${surface} retains the explicit custom image, not the blue origin favicon`);
    if (surface === 'folder') {
      await icons.first().click({ button: 'right' });
      await page.waitForFunction(() => document.querySelectorAll('[data-site-icon][aria-label="Custom site"]').length === 2);
      await icons.last().locator('img').waitFor();
      assert.deepEqual(await cornerPixel(icons.last()), [230, 183, 63, 255],
        'Legacy folder menu preserves original image corners');
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: circular 60%-width Han glyphs at every size, six stable day/night palettes with 4.5:1 contrast, reversible theme switching, original shapes/pixels/transparent backgrounds, visibility-gated loads, explicit precedence, shared and persistent blob/negative cache, remote-offline reuse, refresh failure retention, no provider requests despite legacy opt-in, non-destructive clear, external SVG/CORS metadata-only fallback, corrupted-cache recovery, desktop/Dock/Launchpad/library integration and screenshots');
} finally {
  await browser?.close();
  await server.close();
}

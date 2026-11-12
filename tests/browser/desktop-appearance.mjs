import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.route('https://**/*', route => route.fulfill({ body: '' }));
  const page = await context.newPage();
  const errors = [];
  const wallpaperRequests = [];
  page.on('request', request => {
    if (/\/wallpapers\/.+\.webp/.test(request.url())) wallpaperRequests.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(url);
  const presets = ['snow-mountain', 'misty-mountains', 'corner-tower', 'green-lake'];
  const seed = async (preset, appearance = 'light-glass') => {
    await page.evaluate(async ({ preset, appearance }) => {
      localStorage.clear();
      localStorage.setItem('jipage_bookmarks_v1', JSON.stringify(
        ['Alpha', 'Beta', 'Coolors', 'Design', 'Excalidraw', 'Figma', 'GitHub',
          'Help', 'Ideas', 'Journal', 'Kit', 'Linear', 'MDN', 'Notion'].map((title, i) => ({
          id: `appearance-${i}`, title, url: `https://example.test/${i}`, domain: 'example.test',
          category: 'cat-inbox', order: i, pinnedToDesktop: true, iconMode: 'text',
          collectionIds: [], createdAt: 1, updatedAt: 1,
        })),
      ));
      localStorage.setItem('jipage_folders_v1', '[]');
      localStorage.setItem('jipage_settings_v1', JSON.stringify({
        appearanceMode: appearance, wallpaperPreset: preset, desktopViewMode: 'icon',
        language: 'zh', showDock: true, dockIconSize: 48, dockBookmarkIds: ['appearance-0'],
      }));
      const { StorageManager } = await import('/src/services/storage.ts');
      new StorageManager().setDesktopPins(Array.from({ length: 14 }, (_, i) => `appearance-${i}`), true);
    }, { preset, appearance });
    await page.goto(`${url}/#/`);
    await page.reload();
    await page.locator('[data-wallpaper-canvas]').evaluate(async element => {
      const url = getComputedStyle(element).backgroundImage.match(/url\("?(.*?)"?\)/)?.[1];
      if (!url) throw new Error('Wallpaper must use a bitmap');
      const image = new Image();
      image.src = url;
      await image.decode();
    });
  };
  const launchpad = page.getByRole('dialog', { name: '启动台', exact: true });
  const trigger = page.getByTitle('启动台 · 所有应用与收藏 (桌面上滑亦可展开)');
  const open = async () => {
    await trigger.click();
    await launchpad.waitFor();
    await launchpad.evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished));
    });
  };
  const settle = () => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
  const checkGuide = async (name, reduced = false) => {
    await page.getByRole('button', { name: '使用指南', exact: true }).click();
    const guide = page.getByRole('dialog', { name: '使用指南', exact: true });
    await guide.waitFor();
    const material = await guide.evaluate(el => {
      const probe = document.createElement('span');
      el.append(probe);
      probe.style.backgroundColor = document.documentElement.classList.contains('reduced-transparency')
        || matchMedia('(prefers-reduced-transparency: reduce)').matches
        ? 'var(--desktop-launchpad)' : 'transparent';
      const wash = getComputedStyle(probe).backgroundColor;
      probe.style.backgroundColor = 'var(--desktop-panel)';
      const surface = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        wash, surface,
        backdrop: getComputedStyle(el.parentElement).backgroundColor,
        blur: getComputedStyle(el.parentElement).backdropFilter,
        panel: getComputedStyle(el).backgroundColor,
        panelBlur: getComputedStyle(el).backdropFilter,
      };
    });
    assert.equal(material.backdrop, material.wash);
    assert.equal(material.panel, material.surface);
    assert.equal(material.blur, reduced ? 'none' : 'blur(4px)');
    if (reduced) assert.equal(material.panelBlur, 'none');
    await page.screenshot({ path: `/tmp/jigeqiu-appearance/guide-${name}.png` });
    await page.keyboard.press('Escape');
  };
  const contrast = async locator => locator.evaluate(element => {
    const style = getComputedStyle(element);
    const channels = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = rgb => rgb.map(value => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    const foreground = luminance(channels(style.color));
    const background = luminance(channels(style.backgroundColor));
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  await mkdir('/tmp/jigeqiu-appearance', { recursive: true });
  const darkBackgrounds = new Set();
  for (const preset of presets) {
    const requestStart = wallpaperRequests.length;
    await seed(preset);
    const requested = wallpaperRequests.slice(requestStart);
    assert.ok(requested.some(url => url.endsWith(`${preset}-desktop.webp?v=2`)));
    assert.ok(requested.every(url => url.endsWith(`${preset}-desktop.webp?v=2`)),
      'Desktop loads only the selected wallpaper, not every preset or mobile assets');
    const canvasStyle = await page.locator('[data-wallpaper-canvas]').evaluate(el => {
      const style = getComputedStyle(el);
      return { size: style.backgroundSize, url: style.backgroundImage };
    });
    assert.equal(canvasStyle.size, 'cover');
    const scrim = page.locator('[data-wallpaper-scrim]');
    assert.equal(await scrim.count(), 1);
    const stage = page.locator('.desktop-stage');
    assert.equal(await stage.evaluate(el => getComputedStyle(el, '::before').pointerEvents), 'none');
    const dayWash = await stage.evaluate(el => ({
      stage: getComputedStyle(el).getPropertyValue('--wallpaper-stage-wash').trim(),
      backdrop: getComputedStyle(el).getPropertyValue('--wallpaper-wash').trim(),
      text: getComputedStyle(el).getPropertyValue('--desktop-text').trim(),
    }));
    assert.equal(dayWash.stage, 'rgb(0 0 0 / 36%)', 'Day icon area darkens wallpaper behind light labels');
    assert.ok(!dayWash.backdrop.includes('255 255 255'), 'Day wallpaper wash does not whiten the image');
    assert.equal(dayWash.text, '#182024', 'Day foreground still uses its existing light-theme colors');
    await page.screenshot({ path: `/tmp/jigeqiu-appearance/${preset}-desktop-light.png` });
    if (preset === 'snow-mountain') await page.screenshot({ path: '/tmp/jigeqiu-appearance/desktop-light.png' });
    await open();
    assert.equal(await launchpad.evaluate(el => getComputedStyle(el).backdropFilter), 'none',
      'Launchpad must not blur or expose the desktop icons behind it');
    const launchpadImage = await launchpad.evaluate(el => getComputedStyle(el, '::before').backgroundImage);
    assert.ok(launchpadImage.includes(`${preset}-desktop.webp`), 'Launchpad reuses the selected wallpaper');
    assert.equal(await launchpad.evaluate(el => getComputedStyle(el, '::before').filter), 'none',
      'Launchpad preserves desktop wallpaper sharpness and saturation');
    const launchpadWash = await launchpad.evaluate(el => {
      const probe = document.createElement('span');
      el.append(probe);
      probe.style.background = 'var(--wallpaper-wash), linear-gradient(var(--wallpaper-stage-wash), var(--wallpaper-stage-wash))';
      const expected = getComputedStyle(probe).backgroundImage;
      probe.remove();
      return { expected, actual: getComputedStyle(el, '::after').backgroundImage };
    });
    assert.equal(launchpadWash.actual, launchpadWash.expected, 'Launchpad reuses desktop wallpaper and stage washes');
    if (preset === 'snow-mountain') {
      const withDesktop = await page.screenshot();
      await page.getByTestId('desktop-viewport').evaluate(el => { el.style.visibility = 'hidden'; });
      const withoutDesktop = await page.screenshot();
      assert.ok(withDesktop.equals(withoutDesktop), 'Desktop icons cannot bleed through the launchpad background');
      await page.getByTestId('desktop-viewport').evaluate(el => { el.style.visibility = ''; });
    }
    const icons = launchpad.locator('[data-launchpad-bookmark]');
    const boxes = await icons.evaluateAll(elements => elements.map(element => {
      const { top, bottom } = element.getBoundingClientRect();
      return { top, bottom };
    }));
    assert.equal(boxes.length, 14);
    assert.equal(boxes[0].top, boxes[1].top, 'Different letters share a continuous icon row');
    assert.ok(boxes.every(box => box.bottom < 960), 'Small libraries fit without letter-section scrolling');
    const scroll = launchpad.getByTestId('launchpad-scroll');
    assert.equal(await scroll.evaluate(el => el.scrollHeight > el.clientHeight), false);
    assert.equal(await launchpad.locator('section[aria-label="A"]').count(), 0);
    const heading = launchpad.getByRole('heading', { name: '启动台', exact: true });
    const search = launchpad.getByRole('searchbox');
    assert.ok(await contrast(search) >= 4.5, 'Day search has readable foreground/background contrast');
    assert.equal(await heading.evaluate(el => getComputedStyle(el).color), 'rgb(248, 250, 252)');
    await launchpad.getByRole('button', { name: '跳转到 N', exact: true }).click();
    assert.equal(await launchpad.getByRole('button', { name: 'Notion', exact: true })
      .evaluate(el => el === document.activeElement), true, 'Letter index reaches the first matching bookmark');
    if (preset === 'snow-mountain') await page.screenshot({ path: '/tmp/jigeqiu-appearance/launchpad-light.png' });
    await page.keyboard.press('Escape');
    if (preset === 'snow-mountain') await checkGuide('light');
    await page.getByRole('button', { name: '切换夜间模式', exact: true }).click();
    await settle();
    darkBackgrounds.add(await page.locator('[data-wallpaper-canvas]').evaluate(el => getComputedStyle(el).backgroundImage));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_settings_v1')).wallpaperPreset), preset);
    const dock = page.getByTestId('bottom-dock').locator('.liquid-glass-dock');
    const dockChannels = await dock.evaluate(el => getComputedStyle(el).backgroundColor.match(/[\d.]+/g).slice(0, 3).map(Number));
    assert.ok(dockChannels.every(value => value < 80), 'Dock changes to a dark surface');
    if (preset === 'snow-mountain') await page.screenshot({ path: '/tmp/jigeqiu-appearance/desktop-dark.png' });
    await page.screenshot({ path: `/tmp/jigeqiu-appearance/${preset}-desktop-dark.png` });
    await open();
    assert.ok(await contrast(search) >= 4.5, 'Night search has readable foreground/background contrast');
    const nightChannels = await search.evaluate(el => getComputedStyle(el).backgroundColor.match(/[\d.]+/g).slice(0, 3).map(Number));
    assert.ok(nightChannels.every(value => value < 80), 'Night search never becomes a light panel');
    assert.equal(await heading.evaluate(el => getComputedStyle(el).color), 'rgb(242, 245, 244)');
    if (preset === 'snow-mountain') await page.screenshot({ path: '/tmp/jigeqiu-appearance/launchpad-dark.png' });
    if (preset === 'snow-mountain') {
      await page.keyboard.press('Escape');
      await checkGuide('dark');
    }
  }
  assert.equal(darkBackgrounds.size, presets.length, 'Every wallpaper keeps its own night palette');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const appearance of ['light-glass', 'dark-glass', 'reduced-transparency']) {
      await seed('snow-mountain', appearance);
      assert.ok(await page.locator('[data-wallpaper-canvas]').evaluate(el =>
        getComputedStyle(el).backgroundImage.includes('snow-mountain-mobile.webp')));
      await open();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const boxes = await launchpad.locator('[data-launchpad-bookmark]').evaluateAll(elements =>
        elements.map(el => { const { left, right } = el.getBoundingClientRect(); return { left, right }; }));
      assert.ok(boxes.every(box => box.left >= 0 && box.right <= width), 'Mobile icons stay in bounds');
      await page.screenshot({ path: `/tmp/jigeqiu-appearance/launchpad-${width}-${appearance}.png` });
      if (appearance === 'reduced-transparency') {
        assert.equal(await launchpad.evaluate(el => getComputedStyle(el).backdropFilter), 'none');
        await page.keyboard.press('Escape');
        await checkGuide(`${width}-reduced`, true);
        await open();
      }
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await launchpad.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  const session = await context.newCDPSession(page);
  await seed('snow-mountain', 'dark-glass');
  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  });
  await open();
  assert.equal(await launchpad.evaluate(el => getComputedStyle(el).backdropFilter), 'none');
  assert.equal(await launchpad.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(27, 33, 35)');
  await page.keyboard.press('Escape');
  await checkGuide('system-reduced-dark', true);
  await session.send('Emulation.setEmulatedMedia', { features: [] });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('banner').getByRole('button', { name: '管理中心', exact: true }).click();
  await page.getByRole('navigation', { name: '管理中心导航', exact: true })
    .getByRole('button', { name: '外观', exact: true }).click();
  const thumbnails = page.locator('.wallpaper-preview');
  await thumbnails.first().waitFor();
  assert.equal(await thumbnails.count(), presets.length);
  assert.ok((await thumbnails.evaluateAll(elements =>
    elements.map(el => getComputedStyle(el).backgroundImage))).every(image => image.includes('-thumb.webp')));
  await page.getByRole('button', { name: /雪山晨光/ }).click();
  await page.getByRole('banner').getByRole('button', { name: '桌面', exact: true }).click();
  await page.reload();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_settings_v1')).wallpaperPreset), 'snow-mountain');
  assert.ok(await page.locator('[data-wallpaper-canvas]').evaluate(el =>
    getComputedStyle(el).backgroundImage.includes('snow-mountain-desktop.webp')));
  assert.deepEqual(errors, []);
  console.log('PASS local responsive wallpaper budgets/loading, day/night washes, no launchpad icon bleed, grid/letter focus, contrast, Dock, 320/390px, accessibility and persisted picker');
} finally {
  await browser?.close();
  await server.close();
}

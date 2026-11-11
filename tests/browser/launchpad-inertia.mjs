import assert from 'node:assert/strict';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
const assetKeys = ['jipage_library_v2', 'jipage_bookmarks_v1', 'jipage_folders_v1',
  'jipage_collections_v1', 'jigeqiu_assets_v1'];
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const mode of ['text', 'ok', '403', 'network-failure']) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 }, hasTouch: true, reducedMotion: 'no-preference',
    });
    let requests = 0;
    let forbidden = 0;
    await context.route('https://**/*', async route => {
      requests++;
      await new Promise(resolve => setTimeout(resolve, 35));
      if (mode === 'network-failure') return route.abort('failed');
      if (mode === '403') return route.fulfill({
        status: 403, headers: { 'access-control-allow-origin': '*' }, body: 'Denied',
      });
      return route.fulfill({
        status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' },
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() === 403) forbidden++; });
    await page.addInitScript(() => {
      const cancel = window.cancelAnimationFrame.bind(window);
      window.cancelAnimationFrame = id => {
        if (window.inertiaTrace) window.inertiaTrace.cancels.push({ at: performance.now(), id, stack: new Error().stack });
        cancel(id);
      };
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.evaluate(mode => {
      localStorage.clear();
      localStorage.setItem('jipage_bookmarks_v1', JSON.stringify(Array.from({ length: 364 }, (_, i) => ({
        id: `inertia-${i}`, title: `${String.fromCharCode(65 + Math.floor(i / 14) % 26)} Site ${i} with a long bookmark title for hover`,
        url: `https://site${i}.example.org/`, domain: `site${i}.example.org`, category: '',
        icon: `https://icons.example.org/${i}.png`, iconMode: mode === 'text' ? 'text' : 'auto',
        keywords: [], notes: '', tags: [], collectionIds: [], order: i,
        pinnedToDesktop: false, createdAt: 1, updatedAt: 1,
      }))));
      localStorage.setItem('jipage_settings_v1', JSON.stringify({ language: 'en', appearanceMode: 'light-glass' }));
    }, mode);
    await page.reload();
    const assets = () => page.evaluate(keys => JSON.stringify(keys.map(key => [key, localStorage.getItem(key)])), assetKeys);
    const baseline = await assets();
    await page.keyboard.press('Control+Shift+Space');
    const drawer = page.locator('[data-panel="launchpad"]');
    await drawer.waitFor();
    await drawer.locator('input').blur();
    const scroll = page.getByTestId('launchpad-scroll');
    const rect = await scroll.boundingBox();
    const rail = await drawer.locator('[data-launchpad-alphabet]').boundingBox();
    const blank = { x: Math.round(rect.x + 2), y: Math.round(rect.y + rect.height * 0.65) };
    const reset = async (edge = 0) => {
      await page.keyboard.press('Shift');
      await scroll.evaluate((element, edge) => {
        element.scrollTop = edge < 0 ? 0 : edge > 0 ? element.scrollHeight - element.clientHeight : 500;
      }, edge);
      await page.waitForTimeout(60);
    };
    const stroke = async (pause, onIcon = false, {
      step = 20, interval = 16, count = 8, hover = false, crossRail = false, label = false, edge = 0,
    } = {}) => {
      await reset(edge);
      const start = onIcon ? await drawer.locator('[data-launchpad-bookmark]').evaluateAll((elements, label) => {
        const viewport = document.querySelector('[data-testid="launchpad-scroll"]').getBoundingClientRect();
        const element = elements.find(element => {
          const rect = element.getBoundingClientRect();
          return rect.top > viewport.top + 250 && rect.bottom < viewport.bottom - 30;
        });
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + (label ? 90 : 40) };
      }, label) : blank;
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      for (let i = 1; i <= count; i++) {
        await page.waitForTimeout(interval);
        const x = crossRail ? i <= count / 2 ? rail.x + rail.width / 2 : rect.x + rect.width - 2 : start.x;
        await page.mouse.move(x, start.y - i * step);
      }
      if (pause) await page.waitForTimeout(pause);
      await page.mouse.up();
      const released = await scroll.evaluate(element => element.scrollTop);
      if (hover) {
        await page.evaluate(() => {
          window.inertiaTrace = { cancels: [], icons: 0, letters: 0 };
          document.addEventListener('pointerover', event => {
            if (!window.inertiaTrace || !(event.target instanceof Element)) return;
            if (event.target.closest('[data-launchpad-bookmark]')) window.inertiaTrace.icons++;
            if (event.target.closest('[data-launchpad-alphabet]')) window.inertiaTrace.letters++;
          }, { once: false });
        });
        for (let i = 0; i < 20; i++) {
          await page.mouse.move(i % 4 === 0 ? rail.x + rail.width / 2 : rect.x + 100 + i * 24,
            rect.y + 120 + i % 3 * 110);
          await page.waitForTimeout(20);
        }
        const trace = await page.evaluate(() => {
          const trace = window.inertiaTrace;
          window.inertiaTrace = null;
          return trace;
        });
        console.log(`TRACE post-release hover ${mode}: ${JSON.stringify(trace)}`);
        assert.deepEqual(trace.cancels, [], 'Mouse movement and hover must not cancel release inertia');
        assert.ok(trace.icons > 0 && trace.letters > 0, 'The pointer actually crosses icons and the alphabet rail');
        await page.waitForTimeout(280);
      } else await page.waitForTimeout(700);
      await drawer.waitFor();
      assert.equal(context.pages().length, 1, 'A paused drag must not open a bookmark');
      return (await scroll.evaluate(element => element.scrollTop)) - released;
    };
    for (const direction of [-1, 1]) {
      const edgeDistance = await stroke(30, false, { step: direction * 3, interval: 30, count: 12, edge: -direction });
      assert.ok(edgeDistance * direction >= 80,
        `${mode}: inward slow 36px drag from edge should coast, got ${edgeDistance}px`);
      const distance = await stroke(30, false, { step: direction * 3, interval: 30, count: 12 });
      assert.ok(distance * direction >= 80, `${mode}: slow 36px drag should coast visibly in direction ${direction}, got ${distance}px`);
    }
    // Cover deliberate distance intent as well as short release pauses.
    const distances = {};
    for (const pause of [60, 0, 30, 90, 150, 250]) {
      const distance = await stroke(pause);
      distances[pause] = distance;
      if (pause <= 90) assert.ok(distance > 20, `${mode}: ${pause}ms pause should retain visible inertia, got ${distance}px`);
      if (pause === 250) assert.equal(distance, 0, `${mode}: a deliberate hold must stop`);
    }
    assert.ok(await stroke(60, true) > 20, `${mode}: short pause after icon drag retains inertia`);
    const movingDistance = await stroke(30, true, { hover: true });
    assert.ok(movingDistance > 80, `${mode}: mouse movement and icon hover after release retain inertia, got ${movingDistance}px`);
    const labelDistance = await stroke(30, true, { label: true });
    const railDistance = await stroke(30, true, { crossRail: true });
    assert.ok(labelDistance > 80, `${mode}: title drag retains inertia, got ${labelDistance}px`);
    assert.ok(railDistance > 80, `${mode}: dragging an icon across the rail retains inertia, got ${railDistance}px`);
    console.log(`PASS drag origins ${mode}: ${JSON.stringify({ movingDistance, labelDistance, railDistance })}`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await stroke(60), 0, 'Reduced motion disables inertia');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await reset();
    await page.mouse.move(blank.x, blank.y);
    await page.mouse.down();
    await page.mouse.move(blank.x, blank.y - 160, { steps: 8 });
    await page.waitForTimeout(60);
    await page.keyboard.press('Shift');
    await page.mouse.up();
    const cancelled = await scroll.evaluate(element => element.scrollTop);
    await page.waitForTimeout(150);
    assert.equal(await scroll.evaluate(element => element.scrollTop), cancelled, 'Cancellation during a pause cannot revive inertia');
    assert.equal(await assets(), baseline, 'Inertia never changes bookmark assets');
    if (mode === '403') assert.ok(forbidden > 0, '403 scenario really receives forbidden responses');
    if (mode === 'network-failure') assert.ok(requests > 0, 'Network failure scenario actually requests icons');
    if (mode === 'ok') assert.ok(await drawer.locator('[data-icon-state="ready"]').count() > 0, 'Success scenario renders real images');
    assert.deepEqual(errors, []);
    console.log(`PASS inertia pauses ${mode}: ${JSON.stringify(distances)}`);
    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
}

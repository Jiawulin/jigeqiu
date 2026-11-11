import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { preview } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const baseline = process.env.LAUNCHPAD_BASELINE === 'true';
let browser;
try {
  browser = await chromium.launch({ headless: true });
  console.log(`Chromium ${browser.version()}; production dist; synthetic data; 1500ms chunk delay`);
  for (const scenario of baseline ? ['baseline'] : ['idle', 'no-idle-api', 'pending', 'immediate', 'preload-failure']) {
    const width = scenario === 'no-idle-api' ? 390 : scenario === 'immediate' ? 320 : 1440;
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width, height: 900 } });
    const errors = [];
    const requests = [];
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    await context.addInitScript(({ scenario }) => {
      localStorage.setItem('jipage_bookmarks_v1', JSON.stringify([
        {
          id: 'first-open', title: '中文工具', url: 'https://first-open.invalid/tool',
          domain: 'first-open.invalid', keywords: ['测试'], notes: '', category: 'uncategorized',
          pinnedToDesktop: false, order: 0, collectionIds: [], createdAt: 1, updatedAt: 1,
        },
      ]));
      if (scenario === 'no-idle-api') {
        delete window.requestIdleCallback;
        delete window.cancelIdleCallback;
      }
      // Keep the idle job pending so opening cannot depend on its execution.
      if (scenario === 'immediate') {
        window.requestIdleCallback = () => 1;
        window.cancelIdleCallback = () => {};
        localStorage.setItem('jipage_settings_v1', JSON.stringify({ language: 'en', appearanceMode: 'dark-glass' }));
      }
    }, { scenario });
    let releaseChunk;
    const chunkGate = new Promise(resolve => { releaseChunk = resolve; });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (/\/assets\/Launchpad-[^/]+\.js$/.test(url.pathname)) {
        requests.push(performance.now());
        if (scenario === 'preload-failure') return route.abort();
        if (scenario === 'pending') await chunkGate;
        else await new Promise(resolve => setTimeout(resolve, 1500));
      }
      await route.continue();
    });
    await page.goto(origin);
    const desktop = page.getByTestId('desktop-viewport');
    await desktop.waitFor();
    const libraryBefore = await page.evaluate(() => localStorage.getItem('jipage_library_v2'));
    const launchpad = page.locator('[data-panel="launchpad"]');
    if (['idle', 'no-idle-api', 'pending', 'preload-failure'].includes(scenario)) {
      const deadline = performance.now() + 5000;
      while (!requests.length && performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(requests.length, 1, 'Desktop starts loading Launchpad before the first gesture');
      if (scenario !== 'pending') await page.waitForLoadState('networkidle');
      assert.equal(await launchpad.count(), 0, 'Preloading must not mount a hidden drawer');
      assert.equal(await page.evaluate(() => location.hash), '#/', 'Preloading stays on the desktop route');
    }
    if (scenario === 'preload-failure') {
      await page.getByRole('banner').getByRole('button', { name: '管理中心', exact: true }).click();
      await page.getByRole('heading', { name: '全部收藏', exact: true }).waitFor();
      assert.deepEqual(errors, [], 'Background preload failure must not break the desktop');
      console.log('preload-failure: management remains usable; no uncaught error');
      await context.close();
      continue;
    }
    const openedAt = performance.now();
    // The reported interaction: swipe upward on desktop whitespace.
    await page.mouse.move(8, 540);
    await page.mouse.down();
    await page.mouse.move(8, 490, { steps: 4 });
    await page.mouse.up();
    await page.waitForURL('**/#/start');
    if (scenario === 'immediate') {
      await page.getByRole('status').filter({ hasText: 'Opening Launchpad' }).waitFor();
    }
    if (scenario === 'pending') releaseChunk();
    await launchpad.waitFor();
    const elapsed = Math.round(performance.now() - openedAt);
    console.log(`${scenario}: first upward gesture to drawer ${elapsed}ms; chunk requests ${requests.length}`);
    if (['idle', 'no-idle-api'].includes(scenario)) {
      assert.ok(elapsed < 1200, `Preloaded first open should not pay the 1500ms download: ${elapsed}ms`);
    }
    assert.equal(requests.length, 1, 'Preload and immediate open share the same module request');
    const search = launchpad.getByRole('searchbox');
    assert.equal(await search.evaluate(element => element === document.activeElement), true);
    await search.fill('zwgj');
    await launchpad.locator('[data-launchpad-bookmark="first-open"]').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('jipage_library_v2')), libraryBefore);
    await page.keyboard.press('Escape');
    await launchpad.waitFor({ state: 'hidden' });
    await page.locator('[data-onboarding="launchpad"]').click();
    await launchpad.waitFor();
    assert.equal(await search.inputValue(), '', 'Reopening still resets search');
    assert.equal(requests.length, 1);
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}

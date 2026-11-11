import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
const output = 'test-results/screenshots/launchpad-gestures';
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  await mkdir(output, { recursive: true });
  for (const [width, height, language, dark] of [
    [1440, 1000, 'zh', false], [1440, 1000, 'en', true],
    [820, 1180, 'zh', false], [1180, 820, 'en', true],
    [390, 844, 'en', false], [320, 740, 'zh', true],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: width <= 390 });
    context.setDefaultTimeout(8000);
    await context.route('https://**/*', route => route.fulfill({ body: 'Synthetic destination' }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.evaluate(({ language, dark }) => {
      localStorage.clear();
      const names = [...'ACDEFGHIJKLMNOPQRSTUVWXYZ', '#'];
      localStorage.setItem('jipage_bookmarks_v1', JSON.stringify(names.flatMap((letter, group) =>
        Array.from({ length: 14 }, (_, i) => ({
          id: `gesture-${group}-${i}`, title: `${letter} Site ${String(i).padStart(2, '0')}`,
          url: `https://example.org/${group}/${i}`, domain: 'example.org', category: '',
          keywords: [], notes: '', tags: [], collectionIds: [], order: group * 14 + i,
          pinnedToDesktop: false, iconMode: 'text', createdAt: 1, updatedAt: 1,
        })))));
      localStorage.setItem('jipage_settings_v1', JSON.stringify({
        language, appearanceMode: dark ? 'dark-glass' : 'light-glass', showDock: true, dockIconSize: 48,
      }));
    }, { language, dark });
    await page.reload();
    const readAssets = () => page.evaluate(() => JSON.stringify(Object.fromEntries(
      ['jipage_library_v2', 'jipage_bookmarks_v1', 'jipage_folders_v1', 'jipage_collections_v1',
        'jigeqiu_assets_v1'].map(key => [key, localStorage.getItem(key)]),
    )));
    const baseline = await readAssets();
    const drawer = page.locator('[data-panel="launchpad"]');
    const scroll = page.getByTestId('launchpad-scroll');
    const icons = drawer.locator('[data-launchpad-bookmark]');
    const preview = page.getByTestId('launchpad-letter-preview');
    const letter = value => drawer.locator(`[data-launchpad-letter="${value}"]`);
    const top = () => scroll.evaluate(element => element.scrollTop);
    const open = async () => {
      await page.keyboard.press('Control+Shift+Space');
      await drawer.waitFor();
      await drawer.locator('input').blur();
    };
    await open();
    const rect = await scroll.boundingBox();
    const blank = { x: rect.x + 2, y: rect.y + rect.height * 0.65 };
    const reset = async () => {
      await page.keyboard.press('Shift');
      await scroll.evaluate(element => { element.scrollTop = 0; });
      await page.waitForTimeout(60);
    };
    const mouseDrag = async (start, dy, steps = 5) => {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x, start.y + dy, { steps });
      await page.mouse.up();
    };
    if ((width === 1440 && language === 'zh') || width === 390) {
      const client = await context.newCDPSession(page);
      const profile = async (native, step, count) => {
        await reset();
        await scroll.evaluate(element => { element.scrollTop = 500; });
        const x = blank.x;
        const y = blank.y;
        const point = native
          ? (type, nextY) => client.send('Input.dispatchTouchEvent', {
            type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: nextY, id: 1 }],
          })
          : async (type, nextY) => {
            if (type === 'touchStart') { await page.mouse.move(x, nextY); await page.mouse.down(); }
            else if (type === 'touchEnd') await page.mouse.up();
            else await page.mouse.move(x, nextY);
          };
        await point('touchStart', y);
        for (let i = 1; i <= count; i++) {
          await page.waitForTimeout(16);
          await point('touchMove', y - i * step);
        }
        await point('touchEnd', y - count * step);
        return scroll.evaluate(async element => {
          const start = performance.now();
          const samples = [{ at: 0, top: element.scrollTop }];
          await new Promise(resolve => {
            const frame = now => {
              samples.push({ at: now - start, top: element.scrollTop });
              if (now - start < 1800) requestAnimationFrame(frame); else resolve();
            };
            requestAnimationFrame(frame);
          });
          const first = samples[0];
          const lastMove = samples.findLast((sample, index) => index && sample.top !== samples[index - 1].top);
          return { distance: samples.at(-1).top - first.top, duration: lastMove?.at ?? 0 };
        });
      };
      for (const [name, step, count] of [['slow', 8, 12], ['fast', 36, 8]]) {
        const mouse = await profile(false, step, count);
        const touch = await profile(true, step, count);
        console.log(`MOTION ${width}px ${name} ${JSON.stringify({ mouse, touch })}`);
      }
      await client.detach();
      await reset();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await scroll.evaluate(element => element.addEventListener('pointerdown', event => {
        window.__launchpadTestPointer = event.pointerId;
      }, { once: true }));
      await page.mouse.move(blank.x, blank.y);
      await page.mouse.down();
      const batching = await scroll.evaluate(async (element, start) => {
        const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
        let writes = 0;
        Object.defineProperty(element, 'scrollTop', {
          configurable: true,
          get() { return descriptor.get.call(this); },
          set(value) { writes++; descriptor.set.call(this, value); },
        });
        try {
          for (let i = 1; i <= 6; i++) {
            const properties = {
              bubbles: true, cancelable: true, pointerId: window.__launchpadTestPointer,
              pointerType: 'mouse', isPrimary: true, buttons: 1, clientX: start.x, clientY: start.y - i * 15,
            };
            const event = new PointerEvent('pointermove', properties);
            Object.defineProperty(event, 'getCoalescedEvents', { value: () => [
              new PointerEvent('pointermove', { ...properties, clientY: properties.clientY + 7.5 }),
              new PointerEvent('pointermove', properties),
            ] });
            element.dispatchEvent(event);
          }
          const beforeFrame = writes;
          await new Promise(resolve => requestAnimationFrame(resolve));
          return { beforeFrame, writes, top: element.scrollTop };
        } finally { delete element.scrollTop; }
      }, blank);
      assert.equal(batching.beforeFrame, 0, 'Pointer bursts do not write layout between animation frames');
      assert.equal(batching.writes, 1, 'Coalesced pointer input commits once per frame');
      assert.ok(Math.abs(batching.top - 82) <= 1, 'All coalesced deltas are preserved with one-time activation slop');
      await page.mouse.move(blank.x, blank.y - 90);
      await page.mouse.up();
      await reset();
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
      const edge = await top();
      await page.mouse.move(blank.x, blank.y);
      await page.mouse.down();
      await page.mouse.move(blank.x, blank.y - 100, { steps: 4 });
      await page.mouse.move(blank.x, blank.y - 80);
      await page.waitForTimeout(40);
      assert.ok(await top() < edge - 10, 'Reversing away from an edge responds before release');
      const inward = await top();
      await page.mouse.up();
      await page.waitForTimeout(60);
      assert.ok(await top() <= inward, 'Inward release never flings back toward the clamped edge');
      await reset();
    }
    await mouseDrag(blank, -150);
    assert.ok(await top() > 100, 'Mouse blank drag scrolls');
    await drawer.waitFor();
    const atRelease = await top();
    await page.waitForTimeout(120);
    assert.ok(await top() > atRelease, 'Mouse release continues with inertia');
    await page.keyboard.press('Shift');
    const stopped = await top();
    await page.waitForTimeout(100);
    assert.equal(await top(), stopped, 'Keyboard cancels inertia');
    await reset();
    let icon = await icons.first().boundingBox();
    await mouseDrag({ x: icon.x + 32, y: icon.y + 45 }, -70);
    await drawer.waitFor();
    assert.ok(await top() > 40, 'Mouse drag from an icon scrolls without activation');
    assert.equal(context.pages().length, 1);
    // Use a visible bookmark: clicking an offscreen locator would make Playwright scroll it during inertia.
    const visibleId = await icons.evaluateAll(elements => {
      const viewport = document.querySelector('[data-testid="launchpad-scroll"]').getBoundingClientRect();
      return elements.filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.top > viewport.top + 50 && rect.bottom < viewport.bottom - 50;
      }).sort((a, b) => Math.abs(a.getBoundingClientRect().top - (viewport.top + viewport.height / 2))
        - Math.abs(b.getBoundingClientRect().top - (viewport.top + viewport.height / 2)))[0].dataset.launchpadBookmark;
    });
    await drawer.locator(`[data-launchpad-bookmark="${visibleId}"]`).click({ button: 'right' });
    await drawer.getByRole('menu').waitFor();
    await page.keyboard.press('Escape');
    await reset();
    await icons.first().click({ button: 'right' });
    await drawer.getByRole('menu').waitFor();
    await mouseDrag(blank, -100);
    await drawer.waitFor();
    assert.equal(await drawer.getByRole('menu').count(), 0, 'Dragging outside a menu dismisses it');
    assert.ok(await top() > 50, 'The menu-dismissal stroke scrolls without closing the drawer');
    await reset();
    await page.mouse.move(blank.x, blank.y);
    await page.mouse.down();
    await page.mouse.move(blank.x, blank.y - 70, { steps: 3 });
    await page.keyboard.press('Shift');
    await page.mouse.up();
    await drawer.waitFor();
    await reset();
    if (width === 1440 && language === 'zh') {
      await mouseDrag(blank, -130);
      await page.mouse.wheel(0, 0);
      const wheelStopped = await top();
      await page.waitForTimeout(100);
      assert.equal(await top(), wheelStopped, 'Wheel input cancels mouse inertia');
      await reset();
      await page.mouse.move(blank.x, blank.y);
      await page.mouse.down();
      await page.mouse.move(blank.x, blank.y - 70, { steps: 3 });
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.mouse.up();
      await drawer.waitFor();
      await reset();
    }
    await mouseDrag(blank, 100);
    await drawer.waitFor();
    assert.equal(await top(), 0, 'Dragging beyond top neither scrolls nor closes');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mouseDrag(blank, -160);
    const reducedTop = await top();
    await page.waitForTimeout(150);
    assert.equal(await top(), reducedTop, 'Reduced motion disables mouse inertia');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const bottom = await top();
    await mouseDrag(blank, -100);
    await drawer.waitFor();
    assert.equal(await top(), bottom, 'Dragging beyond bottom neither opens bookmarks nor closes the drawer');

    // Alphabet pointer capture must stay active outside the narrow rail.
    const a = await letter('A').boundingBox();
    const z = await letter('Z').boundingBox();
    const b = await letter('B').boundingBox();
    const navX = a.x + a.width / 2;
    await page.mouse.move(navX, a.y + a.height / 2);
    await page.mouse.down();
    assert.equal(await preview.textContent(), 'A');
    const aTop = await top();
    await page.mouse.move(navX, b.y + b.height / 2);
    assert.equal(await top(), aTop, 'Empty B retains the previous valid position');
    assert.equal(await preview.textContent(), 'A');
    await page.mouse.move(navX, z.y + z.height / 2, { steps: 8 });
    assert.equal(await preview.textContent(), 'Z');
    assert.ok(await top() > 1000);
    await page.screenshot({ path: `${output}/${width}-${language}-${dark ? 'dark' : 'light'}-alphabet.png` });
    await page.mouse.move(navX - 60, a.y - 20);
    assert.equal(await preview.textContent(), 'A', 'Capture allows clamped movement outside rail');
    await page.mouse.up();
    await preview.waitFor({ state: 'hidden' });
    await drawer.waitFor();
    await icons.first().focus();
    await page.mouse.move(navX, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(navX, z.y + z.height / 2);
    await page.mouse.up();
    assert.equal(await drawer.locator('[data-launchpad-initial="Z"]').first()
      .evaluate(element => document.activeElement === element), true, 'Alphabet release transfers keyboard focus to its target');
    await letter('Z').focus();
    await page.keyboard.press('Enter');
    assert.ok(await top() > 1000, 'Keyboard letter activation remains available');

    await reset();
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: points.map(([x, y, id = 1]) => ({ x, y, id })),
    });
    icon = await icons.first().boundingBox();
    const tx = icon.x + icon.width / 2;
    const ty = icon.y + 60;
    await touch('touchStart', [[tx, ty]]);
    for (const dy of [20, 45, 80, 115]) await touch('touchMove', [[tx, ty - dy]]);
    await touch('touchEnd', []);
    const touchRelease = await top();
    await page.waitForTimeout(180);
    assert.ok(await top() > 50, 'Native touch scroll starts on icons');
    assert.ok(await top() > touchRelease, 'Native touch scrolling keeps browser inertia after release');
    await drawer.waitFor();
    assert.equal(context.pages().length, 1);
    // Stop native inertia with another touch, then exercise reverse direction.
    const middleY = rect.y + rect.height / 2;
    await touch('touchStart', [[blank.x, middleY]]);
    await touch('touchEnd', []);
    const beforeReverse = await top();
    await touch('touchStart', [[blank.x, middleY]]);
    for (const dy of [25, 55, 85]) await touch('touchMove', [[blank.x, middleY + dy]]);
    await touch('touchEnd', []);
    await page.waitForTimeout(100);
    assert.ok(await top() < beforeReverse, 'Native downward swipe scrolls back up');

    // Touch rail uses its own non-scrolling gesture.
    await touch('touchStart', [[navX, a.y + a.height / 2]]);
    await touch('touchMove', [[navX, z.y + z.height / 2]]);
    assert.equal(await preview.textContent(), 'Z');
    await touch('touchCancel', []);
    await preview.waitFor({ state: 'hidden' });
    await drawer.waitFor();
    await touch('touchStart', [[navX, a.y + a.height / 2]]);
    await touch('touchStart', [[navX, a.y + a.height / 2, 1], [navX - 80, a.y + 20, 2]]);
    await touch('touchEnd', []);
    await preview.waitFor({ state: 'hidden' });
    await drawer.waitFor();
    const input = drawer.locator('input');
    await input.fill('Site');
    assert.equal(await drawer.locator('[data-launchpad-alphabet]').count(), 0);
    await input.blur();
    await mouseDrag(blank, -120);
    assert.ok(await top() > 50, 'Search results also support dragging');
    await input.fill('A Site 00');
    assert.equal(await top(), 0, 'Search changes interrupt inertia and reset position');
    await input.fill('');
    await input.blur();
    await reset();
    await page.mouse.click(blank.x, blank.y);
    await drawer.waitFor({ state: 'hidden' });
    await open();
    await drawer.waitFor();
    assert.equal(await readAssets(), baseline,
      'Gestures do not mutate assets');
    const popPromise = context.waitForEvent('page');
    await icons.first().click();
    const popup = await popPromise;
    await popup.waitForLoadState();
    assert.equal(popup.url(), 'https://example.org/0/0', 'Stationary icon clicks still open the bookmark');
    await popup.close();
    await drawer.waitFor({ state: 'hidden' });
    await open();
    const touchPopupPromise = context.waitForEvent('page');
    await icons.first().tap();
    const touchPopup = await touchPopupPromise;
    await touchPopup.waitForLoadState();
    assert.equal(touchPopup.url(), 'https://example.org/0/0', 'Stationary icon taps still open the bookmark');
    await touchPopup.close();
    await drawer.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS launchpad gestures ${width}x${height} ${language} ${dark ? 'dark' : 'light'}`);
  }
} finally {
  await browser?.close();
  await server.close();
}

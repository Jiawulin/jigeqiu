import assert from 'node:assert/strict';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
  for (const gutter of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
    await context.route('https://**/*', route => route.abort());
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.scrollOwnershipTrace = [];
      window.scrollOwnershipEvents = [];
      const record = (kind, element, value) => {
        if (!document.querySelector('[data-panel="launchpad"]')) return;
        window.scrollOwnershipTrace.push({
          kind, value, at: performance.now(),
          target: element?.dataset?.launchpadBookmark ?? element?.dataset?.launchpadLetter ?? element?.className,
          stack: new Error().stack,
        });
        if (window.scrollOwnershipTrace.length > 200) window.scrollOwnershipTrace.shift();
      };
      const top = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
      Object.defineProperty(Element.prototype, 'scrollTop', {
        ...top, set(value) { record('scrollTop', this, value); top.set.call(this, value); },
      });
      const into = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (...args) {
        record('scrollIntoView', this, args);
        return into.apply(this, args);
      };
      document.addEventListener('pointerdown', event => {
        if (document.querySelector('[data-panel="launchpad"]')) {
          window.scrollOwnershipEvents.push({ x: event.clientX, y: event.clientY, prevented: event.defaultPrevented });
        }
      });
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('jipage_bookmarks_v1', JSON.stringify(Array.from({ length: 364 }, (_, i) => ({
        id: `ownership-${i}`, title: `${String.fromCharCode(65 + Math.floor(i / 14))} Site ${i}`,
        url: `https://site${i}.example.org/`, domain: `site${i}.example.org`, category: '',
        iconMode: 'text', keywords: [], notes: '', tags: [], collectionIds: [], order: i,
        pinnedToDesktop: false, createdAt: 1, updatedAt: 1,
      }))));
      localStorage.setItem('jipage_settings_v1', JSON.stringify({ language: 'en', appearanceMode: 'light-glass' }));
    });
    await page.reload();
    await page.keyboard.press('Control+Shift+Space');
    const drawer = page.locator('[data-panel="launchpad"]');
    await drawer.waitFor();
    const scroll = page.getByTestId('launchpad-scroll');
    if (gutter) await scroll.evaluate(element => { element.style.scrollbarGutter = 'stable'; });
    const position = () => scroll.evaluate(element => element.scrollTop);
    try {
      for (const keyboard of [false, true]) {
        const letter = drawer.locator('[data-launchpad-letter="M"]');
        if (keyboard) {
          await letter.focus();
          await page.keyboard.press('Enter');
        } else await letter.click();
        await page.waitForTimeout(80);
        const located = await position();
        if (keyboard) {
          await scroll.hover();
          await page.mouse.wheel(0, 300);
          await page.waitForTimeout(400);
        }
        const wheeled = await position();
        if (keyboard) assert.ok(wheeled >= located + 250, 'Wheel can leave an alphabet target');
        await page.waitForTimeout(200);
        assert.equal(await position(), wheeled, 'Alphabet highlight must not pull wheel scrolling back');

        const geometry = await scroll.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return {
            x: rect.right - 2, y: rect.top + element.scrollTop * element.clientHeight / element.scrollHeight
              + Math.max(18, element.clientHeight ** 2 / element.scrollHeight) / 2,
            left: rect.left, top: rect.top, height: rect.height,
            gutter: element.offsetWidth - element.clientWidth,
          };
        });
        await page.evaluate(() => { window.scrollOwnershipTrace = []; window.scrollOwnershipEvents = []; });
        await page.mouse.move(geometry.x, geometry.y);
        await page.mouse.down();
        await page.mouse.move(geometry.x, geometry.y + 100, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(250);
        const thumb = await position();
        const trace = await page.evaluate(() => ({
          writes: window.scrollOwnershipTrace, events: window.scrollOwnershipEvents,
        }));
        console.log(`SCROLLBAR ${JSON.stringify({ gutter, keyboard, geometry, located, wheeled, thumb })}`);
        assert.ok(thumb > wheeled + 100, 'Dragging the container scrollbar moves down after alphabet navigation');
        assert.ok(!trace.events.some(event => event.prevented), 'Native scrollbar presses must not be prevented by content dragging');
        assert.deepEqual(trace.writes, [], 'Native scrollbar movement must not trigger script position writes');
        await page.waitForTimeout(200);
        assert.equal(await position(), thumb, 'Container scrollbar position must not snap back to the alphabet target');

        await page.mouse.move(geometry.left + 2, geometry.top + geometry.height * 0.65);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++) {
          await page.waitForTimeout(16);
          await page.mouse.move(geometry.left + 2, geometry.top + geometry.height * 0.65 - i * 16);
        }
        await page.mouse.up();
        const release = await position();
        await page.waitForTimeout(600);
        assert.ok(await position() > release + 40, 'Content drag keeps inertia after alphabet and scrollbar interaction');
      }
      console.log(`PASS scroll ownership gutter=${gutter}`);
    } catch (error) {
      console.log('SCROLL WRITERS', JSON.stringify(await page.evaluate(() => window.scrollOwnershipTrace), null, 2));
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
}

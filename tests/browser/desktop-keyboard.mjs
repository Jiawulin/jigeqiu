import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
const screenshots = process.env.SCREENSHOT_DIR ?? 'test-results/screenshots/desktop-keyboard';
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(8000);
  await context.route('https://**/*', route => route.fulfill({ body: 'Synthetic destination' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('jipage_bookmarks_v1', JSON.stringify(Array.from({ length: 80 }, (_, i) => ({
      id: `key-${i}`, title: `Keyboard site ${i}`, url: `https://example.org/keyboard/${i}`,
      domain: 'example.org', category: 'uncategorized', tags: [], notes: '', keywords: [],
      pinnedToDesktop: false, order: i, collectionIds: [], createdAt: 1, updatedAt: 1,
    }))));
    localStorage.setItem('jipage_settings_v1', JSON.stringify({
      language: 'zh', appearanceMode: 'light-glass', desktopViewMode: 'icon',
      showDock: true, dockIconSize: 48, reduceMotion: true,
    }));
  });
  await page.reload();
  await page.evaluate(async () => {
    const { StorageManager } = await import('/src/services/storage.ts');
    const manager = new StorageManager();
    manager.executeDesktop([
      ...Array.from({ length: 80 }, (_, i) => ({
        type: 'desktop.pin', bookmarkId: `key-${i}`, shortcutId: `key-shortcut-${i}`, to: { kind: 'root', index: i },
      })),
      { type: 'desktop.folder.create', id: 'key-folder', name: 'Keyboard folder', shortcutIds: ['key-shortcut-79'], index: 0 },
    ]);
  });
  await page.reload();
  const viewport = page.getByTestId('desktop-viewport');
  const icons = () => page.locator('[data-active="true"] [data-desktop-id]');
  const ids = () => icons().evaluateAll(elements => elements.map(element => element.dataset.desktopId));
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute('data-desktop-id'));
  const expectFocus = id => page.waitForFunction(id =>
    document.activeElement?.getAttribute('data-desktop-id') === id && !document.activeElement.closest('[inert]'), id);
  let baseline = await page.evaluate(() => localStorage.getItem('jipage_library_v2'));
  await viewport.waitFor();
  for (const arrow of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    await viewport.focus();
    await page.keyboard.press(arrow);
    await expectFocus('key-folder');
  }
  await page.keyboard.press('ArrowRight');
  await expectFocus('key-0');
  await page.keyboard.press('ArrowLeft');
  await expectFocus('key-folder');
  await page.keyboard.press('ArrowLeft');
  await expectFocus('key-folder');
  const columns = await icons().first().evaluate(element =>
    getComputedStyle(element.closest('[data-testid="desktop-grid"]')).gridTemplateColumns.split(' ').length);
  const firstIds = await ids();
  await page.keyboard.press('ArrowDown');
  await expectFocus(firstIds[columns]);
  await page.keyboard.press('ArrowUp');
  await expectFocus('key-folder');
  await page.keyboard.press('Enter');
  const folder = page.getByRole('dialog', { name: '桌面文件夹', exact: true });
  await folder.waitFor();
  await page.keyboard.press('Escape');
  await folder.waitFor({ state: 'hidden' });
  await expectFocus('key-folder');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menu').waitFor();
  await page.keyboard.press('Escape');
  await expectFocus('key-0');
  await page.keyboard.press('Tab');
  assert.equal(await focused(), null, 'Tab leaves the whole icon collection');
  await page.keyboard.press('Shift+Tab');
  await expectFocus('key-0');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await focused(), null, 'Reverse Tab leaves the icon collection');
  await page.keyboard.press('Tab');
  await expectFocus('key-0');
  assert.equal(await icons().evaluateAll(elements => elements.filter(element => element.tabIndex === 0).length), 1);
  assert.equal(await page.locator('[data-active="true"] button[aria-label^="更多操作"]').evaluateAll(elements =>
    elements.every(element => element.tabIndex === -1)), true);
  const popupPromise = context.waitForEvent('page');
  assert.equal(await page.evaluate(() => localStorage.getItem('jipage_library_v2')), baseline,
    'Arrows, Tab and menus do not write assets');
  await page.keyboard.press(' ');
  const popup = await popupPromise;
  await popup.waitForLoadState();
  assert.equal(popup.url(), 'https://example.org/keyboard/0');
  await popup.close();
  const opened = await page.evaluate(() => localStorage.getItem('jipage_library_v2'));
  const openedLibrary = JSON.parse(opened);
  assert.ok(openedLibrary.bookmarks[0].lastUsedAt > 0, 'Activation retains the existing usage timestamp');
  delete openedLibrary.bookmarks[0].lastUsedAt;
  assert.deepEqual(openedLibrary, JSON.parse(baseline), 'Activation changes only the existing usage timestamp');
  baseline = opened;
  await icons().last().focus();
  await page.keyboard.press('ArrowRight');
  const secondIds = await ids();
  assert.notEqual(secondIds[0], firstIds[0]);
  await expectFocus(secondIds[0]);
  await page.keyboard.press('ArrowLeft');
  await expectFocus(firstIds.at(-1));
  await page.getByRole('button', { name: '第 2 屏', exact: true }).click();
  await viewport.focus();
  await page.keyboard.press('ArrowUp');
  await expectFocus(secondIds[0]);
  await page.keyboard.down('ArrowRight');
  await expectFocus(secondIds[1]);
  await page.keyboard.down('ArrowRight');
  await expectFocus(secondIds[1]);
  await page.keyboard.up('ArrowRight');
  await page.getByRole('button', { name: '第 1 屏', exact: true }).click();
  const edit = page.getByRole('button', { name: '编辑桌面', exact: true });
  await edit.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await edit.evaluate(element => element === document.activeElement), true, 'Toolbar keys are not stolen');
  const protection = await page.evaluate(() => {
    const results = [];
    for (const flags of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { shiftKey: true },
      { metaKey: true }, { altKey: true }, { repeat: true }]) {
      document.querySelector('[data-testid="desktop-viewport"]').focus();
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true, ...flags });
      document.activeElement.dispatchEvent(event);
      results.push(event.defaultPrevented);
    }
    return results;
  });
  assert.deepEqual(protection, Array(7).fill(false));
  await edit.click();
  assert.equal(await icons().evaluateAll(elements => elements.every(element => element.tabIndex === 0)), true,
    'Editing retains sequential Tab access');
  await viewport.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await focused(), null, 'Editing retains its existing direction handling');
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('jipage_library_v2')), baseline,
    'Keyboard navigation and editing mode toggles never write assets');

  await mkdir(screenshots, { recursive: true });
  for (const width of [1440, 390, 320]) {
    for (const language of ['zh', 'en']) {
      for (const dark of [false, true]) {
        await page.evaluate(({ language, dark }) => {
          const settings = JSON.parse(localStorage.getItem('jipage_settings_v1'));
          localStorage.setItem('jipage_settings_v1', JSON.stringify({
            ...settings, language, appearanceMode: dark ? 'dark-glass' : 'light-glass',
          }));
        }, { language, dark });
        await page.setViewportSize({ width, height: 1000 });
        await page.reload();
        await viewport.waitFor();
        await viewport.focus();
        await page.keyboard.press('ArrowDown');
        await expectFocus('key-folder');
        await page.keyboard.press('ArrowRight');
        await expectFocus('key-0');
        const geometry = await icons().nth(1).evaluate(element => ({
          focused: element.matches(':focus-visible'),
          shadow: getComputedStyle(element).boxShadow,
          width: document.documentElement.scrollWidth,
          viewport: innerWidth,
        }));
        assert.equal(geometry.focused, true);
        assert.notEqual(geometry.shadow, 'none');
        assert.ok(geometry.width <= geometry.viewport);
        await page.screenshot({ path: `${screenshots}/${width}-${language}-${dark ? 'dark' : 'light'}.png` });
        await page.keyboard.press('Tab');
        assert.equal(await focused(), null);
        await page.keyboard.press('Shift+Tab');
        await expectFocus('key-0');
        const edgeIds = await ids();
        for (const id of [edgeIds[0], edgeIds.at(-1)]) {
          await page.locator(`[data-desktop-id="${id}"]`).focus();
          const ring = await page.locator(`[data-desktop-id="${id}"]`).evaluate(element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const viewport = element.closest('[data-testid="desktop-viewport"]').getBoundingClientRect();
            const shadows = style.boxShadow.split(/,(?![^()]*\))/).filter(shadow => !/rgba?\([^)]*, 0\)/.test(shadow));
            return { shadow: style.boxShadow, inset: shadows.every(shadow => shadow.includes('inset')),
              fits: rect.top >= viewport.top - 0.5 && rect.left >= viewport.left - 0.5
                && rect.right <= viewport.right + 0.5 && rect.bottom <= viewport.bottom + 0.5 };
          });
          assert.equal(ring.inset, true, `All four focus ring edges stay inside the icon: ${ring.shadow}`);
          assert.equal(ring.fits, true, 'Top-left and bottom-right icons fit inside the clipping viewport');
        }
        await page.keyboard.press('Escape');
        await page.screenshot({ path: `${screenshots}/${width}-${language}-${dark ? 'dark' : 'light'}-edge.png` });
      }
    }
  }
  // Repagination while the last desktop icon is focused must repair hidden-page focus.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await icons().last().focus();
  await page.setViewportSize({ width: 320, height: 700 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[inert]')), false);
  assert.ok(await focused(), 'Resize restores focus to a visible icon');
  assert.equal(await page.evaluate(() => localStorage.getItem('jipage_library_v2')), baseline);

  // Render the real component with controlled props to exercise live removals/reorders without storage writes.
  await context.route('**/__keyboard_fixture', async route => route.fulfill({
    contentType: 'text/html',
    body: await server.transformIndexHtml('/__keyboard_fixture', `<html><body><div id="root"></div><script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import { DesktopView } from '/src/components/desktop/DesktopView.tsx';
      const bookmarks = Array.from({length: 6}, (_, i) => ({
        id: 'live-' + i, title: 'Live ' + i, url: 'https://example.org/' + i,
        iconMode: 'text', order: i, createdAt: 1, updatedAt: 1,
      }));
      function Harness() {
        const [order, setOrder] = React.useState(bookmarks.map(b => b.id));
        window.updateDesktopOrder = setOrder;
        const layout = { folders: [], dock: [],
          shortcuts: order.map(id => ({id: 'shortcut-' + id, bookmarkId: id})),
          root: order.map(id => ({kind: 'shortcut', id: 'shortcut-' + id})) };
        return React.createElement(DesktopView, {
          bookmarks, folders: [], plugins: [], viewMode: 'icon', showDock: false,
          desktopLayout: layout, onChangeViewMode() {}, onOpenBookmark() {},
          onOpenTool() {}, onQuickAdd() {}, onUnpinFromDesktop() {},
        });
      }
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
    </script></body></html>`),
  }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(new URL('/__keyboard_fixture', page.url()).href);
  await icons().first().waitFor().catch(error => { throw new Error(`${error.message}\n${errors.join('\n')}`); });
  await page.locator('[data-desktop-id="live-2"]').focus();
  await page.evaluate(() => window.updateDesktopOrder(['live-5', 'live-2', 'live-0', 'live-1', 'live-3', 'live-4']));
  await expectFocus('live-2');
  assert.equal(await page.locator('[data-desktop-id="live-2"]').getAttribute('tabindex'), '0');
  await page.evaluate(() => window.updateDesktopOrder(['live-5', 'live-0', 'live-1', 'live-3', 'live-4']));
  await expectFocus('live-5');
  await page.evaluate(() => window.updateDesktopOrder([]));
  await page.waitForFunction(() => document.querySelectorAll('[data-desktop-id]').length === 0);
  assert.equal(await viewport.getAttribute('tabindex'), '-1', 'Empty desktop adds no pointless Tab stop');
  for (const arrow of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    await viewport.focus();
    await page.keyboard.press(arrow);
    assert.equal(await focused(), null, 'Empty desktop arrows do not invent a selection');
  }
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: '添加收藏', exact: true }).last()
    .evaluate(element => element === document.activeElement), true, 'Empty desktop keeps its add action reachable');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS desktop keyboard: arrows, pages, Tab regions, activation, menus, editing, event protection, resize and 12 visual variants');
} finally {
  await browser?.close();
  await server.close();
}

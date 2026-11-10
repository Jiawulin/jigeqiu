import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
const screenshots = process.env.SCREENSHOT_DIR ?? 'test-results/screenshots';
let browser;

function activeGrid(page) {
  return page.locator('[data-testid="desktop-grid"][data-active="true"], [data-active="true"] [data-testid="desktop-grid"]');
}

async function readLibrary(page) {
  return page.evaluate(() => {
    const combined = localStorage.getItem('jipage_library_v2');
    return combined ? JSON.parse(combined) : {
      bookmarks: JSON.parse(localStorage.getItem('jipage_bookmarks_v1')),
      folders: JSON.parse(localStorage.getItem('jipage_folders_v1')),
    };
  });
}

function assertArchiveUnchanged(actual, expected, action) {
  assert.deepEqual(actual.bookmarks, expected.bookmarks, `${action} preserves every original bookmark field and order`);
  assert.deepEqual(actual.folders, expected.folders, `${action} preserves every archive folder field and membership`);
}

function rootBookmarkOrder(layout) {
  return layout.root.filter(ref => ref.kind === 'shortcut')
    .map(ref => layout.shortcuts.find(shortcut => shortcut.id === ref.id)?.bookmarkId);
}

async function settledPage(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const track = document.querySelector('[data-testid="desktop-viewport"]')?.firstElementChild;
    await Promise.allSettled((track?.getAnimations() ?? []).map(animation => animation.finished));
  });
  await page.waitForFunction(() => {
    const viewport = document.querySelector('[data-testid="desktop-viewport"]');
    const active = viewport?.querySelector('[data-active="true"]');
    return active && Math.abs(active.getBoundingClientRect().left - viewport.getBoundingClientRect().left) < 1;
  });
}

async function dragToPoint(page, source, point) {
  const rect = await source.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 32);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 10, rect.y + 32, { steps: 3 });
  await page.mouse.move(point.x, point.y, { steps: 8 });
  // Chromium enters native drag mode on a move; send another move for dragover.
  await page.mouse.move(point.x, point.y);
}

async function checkLabelBounds(page) {
  await settledPage(page);
  const clipped = await activeGrid(page).locator('[data-desktop-id]').evaluateAll(items => {
    const viewport = document.querySelector('[data-testid="desktop-viewport"]').getBoundingClientRect();
    return items.flatMap(item => {
      const label = item.querySelector(':scope > span');
      if (!label) return [item.dataset.desktopId];
      const bounds = label.getBoundingClientRect();
      const parent = item.getBoundingClientRect();
      return bounds.bottom > viewport.bottom + 1 || bounds.bottom > parent.bottom + 1
        || bounds.left < viewport.left - 1 || bounds.right > viewport.right + 1
        ? [item.dataset.desktopId] : [];
    });
  });
  assert.deepEqual(clipped, [], 'All active-page labels, including the bottom row, fit their items and viewport');
}

async function capacity(page, size) {
  await page.setViewportSize(size);
  await page.waitForFunction(({ width, height }) => {
    const grid = document.querySelector('[data-testid="desktop-grid"][data-active="true"]')
      ?? document.querySelector('[data-active="true"] [data-testid="desktop-grid"]');
    if (!grid || innerWidth !== width || innerHeight !== height) return false;
    return Number(grid.dataset.pageSize) > 0;
  }, size);
  // ResizeObserver and React may commit after the viewport resize event.
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const grid = activeGrid(page);
  assert.equal(await grid.count(), 1, 'Exactly one desktop grid belongs to the active page');
  const result = Number(await grid.getAttribute('data-page-size'));
  assert.ok(Number.isSafeInteger(result) && result > 0, 'Grid exposes a positive capacity');
  assert.ok(await grid.locator('[data-desktop-id]').count() <= result,
    'Active page cannot contain more items than its advertised capacity');
  const geometry = await grid.evaluate(element => {
    const style = getComputedStyle(element);
    const columns = style.gridTemplateColumns.split(' ').length;
    const items = [...element.querySelectorAll('[data-desktop-id]')].map(item => {
      const icon = item.firstElementChild.getBoundingClientRect();
      return { x: icon.x + icon.width / 2, y: icon.y + icon.height / 2 };
    });
    return { columns, items, rowSize: parseFloat(style.gridAutoRows), height: element.getBoundingClientRect().height };
  });
  assert.equal(result, geometry.columns * Math.max(1, Math.floor(geometry.height / geometry.rowSize)),
    'Capacity is calculated from complete square rows in the usable viewport');
  if (geometry.columns > 1 && geometry.items.length > geometry.columns) {
    const first = geometry.items[0];
    const horizontal = geometry.items[1].x - first.x;
    const vertical = geometry.items[geometry.columns].y - first.y;
    assert.ok(Math.abs(horizontal - vertical) < 1, 'Horizontal and vertical icon-center spacing match');
    for (const [index, item] of geometry.items.entries()) {
      assert.ok(Math.abs(item.x - first.x - index % geometry.columns * horizontal) < 1, 'Every column is aligned');
      assert.ok(Math.abs(item.y - first.y - Math.floor(index / geometry.columns) * vertical) < 1, 'Every row is aligned');
    }
  }
  return result;
}

async function openBlankMenu(page) {
  const point = await page.getByTestId('desktop-viewport').evaluate(viewport => {
    const rect = viewport.getBoundingClientRect();
    // Search from the bottom-right so placement is exercised near screen edges.
    for (let y = Math.min(rect.bottom, innerHeight) - 10; y > rect.top + 5; y -= 12) {
      for (let x = Math.min(rect.right, innerWidth) - 10; x > rect.left + 5; x -= 12) {
        const target = document.elementFromPoint(x, y);
        if (target && viewport.contains(target)
          && !target.closest('[data-desktop-id], button, input, a, [role="button"], .dock-container')) {
          return { x, y };
        }
      }
    }
    return null;
  });
  assert.ok(point, 'Desktop must have reachable blank space for its context menu');
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.getByRole('menu', { name: '桌面菜单', exact: true }).waitFor();
}

async function checkMenu(page) {
  const menu = page.getByRole('menu', { name: '桌面菜单', exact: true });
  assert.ok(await menu.getByRole('menuitem').count() >= 2, 'Menu has semantic actions');
  assert.equal(await menu.getByRole('menuitem').evaluateAll(items =>
    items.every(item => item.tagName === 'BUTTON')), true, 'Menu actions are buttons');
  assert.equal(await menu.getByText(/分类|iframe|桌面窗口|窗口打开/i).count(), 0,
    'Desktop menu must not expose category or arbitrary iframe/window actions');
  const bounds = await menu.boundingBox();
  const size = page.viewportSize();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0
    && bounds.x + bounds.width <= size.width + 1
    && bounds.y + bounds.height <= size.height + 1, 'Menu stays within the viewport');
  const dock = page.locator('[data-testid="bottom-dock"], .dock-container').first();
  assert.equal(await dock.isVisible(), true, 'Fixture keeps the Dock visible');
  const dockBounds = await dock.boundingBox();
  assert.ok(dockBounds && bounds.y + bounds.height <= dockBounds.y + 1,
    'Menu stays above the Dock safe area');
}

async function checkKeyboard(page) {
  const focusedAction = () => page.getByRole('menu', { name: '桌面菜单', exact: true })
    .getByRole('menuitem').evaluateAll(items => items.indexOf(document.activeElement));
  await page.keyboard.press('ArrowDown');
  const first = await focusedAction();
  assert.ok(first >= 0, 'ArrowDown focuses a menu action');
  await page.keyboard.press('ArrowDown');
  const second = await focusedAction();
  assert.ok(second >= 0 && second !== first, 'ArrowDown advances menu focus');
  await page.keyboard.press('ArrowUp');
  assert.equal(await focusedAction(), first, 'ArrowUp returns to the previous action');
  await page.keyboard.press('Escape');
  await page.getByRole('menu', { name: '桌面菜单', exact: true }).waitFor({ state: 'hidden' });
}

try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  await context.route('https://**/*', route => route.fulfill({ body: 'Destination' }));
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(origin);
  await page.evaluate(() => {
    localStorage.clear();
    const time = 1700000000000;
    const bookmarks = Array.from({ length: 200 }, (_, index) => ({
      id: `desktop-fixture-${index}`,
      title: index === 0 ? 'Shortcut to preserve' : index === 9
        ? '屏幕边缘的完整网站名称与超长连续文本ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(3)
        : `Desktop bookmark ${index}`,
      url: `https://example.org/desktop/${index}`,
      domain: 'example.org',
      category: 'uncategorized',
      tags: [],
      notes: `Private fixture note ${index}`,
      keywords: [`fixture${index}`],
      folderId: 'desktop-fixture-folder',
      pinnedToDesktop: true,
      order: index,
      collectionIds: [],
      createdAt: time,
      updatedAt: time,
    }));
    bookmarks.push({
      ...bookmarks[0], id: 'library-only-fixture', title: 'Library only fixture',
      url: 'https://example.org/library-only', pinnedToDesktop: false, order: 200,
    });
    localStorage.setItem('jipage_bookmarks_v1', JSON.stringify(bookmarks));
    localStorage.setItem('jipage_folders_v1', JSON.stringify([{
      id: 'desktop-fixture-folder', name: 'Fixture archive',
      bookmarkIds: bookmarks.map(bookmark => bookmark.id),
      pinnedToDesktop: false, order: 0, createdAt: time, updatedAt: time,
    }]));
    localStorage.setItem('jipage_settings_v1', JSON.stringify({
      appearanceMode: 'light-glass', wallpaperPreset: 'cyan-lake',
      desktopViewMode: 'category', defaultSearchEngineId: 'google',
      confirmBatchOpen: true, reduceMotion: true, language: 'zh',
      showDock: true, dockAutoHide: false, dockMagnification: false,
      dockIconSize: 48, dockBookmarkIds: [],
    }));
  });
  await page.reload();
  const library = page.getByRole('banner').getByRole('button', { name: '管理中心', exact: true });
  await library.waitFor();
  await library.click();
  const filter = page.getByPlaceholder('按名称、网址或关键词搜索...');
  await filter.fill('Library only fixture');
  await page.getByRole('main').getByText('Library only fixture', { exact: true }).waitFor();
  await page.getByTitle('点击返回首页桌面').click();

  const legacyLibrary = await readLibrary(page);
  const legacyRaw = await page.evaluate(() => ({
    bookmarks: localStorage.getItem('jipage_bookmarks_v1'),
    folders: localStorage.getItem('jipage_folders_v1'),
  }));
  assert.equal(await page.locator('[data-desktop-id]').count(), 0, 'Legacy flags do not generate desktop icons');
  assert.deepEqual(await readLibrary(page), legacyLibrary, 'Reading the desktop does not save data');
  await page.evaluate(async () => {
    const { StorageManager } = await import('/src/services/storage.ts');
    new StorageManager().setDesktopPins(Array.from({ length: 200 }, (_, i) => `desktop-fixture-${i}`), true);
  });
  await page.reload();
  const converted = await readLibrary(page);
  assertArchiveUnchanged(converted, legacyLibrary, 'Explicit desktop pin seed');
  assert.equal(converted.desktopLayout.shortcuts.length, 200);
  assert.equal(converted.desktopLayout.folders.length, 0, 'An unpinned archive is not a desktop folder');
  assert.deepEqual(rootBookmarkOrder(converted.desktopLayout),
    Array.from({ length: 200 }, (_, i) => `desktop-fixture-${i}`),
  'Explicit pins preserve the requested desktop shortcut order');

  async function checkDockResizeOverflow(key, expectedSize) {
    const dock = page.getByTestId('bottom-dock');
    await dock.locator(':scope > div').first().click({ button: 'right', position: { x: 10, y: 20 } });
    const slider = page.locator('input[type="range"]');
    await slider.focus();
    await slider.press(key);
    await page.waitForFunction(size =>
      JSON.parse(localStorage.getItem('jipage_settings_v1')).dockIconSize === size, expectedSize);
    await page.mouse.click(12, 400);
    await page.evaluate(async () => {
      await new Promise(resolve => setTimeout(resolve, 400));
      window.scrollTo(0, 0);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const bounds = await page.evaluate(() => {
      const viewport = document.querySelector('[data-testid="desktop-viewport"]');
      const dock = document.querySelector('[data-testid="bottom-dock"]');
      return {
        width: innerWidth, height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        desktopBottom: viewport.getBoundingClientRect().bottom,
        dockTop: dock.getBoundingClientRect().top,
      };
    });
    assert.ok(bounds.scrollHeight <= bounds.height + 1,
      `Dock ${expectedSize}px must not create a vertical page scrollbar: ${JSON.stringify(bounds)}`);
    assert.ok(bounds.scrollWidth <= bounds.width + 1, 'Dock resizing must not create horizontal page overflow');
    assert.ok(bounds.desktopBottom <= bounds.dockTop, 'Desktop icons stay above the resized Dock');
    await checkLabelBounds(page);
  }
  await checkDockResizeOverflow('Home', 34);
  await checkDockResizeOverflow('End', 74);
  await page.getByTestId('bottom-dock').locator(':scope > div').first()
    .click({ button: 'right', position: { x: 10, y: 20 } });
  await page.getByRole('button', { name: '恢复默认大小 (48px)' }).click();

  const launchpadDialog = page.getByRole('dialog', { name: '启动台', exact: true });
  const searchDialog = page.getByRole('dialog', { name: '全局搜索', exact: true });
  for (const x of [20, 1420]) {
    await page.mouse.move(x, 500);
    await page.mouse.down();
    await page.mouse.move(x, 390, { steps: 8 });
    await page.mouse.up();
    await launchpadDialog.waitFor();
    await page.keyboard.press('Escape');
    await launchpadDialog.waitFor({ state: 'hidden' });
    await page.mouse.move(x, 390);
    await page.mouse.down();
    await page.mouse.move(x, 500, { steps: 8 });
    await page.mouse.up();
    await searchDialog.waitFor();
    await page.keyboard.press('Escape');
    await searchDialog.waitFor({ state: 'hidden' });
  }

  await page.getByTestId('desktop-viewport').waitFor();
  const wheelTarget = page.getByTestId('desktop-viewport');
  const sendWheel = (dx, dy, extra = {}) => wheelTarget.evaluate((element, { dx, dy, extra }) => {
    const event = new WheelEvent('wheel', { deltaX: dx, deltaY: dy, bubbles: true, cancelable: true, ...extra });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, { dx, dy, extra });
  // Control event timestamps so host scheduling cannot turn a 40ms tail into a new gesture.
  let wheelClock = await page.evaluate(() => performance.now());
  const wheelAt = (dx, at) => wheelTarget.evaluate((element, { dx, at }) => {
    const descriptor = Object.getOwnPropertyDescriptor(performance, 'now');
    Object.defineProperty(performance, 'now', { configurable: true, value: () => at });
    try {
      element.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, bubbles: true, cancelable: true }));
    } finally {
      if (descriptor) Object.defineProperty(performance, 'now', descriptor);
      else delete performance.now;
    }
  }, { dx, at: wheelClock + at });
  assert.equal(await sendWheel(-70, 0), true, 'First-page edge consumes horizontal wheel navigation');
  await page.waitForTimeout(240);
  const initialPage = await page.locator('[data-active="true"] [data-desktop-id]').first().getAttribute('data-desktop-id');
  wheelClock = await page.evaluate(() => performance.now());
  await wheelAt(60, 0);
  await page.waitForFunction(id => document.querySelector('[data-active="true"] [data-desktop-id]')?.getAttribute('data-desktop-id') !== id, initialPage);
  const nextPage = await page.locator('[data-active="true"] [data-desktop-id]').first().getAttribute('data-desktop-id');
  assert.notEqual(nextPage, initialPage, 'Horizontal wheel advances one desktop page');
  for (let index = 0; index < 12; index++) {
    await wheelAt(25, (index + 1) * 40);
    await page.waitForTimeout(40);
  }
  assert.equal(await page.locator('[data-active="true"] [data-desktop-id]').first().getAttribute('data-desktop-id'), nextPage,
    'Momentum lasting longer than the old cooldown still advances only once');
  assert.equal(await sendWheel(0, 20, { ctrlKey: true }), false, 'Pinch zoom remains native');
  await page.waitForTimeout(240);
  await sendWheel(-60, 0);
  await settledPage(page);
  assert.equal(await page.locator('[data-active="true"] [data-desktop-id]').first().getAttribute('data-desktop-id'), initialPage);
  const expectScreen = screen => page.waitForFunction(screen =>
    document.querySelector('nav[aria-label="桌面分页"] [aria-current="page"]')?.getAttribute('aria-label') === `第 ${screen} 屏`, screen);
  await page.getByRole('banner').getByRole('button', { name: '桌面', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expectScreen(1);
  assert.equal(await page.getByRole('banner').getByRole('button', { name: '桌面', exact: true })
    .evaluate(element => document.activeElement === element), true, 'Header controls retain direction keys');
  await wheelTarget.focus();
  await page.keyboard.press('ArrowRight');
  await expectScreen(1);
  assert.equal(await activeGrid(page).locator('[data-desktop-id]').first()
    .evaluate(element => document.activeElement === element), true, 'First arrow selects the first icon');
  await activeGrid(page).locator('[data-desktop-id]').last().focus();
  await page.keyboard.press('ArrowRight');
  await expectScreen(2);
  await page.keyboard.press('ArrowLeft');
  await expectScreen(1);
  await activeGrid(page).locator('[data-desktop-id]').first().focus();
  await page.keyboard.down('ArrowRight');
  const heldId = await page.evaluate(() => document.activeElement?.getAttribute('data-desktop-id'));
  await page.keyboard.down('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-desktop-id')), heldId,
    'Holding an arrow does not continuously navigate');
  await page.keyboard.up('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expectScreen(1);

  const controlProtection = await page.evaluate(async () => {
    const results = [];
    for (const kind of ['input', 'textarea', 'select', 'editable', 'slider', 'tree']) {
      const control = document.createElement(['input', 'textarea', 'select'].includes(kind) ? kind : 'div');
      if (kind === 'editable') control.contentEditable = 'true';
      if (kind === 'slider' || kind === 'tree') { control.setAttribute('role', kind); control.tabIndex = 0; }
      control.style.cssText = 'position:fixed;top:60px;left:10px;width:100px;height:30px';
      document.body.appendChild(control);
      control.focus();
      // Dispatch at window too: focus protection cannot depend solely on event.target.
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      await new Promise(requestAnimationFrame);
      results.push({ kind, prevented: event.defaultPrevented,
        screen: document.querySelector('nav[aria-label="桌面分页"] [aria-current="page"]')?.getAttribute('aria-label') });
      control.remove();
    }
    for (const kind of ['dialog', 'alertdialog', 'menu', 'window']) {
      const overlay = document.createElement('div');
      if (kind === 'window') overlay.className = 'desktop-window';
      else overlay.setAttribute('role', kind);
      overlay.style.cssText = 'position:fixed;top:60px;left:10px;width:100px;height:30px';
      document.body.appendChild(overlay);
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      await new Promise(requestAnimationFrame);
      results.push({ kind, prevented: event.defaultPrevented,
        screen: document.querySelector('nav[aria-label="桌面分页"] [aria-current="page"]')?.getAttribute('aria-label') });
      overlay.remove();
    }
    for (const flags of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true },
      { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true, ...flags });
      window.dispatchEvent(event);
      await new Promise(requestAnimationFrame);
      results.push({ kind: JSON.stringify(flags), prevented: event.defaultPrevented,
        screen: document.querySelector('nav[aria-label="桌面分页"] [aria-current="page"]')?.getAttribute('aria-label') });
    }
    return results;
  });
  for (const result of controlProtection) {
    assert.equal(result.prevented, false, `${result.kind} keeps its native key handling`);
    assert.equal(result.screen, '第 1 屏', `${result.kind} must not turn the desktop page`);
  }
  const transition = await wheelTarget.locator(':scope > div').first().evaluate(track => track.style.transition);
  assert.match(transition, /transform 220ms/, 'Desktop paging retains the existing 220ms transition');

  wheelClock = await page.evaluate(() => performance.now() + 300);
  await wheelAt(60, 0);
  await expectScreen(2);
  await wheelAt(60, 50);
  await expectScreen(3);
  await wheelAt(-60, 120);
  await expectScreen(2);
  for (const [at, dx] of [[140, -30], [160, -10], [180, -5], [220, -20]]) {
    await wheelAt(dx, at);
    await expectScreen(2);
  }
  await wheelAt(-32, 236);
  await expectScreen(1);
  await wheelAt(-30, 260);
  await expectScreen(1);
  await page.waitForTimeout(700);
  // New physical effort can start before the old momentum has reached tiny deltas.
  wheelClock = await page.evaluate(() => performance.now() + 300);
  const renewedDeltas = [60, 45, 32, 24, 30, 42, 50, 38, 26, 18, 24, 34, 48];
  const renewedScreens = [2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4];
  for (const [index, dx] of renewedDeltas.entries()) {
    await wheelAt(dx, index * 16);
    await expectScreen(renewedScreens[index]);
  }
  for (const screen of [3, 2, 1]) {
    await page.getByRole('button', { name: `第 ${screen} 屏`, exact: true }).click();
    await expectScreen(screen);
  }
  await page.waitForTimeout(600);
  const gradualDeltas = [60, 40, 24, 12, 13, 15, 18, 24, 32, 40, 30, 20, 10, 11, 13, 16, 21, 28, 34];
  for (const direction of [1, -1]) {
    wheelClock = await page.evaluate(() => performance.now() + 300);
    let screen = direction === 1 ? 1 : 4;
    for (const [index, dx] of gradualDeltas.entries()) {
      await wheelAt(dx * direction, index * 16);
      if ([0, 7, 16].includes(index)) screen += direction;
      await expectScreen(screen);
    }
    await page.waitForTimeout(650);
  }
  await settledPage(page);
  const browserBoundary = await page.evaluate(() => {
    const horizontal = new WheelEvent('wheel', { deltaX: -100, bubbles: true, cancelable: true });
    document.body.dispatchEvent(horizontal);
    const vertical = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    document.body.dispatchEvent(vertical);
    return { horizontal: horizontal.defaultPrevented, vertical: vertical.defaultPrevented,
      overscroll: getComputedStyle(document.documentElement).overscrollBehaviorX };
  });
  assert.deepEqual(browserBoundary, { horizontal: true, vertical: false, overscroll: 'none' },
    'Application boundary blocks horizontal navigation without blocking ordinary vertical scrolling');
  const controlScroll = await page.evaluate(() => {
    const control = document.createElement('div');
    control.style.cssText = 'position:fixed;width:100px;overflow-x:auto;top:0;left:0';
    const content = document.createElement('div');
    content.style.cssText = 'width:400px;height:20px';
    control.append(content);
    document.body.append(control);
    const send = (deltaX, ctrlKey = false) => {
      const event = new WheelEvent('wheel', { deltaX, ctrlKey, cancelable: true, bubbles: true });
      control.dispatchEvent(event);
      return event.defaultPrevented;
    };
    control.scrollLeft = 100;
    const interior = send(50);
    control.scrollLeft = 300;
    const edge = send(50);
    const pinch = send(50, true);
    control.remove();
    return { interior, edge, pinch };
  });
  assert.deepEqual(controlScroll, { interior: false, edge: true, pinch: false },
    'Horizontal controls scroll normally internally but cannot chain to browser navigation at their boundary');
  assert.equal(await page.getByTitle(/分类视图|图标视图|列表视图/).count(), 0,
    'No category/view-mode toggle remains, even with legacy category settings');
  const shortCapacity = await capacity(page, { width: 1000, height: 650 });
  const tallCapacity = await capacity(page, { width: 1000, height: 1000 });
  assert.ok(tallCapacity > shortCapacity, 'More viewport height increases desktop capacity');
  const tallColumns = await activeGrid(page).evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  const wideCapacity = await capacity(page, { width: 1440, height: 1000 });
  const wideColumns = await activeGrid(page).evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  assert.ok(wideColumns >= tallColumns, 'More viewport width preserves or increases the number of aligned columns');
  assert.ok(wideCapacity > shortCapacity, 'The larger viewport fits more square-grid items than the compact viewport');
  assert.equal(await page.getByTestId('desktop-viewport')
    .locator('[data-active="true"]').count(), 1, 'Exactly one desktop page is active');

  await openBlankMenu(page);
  await checkMenu(page);
  await checkKeyboard(page);
  await openBlankMenu(page);
  await page.getByRole('menu', { name: '桌面菜单', exact: true })
    .getByRole('menuitem', { name: '添加收藏', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('网址 URL', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await openBlankMenu(page);
  await page.getByRole('menu', { name: '桌面菜单', exact: true })
    .getByRole('menuitem', { name: /全部收藏/ }).click();
  await filter.fill('Library only fixture');
  await page.getByRole('main').getByText('Library only fixture', { exact: true }).waitFor();
  await page.getByTitle('点击返回首页桌面').click();

  const shortcut = activeGrid(page).locator('[data-desktop-id="desktop-fixture-0"]');
  const label = shortcut.locator('[data-desktop-label]');
  await label.waitFor();
  const initialLabel = await label.boundingBox();
  const initialNeighbor = await activeGrid(page).locator('[data-desktop-id="desktop-fixture-1"]').boundingBox();
  assert.equal(await shortcut.getAttribute('title'), null);
  assert.equal(await shortcut.locator('[title]').count(), 0, 'No nested native title competes with the custom label');
  const labelStyle = await label.evaluate(element => {
    const style = getComputedStyle(element);
    return { whiteSpace: style.whiteSpace, overflow: style.overflow, textOverflow: style.textOverflow };
  });
  assert.deepEqual(labelStyle, { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'clip' });
  await shortcut.hover();
  const tip = page.getByRole('tooltip', { name: 'Shortcut to preserve', exact: true });
  await tip.waitFor();
  const expanded = await tip.boundingBox();
  assert.ok(Math.abs(expanded.x - initialLabel.x) < 1 && Math.abs(expanded.y - initialLabel.y) < 1,
    'Expanded name keeps its original text origin');
  assert.ok(expanded.width > initialLabel.width, 'Long name reveals more content on the right');
  assert.deepEqual(await label.boundingBox(), initialLabel, 'Expanding a label does not move the base text');
  assert.deepEqual(await activeGrid(page).locator('[data-desktop-id="desktop-fixture-1"]').boundingBox(), initialNeighbor,
    'Expanding a label does not move adjacent icons');
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: `${screenshots}/desktop-label-light.png` });
  const lightTipColor = await tip.evaluate(element => getComputedStyle(element).backgroundColor);
  await page.evaluate(() => document.documentElement.classList.add('dark', 'dark-glass'));
  assert.notEqual(await tip.evaluate(element => getComputedStyle(element).backgroundColor), lightTipColor,
    'The custom label follows the night theme without moving');
  assert.deepEqual(await tip.boundingBox(), expanded);
  await page.screenshot({ path: `${screenshots}/desktop-label-dark.png` });
  await page.evaluate(() => document.documentElement.classList.remove('dark', 'dark-glass'));
  await page.mouse.move(0, 0);
  await tip.waitFor({ state: 'hidden' });
  await shortcut.focus();
  await tip.waitFor();
  await page.keyboard.press('Escape');
  await tip.waitFor({ state: 'hidden' });
  const edgeShortcut = activeGrid(page).locator('[data-desktop-id="desktop-fixture-9"]');
  const edgeLabel = await edgeShortcut.locator('[data-desktop-label]').boundingBox();
  await edgeShortcut.hover();
  const edgeTip = page.getByRole('tooltip');
  await edgeTip.waitFor();
  const edgeBounds = await edgeTip.boundingBox();
  assert.ok(Math.abs(edgeBounds.x - edgeLabel.x) < 1 && Math.abs(edgeBounds.y - edgeLabel.y) < 1);
  assert.ok(edgeBounds.x + edgeBounds.width <= 1440 - 6, 'Edge label stays within the screen');
  assert.ok(edgeBounds.height > 18, 'Very long edge labels wrap instead of shifting their text origin');
  assert.equal(await edgeTip.evaluate(element => element.scrollWidth <= element.clientWidth), true,
    'Even an unbroken long name stays within the expanded label');
  await page.screenshot({ path: `${screenshots}/desktop-label-edge.png` });
  await page.mouse.move(0, 0);
  await edgeTip.waitFor({ state: 'hidden' });
  await shortcut.click({ button: 'right' });
  await checkMenu(page);
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: `${screenshots}/desktop-ui-menu.png` });
  // Capturing can cause scroll events; reopen if production dismisses its transient menu.
  if (!await page.getByRole('menu', { name: '桌面菜单', exact: true }).isVisible()) {
    await shortcut.click({ button: 'right' });
  }
  const initialDockUnpinActions = await page.getByRole('menu', { name: '桌面菜单', exact: true })
    .getByRole('menuitem', { name: '从任务栏取消固定', exact: true }).count();
  await page.getByRole('menu', { name: '桌面菜单', exact: true })
    .getByRole('menuitem', { name: /从桌面移除快捷方式|从桌面移除/ }).click();
  await page.getByRole('alertdialog', { name: '从桌面移除', exact: true })
    .getByRole('button', { name: '确认移除快捷方式', exact: true }).click();
  await shortcut.waitFor({ state: 'hidden' });
  const saved = await readLibrary(page);
  assertArchiveUnchanged(saved, converted, 'Removing a desktop shortcut');
  const removedShortcut = converted.desktopLayout.shortcuts.find(shortcut => shortcut.bookmarkId === 'desktop-fixture-0');
  assert.deepEqual(saved.desktopLayout, {
    ...converted.desktopLayout,
    shortcuts: converted.desktopLayout.shortcuts.filter(shortcut => shortcut.id !== removedShortcut.id),
    root: converted.desktopLayout.root.filter(ref => ref.kind !== 'shortcut' || ref.id !== removedShortcut.id),
  }, 'Shortcut removal only removes the independent layout shortcut and root reference');
  await library.click();
  await filter.fill('Shortcut to preserve');
  await page.getByRole('main').getByText('Shortcut to preserve', { exact: true }).waitFor();
  await page.getByTitle('点击返回首页桌面').click();
  await page.reload();
  await page.getByTestId('desktop-viewport').waitFor();
  assert.equal(await page.locator('[data-desktop-id="desktop-fixture-0"]').count(), 0,
    'Shortcut removal survives reload');

  const editShortcut = activeGrid(page).locator('[data-desktop-id="desktop-fixture-1"]');
  const beforeEdit = await readLibrary(page);
  const original = beforeEdit.bookmarks.find(bookmark => bookmark.id === 'desktop-fixture-1');
  const settingsBeforeEdit = await page.evaluate(() => localStorage.getItem('jipage_settings_v1'));
  await editShortcut.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑收藏', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑收藏', exact: true });
  assert.equal(await editor.getByLabel('网址 URL', { exact: true }).inputValue(), original.url);
  for (const keyword of original.keywords) await editor.getByRole('button', { name: `移除关键词 ${keyword}`, exact: true }).waitFor();
  await editor.getByLabel('网站名称', { exact: true }).fill('Edited desktop title');
  await page.evaluate(() => {
    window.desktopOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  });
  try {
    await editor.getByRole('button', { name: '保存更改', exact: true }).click();
    await editor.getByRole('alert').filter({ hasText: '空间不足' }).waitFor();
    assert.equal(await editor.getByLabel('网站名称', { exact: true }).inputValue(), 'Edited desktop title',
      'Quota failure keeps the edit draft open');
    assert.equal(await editor.getByLabel('网址 URL', { exact: true }).inputValue(), original.url);
    for (const keyword of original.keywords) await editor.getByRole('button', { name: `移除关键词 ${keyword}`, exact: true }).waitFor();
    assert.deepEqual(await readLibrary(page), beforeEdit, 'Failed desktop edit cannot change stored data');
  } finally {
    await page.evaluate(() => { Storage.prototype.setItem = window.desktopOriginalSetItem; });
  }
  await editor.getByRole('button', { name: '保存更改', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  await editShortcut.getByText('Edited desktop title', { exact: true }).waitFor();
  const afterEdit = await readLibrary(page);
  const edited = afterEdit.bookmarks.find(bookmark => bookmark.id === original.id);
  assert.deepEqual(edited, { ...original, iconMode: 'auto', title: 'Edited desktop title', updatedAt: edited.updatedAt },
    'Title edit preserves URL, folderId, notes, keywords, pins, ID and creation time');
  assert.deepEqual(afterEdit.folders, beforeEdit.folders, 'Title edit preserves folder membership order');
  assert.deepEqual(afterEdit.desktopLayout, beforeEdit.desktopLayout, 'Title edit preserves the independent desktop layout');
  assert.deepEqual(afterEdit.bookmarks.filter(bookmark => bookmark.id !== original.id),
    beforeEdit.bookmarks.filter(bookmark => bookmark.id !== original.id), 'Title edit preserves all other bookmarks');
  assert.equal(await page.evaluate(() => localStorage.getItem('jipage_settings_v1')), settingsBeforeEdit,
    'Desktop edit preserves Dock and other settings');
  await page.reload();
  await activeGrid(page).getByText('Edited desktop title', { exact: true }).waitFor();

  const pagination = page.getByRole('navigation', { name: '桌面分页', exact: true });
  const paginationColor = await pagination.evaluate(el => ({
    actual: getComputedStyle(el).color,
    expected: getComputedStyle(el).getPropertyValue('--wallpaper-label').trim(),
  }));
  assert.ok(paginationColor.actual === 'rgb(248, 250, 252)' || paginationColor.actual === 'rgb(242, 245, 244)',
    `Pagination uses the light wallpaper foreground (${paginationColor.expected})`);
  assert.equal(await pagination.locator('[aria-current="page"] span').evaluate(el => getComputedStyle(el).opacity), '1');
  assert.equal(await pagination.locator('button[aria-label]:not([aria-current]) span').first()
    .evaluate(el => getComputedStyle(el).opacity), '0.4', 'Other page dots remain dimmer');
  const firstPageIds = await activeGrid(page).locator('[data-desktop-id]')
    .evaluateAll(items => items.map(item => item.dataset.desktopId));
  await pagination.getByTitle('下一页', { exact: true }).click();
  await pagination.getByRole('button', { name: '第 2 屏', exact: true })
    .and(page.locator('[aria-current="page"]')).waitFor();
  await settledPage(page);
  const secondPageIds = await activeGrid(page).locator('[data-desktop-id]')
    .evaluateAll(items => items.map(item => item.dataset.desktopId));
  assert.ok(secondPageIds.length > 0 && secondPageIds.every(id => !firstPageIds.includes(id)),
    'Next page displays a different slice without duplicates');
  await checkLabelBounds(page);
  await page.getByTestId('desktop-viewport').focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await activeGrid(page).locator('[data-desktop-id]').first()
    .evaluate(element => document.activeElement === element), true, 'First arrow selects the current page first icon');
  await page.keyboard.press('ArrowLeft');
  await pagination.getByRole('button', { name: '第 1 屏', exact: true })
    .and(page.locator('[aria-current="page"]')).waitFor();
  await settledPage(page);
  assert.deepEqual(await activeGrid(page).locator('[data-desktop-id]')
    .evaluateAll(items => items.map(item => item.dataset.desktopId)), firstPageIds,
  'Keyboard page return restores the original slice');

  const dragSource = await activeGrid(page).locator('[data-desktop-id="desktop-fixture-3"]').boundingBox();
  const leadingTarget = await activeGrid(page).locator('[data-desktop-id="desktop-fixture-1"]').boundingBox();
  await page.mouse.move(dragSource.x + 48, dragSource.y + 32);
  await page.mouse.down();
  await page.mouse.move(dragSource.x + 58, dragSource.y + 32, { steps: 3 });
  await page.mouse.move(leadingTarget.x - 8, leadingTarget.y + 32, { steps: 8 });
  await page.mouse.move(leadingTarget.x - 8, leadingTarget.y + 32);
  const dropSlot = page.getByTestId('desktop-drop-slot');
  await dropSlot.waitFor();
  const dragPreview = page.getByTestId('desktop-drag-preview');
  await dragPreview.waitFor();
  const previewBounds = await dragPreview.boundingBox();
  assert.ok(Math.abs(previewBounds.x + 52 - (leadingTarget.x - 8)) < 1, 'Dragged icon follows the cursor');
  await page.screenshot({ path: `${screenshots}/desktop-drag-insert.png` });
  await page.evaluate(() => document.documentElement.classList.add('dark', 'dark-glass'));
  await page.screenshot({ path: `${screenshots}/desktop-drag-insert-dark.png` });
  await page.evaluate(() => document.documentElement.classList.remove('dark', 'dark-glass'));
  await page.mouse.up();
  await dragPreview.waitFor({ state: 'hidden' });
  await dropSlot.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => {
    const grid = document.querySelector('[data-active="true"] [data-testid="desktop-grid"]');
    return grid?.querySelector('[data-desktop-id]')?.getAttribute('data-desktop-id') === 'desktop-fixture-3';
  });
  const reordered = await readLibrary(page);
  const pinnedOrder = rootBookmarkOrder(reordered.desktopLayout);
  assert.deepEqual(pinnedOrder.slice(0, 3), ['desktop-fixture-3', 'desktop-fixture-1', 'desktop-fixture-2'],
    'Dropping at the leading edge reorders rather than merges');
  assertArchiveUnchanged(reordered, afterEdit, 'Native drag reorder');
  assert.deepEqual(reordered.desktopLayout.shortcuts, afterEdit.desktopLayout.shortcuts,
    'Reorder preserves shortcut identities and sources');
  assert.deepEqual(reordered.desktopLayout.folders, afterEdit.desktopLayout.folders);
  assert.deepEqual(reordered.desktopLayout.dock, afterEdit.desktopLayout.dock);

  const pageSizeBeforeDrop = Number(await activeGrid(page).getAttribute('data-page-size'));
  const expectedPageOrder = pinnedOrder.filter(id => id !== 'desktop-fixture-3');
  expectedPageOrder.splice(pageSizeBeforeDrop, 0, 'desktop-fixture-3');
  await activeGrid(page).locator('[data-desktop-id="desktop-fixture-3"]').dragTo(
    pagination.getByRole('button', { name: '第 2 屏', exact: true }),
  );
  await pagination.getByRole('button', { name: '第 2 屏', exact: true })
    .and(page.locator('[aria-current="page"]')).waitFor();
  await settledPage(page);
  await activeGrid(page).locator('[data-desktop-id="desktop-fixture-3"]').waitFor();
  const pageDropped = await readLibrary(page);
  assert.deepEqual(rootBookmarkOrder(pageDropped.desktopLayout), expectedPageOrder,
  'Forward drop on page 2 dot places the source at the destination page boundary');
  assertArchiveUnchanged(pageDropped, reordered, 'Page-dot drop');
  assert.deepEqual(pageDropped.desktopLayout.shortcuts, reordered.desktopLayout.shortcuts);
  assert.deepEqual(pageDropped.desktopLayout.folders, reordered.desktopLayout.folders);
  assert.deepEqual(pageDropped.desktopLayout.dock, reordered.desktopLayout.dock);
  await page.reload();
  await page.getByTestId('desktop-viewport').waitFor();
  assert.deepEqual(await readLibrary(page), pageDropped, 'Page-dot reorder persists after reload');
  await pagination.getByRole('button', { name: '第 2 屏', exact: true }).click();
  await settledPage(page);
  await activeGrid(page).locator('[data-desktop-id="desktop-fixture-3"]').waitFor();
  await pagination.getByRole('button', { name: '第 1 屏', exact: true }).click();
  await settledPage(page);

  const mergeSource = await activeGrid(page).locator('[data-desktop-id="desktop-fixture-4"]').boundingBox();
  const mergeTarget = activeGrid(page).locator('[data-desktop-id="desktop-fixture-5"]');
  const mergeBounds = await mergeTarget.boundingBox();
  await page.mouse.move(mergeSource.x + 48, mergeSource.y + 32);
  await page.mouse.down();
  await page.mouse.move(mergeSource.x + 58, mergeSource.y + 32, { steps: 3 });
  await page.mouse.move(mergeBounds.x + 48, mergeBounds.y + 32, { steps: 8 });
  await page.mouse.move(mergeBounds.x + 48, mergeBounds.y + 32);
  assert.equal(await mergeTarget.getAttribute('data-drop-state'), null, 'Passing across an icon cannot immediately merge');
  await page.waitForFunction(() =>
    document.querySelector('[data-desktop-id="desktop-fixture-5"]')?.getAttribute('data-drop-state') === 'merge');
  await page.screenshot({ path: `${screenshots}/desktop-drag-merge.png` });
  await page.mouse.up();
  await activeGrid(page).locator('[data-desktop-id="desktop-fixture-4"]').waitFor({ state: 'hidden' });
  await activeGrid(page).locator('[data-desktop-id="desktop-fixture-5"]').waitFor({ state: 'hidden' });
  const merged = await readLibrary(page);
  assertArchiveUnchanged(merged, pageDropped, 'Center-drop desktop merge');
  const newFolder = merged.desktopLayout.folders.find(folder =>
    !pageDropped.desktopLayout.folders.some(old => old.id === folder.id));
  assert.ok(newFolder, 'Center drop creates an independent desktop folder');
  assert.deepEqual(newFolder.shortcutIds.map(id =>
    merged.desktopLayout.shortcuts.find(shortcut => shortcut.id === id)?.bookmarkId),
  ['desktop-fixture-5', 'desktop-fixture-4'], 'Merged folder contains target then source shortcut');
  assert.deepEqual(merged.desktopLayout.shortcuts, pageDropped.desktopLayout.shortcuts,
    'Merge reuses shortcuts without duplicating them');
  assert.deepEqual(merged.desktopLayout.dock, pageDropped.desktopLayout.dock, 'Merge preserves Dock pins');
  const mergedIds = new Set(newFolder.shortcutIds);
  const targetId = pageDropped.desktopLayout.shortcuts.find(shortcut => shortcut.bookmarkId === 'desktop-fixture-5').id;
  const targetIndex = pageDropped.desktopLayout.root.findIndex(ref => ref.kind === 'shortcut' && ref.id === targetId);
  const groupIndex = pageDropped.desktopLayout.root.slice(0, targetIndex)
    .filter(ref => ref.kind !== 'shortcut' || !mergedIds.has(ref.id)).length;
  const expectedRoot = pageDropped.desktopLayout.root.filter(ref => ref.kind !== 'shortcut' || !mergedIds.has(ref.id));
  expectedRoot.splice(groupIndex, 0, { kind: 'desktop-folder', id: newFolder.id });
  assert.deepEqual(merged.desktopLayout.root, expectedRoot, 'Merge replaces only the selected root shortcuts');
  await activeGrid(page).locator(`[data-desktop-id="${newFolder.id}"]`).waitFor();
  await page.reload();
  await activeGrid(page).locator(`[data-desktop-id="${newFolder.id}"]`).waitFor();
  assert.deepEqual(await readLibrary(page), merged, 'Reorder and merge survive reload');
  await checkLabelBounds(page);

  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: `${screenshots}/desktop-ui.png`, fullPage: true });
  await capacity(page, { width: 390, height: 844 });
  const mobile = await page.evaluate(() => {
    const viewport = document.querySelector('[data-testid="desktop-viewport"]').getBoundingClientRect();
    const active = document.querySelector('[data-testid="desktop-grid"][data-active="true"]')
      ?? document.querySelector('[data-active="true"] [data-testid="desktop-grid"]');
    return {
      width: innerWidth,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewport: { left: viewport.left, right: viewport.right },
      items: [...active.querySelectorAll('[data-desktop-id]')].map(item => {
        const rect = item.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      }),
    };
  });
  assert.ok(mobile.scrollWidth <= mobile.width + 1, '390px mobile has no horizontal page overflow');
  assert.ok(mobile.viewport.left >= 0 && mobile.viewport.right <= mobile.width + 1,
    'Mobile desktop viewport fits the screen');
  assert.ok(mobile.items.length > 0 && mobile.items.every(item =>
    item.left >= mobile.viewport.left - 1 && item.right <= mobile.viewport.right + 1),
  'Mobile desktop items fit their viewport');
  await openBlankMenu(page);
  await checkMenu(page);
  await checkKeyboard(page);
  await checkLabelBounds(page);
  const mobileLongName = activeGrid(page).locator('[data-desktop-id="desktop-fixture-1"]');
  await mobileLongName.focus();
  const mobileTip = page.getByRole('tooltip');
  await mobileTip.waitFor();
  const mobileTipBounds = await mobileTip.boundingBox();
  assert.ok(mobileTipBounds.x >= 0 && mobileTipBounds.x + mobileTipBounds.width <= 390 - 6,
    'Keyboard-expanded mobile label stays inside the viewport');
  await page.screenshot({ path: `${screenshots}/desktop-label-mobile.png` });
  await page.keyboard.press('Escape');
  await mobileTip.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '更多操作：Edited desktop title', exact: true }).tap();
  await checkMenu(page);
  await page.screenshot({ path: `${screenshots}/desktop-ui-mobile-menu.png`, fullPage: true });
  await page.getByRole('menuitem', { name: '编辑收藏', exact: true }).tap();
  await editor.getByLabel('网站名称', { exact: true }).waitFor();
  await editor.getByRole('button', { name: '取消', exact: true }).tap();
  await editor.waitFor({ state: 'hidden' });
  await page.screenshot({ path: `${screenshots}/desktop-ui-mobile.png`, fullPage: true });
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  assertArchiveUnchanged(await readLibrary(page), merged, 'Mobile menus and canceled edit');
  assert.deepEqual(await page.evaluate(() => ({
    bookmarks: localStorage.getItem('jipage_bookmarks_v1'),
    folders: localStorage.getItem('jipage_folders_v1'),
  })), legacyRaw, 'Explicit pins and all desktop actions retain the original legacy keys byte-for-byte');
  assert.equal(initialDockUnpinActions, 0,
    'Explicitly empty Dock pins do not automatically pin desktop bookmarks');

  await capacity(page, { width: 1440, height: 1000 });
  await pagination.getByRole('button', { name: '第 1 屏', exact: true }).click();
  await settledPage(page);
  const beforeCancel = await readLibrary(page);
  const cancelSource = activeGrid(page).locator('[data-desktop-id="desktop-fixture-6"]');
  const gapLeft = await activeGrid(page).locator('[data-desktop-id="desktop-fixture-1"]').boundingBox();
  const gapRight = await activeGrid(page).locator('[data-desktop-id="desktop-fixture-2"]').boundingBox();
  const gap = { x: (gapLeft.x + gapLeft.width + gapRight.x) / 2, y: gapLeft.y + 32 };
  await dragToPoint(page, cancelSource, gap);
  await dropSlot.waitFor();
  const slotBounds = await dropSlot.boundingBox();
  assert.ok(slotBounds.x < gap.x && slotBounds.x + slotBounds.width > gap.x,
    'A visible container occupies the gap between neighboring icons');
  await page.screenshot({ path: `${screenshots}/desktop-drag-between.png` });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await dropSlot.waitFor({ state: 'hidden' });
  await dragPreview.waitFor({ state: 'hidden' });
  assert.deepEqual(await readLibrary(page), beforeCancel, 'Escape cancels the drag without changing stored order');

  const folderLocator = activeGrid(page).locator(`[data-desktop-id="${newFolder.id}"]`);
  const folderBounds = await folderLocator.boundingBox();
  await dragToPoint(page, cancelSource, { x: folderBounds.x + 48, y: folderBounds.y + 32 });
  await page.waitForFunction(id =>
    document.querySelector(`[data-desktop-id="${id}"]`)?.getAttribute('data-drop-state') === 'merge', newFolder.id);
  await page.mouse.up();
  await cancelSource.waitFor({ state: 'hidden' });
  const afterFolderDrop = await readLibrary(page);
  assertArchiveUnchanged(afterFolderDrop, beforeCancel, 'Dropping into an existing desktop folder');
  assert.equal(afterFolderDrop.desktopLayout.folders.find(folder => folder.id === newFolder.id).shortcutIds.length,
    newFolder.shortcutIds.length + 1, 'Existing folder receives the dragged shortcut once');

  await pagination.locator('button[aria-label^="第 "]').last().click();
  await settledPage(page);
  const trailingItems = activeGrid(page).locator('[data-desktop-id]');
  const trailingId = await trailingItems.first().getAttribute('data-desktop-id');
  const lastBounds = await trailingItems.last().boundingBox();
  await dragToPoint(page, trailingItems.first(), {
    x: lastBounds.x + lastBounds.width + 8, y: lastBounds.y + 32,
  });
  await dropSlot.waitFor();
  await page.mouse.up();
  const afterTrailingDrop = await readLibrary(page);
  assert.equal(rootBookmarkOrder(afterTrailingDrop.desktopLayout).at(-1), trailingId,
    'Trailing blank space inserts at the end of the desktop sequence');
  assertArchiveUnchanged(afterTrailingDrop, afterFolderDrop, 'Trailing empty-cell drop');
  assert.deepEqual(errors, [], 'No uncaught browser errors after drag boundaries');
  console.log('PASS: explicit desktop pins; desktop library navigation, responsive capacity/label bounds, Dock fallback and safe menus, keyboard/Escape/pages, layout-only shortcut removal/reorder/page-dot drop/merge with unchanged bookmark/archive arrays, atomic title edit/quota draft, reload and mobile touch menus; screenshots');
} finally {
  await browser?.close();
  await server.close();
}

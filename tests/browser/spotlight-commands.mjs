import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
  await context.route('https://**/*', route => route.fulfill({ body: 'Destination' }));
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('jipage_bookmarks_v1', '[]');
    localStorage.setItem('jipage_folders_v1', '[]');
    localStorage.setItem('jipage_search_engines_v1', JSON.stringify([
      { id: 'google', name: 'Google', keyword: 'g', urlTemplate: 'https://www.google.com/search?q={query}', isEnabled: true },
      { id: 'custom', name: 'Custom Search', keyword: 'search', urlTemplate: 'https://custom.example.test/?q={query}', isEnabled: true },
      { id: 'second', name: 'Second Search', keyword: 'search', urlTemplate: 'https://second.example.test/?q={query}', isEnabled: true },
    ]));
  });
  await page.reload();
  const dialog = page.getByRole('dialog', { name: '全局搜索', exact: true });
  const input = dialog.getByRole('combobox');
  const guide = page.getByRole('dialog', { name: '使用指南', exact: true });
  const searchTrigger = page.getByRole('button', { name: /^(打开搜索|Open search)$/ });
  for (const method of ['keyboard', 'mouse']) {
    await searchTrigger.click();
    await input.fill('/HELP');
    const result = dialog.getByRole('option').filter({ hasText: '使用指南' });
    await result.waitFor();
    assert.equal(await result.getAttribute('aria-selected'), 'true', 'The default command is visibly selected before Enter');
    assert.equal(await input.getAttribute('aria-activedescendant'), await result.getAttribute('id'));
    if (method === 'keyboard') await input.press('Enter');
    else await result.click();
    await guide.waitFor();
    assert.equal(await dialog.count(), 0, 'Help replaces search instead of stacking panels');
    assert.equal(new URL(page.url()).hash, '#/', 'Help is a transient panel');
    assert.equal(await guide.evaluate(element => element.contains(document.activeElement)), true);
    await guide.getByRole('tab', { name: '快捷指令', exact: true }).click();
    await guide.locator('dt code').filter({ hasText: /^\/help$/ }).waitFor();
    await page.keyboard.press('Control+k');
    assert.equal(await dialog.count(), 0, 'Help blocks search shortcuts');
    if (method === 'keyboard') await page.keyboard.press('Escape');
    else await guide.getByRole('button', { name: '关闭', exact: true }).click();
    await guide.waitFor({ state: 'hidden' });
    assert.equal(await searchTrigger.evaluate(element => element === document.activeElement), true,
      'Closing command-opened help restores focus to the original search trigger');
  }
  await searchTrigger.click();
  await input.fill('/help');
  await input.press('Enter');
  await guide.waitFor();
  await page.evaluate(() => { location.hash = '#/library'; });
  await page.getByRole('heading', { name: '全部收藏', exact: true }).waitFor();
  await guide.waitFor({ state: 'hidden' });
  await page.goBack();
  await searchTrigger.waitFor();
  assert.equal(await guide.count(), 0, 'Leaving the desktop clears help state rather than reopening it on return');
  await page.getByRole('button', { name: /^(打开搜索|Open search)$/ }).click();
  await input.fill('/add');
  await dialog.getByRole('button', { name: /切换搜索引擎/ }).click();
  await input.focus();
  await input.press('Enter');
  assert.equal(await dialog.isVisible(), true, 'Engine picker cannot execute hidden system commands');
  assert.equal(await dialog.getByRole('group', { name: '搜索引擎', exact: true }).isVisible(), true);
  await page.keyboard.press('Escape');
  await input.fill('/all');
  await dialog.getByRole('option').filter({ hasText: '全部收藏管理' }).waitFor();
  await input.fill('/search');
  assert.equal(await dialog.getByRole('option').count(), 3, 'System and all colliding engines coexist');
  const options = dialog.getByRole('option');
  assert.equal(await options.first().getAttribute('aria-selected'), 'true');
  await input.press('ArrowDown');
  assert.equal(await options.nth(1).getAttribute('aria-selected'), 'true', 'Down moves from the default to the second result');
  await input.press('ArrowUp');
  assert.equal(await options.first().getAttribute('aria-selected'), 'true');
  await input.dispatchEvent('compositionstart');
  await input.dispatchEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true });
  assert.equal(await dialog.isVisible(), true, 'IME confirmation must not execute the selected command');
  await input.dispatchEvent('compositionend');
  await input.fill('/all');
  assert.equal(await dialog.getByRole('option').first().getAttribute('aria-selected'), 'true', 'Editing input resets selection');
  await input.fill('/search');
  await mkdir('test-results/screenshots', { recursive: true });
  await dialog.screenshot({ path: 'test-results/screenshots/spotlight-commands.png' });
  await page.setViewportSize({ width: 320, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await dialog.screenshot({ path: 'test-results/screenshots/spotlight-commands-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await input.press('Tab');
  assert.equal(await dialog.getByRole('option').first().evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(await dialog.getByRole('option').nth(1).evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await input.evaluate(e => e === document.activeElement), true);
  await input.fill('/s');
  assert.equal(await dialog.getByRole('option').filter({ hasText: '系统指令' }).count(), 3);
  await input.fill('/search React');
  assert.equal(await dialog.getByRole('option').count(), 2);
  const popupWaiting = context.waitForEvent('page');
  await input.press('Enter');
  const popup = await popupWaiting;
  await popup.waitForLoadState();
  assert.equal(new URL(popup.url()).hostname, 'custom.example.test');
  assert.equal(new URL(popup.url()).searchParams.get('q'), 'React');
  await popup.close();
  const open = async key => {
    await page.locator('body').click({ position: { x: 5, y: 400 } });
    if (key === '、') await page.locator('body').dispatchEvent('keydown', { key, code: 'Slash', bubbles: true });
    else await page.keyboard.press(key);
    await dialog.waitFor();
    assert.equal(await input.inputValue(), '/');
  };
  await open('/');
  await input.fill('/search');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  assert.match(await dialog.locator('[role="option"][aria-selected="true"]').textContent(), /Second Search/);
  await input.press('Enter');
  assert.equal(await dialog.isVisible(), true, 'Bare engine stays open for a query');
  assert.equal(await input.inputValue(), '', 'Bare command clears after switching the visible search engine');
  await dialog.getByRole('button', { name: '切换搜索引擎：Second Search', exact: true }).waitFor();
  assert.equal(await input.evaluate(element => element === document.activeElement), true);
  assert.equal(await dialog.getByRole('button', { name: '搜索', exact: true }).isDisabled(), true);
  const secondWaiting = context.waitForEvent('page');
  await input.pressSequentially('TypeScript');
  await input.press('Enter');
  const secondPopup = await secondWaiting;
  await secondPopup.waitForLoadState();
  assert.equal(new URL(secondPopup.url()).hostname, 'second.example.test', 'Chosen duplicate engine remains active for the query');
  await secondPopup.close();
  await page.getByRole('search', { name: '桌面搜索', exact: true })
    .getByRole('button', { name: '切换搜索引擎：Google', exact: true }).waitFor();
  await open('、');
  assert.equal(await dialog.getByRole('option').filter({ hasText: '系统指令' }).count(), 10);
  await input.fill('/start');
  await input.press('Enter');
  const launchpad = page.getByRole('dialog', { name: '启动台', exact: true });
  await launchpad.waitFor();
  assert.equal(await dialog.count(), 0, 'Launchpad replaces search');
  await launchpad.getByRole('searchbox').waitFor({ state: 'visible' });
  assert.equal(await launchpad.getByRole('searchbox').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Escape');
  await launchpad.waitFor({ state: 'hidden' });
  for (const [command, mode] of [['dark', 'dark-glass'], ['dark', 'dark-glass'], ['light', 'light-glass'], ['light', 'light-glass']]) {
    await page.getByRole('button', { name: /^(打开搜索|Open search)$/ }).click();
    await input.fill(`/${command}`);
    await input.press('Enter');
    assert.equal(await dialog.count(), 0, 'Mode command closes search');
    assert.equal(await page.evaluate(() => location.hash), '#/');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_settings_v1')).appearanceMode), mode);
    assert.equal(await page.locator('.dark').count() > 0, mode === 'dark-glass');
    await page.reload();
    await page.getByRole('button', { name: /^(打开搜索|Open search)$/ }).waitFor();
    assert.equal(await page.locator('.dark').count() > 0, mode === 'dark-glass', 'Mode survives reload');
  }
  await page.getByRole('button', { name: /^(打开搜索|Open search)$/ }).click();
  await input.fill('/add');
  await input.press('Enter');
  const addDialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: /网址/ }) });
  await addDialog.waitFor();
  await addDialog.getByRole('textbox', { name: /网址/ }).fill('https://example.test/');
  await page.keyboard.press('/');
  assert.equal(await dialog.count(), 0, 'Editing and open dialogs block single-key invocation');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /^(打开搜索|Open search)$/ }).click();
  await input.fill('/all');
  await input.press('Enter');
  await page.getByRole('heading', { name: '全部收藏', exact: true }).waitFor();
  assert.equal(await dialog.count(), 0);
  await page.keyboard.press('/');
  assert.equal(await dialog.count(), 0, 'Non-desktop pages cannot invoke single-key search');
  for (const [command, heading, hash] of [
    ['setting', '外观与壁纸个性化', '#/settings/appearance'],
    ['theme', '外观与壁纸个性化', '#/settings/appearance'],
    ['trash', '回收站', '#/trash'],
    ['search', '自定义搜索引擎管理', '#/settings/search-engines'],
  ]) {
    await page.getByTitle('点击返回首页桌面', { exact: true }).click();
    await page.getByRole('button', { name: /^(打开搜索|Open search)$/ }).click();
    await input.fill(`/${command}`);
    await input.press('Tab');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: heading, exact: true, ...(command === 'trash' ? { level: 1 } : {}) }).waitFor();
    assert.equal(await page.evaluate(() => location.hash), hash);
  }
  await page.getByTitle('点击返回首页桌面', { exact: true }).click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const command of ['dark', 'light']) {
      await page.getByRole('button', { name: /^(打开搜索|Open search)$/ }).click();
      await input.fill(`/${command}`);
      await dialog.getByRole('option').click();
      await page.getByRole('button', { name: /^(打开搜索|Open search)$/ }).click();
      await input.fill('/');
      assert.equal(await dialog.getByRole('option').filter({ hasText: '系统指令' }).count(), 10);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await dialog.screenshot({ path: `test-results/screenshots/spotlight-shortcuts-${width}-${command}.png` });
      await page.keyboard.press('Escape');
    }
  }
  await page.getByRole('banner').getByRole('button', { name: '切换为英文', exact: true }).click();
  await page.getByRole('button', { name: /^(打开搜索|Open search)$/ }).click();
  for (const [command, title] of [
    ['start', 'Launchpad'], ['trash', 'Recycle bin'], ['theme', 'Appearance settings'],
    ['dark', 'Night mode'], ['light', 'Day mode'], ['help', 'User guide'],
  ]) {
    await input.fill(`/${command}`);
    await dialog.getByRole('option').filter({ hasText: title }).waitFor();
  }
  await page.keyboard.press('Escape');
  await page.getByRole('banner').getByRole('button', { name: 'Switch to Chinese', exact: true }).click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'jipage_settings_v1') throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: /^(打开搜索|Open search)$/ }).click();
  await input.fill('/dark');
  await input.press('Enter');
  await page.getByText('浏览器存储空间不足，设置变更未保存。请释放空间后重试。', { exact: true }).waitFor();
  assert.equal(await page.locator('.dark').count(), 0, 'Failed save does not publish night mode');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jipage_settings_v1')).appearanceMode), 'light-glass');
  assert.deepEqual(errors, []);
  console.log('PASS ten commands, help keyboard/mouse/focus, launchpad, routes, explicit modes/reload/quota failure, mobile/i18n, collisions and keyboard navigation');
} finally {
  await browser?.close();
  await server.close();
}

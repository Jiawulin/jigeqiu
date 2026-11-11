import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? 'playwright'
);
const root = fileURLToPath(new URL('../../', import.meta.url));
const extension = path.join(root, 'dist-extension');
const profile = await mkdtemp(
  path.join(os.tmpdir(), 'jigeqiu-extension-browser-'),
);
let context;
async function launch(directory) {
  const browser = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    locale: 'zh-CN',
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
    viewport: { width: 1440, height: 1000 },
    args: [
      `--disable-extensions-except=${directory}`,
      `--load-extension=${directory}`,
    ],
  });
  await browser.route(/^https?:/, async (route) => {
    const url = new URL(route.request().url());
    if (
      ['example.org', 'manual-image.test'].includes(url.hostname) &&
      /\.(ico|png)$/.test(url.pathname)
    ) {
      await route.fulfill({
        contentType: 'image/png',
        body: await readFile(path.join(extension, 'icons/icon-128.png')),
      });
    } else await route.abort();
  });
  return browser;
}
try {
  context = await launch(extension);
  const page = await context.newPage();
  const errors = [];
  const cspErrors = [];
  const corsErrors = [];
  const remoteRequests = [];
  context.on('request', (request) => {
    if (/^https?:/.test(request.url()))
      remoteRequests.push({ url: request.url(), type: request.resourceType() });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/content security policy|violates.*directive/i.test(message.text()))
      cspErrors.push(message.text());
    if (/blocked by CORS|Access-Control-Allow-Origin/i.test(message.text()))
      corsErrors.push(message.text());
  });
  page.setDefaultTimeout(15000);
  await page.goto('chrome://newtab/');
  const screenshots = path.join(root, 'test-results/extension');
  await mkdir(screenshots, { recursive: true });
  await page
    .getByRole('heading', { name: '使用前的隐私告知', exact: true })
    .waitFor();
  await page.goto(
    await page.evaluate(() => globalThis.chrome.runtime.getURL('index.html')),
  );
  await page
    .getByRole('heading', { name: '使用前的隐私告知', exact: true })
    .waitFor();
  assert.equal(await page.getByRole('main').count(), 1);
  assert.equal(await page.getByRole('banner').count(), 0);
  await page.screenshot({
    path: path.join(screenshots, 'privacy-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: path.join(screenshots, 'privacy-mobile.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await page.locator('[data-site-icon]').count(), 0);
  assert.deepEqual(
    remoteRequests,
    [],
    'No workbench network activity before acknowledgment',
  );
  await page.reload();
  await page
    .getByRole('heading', { name: '使用前的隐私告知', exact: true })
    .waitFor();
  await page.getByRole('button', { name: '暂不使用', exact: true }).click();
  assert.equal(await page.getByRole('banner').count(), 0);
  await page.getByRole('button', { name: '返回隐私告知', exact: true }).click();
  const beforePrivacyURL = page.url();
  await page.getByRole('button', { name: '完整隐私说明', exact: true }).click();
  const privacyDialog = page.getByRole('dialog', {
    name: '隐私说明',
    exact: true,
  });
  await privacyDialog.waitFor();
  assert.equal(page.url(), beforePrivacyURL);
  await page.getByRole('heading', { name: '隐私说明', exact: true }).waitFor();
  await page.screenshot({
    path: path.join(screenshots, 'privacy-policy-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await privacyDialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.left >= 0 &&
        rect.right <= innerWidth &&
        rect.top >= 0 &&
        rect.bottom <= innerHeight
      );
    }),
    true,
  );
  await page.screenshot({
    path: path.join(screenshots, 'privacy-policy-mobile.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.deepEqual(
    remoteRequests,
    [],
    'Privacy document uses no external requests',
  );
  await privacyDialog.locator('.privacy-dialog-body').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await privacyDialog
    .getByRole('button', { name: '关闭隐私说明', exact: true })
    .click();
  await privacyDialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('banner').count(), 0);
  await page.getByRole('button', { name: '完整隐私说明', exact: true }).click();
  await page.keyboard.press('Escape');
  await privacyDialog.waitFor({ state: 'hidden' });
  assert.equal(
    await page
      .getByRole('button', { name: '完整隐私说明', exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.evaluate(() => {
    const original = globalThis.chrome.storage.local.set.bind(globalThis.chrome.storage.local);
    globalThis.chrome.storage.local.set = async () => {
      globalThis.chrome.storage.local.set = original;
      throw new Error('QUOTA_BYTES quota exceeded');
    };
  });
  await page.getByRole('button', { name: '知晓并继续', exact: true }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: '无法保存本地告知记录' })
    .waitFor();
  assert.equal(await page.getByRole('banner').count(), 0);
  assert.equal(await page.locator('[data-site-icon]').count(), 0);
  await page.getByRole('button', { name: '知晓并继续', exact: true }).click();
  await page
    .getByRole('dialog', { name: '欢迎使用记个球', exact: true })
    .waitFor();
  const runtime = await page.evaluate(() => ({
    id: globalThis.chrome?.runtime?.id,
    secure: globalThis.isSecureContext,
    locks: typeof navigator.locks?.request,
  }));
  const manifest = JSON.parse(
    await readFile(path.join(extension, 'manifest.json'), 'utf8'),
  );
  const expectedId = createHash('sha256')
    .update(Buffer.from(manifest.key, 'base64'))
    .digest('hex')
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (digit) =>
      String.fromCharCode(97 + parseInt(digit, 16)),
    );
  assert.equal(runtime.id, expectedId);
  assert.equal(runtime.secure, true);
  assert.equal(runtime.locks, 'function');
  assert.equal(manifest.options_ui, undefined);
  assert.equal(
    await page.getByRole('link', { name: '完整备份与恢复' }).count(),
    0,
  );
  await page.getByRole('button', { name: '暂时跳过', exact: true }).click();
  await page.getByRole('button', { name: '隐私说明', exact: true }).click();
  await page.getByRole('heading', { name: '隐私说明', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭隐私说明', exact: true }).click();
  await page.getByRole('banner').waitFor();
  await page.keyboard.press('Control+Shift+Enter');
  const dialog = page.getByRole('dialog', { name: '添加收藏', exact: true });
  await dialog
    .getByLabel('网址 URL', { exact: true })
    .fill('https://example.org/extension-test');
  await dialog
    .getByLabel('网站名称', { exact: true })
    .fill('Extension smoke test');
  assert.equal(
    await dialog
      .getByRole('button', { name: '授权此站点', exact: true })
      .count(),
    0,
  );
  const picker = dialog.getByRole('group', { name: '网站图标', exact: true });
  await picker.getByRole('button', { name: /网站图标/ }).click();
  const online = picker.getByRole('tabpanel', {
    name: '在线候选',
    exact: true,
  });
  await online.getByRole('button').first().waitFor();
  const candidate = new URL(
    await online.locator('img').first().getAttribute('src'),
  );
  assert.equal(candidate.protocol, 'https:');
  assert.equal(candidate.host, 'example.org');
  await online.getByRole('button').first().click();
  assert.equal(
    await online.getByRole('button').first().getAttribute('aria-pressed'),
    'true',
  );
  await picker.getByRole('tab', { name: '图片链接', exact: true }).click();
  await dialog.getByText(/加载远程图片会连接目标网站/).waitFor();
  await picker
    .getByRole('textbox', { name: '图标图片链接' })
    .fill('https://manual-image.test/icon.png');
  await picker.getByRole('button', { name: '使用图片', exact: true }).click();
  await picker
    .locator('[data-site-icon][data-icon-state="ready"] img')
    .waitFor();
  assert.ok(remoteRequests.length > 0);
  assert.ok(
    remoteRequests.some((request) =>
      request.url.startsWith('https://example.org/'),
    ),
    `Original icon discovery must request website icons: ${JSON.stringify(remoteRequests)}`,
  );
  assert.ok(
    remoteRequests.every((request) => request.type !== 'fetch'),
    'Unrequested optional host permissions must prevent all icon and title fetches',
  );
  remoteRequests.length = 0;
  await dialog.getByRole('button', { name: '添加收藏', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const snapshot = await page.evaluate(async () =>
    (await globalThis.chrome.storage.local.get('jigeqiu-extension-state-v1'))['jigeqiu-extension-state-v1'].data.jipage_library_v2,
  );
  assert.ok(
    JSON.parse(snapshot).bookmarks.some(
      (bookmark) => bookmark.title === 'Extension smoke test',
    ),
  );
  const savedBookmark = JSON.parse(snapshot).bookmarks.find(
    (bookmark) => bookmark.title === 'Extension smoke test',
  );
  assert.equal(savedBookmark.iconMode, 'custom');
  assert.equal(savedBookmark.icon, 'https://manual-image.test/icon.png');
  // Recreate a pre-migration installation with a real library and preferences.
  await page.evaluate(async () => {
    const key = 'jigeqiu-extension-state-v1';
    const { data } = (await globalThis.chrome.storage.local.get(key))[key];
    for (const [key, value] of Object.entries(data)) localStorage.setItem(key, value);
    localStorage.setItem('jipage_recent_searches_v1', '["legacy migration"]');
    localStorage.setItem('unrelated', 'leave untouched');
    await globalThis.chrome.storage.local.remove(key);
  });
  await page.reload();
  await page.getByRole('banner').waitFor();
  assert.deepEqual(await page.evaluate(async () => ({
    saved: (await globalThis.chrome.storage.local.get('jigeqiu-extension-state-v1'))['jigeqiu-extension-state-v1'].data.jipage_recent_searches_v1,
    original: localStorage.getItem('jipage_library_v2'),
    unrelated: (await globalThis.chrome.storage.local.get('jigeqiu-extension-state-v1'))['jigeqiu-extension-state-v1'].data.unrelated,
  })), { saved: '["legacy migration"]', original: snapshot, unrelated: undefined });
  assert.equal(await page.locator('img[src*="/_favicon/"]').count(), 0);
  assert.ok(
    !remoteRequests.some((request) => request.url.includes('/s2/favicons')),
    'Google icon provider remains off by default',
  );
  assert.equal(
    await page.evaluate(async () => (await globalThis.chrome.storage.local.get('jigeqiu-extension-state-v1'))['jigeqiu-extension-state-v1'].data.jipage_library_v2),
    snapshot,
  );
  const second = await context.newPage();
  await second.goto('chrome://newtab/');
  await second.getByRole('banner').waitFor();
  assert.equal(
    await second.evaluate(async () => (await globalThis.chrome.storage.local.get('jigeqiu-extension-state-v1'))['jigeqiu-extension-state-v1'].data.jipage_library_v2),
    snapshot,
  );
  // A quota rejection must retain the editor draft and never report a saved bookmark.
  await page.keyboard.press('Control+Shift+Enter');
  const failedDialog = page.getByRole('dialog', { name: '添加收藏', exact: true });
  await failedDialog.getByLabel('网址 URL', { exact: true }).fill('https://example.org/quota-test');
  await failedDialog.getByLabel('网站名称', { exact: true }).fill('Quota draft');
  await page.evaluate(() => {
    const original = globalThis.chrome.storage.local.set.bind(globalThis.chrome.storage.local);
    globalThis.chrome.storage.local.set = async () => {
      globalThis.chrome.storage.local.set = original;
      throw new Error('QUOTA_BYTES quota exceeded');
    };
  });
  await failedDialog.getByRole('button', { name: '添加收藏', exact: true }).click();
  await failedDialog.getByRole('alert').filter({ hasText: /空间不足/ }).waitFor();
  assert.equal(await failedDialog.getByLabel('网站名称', { exact: true }).inputValue(), 'Quota draft');
  await failedDialog.getByRole('button', { name: '添加收藏', exact: true }).click();
  await failedDialog.waitFor({ state: 'hidden' });
  await second.getByText(/其他标签页.*更新收藏库/).first().waitFor();
  await second.close();
  // The authoritative copy survives removal of all old web storage.
  const committed = await page.evaluate(async () =>
    (await globalThis.chrome.storage.local.get('jigeqiu-extension-state-v1'))['jigeqiu-extension-state-v1'].data.jipage_library_v2);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('banner').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('jipage_library_v2')), null);
  const assets = await page.evaluate(async () => {
    const base = globalThis.chrome.runtime.getURL('');
    return Promise.all(
      [
        'brand/logo-a2-equator.png',
        'wallpapers/cyan-lake-desktop.webp',
        'icons/icon-128.png',
      ].map(async (name) => {
        const response = await fetch(base + name);
        return response.ok && (await response.blob()).size > 0;
      }),
    );
  });
  assert.ok(assets.every(Boolean));
  const layout = await page.locator('[data-wallpaper]').evaluate((element) => ({
    position: getComputedStyle(element).position,
    width: element.getBoundingClientRect().width,
  }));
  assert.equal(layout.position, 'relative');
  assert.equal(layout.width, 1440);
  await page.screenshot({
    path: path.join(screenshots, 'desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(screenshots, 'mobile.png'),
    fullPage: true,
  });
  await page.goto(`chrome-extension://${runtime.id}/index.html#/library`);
  await page
    .getByRole('main')
    .getByText('Extension smoke test', { exact: true })
    .waitFor();
  await page.evaluate(async () => {
    const key = 'jigeqiu-extension-state-v1';
    const state = (await globalThis.chrome.storage.local.get(key))[key];
    state.data['jigeqiu-extension-privacy-acknowledged'] = 'old-version';
    state.revision++;
    await globalThis.chrome.storage.local.set({ [key]: state });
  });
  await page.reload();
  await page
    .getByRole('heading', { name: '使用前的隐私告知', exact: true })
    .waitFor();
  assert.equal(await page.getByRole('banner').count(), 0);
  assert.equal(
    await page.evaluate(async () => (await globalThis.chrome.storage.local.get('jigeqiu-extension-state-v1'))['jigeqiu-extension-state-v1'].data.jipage_library_v2),
    committed,
  );
  await page.getByRole('button', { name: '知晓并继续', exact: true }).click();
  await page.getByRole('banner').waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(cspErrors, []);
  assert.deepEqual(corsErrors, []);
  await context.close();
  context = undefined;
  const copy = await mkdtemp(path.join(os.tmpdir(), 'jigeqiu-extension-copy-'));
  try {
    await cp(extension, copy, { recursive: true });
    context = await launch(copy);
    const moved = await context.newPage();
    await moved.goto('chrome://newtab/');
    await moved.getByRole('banner').waitFor();
    assert.equal(
      await moved.evaluate(() => globalThis.chrome.runtime.id),
      runtime.id,
    );
    assert.equal(
      await moved.evaluate(async () => (await globalThis.chrome.storage.local.get('jigeqiu-extension-state-v1'))['jigeqiu-extension-state-v1'].data.jipage_library_v2),
      committed,
    );
    await context.close();
    context = undefined;
  } finally {
    await rm(copy, { recursive: true, force: true });
  }
  // A test-only installation fixture supplies actual browser host access.
  // Production ZIPs remain optional-only; never add these grants to the source manifest.
  const grantedCopy = await mkdtemp(
    path.join(os.tmpdir(), 'jigeqiu-extension-granted-'),
  );
  try {
    await cp(extension, grantedCopy, { recursive: true });
    await writeFile(
      path.join(grantedCopy, 'manifest.json'),
      JSON.stringify({
        ...manifest,
        host_permissions: ['https://example.org/*'],
      }),
    );
    context = await launch(grantedCopy);
    const grantedPage = await context.newPage();
    const grantedRequests = [];
    context.on('request', (request) => {
      if (request.url().startsWith('https://example.org/'))
        grantedRequests.push(request.resourceType());
    });
    await grantedPage.goto(`chrome-extension://${runtime.id}/index.html`);
    await grantedPage.getByRole('banner').waitFor();
    await grantedPage.keyboard.press('Control+Shift+Enter');
    const grantedDialog = grantedPage.getByRole('dialog', {
      name: '添加收藏',
      exact: true,
    });
    await grantedDialog
      .getByLabel('网址 URL', { exact: true })
      .fill('https://example.org/permission-test');
    await grantedDialog
      .getByLabel('网站名称', { exact: true })
      .fill('Granted icon');
    const grantedPicker = grantedDialog.getByRole('group', {
      name: '网站图标',
      exact: true,
    });
    await grantedPicker.getByRole('button', { name: /网站图标/ }).click();
    await grantedPicker
      .getByRole('tabpanel', { name: '在线候选', exact: true })
      .getByRole('button')
      .first()
      .waitFor();
    assert.ok(
      grantedRequests.includes('fetch'),
      'Granted sites can fetch images without CORS response headers',
    );
    await grantedPage.screenshot({
      path: path.join(screenshots, 'site-permission-desktop.png'),
      fullPage: true,
    });
    await grantedPage.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await grantedPage.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await grantedPage.screenshot({
      path: path.join(screenshots, 'site-permission-mobile.png'),
      fullPage: true,
    });
    await context.close();
    context = undefined;
  } finally {
    await rm(grantedCopy, { recursive: true, force: true });
  }
  console.log(
    'PASS: privacy gate, offline policy, acknowledgment; no authorization button, no ungranted fetch or CORS errors, image fallback, granted host access, persistence, assets, routing and CSP',
  );
} catch (cause) {
  for (const page of context?.pages() ?? []) {
    console.error('Extension failure page:', page.url(), await page.locator('body').innerText().catch(() => 'unavailable'));
  }
  throw cause;
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}

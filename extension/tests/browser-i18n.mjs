import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const extension = path.join(root, 'dist-extension');
const screenshots = path.join(root, 'test-results/extension');
await mkdir(screenshots, { recursive: true });

for (const [browserLocale, expected] of [['en-US', 'en'], ['zh-TW', 'zh-CN'], ['ja-JP', 'zh-CN']]) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'jigeqiu-locale-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
      locale: browserLocale,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    await context.route(/^https?:/, route => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('chrome://newtab/');
    const initial = expected === 'en' ? 'Privacy before you begin' : '使用前的隐私告知';
    await page.getByRole('heading', { name: initial, exact: true }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), expected);
    if (expected === 'en') {
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth), false);
        await page.screenshot({ path: path.join(screenshots, `privacy-en-${width}.png`), fullPage: true });
      }
      await page.getByRole('button', { name: 'Full privacy notice', exact: true }).click();
      await page.getByRole('heading', { name: 'Local data', exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog').locator('section').count(), 12);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Not now', exact: true }).click();
      await page.getByRole('button', { name: 'Back to privacy notice', exact: true }).click();
      await page.evaluate(() => {
        const original = globalThis.chrome.storage.local.set.bind(globalThis.chrome.storage.local);
        globalThis.chrome.storage.local.set = async () => {
          globalThis.chrome.storage.local.set = original;
          throw new Error('QUOTA_BYTES quota exceeded');
        };
      });
      await page.getByRole('button', { name: 'Acknowledge and continue', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'The local acknowledgment could not be saved' }).waitFor();
      assert.equal(await page.getByRole('banner').count(), 0);
    }
    await page.getByRole('button', {
      name: expected === 'en' ? 'Acknowledge and continue' : '知晓并继续', exact: true,
    }).click();
    await page.getByRole('button', {
      name: expected === 'en' ? 'Skip for now' : '暂时跳过', exact: true,
    }).click();
    await page.getByRole('banner').waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), expected);
    if (expected === 'en') {
      const url = await page.evaluate(() => globalThis.chrome.runtime.getURL('index.html'));
      const other = await context.newPage();
      await other.goto(`${url}?privacy`);
      await other.getByRole('heading', { name: 'Privacy notice', exact: true }).waitFor();
      // Exercise the real persisted language control and cross-tab propagation.
      await page.getByRole('button', { name: 'Switch to Chinese', exact: true }).click();
      await page.waitForFunction(() => globalThis.document.documentElement.lang === 'zh-CN');
      await other.getByRole('heading', { name: '隐私说明', exact: true }).waitFor();
      await page.reload();
      await page.getByRole('banner').waitFor();
      assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
      await other.reload();
      await other.getByRole('heading', { name: '隐私说明', exact: true }).waitFor();
      await page.getByRole('button', { name: '切换为英文', exact: true }).click();
      await other.getByRole('heading', { name: 'Privacy notice', exact: true }).waitFor();
      await page.keyboard.press('Control+Shift+Enter');
      const form = page.getByRole('dialog', { name: 'Add bookmark', exact: true });
      await form.getByText(/Loading a remote image connects to its website/).waitFor();
      await page.keyboard.press('Escape');
    } else {
      await page.getByRole('button', { name: '切换为英文', exact: true }).click();
      await page.waitForFunction(() => globalThis.document.documentElement.lang === 'en');
      await page.reload();
      await page.getByRole('button', { name: 'Switch to Chinese', exact: true }).waitFor();
      assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    }
    assert.deepEqual(errors, []);
    console.log(`Locale verified: browser=${browserLocale}, initial=${expected}`);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
}

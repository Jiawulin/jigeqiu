import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { unzipSync } from 'fflate';

test('package CLI completes a fresh build with shared styles and correct icon dimensions', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  execFileSync(
    process.execPath,
    [path.join(root, 'extension/scripts/build.mjs'), '--legacy-id'],
    {
      cwd: root,
      timeout: 60000,
      stdio: 'pipe',
    },
  );
  assert.equal(
    JSON.parse(
      await readFile(path.join(root, 'dist-extension/manifest.json'), 'utf8'),
    ).key,
    undefined,
    'Migration build must retain the old path-derived identity',
  );
  execFileSync(
    process.execPath,
    [path.join(root, 'extension/scripts/package.mjs')],
    {
      cwd: root,
      timeout: 60000,
      stdio: 'pipe',
    },
  );
  const { version } = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8'),
  );
  const entries = unzipSync(
    await readFile(
      path.join(root, `release-extension/jigeqiu-extension-${version}.zip`),
    ),
  );
  assert.equal(
    JSON.parse(Buffer.from(entries['manifest.json']).toString()).version,
    version,
  );
  const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString());
  assert.equal(manifest.default_locale, 'zh_CN');
  assert.equal(manifest.name, '__MSG_extensionName__');
  assert.equal(manifest.description, '__MSG_extensionDescription__');
  for (const locale of ['zh_CN', 'en']) {
    const messages = JSON.parse(Buffer.from(entries[`_locales/${locale}/messages.json`]).toString());
    assert.ok(messages.extensionName.message.trim());
    assert.ok(messages.extensionDescription.message.trim());
  }
  const { createPublicKey } = await import('node:crypto');
  assert.equal(
    createPublicKey({
      key: Buffer.from(manifest.key, 'base64'),
      type: 'spki',
      format: 'der',
    }).asymmetricKeyType,
    'rsa',
  );
  assert.equal(manifest.options_ui, undefined);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.ok(entries['background.js']);
  assert.deepEqual(manifest.permissions, ['storage', 'contextMenus', 'activeTab']);
  assert.equal(manifest.commands['save-current-page'].suggested_key.default, 'Alt+Shift+D');
  assert.equal(manifest.commands['save-current-page'].suggested_key.mac, 'Alt+Shift+D');
  for (const size of [16, 32, 48, 128]) {
    const png = Buffer.from(entries[`icons/icon-${size}.png`]);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  const css = Object.entries(entries)
    .filter(([name]) => /^assets\/index-.+\.css$/.test(name))
    .map(([, bytes]) => Buffer.from(bytes).toString())
    .join('\n');
  assert.match(css, /\.relative\{position:relative\}/);
  assert.ok(entries['brand/logo-a2-equator.png']);
  assert.equal(entries['wallpapers/cyan-lake-desktop.webp'], undefined);
  for (const preset of ['snow-mountain', 'misty-mountains', 'corner-tower', 'green-lake']) {
    assert.ok(entries[`wallpapers/${preset}-desktop.webp`]);
  }
});

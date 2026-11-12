import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateExtension } from './package.mjs';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const extensionOutput = path.join(projectRoot, 'dist-extension');

export async function buildExtension() {
  const { build } = await import('vite');
  const { version } = JSON.parse(
    await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
  );
  const manifest = JSON.parse(
    await readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
  );
  manifest.version = version;
  // Migration build keeps the previous path-derived ID long enough to export old data.
  if (process.argv.includes('--legacy-id')) delete manifest.key;
  await build({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  });
  const { build: bundle } = await import('esbuild');
  await bundle({
    entryPoints: [path.join(projectRoot, 'extension/background.ts')],
    outfile: path.join(extensionOutput, 'background.js'),
    bundle: true, format: 'esm', platform: 'browser', target: 'chrome120',
  });
  await cp(
    fileURLToPath(new URL('../_locales', import.meta.url)),
    path.join(extensionOutput, '_locales'),
    { recursive: true },
  );
  await mkdir(path.join(extensionOutput, 'icons'), { recursive: true });
  // The existing ICO contains PNG entries at all extension icon sizes.
  const ico = await readFile(path.join(projectRoot, 'public/favicon.ico'));
  assert.equal(ico.readUInt16LE(2), 1, 'Expected an ICO resource');
  for (const size of [16, 32, 48, 128]) {
    let png;
    for (let index = 0; index < ico.readUInt16LE(4); index++) {
      const entry = 6 + index * 16;
      if (ico[entry] !== size || ico[entry + 1] !== size) continue;
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      png = ico.subarray(offset, offset + length);
      assert.equal(png.length, length, 'Truncated ICO entry');
      assert.equal(
        png.subarray(0, 8).toString('hex'),
        '89504e470d0a1a0a',
        'Expected PNG icon',
      );
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
      break;
    }
    assert.ok(png, `Missing ${size}px PNG in favicon.ico`);
    await writeFile(path.join(extensionOutput, `icons/icon-${size}.png`), png);
  }
  await writeFile(
    path.join(extensionOutput, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await cp(
    path.join(projectRoot, 'LICENSE'),
    path.join(extensionOutput, 'LICENSE'),
  );
  await validateExtension(extensionOutput, version);
  console.log('Extension built and validated: dist-extension/');
  return version;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await buildExtension();
}

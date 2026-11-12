import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync } from 'fflate';
import { parse } from 'parse5';

function localPath(root, value, from = 'index.html') {
  assert.ok(
    typeof value === 'string' && value.length > 0,
    'Missing extension path',
  );
  assert.ok(
    !/^[a-z][a-z\d+.-]*:|^\/\/|\\|\0/i.test(value),
    `Unsafe extension path: ${value}`,
  );
  const pathname = decodeURIComponent(value.split(/[?#]/)[0]);
  assert.ok(
    !pathname.split('/').includes('..'),
    `Unsafe extension path: ${value}`,
  );
  const relative = pathname.startsWith('/')
    ? pathname.slice(1)
    : path.posix.join(path.posix.dirname(from), pathname);
  const resolved = path.resolve(root, relative);
  assert.ok(
    resolved.startsWith(path.resolve(root) + path.sep),
    `Unsafe extension path: ${value}`,
  );
  return { absolute: resolved, relative };
}

async function requireFile(root, value, from) {
  const file = localPath(root, value, from);
  const info = await stat(file.absolute).catch(() => null);
  assert.ok(info?.isFile(), `Missing extension file: ${file.relative}`);
  return file;
}

export async function validateExtension(root, version) {
  const manifest = JSON.parse(
    await readFile(path.join(root, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.manifest_version, 3, 'Expected Manifest V3');
  assert.equal(
    manifest.version,
    version,
    'Extension version must match package.json',
  );
  assert.ok(manifest.name, 'Missing extension name');
  if (manifest.background?.service_worker) {
    await requireFile(root, manifest.background.service_worker);
    assert.equal(manifest.background.type, 'module');
  }
  if (manifest.default_locale) {
    const locales = await readdir(path.join(root, '_locales'));
    assert.ok(locales.includes(manifest.default_locale), 'Missing default locale');
    for (const locale of locales) {
      const file = await requireFile(root, `_locales/${locale}/messages.json`);
      const messages = JSON.parse(await readFile(file.absolute, 'utf8'));
      for (const value of [
        manifest.name, manifest.description,
        ...Object.values(manifest.commands ?? {}).map(command => command.description),
      ]) {
        const key = /^__MSG_(\w+)__$/.exec(value)?.[1];
        if (key) assert.ok(messages[key]?.message?.trim(), `Missing message: ${locale}/${key}`);
      }
    }
  }
  const entry = await requireFile(root, manifest.chrome_url_overrides?.newtab);
  assert.ok(
    Object.keys(manifest.icons ?? {}).length,
    'Missing extension icons',
  );
  for (const icon of Object.values(manifest.icons))
    await requireFile(root, icon);
  for (const name of ['LICENSE', 'wallpapers/CREDITS.md'])
    await requireFile(root, name);
  const html = await readFile(entry.absolute, 'utf8');
  const stack = [parse(html)];
  while (stack.length) {
    const node = stack.pop();
    if (node.childNodes) stack.push(...node.childNodes);
    if (!node.tagName) continue;
    const attrs = Object.fromEntries(
      node.attrs.map((attr) => [attr.name, attr.value]),
    );
    assert.ok(
      !Object.keys(attrs).some((name) => /^on/i.test(name)),
      'Inline script handlers are not allowed',
    );
    if (node.tagName === 'script') {
      assert.ok(
        attrs.src && !/^[a-z][a-z\d+.-]*:|^\/\//i.test(attrs.src),
        'Only local external scripts are allowed',
      );
      assert.ok(
        !node.childNodes.some((child) => child.value?.trim()),
        'Inline scripts are not allowed',
      );
      await requireFile(root, attrs.src, entry.relative);
    }
    if (
      node.tagName === 'link' &&
      ['stylesheet', 'modulepreload', 'icon'].includes(attrs.rel)
    ) {
      await requireFile(root, attrs.href, entry.relative);
    }
  }
  const files = await readdir(root, { recursive: true, withFileTypes: true });
  for (const file of files) {
    assert.ok(
      !file.isSymbolicLink(),
      'Symlinks are not allowed in extension packages',
    );
    if (!file.isFile() || !file.name.endsWith('.css')) continue;
    const absolute = path.join(file.parentPath, file.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const css = await readFile(absolute, 'utf8');
    for (const match of css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) {
      if (/^(data:|blob:|https?:|#)/i.test(match[1])) continue;
      await requireFile(root, match[1], relative);
    }
  }
  return manifest;
}

export async function packageExtension(root, output, version) {
  await validateExtension(root, version);
  const files = await readdir(root, { recursive: true, withFileTypes: true });
  const entries = {};
  for (const file of files) {
    if (!file.isFile()) continue;
    const absolute = path.join(file.parentPath, file.name);
    const name = path.relative(root, absolute).split(path.sep).join('/');
    entries[name] = await readFile(absolute);
  }
  const bytes = zipSync(entries, { level: 6 });
  const name = `jigeqiu-extension-${version}.zip`;
  await mkdir(output, { recursive: true });
  const archive = path.join(output, name);
  await writeFile(archive, bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(output, 'SHA256SUMS.txt'), `${hash}  ${name}\n`);
  console.log(`Extension package created: ${archive}`);
  return archive;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL('./build.mjs', import.meta.url))],
    {
      cwd: projectRoot,
      stdio: 'inherit',
    },
  );
  const { version } = JSON.parse(
    await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
  );
  await packageExtension(
    path.join(projectRoot, 'dist-extension'),
    path.join(projectRoot, 'release-extension'),
    version,
  );
}

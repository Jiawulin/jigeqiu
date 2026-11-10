import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const checksumName = 'SHA256SUMS.txt';

function checksums(text, allowed) {
  const result = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) {2}([a-zA-Z0-9.-]+)$/.exec(line);
    assert.ok(match && allowed.includes(match[2]), 'Unexpected checksum entry');
    assert.ok(!result.has(match[2]), 'Duplicate checksum entry');
    result.set(match[2], match[1]);
  }
  return result;
}

export async function prepareReleaseAssets(root, tag) {
  const { version } = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8'),
  );
  assert.match(
    tag ?? '',
    /^v\d+\.\d+\.\d+$/,
    'Expected a v-prefixed release version',
  );
  assert.equal(tag, `v${version}`, 'Tag must match package.json version');
  const names = [`jigeqiu-${tag}-web.zip`, `jigeqiu-extension-${version}.zip`];
  const output = path.join(root, 'release-assets');
  const assets = [];
  for (const [index, name] of names.entries()) {
    const folder = index === 0 ? output : path.join(root, 'release-extension');
    const bytes = await readFile(path.join(folder, name));
    const sums = checksums(
      await readFile(path.join(folder, checksumName), 'utf8'),
      names,
    );
    assert.equal(sums.get(name), sha256(bytes), `Checksum mismatch: ${name}`);
    assets.push({ name, path: path.join(output, name), hash: sha256(bytes) });
  }
  await copyFile(
    path.join(root, 'release-extension', names[1]),
    assets[1].path,
  );
  const combined = assets
    .map(({ name, hash }) => `${hash}  ${name}\n`)
    .join('');
  await writeFile(path.join(output, checksumName), combined);
  return [
    ...assets,
    {
      name: checksumName,
      path: path.join(output, checksumName),
      hash: sha256(combined),
    },
  ];
}

async function gh(args) {
  const { stdout } = await execute('gh', args, {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

async function verifyRemote(run, api, release, expected) {
  const pages = JSON.parse(
    await run([
      'api',
      `${api}/releases/${release.id}/assets`,
      '--paginate',
      '--slurp',
    ]),
  );
  const assets = pages.flat();
  const downloaded = new Map();
  for (const { name } of expected) {
    const matches = assets.filter((asset) => asset.name === name);
    assert.equal(
      matches.length,
      1,
      `Missing or duplicate release asset: ${name}`,
    );
    const [asset] = matches;
    assert.equal(asset.state, 'uploaded', `Incomplete release asset: ${name}`);
    const bytes = Buffer.from(
      await run([
        'api',
        `${api}/releases/assets/${asset.id}`,
        '-H',
        'Accept: application/octet-stream',
      ]),
    );
    assert.equal(
      bytes.length,
      asset.size,
      `Release asset size mismatch: ${name}`,
    );
    downloaded.set(name, bytes);
  }
  const sums = checksums(
    downloaded.get(checksumName).toString('utf8'),
    expected.slice(0, 2).map(({ name }) => name),
  );
  assert.equal(sums.size, 2, 'Release checksum must cover both packages');
  for (const asset of expected.slice(0, 2)) {
    const actual = sha256(downloaded.get(asset.name));
    assert.equal(
      actual,
      sums.get(asset.name),
      `Remote checksum mismatch: ${asset.name}`,
    );
  }
  // Rebuilds can differ in ZIP timestamps. Published versions are immutable and
  // verified against their own manifest; drafts must match this exact build.
  if (release.draft) {
    for (const asset of expected) {
      assert.equal(
        sha256(downloaded.get(asset.name)),
        asset.hash,
        `Upload mismatch: ${asset.name}`,
      );
    }
  }
}

export async function publishRelease({ root, tag, repo, run = gh }) {
  const assets = await prepareReleaseAssets(root, tag);
  assert.match(repo ?? '', /^[\w.-]+\/[\w.-]+$/, 'Expected owner/repository');
  const api = `repos/${repo}`;
  await run(['api', `${api}/git/ref/tags/${encodeURIComponent(tag)}`]);
  const pages = JSON.parse(
    await run(['api', `${api}/releases?per_page=100`, '--paginate', '--slurp']),
  );
  const matches = pages.flat().filter((release) => release.tag_name === tag);
  assert.ok(
    matches.length <= 1,
    `Multiple releases for ${tag}; resolve duplicates manually before publishing`,
  );
  let release = matches[0];
  if (!release) {
    release = JSON.parse(
      await run([
        'api',
        `${api}/releases`,
        '--method',
        'POST',
        '-f',
        `tag_name=${tag}`,
        '-f',
        `name=JIGEQIU ${tag}`,
        '-F',
        'draft=true',
        '-f',
        `body=## 下载哪个包？

| 附件 | 适用场景 | 使用方式 |
| --- | --- | --- |
| \`${assets[0].name}\` | Web 网页版，自行部署网站 | 解压到静态站点，通过浏览器访问 |
| \`${assets[1].name}\` | Chrome / Edge 新标签页扩展 | 解压后在扩展管理页加载，无需部署网站 |
| \`SHA256SUMS.txt\` | 文件完整性校验 | 不是应用，不需要安装 |

只需下载符合用途的一个 ZIP。GitHub 自动附带的 Source code (zip / tar.gz) 是源码，不是可直接使用的安装包。

### Chrome / Edge 扩展安装
1. 下载 \`${assets[1].name}\`，解压到准备长期保留的固定目录。
2. Chrome 打开 \`chrome://extensions\`；Edge 打开 \`edge://extensions\`，开启开发者模式。
3. 点击“加载已解压的扩展程序”（Edge 为“加载解压缩的扩展”），选择直接包含 \`manifest.json\` 的目录，而不是 ZIP 文件。
4. 打开新标签页，确认浏览器提示的新标签页更改，并阅读首次启动的隐私说明。

无需 Node.js 或网站服务器；不是 CRX 双击安装包，也不代表扩展商店发布。
更新前导出 JSON 资产备份，关闭已打开的扩展页面，将新版文件更新到原目录，在扩展管理页重新加载，再打开新标签页核对数据。不要卸载旧扩展后重装，不要移动或删除安装目录。

### Web 网页版部署
1. 下载 \`${assets[0].name}\`，将完整内容解压到 Nginx、Caddy 或静态托管站点。
2. 站点根目录应直接包含 \`index.html\`、\`assets/\`、\`wallpapers/\`。
3. 通过站点地址访问。公网和局域网部署使用 HTTPS；本机 \`localhost\` / \`127.0.0.1\` 可使用 HTTP。

不需要 Node.js 或数据库常驻运行；不要双击 \`index.html\`，也不要把 Web ZIP 加载为浏览器扩展。
升级前导出 JSON 资产备份，更新完整站点文件并保持原访问地址。
网页与扩展数据不会自动同步，迁移需手动导出／导入；JSON 资产备份不包含全部设置、布局和壁纸。

### 校验文件
下载两个 ZIP 和 \`SHA256SUMS.txt\` 到同一目录，执行 \`sha256sum --check SHA256SUMS.txt\`（macOS：\`shasum -a 256 -c SHA256SUMS.txt\`）。
只下载一个 ZIP 时，完整校验命令会提示另一个文件缺失，可单独计算已下载文件的 SHA256 并与对应行比较。

## English
- **Browser extension:** download \`${assets[1].name}\`, extract to a permanent folder, enable developer mode at \`chrome://extensions\` or \`edge://extensions\`, then load the unpacked folder containing \`manifest.json\`. Open a new tab. No Node.js or web server is required; the ZIP is not a double-click installer.
- **Web deployment:** download \`${assets[0].name}\`, extract all files into a static web root and access it over HTTPS (HTTP is allowed on localhost / 127.0.0.1). Do not open \`index.html\` directly or load this package as an extension.
- **Updates and data:** export a JSON asset backup first. Keep the extension's installation folder and identity; close extension pages, replace files and reload without uninstalling. Keep the web deployment's address unchanged. Web and extension data do not sync automatically; JSON backups exclude settings, layouts and wallpapers.
- **Checksums:** \`SHA256SUMS.txt\` covers both ZIPs. Source code archives are for development, not ready-to-use packages.

完整使用说明 / Full guide: [中文 README](https://github.com/${repo}/blob/${tag}/README.md) · [English README](https://github.com/${repo}/blob/${tag}/README.en.md)
`,
      ]),
    );
    assert.equal(release.tag_name, tag);
    assert.equal(release.draft, true);
  }
  if (release.draft) {
    const current = JSON.parse(
      await run(['api', `${api}/releases/${release.id}`]),
    );
    assert.equal(current.draft, true, 'Release is no longer a draft');
    assert.equal(current.tag_name, tag, 'Release tag changed');
    const existing = JSON.parse(
      await run([
        'api',
        `${api}/releases/${release.id}/assets`,
        '--paginate',
        '--slurp',
      ]),
    ).flat();
    if (
      assets.every(({ name }) => existing.some((asset) => asset.name === name))
    ) {
      await verifyRemote(run, api, { ...release, draft: false }, assets);
    } else {
      const missing = [];
      for (const asset of assets) {
        const matches = existing.filter(({ name }) => name === asset.name);
        assert.ok(matches.length <= 1, `Duplicate draft asset: ${asset.name}`);
        if (!matches.length) {
          missing.push(asset);
          continue;
        }
        const bytes = await run([
          'api',
          `${api}/releases/assets/${matches[0].id}`,
          '-H',
          'Accept: application/octet-stream',
        ]);
        assert.equal(
          sha256(bytes),
          asset.hash,
          `Draft asset differs; resolve manually: ${asset.name}`,
        );
      }
      for (const asset of missing) {
        const current = JSON.parse(
          await run(['api', `${api}/releases/${release.id}`]),
        );
        assert.equal(current.draft, true, 'Release is no longer a draft');
        assert.equal(current.tag_name, tag, 'Release tag changed');
        await run([
          'api',
          `https://uploads.github.com/${api}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`,
          '--method',
          'POST',
          '--input',
          asset.path,
          '-H',
          `Content-Type: ${asset.name.endsWith('.zip') ? 'application/zip' : 'text/plain'}`,
        ]);
      }
      await verifyRemote(run, api, release, assets);
    }
  } else {
    await verifyRemote(run, api, release, assets);
  }
  if (release.draft) {
    const current = JSON.parse(
      await run(['api', `${api}/releases/${release.id}`]),
    );
    assert.equal(current.draft, true, 'Release is no longer a draft');
    assert.equal(current.tag_name, tag, 'Release tag changed');
    const published = JSON.parse(
      await run([
        'api',
        `${api}/releases/${release.id}`,
        '--method',
        'PATCH',
        '-F',
        'draft=false',
      ]),
    );
    assert.equal(published.draft, false, 'Release was not published');
    assert.equal(published.tag_name, tag);
  }
  console.log(`Release verified: ${repo} ${tag}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [tag, mode] = process.argv.slice(2);
  assert.ok(
    mode === undefined || mode === '--publish',
    'Unexpected release option',
  );
  if (mode === '--publish') {
    await publishRelease({
      root: process.cwd(),
      tag,
      repo: process.env.GH_REPO,
    });
  } else {
    await prepareReleaseAssets(process.cwd(), tag);
    console.log('Both release packages and combined checksums are ready');
  }
}

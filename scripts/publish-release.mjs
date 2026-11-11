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
        `body=## 中文

**记个球 JIGEQIU** 是一款轻量的个人网址收藏工作台，提供收藏管理、桌面快捷方式、启动台和搜索，支持中英文界面。数据保存在当前浏览器，不依赖账号或云同步。你可以将它安装为浏览器新标签页扩展，也可以自行部署网页版，请按用途选择下方 **Release Assets** 中的文件。

| 文件 | 适用场景 | 使用方式 |
| --- | --- | --- |
| \`${assets[1].name}\` | Chrome / Edge 新标签页扩展 | 解压到固定目录，在浏览器扩展管理页开启开发者模式，选择“加载已解压的扩展程序”，加载直接包含 \`manifest.json\` 的目录 |
| \`${assets[0].name}\` | 自行部署 Web 网页版 | 解压后将文件部署到静态网站服务器，建议使用 HTTPS；无需 Node.js 运行环境 |
| \`SHA256SUMS.txt\` | 校验下载文件完整性 | 用于核对上述两个 ZIP 的 SHA256 |
| \`Source code (zip / tar.gz)\` | 开发与源码研究 | GitHub 自动生成的源码包，不是可直接安装的成品 |

**安装提示：** 扩展 ZIP 需先解压，不能作为 CRX 直接安装。更新扩展时请保持扩展身份与加载目录不变，替换文件后点击“重新加载”，不要先卸载。Web 版与扩展版的数据不会自动同步，迁移前请手动导出 JSON 资产备份；普通资产备份不包含全部设置、布局和壁纸。

## English

**JIGEQIU** is a lightweight personal bookmark workbench featuring bookmark management, desktop shortcuts, a launchpad and search, with Chinese and English interfaces. Data stays in your current browser, with no account or cloud sync required. Install it as a new tab extension or host the web edition yourself. Choose the appropriate file from **Release Assets** below.

| File | Intended Use | Getting Started |
| --- | --- | --- |
| \`${assets[1].name}\` | Chrome / Edge new tab extension | Extract to a permanent folder, enable Developer mode in your browser's extension manager (\`chrome://extensions\` or \`edge://extensions\`), then choose **Load unpacked** and select the folder directly containing \`manifest.json\` |
| \`${assets[0].name}\` | Self-hosted web edition | Extract and deploy the files to a static web server, preferably over HTTPS; no Node.js runtime is required |
| \`SHA256SUMS.txt\` | Download integrity verification | Verify the SHA256 checksums of the two ZIP files |
| \`Source code (zip / tar.gz)\` | Development and source inspection | Source archives generated by GitHub, not ready-to-install builds |

**Installation notes:** Extract the extension ZIP before loading it; it is not a CRX installer. When updating, preserve the extension identity and installation folder, replace the files and click **Reload** instead of uninstalling first. The web and extension editions do not sync data automatically. Export a JSON asset backup before migrating; standard asset backups do not include all settings, layouts and wallpapers.

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

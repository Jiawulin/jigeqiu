import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const moduleURL = new URL('../../scripts/publish-release.mjs', import.meta.url);
const tag = 'v0.1.2';
const repo = 'example/jigeqiu';
const web = `jigeqiu-${tag}-web.zip`;
const extension = 'jigeqiu-extension-0.1.2.zip';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'jigeqiu-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'release-assets'));
  await mkdir(path.join(root, 'release-extension'));
  await writeFile(path.join(root, 'package.json'), '{"version":"0.1.2"}');
  for (const [folder, name] of [
    ['release-assets', web],
    ['release-extension', extension],
  ]) {
    const bytes = Buffer.from(`fixture ${name}`);
    await writeFile(path.join(root, folder, name), bytes);
    await writeFile(
      path.join(root, folder, 'SHA256SUMS.txt'),
      `${hash(bytes)}  ${name}\n`,
    );
  }
  return root;
}

function github(
  root,
  { releases = [], failUpload = false, corrupt = false, failList = false } = {},
) {
  const calls = [];
  let release = releases[0];
  const assets = new Map();
  const run = async (args) => {
    calls.push(args);
    const [command, endpoint] = args;
    if (command === 'api' && endpoint.endsWith('/releases?per_page=100')) {
      if (failList) throw new Error('GitHub unavailable');
      return JSON.stringify([releases]);
    }
    if (command === 'api' && endpoint.includes('/git/ref/tags/')) return '{}';
    if (command === 'api' && endpoint.endsWith('/releases')) {
      release = { id: 42, tag_name: tag, draft: true };
      return JSON.stringify(release);
    }
    if (
      command === 'api' &&
      endpoint.startsWith('https://uploads.github.com/')
    ) {
      if (failUpload) throw new Error('Upload failed');
      for (const name of [web, extension, 'SHA256SUMS.txt'].filter((name) =>
        args.includes(path.join(root, 'release-assets', name)),
      )) {
        assets.set(
          name,
          await readFile(path.join(root, 'release-assets', name)),
        );
      }
      return '';
    }
    if (command === 'api' && endpoint.endsWith('/releases/42/assets')) {
      return JSON.stringify([
        [...assets].map(([name, bytes], i) => ({
          id: i + 1,
          name,
          size: bytes.length,
          state: 'uploaded',
        })),
      ]);
    }
    if (command === 'api' && endpoint.includes('/releases/assets/')) {
      const index = Number(endpoint.split('/').at(-1)) - 1;
      const bytes = [...assets.values()][index];
      return corrupt ? Buffer.alloc(bytes.length, 120) : bytes;
    }
    if (command === 'api' && endpoint.endsWith('/releases/42')) {
      if (args.includes('PATCH')) release = { ...release, draft: false };
      return JSON.stringify(release);
    }
    throw new Error(`Unexpected gh call: ${args.join(' ')}`);
  };
  return { calls, run, assets };
}

test('release orchestration module is available', async () => {
  assert.ok(await readFile(moduleURL, 'utf8').catch(() => ''));
});

test('preparation merges both verified checksums and can run twice', async (t) => {
  const { prepareReleaseAssets } = await import(moduleURL);
  const root = await fixture(t);
  const first = await prepareReleaseAssets(root, tag);
  const second = await prepareReleaseAssets(root, tag);
  assert.deepEqual(second, first);
  assert.deepEqual(
    first.map((asset) => asset.name),
    [web, extension, 'SHA256SUMS.txt'],
  );
  const sums = await readFile(
    path.join(root, 'release-assets/SHA256SUMS.txt'),
    'utf8',
  );
  assert.equal(sums.trim().split('\n').length, 2);
  for (const name of [web, extension]) {
    assert.ok(
      sums.includes(
        `${hash(await readFile(path.join(root, 'release-assets', name)))}  ${name}\n`,
      ),
    );
  }
});

test('missing, corrupt or wrong-version packages fail before GitHub access', async (t) => {
  const { publishRelease } = await import(moduleURL);
  for (const scenario of ['missing', 'corrupt', 'version']) {
    const root = await fixture(t);
    if (scenario === 'missing')
      await rm(path.join(root, 'release-extension', extension));
    if (scenario === 'corrupt')
      await writeFile(
        path.join(root, 'release-extension', extension),
        'changed',
      );
    const gh = github(root);
    await assert.rejects(
      publishRelease({
        root,
        tag: scenario === 'version' ? 'v0.1.3' : tag,
        repo,
        run: gh.run,
      }),
    );
    assert.equal(gh.calls.length, 0);
  }
});

test('a new release stays draft until both ZIPs and the checksum are uploaded and downloaded for verification', async (t) => {
  const { publishRelease } = await import(moduleURL);
  const root = await fixture(t);
  const gh = github(root);
  await publishRelease({ root, tag, repo, run: gh.run });
  const create = gh.calls.find((args) => args.includes('POST'));
  assert.ok(create.includes('draft=true'));
  const body = create.find((arg) => arg.startsWith('body='));
  for (const text of [
    web,
    extension,
    'SHA256SUMS.txt',
    'Chrome',
    'Edge',
    'chrome://extensions',
    'edge://extensions',
    'manifest.json',
    'HTTPS',
    'Source code',
    'JSON',
    '不要先卸载',
    'Web',
    'English',
    '## 中文',
    '个人网址收藏工作台',
    'personal bookmark workbench',
    '| 文件 | 适用场景 | 使用方式 |',
    '| File | Intended Use | Getting Started |',
  ]) {
    assert.ok(body.includes(text), `Release instructions missing: ${text}`);
  }
  assert.ok(
    !body.includes('vX.Y.Z'),
    'Release filenames must use the actual tag',
  );
  assert.ok(
    !body.includes('X.Y.Z'),
    'No placeholder versions in release instructions',
  );
  assert.ok(body.indexOf('## 中文') < body.indexOf('## English'));
  const upload = gh.calls.findIndex((args) => args.includes('--input'));
  const publish = gh.calls.findIndex((args) => args.includes('PATCH'));
  assert.ok(upload > 0 && publish > upload);
  assert.equal(
    gh.calls.filter((args) => args.includes('Accept: application/octet-stream'))
      .length,
    3,
  );
  assert.ok(gh.calls[publish].includes('draft=false'));
});

test('an existing draft is reused without creating another release', async (t) => {
  const { publishRelease } = await import(moduleURL);
  const root = await fixture(t);
  const gh = github(root, {
    releases: [{ id: 42, tag_name: tag, draft: true }],
  });
  await publishRelease({ root, tag, repo, run: gh.run });
  assert.ok(
    !gh.calls.some(
      (args) => args.includes('POST') && args[1].endsWith('/releases'),
    ),
  );
  assert.ok(!gh.calls.some((args) => args.includes('--clobber')));
});

test('upload or remote verification failure never publishes the draft', async (t) => {
  const { publishRelease } = await import(moduleURL);
  for (const options of [{ failUpload: true }, { corrupt: true }]) {
    const root = await fixture(t);
    const gh = github(root, options);
    await assert.rejects(publishRelease({ root, tag, repo, run: gh.run }));
    assert.ok(!gh.calls.some((args) => args.includes('PATCH')));
  }
});

test('published releases are verified on rerun without uploading or changing metadata', async (t) => {
  const { prepareReleaseAssets, publishRelease } = await import(moduleURL);
  const root = await fixture(t);
  const gh = github(root, {
    releases: [{ id: 42, tag_name: tag, draft: false }],
  });
  const expected = await prepareReleaseAssets(root, tag);
  for (const asset of expected)
    gh.assets.set(asset.name, await readFile(asset.path));
  await publishRelease({ root, tag, repo, run: gh.run });
  assert.ok(
    gh.calls.every(
      (args) =>
        args[0] === 'api' && !args.includes('PATCH') && !args.includes('POST'),
    ),
  );
});

test('incomplete published releases, duplicate releases and API errors fail without mutations', async (t) => {
  const { publishRelease } = await import(moduleURL);
  for (const options of [
    { releases: [{ id: 42, tag_name: tag, draft: false }] },
    {
      releases: [
        { id: 42, tag_name: tag, draft: false },
        { id: 43, tag_name: tag, draft: true },
      ],
    },
    { failList: true },
  ]) {
    const root = await fixture(t);
    const gh = github(root, options);
    await assert.rejects(publishRelease({ root, tag, repo, run: gh.run }));
    assert.ok(
      gh.calls.every(
        (args) =>
          args[0] === 'api' &&
          !args.includes('PATCH') &&
          !args.includes('POST'),
      ),
    );
  }
});

test('published reruns accept timestamp-different builds but reject corrupt remote bytes', async (t) => {
  const { prepareReleaseAssets, publishRelease } = await import(moduleURL);
  const root = await fixture(t);
  const gh = github(root, {
    releases: [{ id: 42, tag_name: tag, draft: false }],
  });
  const expected = await prepareReleaseAssets(root, tag);
  for (const asset of expected) {
    gh.assets.set(asset.name, await readFile(asset.path));
  }
  const different = Buffer.from('rebuilt ZIP with different timestamps');
  await writeFile(path.join(root, 'release-assets', web), different);
  const extensionBytes = await readFile(
    path.join(root, 'release-extension', extension),
  );
  await writeFile(
    path.join(root, 'release-assets/SHA256SUMS.txt'),
    `${hash(different)}  ${web}\n${hash(extensionBytes)}  ${extension}\n`,
  );
  await publishRelease({ root, tag, repo, run: gh.run });
  gh.assets.set(web, Buffer.alloc(gh.assets.get(web).length, 120));
  await assert.rejects(
    publishRelease({ root, tag, repo, run: gh.run }),
    /Remote checksum mismatch/,
  );
  assert.ok(
    gh.calls.every(
      (args) =>
        args[0] === 'api' && !args.includes('PATCH') && !args.includes('POST'),
    ),
  );
});

test('complete drafts are verified and published without replacing attachments', async (t) => {
  const { prepareReleaseAssets, publishRelease } = await import(moduleURL);
  const root = await fixture(t);
  const gh = github(root, {
    releases: [{ id: 42, tag_name: tag, draft: true }],
    failUpload: true,
  });
  for (const asset of await prepareReleaseAssets(root, tag)) {
    gh.assets.set(asset.name, await readFile(asset.path));
  }
  await publishRelease({ root, tag, repo, run: gh.run });
  assert.ok(!gh.calls.some((args) => args.includes('--input')));
  assert.ok(gh.calls.some((args) => args.includes('PATCH')));
});

test('conflicting partial drafts and drafts published concurrently are not mutated', async (t) => {
  const { publishRelease } = await import(moduleURL);
  for (const concurrent of [false, true]) {
    const root = await fixture(t);
    const gh = github(root, {
      releases: [{ id: 42, tag_name: tag, draft: true }],
    });
    gh.assets.set(web, Buffer.from('existing asset must not be deleted'));
    const run = async (args) =>
      concurrent && args[1].endsWith('/releases/42')
        ? JSON.stringify({ id: 42, tag_name: tag, draft: false })
        : gh.run(args);
    await assert.rejects(
      publishRelease({ root, tag, repo, run }),
      concurrent ? /no longer a draft/ : /Draft asset differs/,
    );
    assert.ok(
      gh.calls.every(
        (args) => !args.includes('POST') && !args.includes('PATCH'),
      ),
    );
    assert.equal(
      gh.assets.get(web).toString(),
      'existing asset must not be deleted',
    );
  }
});

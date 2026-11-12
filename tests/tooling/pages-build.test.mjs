import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('Pages checks PRs but deploys only master and keeps release builds separate', async () => {
  const workflow = await readFile(
    path.join(root, '.github/workflows/pages.yml'),
    'utf8',
  );
  assert.match(workflow, /pull_request:\s+branches: \[master\]/);
  assert.match(workflow, /needs: check/);
  assert.match(
    workflow,
    /github.event_name != 'pull_request' && github.ref == 'refs\/heads\/master'/,
  );
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /npm run build -- --base=\/jigeqiu\//);
  assert.match(
    workflow,
    /VITE_SITE_URL: https:\/\/jiawulin.github.io\/jigeqiu\//,
  );
  assert.match(workflow, /path: dist/);
  assert.doesNotMatch(workflow, /secrets\.|pull_request_target/);
  for (const [, action] of workflow.matchAll(/uses: (\S+)/g)) {
    assert.match(action, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
  }
  const release = await readFile(
    path.join(root, '.github/workflows/release.yml'),
    'utf8',
  );
  assert.doesNotMatch(release, /--base|VITE_SITE_URL/);
});

test('root and Pages builds keep assets and sharing metadata within their deployment', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'jigeqiu-pages-build-'));
  try {
    for (const base of ['/', '/jigeqiu/']) {
      const output = path.join(temporary, base === '/' ? 'root' : 'pages');
      const site =
        base === '/'
          ? 'https://jigeqiu.com/'
          : 'https://jiawulin.github.io/jigeqiu/';
      const env = { ...process.env };
      delete env.VITE_SITE_URL;
      if (base !== '/') env.VITE_SITE_URL = site;
      const result = spawnSync(
        process.execPath,
        [
          'node_modules/vite/bin/vite.js',
          'build',
          `--base=${base}`,
          '--outDir',
          output,
        ],
        { cwd: root, env, encoding: 'utf8', timeout: 120000 },
      );
      assert.equal(result.status, 0, result.stderr);
      const html = await readFile(path.join(output, 'index.html'), 'utf8');
      assert.ok(html.includes(`rel="canonical" href="${site}"`));
      assert.ok(html.includes(`property="og:url" content="${site}"`));
      assert.ok(
        html.includes(`href="${base}favicon.ico?v=jigeqiu-a2-equator-1"`),
      );
      assert.ok(
        html.includes(
          `href="${base}apple-touch-icon.png?v=jigeqiu-a2-equator-1"`,
        ),
      );
      assert.ok(html.includes(`src="${base}assets/`));
      assert.ok(html.includes(`href="${base}assets/`));
      let css = '';
      for (const file of await readdir(path.join(output, 'assets'))) {
        if (!file.endsWith('.css')) continue;
        css += await readFile(path.join(output, 'assets', file), 'utf8');
      }
      for (const name of [
        'snow-mountain',
        'misty-mountains',
        'corner-tower',
        'green-lake',
      ]) {
        for (const size of ['desktop', 'mobile', 'thumb']) {
          assert.ok(css.includes(`${base}wallpapers/${name}-${size}.webp`));
        }
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

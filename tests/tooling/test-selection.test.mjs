import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTestPlan } from '../../scripts/test-selected.mjs';
import {
  layoutCases,
  captureScreenshots,
} from '../browser/helpers/layout-cases.mjs';

const catalog = {
  scripts: {
    'test:browser:transfer-formats': 'node tests/browser/transfer-formats.mjs',
    'test:browser:static-first-use':
      'npm run build && node tests/browser/static-first-use.mjs',
    check: 'npm run test && npm run build',
  },
  unitFiles: ['desktop-keyboard.test.ts', 'workbench-backup.test.ts'],
};

test('targeted runners require explicit tests and reject unknown input before execution', () => {
  for (const kind of ['unit', 'browser']) {
    assert.throws(() => buildTestPlan(kind, [], catalog), /Select/);
    assert.throws(() => buildTestPlan(kind, ['missing'], catalog), /Unknown/);
    assert.throws(() => buildTestPlan(kind, ['--typo'], catalog), /Unknown/);
  }
  assert.throws(
    () => buildTestPlan('browser', ['transfer-formats', 'missing'], catalog),
    /Unknown/,
  );
  assert.throws(() => buildTestPlan('unit', ['../check'], catalog), /Unknown/);
});

test('unit selection runs only named files once and supports existing paths', () => {
  const plan = buildTestPlan(
    'unit',
    ['desktop-keyboard', 'tests/unit/desktop-keyboard.test.ts', '--dry-run'],
    catalog,
  );
  assert.equal(plan.dryRun, true);
  assert.deepEqual(plan.commands, [
    {
      command: process.execPath,
      args: [
        '--import',
        'tsx',
        '--test',
        'tests/unit/desktop-keyboard.test.ts',
      ],
      label: 'unit (1 file)',
    },
  ]);
});

test('browser selection deduplicates suites and preserves their build commands', () => {
  const plan = buildTestPlan(
    'browser',
    [
      'static-first-use',
      'transfer-formats',
      'static-first-use',
      '--matrix',
      '--screenshots',
    ],
    catalog,
  );
  assert.deepEqual(
    plan.commands.map((item) => item.args),
    [
      ['run', 'test:browser:static-first-use'],
      ['run', 'test:browser:transfer-formats'],
    ],
  );
  assert.equal(plan.matrix, true);
  assert.equal(plan.screenshots, true);
  assert.equal(
    catalog.scripts['test:browser:static-first-use'].startsWith(
      'npm run build',
    ),
    true,
  );
});

test('listing does not execute anything, and browser flags cannot silently affect unit selection', () => {
  const plan = buildTestPlan('browser', ['--list'], catalog);
  assert.deepEqual(plan.available, ['static-first-use', 'transfer-formats']);
  assert.deepEqual(plan.commands, []);
  assert.throws(
    () => buildTestPlan('unit', ['desktop-keyboard', '--matrix'], catalog),
    /browser/,
  );
});

test('quick layouts cover every language, theme and viewport while the full matrix remains available', () => {
  const quick = layoutCases({});
  const matrix = layoutCases({ TEST_MATRIX: '1' });
  assert.equal(quick.length, 4);
  assert.equal(matrix.length, 12);
  assert.equal(new Set(matrix.map((item) => JSON.stringify(item))).size, 12);
  assert.deepEqual(
    [...new Set(quick.map((item) => item.width))].sort(),
    [1440, 320, 390],
  );
  assert.deepEqual([...new Set(quick.map((item) => item.language))].sort(), [
    'en',
    'zh',
  ]);
  assert.deepEqual(
    [...new Set(quick.map((item) => item.appearanceMode))].sort(),
    ['dark-glass', 'light-glass'],
  );
  for (const item of quick) {
    assert.ok(
      matrix.some(
        (candidate) => JSON.stringify(candidate) === JSON.stringify(item),
      ),
    );
  }
  assert.equal(captureScreenshots({}), false);
  assert.equal(captureScreenshots({ TEST_SCREENSHOTS: '1' }), true);
  assert.equal(captureScreenshots({ TEST_MATRIX: '1' }), true);
});

test('the real CLI previews selected commands and refuses an empty selection', () => {
  const script = fileURLToPath(
    new URL('../../scripts/test-selected.mjs', import.meta.url),
  );
  const preview = spawnSync(
    process.execPath,
    [script, 'browser', 'transfer-formats', 'transfer-formats', '--dry-run'],
    { encoding: 'utf8' },
  );
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(
    preview.stdout.match(/npm run test:browser:transfer-formats/g)?.length,
    1,
  );
  assert.doesNotMatch(preview.stdout, /PASS|FAIL/);
  const empty = spawnSync(process.execPath, [script, 'unit'], {
    encoding: 'utf8',
  });
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /Select/);
});

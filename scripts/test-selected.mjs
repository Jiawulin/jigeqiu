import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function buildTestPlan(kind, args, { scripts, unitFiles }) {
  if (!['unit', 'browser'].includes(kind)) throw new Error('Choose unit or browser.');
  const flags = new Set(['--list', '--dry-run', '--matrix', '--screenshots']);
  for (const arg of args) {
    if (arg.startsWith('--') && !flags.has(arg)) throw new Error(`Unknown flag: ${arg}`);
  }
  if (kind === 'unit' && args.some(arg => ['--matrix', '--screenshots'].includes(arg))) {
    throw new Error('--matrix and --screenshots are browser options.');
  }
  const available = kind === 'unit'
    ? unitFiles.map(file => file.replace(/\.test\.ts$/, '')).sort()
    : Object.keys(scripts).filter(key => key.startsWith('test:browser:'))
      .map(key => key.slice('test:browser:'.length)).sort();
  const requested = [...new Set(args.filter(arg => !arg.startsWith('--')).map(arg => kind === 'unit'
    ? arg.replace(/^tests\/unit\//, '').replace(/\.test\.ts$/, '') : arg))];
  for (const name of requested) {
    if (!available.includes(name)) throw new Error(`Unknown ${kind} test: ${name}. Use --list.`);
  }
  if (!requested.length && !args.includes('--list')) throw new Error('Select at least one test. Use --list.');
  const commands = args.includes('--list') ? [] : kind === 'unit'
    ? [{
      command: process.execPath,
      args: ['--import', 'tsx', '--test', ...requested.map(name => `tests/unit/${name}.test.ts`)],
      label: `unit (${requested.length} ${requested.length === 1 ? 'file' : 'files'})`,
    }]
    : requested.map(name => ({
      command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
      args: ['run', `test:browser:${name}`],
      label: name,
    }));
  return {
    commands, available, list: args.includes('--list'), dryRun: args.includes('--dry-run'),
    matrix: args.includes('--matrix'), screenshots: args.includes('--screenshots'),
  };
}

function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const unitFiles = readdirSync(new URL('../tests/unit/', import.meta.url)).filter(file => file.endsWith('.test.ts'));
  const plan = buildTestPlan(process.argv[2], process.argv.slice(3), { scripts: manifest.scripts, unitFiles });
  if (plan.list) { console.log(plan.available.join('\n')); return; }
  const env = { ...process.env };
  if (plan.matrix) env.TEST_MATRIX = '1';
  if (plan.screenshots) env.TEST_SCREENSHOTS = '1';
  for (const command of plan.commands) {
    console.log(`\n[selected] ${command.command} ${command.args.join(' ')}`);
    if (plan.dryRun) continue;
    const start = performance.now();
    const result = spawnSync(command.command, command.args, { cwd: root, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    console.log(`[selected] ${command.label}: ${result.status === 0 ? 'PASS' : 'FAIL'} (${((performance.now() - start) / 1000).toFixed(1)}s)`);
    if (result.status !== 0) { process.exitCode = result.status ?? 1; return; }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

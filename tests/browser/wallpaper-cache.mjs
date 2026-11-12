import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { get } from 'node:http';

const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', chunk => { output += chunk; });
server.stderr.on('data', chunk => { output += chunk; });
try {
  const started = Date.now();
  while (!output.includes('Server listening')) {
    if (server.exitCode !== null || Date.now() - started > 15_000) throw new Error(output);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const url = `http://127.0.0.1:${port}/wallpapers/snow-mountain-desktop.webp?v=2`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') ?? '', /public.*max-age=2592000/);
  assert.match(response.headers.get('content-type') ?? '', /image\/webp/);
  const etag = response.headers.get('etag');
  assert.ok(etag);
  // Node fetch adds no-cache to conditional requests, forcing Express to send 200.
  const revalidated = await new Promise((resolve, reject) => {
    get(url, { headers: { 'If-None-Match': etag } }, response => {
      let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; });
      response.on('end', () => resolve({ status: response.statusCode, bytes }));
      response.on('error', reject);
    }).on('error', reject);
  });
  assert.equal(revalidated.status, 304);
  assert.equal(revalidated.bytes, 0);
  const revision = await fetch(url.replace('v=2', 'v=3'));
  assert.equal(revision.status, 200, 'Changed version URL does not reuse an older response');
  const index = await fetch(`http://127.0.0.1:${port}/`);
  assert.doesNotMatch(index.headers.get('cache-control') ?? '', /max-age=2592000/,
    'HTML cannot inherit wallpaper cache lifetime');
  console.log('PASS production wallpaper 30-day caching, ETag/304, versioned URL and uncached HTML');
} finally {
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  await exited;
}

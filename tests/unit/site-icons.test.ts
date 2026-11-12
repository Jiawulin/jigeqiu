import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createSiteIconService, type SiteIconState, type SiteIconRecord,
} from '../../src/services/site-icons';
import * as icons from '../../src/services/site-icons';
import { createSiteIconPersistence } from '../../src/services/site-icon-persistence';
import type { SiteIconCandidate } from '../../src/services/site-icon-discovery';

const DAY = 86_400_000;
const request = { url: 'https://example.test/private/page?token=secret' };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  let now = 1;
  let fail = false;
  const calls: string[] = [];
  const records = new Map<string, SiteIconRecord>();
  const preferences = new Map<string, string>();
  const revoked: string[] = [];
  let objectId = 0;
  const deps = {
    discover: async (_url: string, _options: { signal: AbortSignal }): Promise<SiteIconCandidate[]> => [],
    now: () => now,
    load: async (source: string, _signal: AbortSignal): Promise<{ blob?: Blob }> => {
      calls.push(source);
      if (fail) throw new Error('unavailable');
      return {};
    },
    persistence: {
      read: async (key: string) => records.get(key),
      write: async (record: SiteIconRecord) => { records.set(record.key, record); },
      clear: async () => { records.clear(); },
    },
    preferences: {
      getItem: (key: string) => preferences.get(key) ?? null,
      setItem: (key: string, value: string) => { preferences.set(key, value); },
    },
    createObjectURL: (_blob: Blob) => `blob:owned-${++objectId}`,
    revokeObjectURL: (url: string) => { revoked.push(url); },
  };
  return {
    deps, calls, records, preferences, revoked,
    advance: (ms: number) => { now += ms; },
    fail: (value = true) => { fail = value; },
  };
}

test('manual automatic refresh discovers a declared SVG instead of retrying only favicon.ico', async () => {
  const h = harness();
  const svg = 'https://example.test/brand/tianmu-viewer.svg';
  const discovered: string[] = [];
  h.deps.discover = async (url, options) => {
    assert.equal(options.signal.aborted, false);
    discovered.push(url);
    return [{ url: svg, kind: 'icon', width: 512, height: 512 }];
  };
  const service = createSiteIconService(h.deps);
  await service.refreshSiteIcon(request);
  assert.deepEqual(discovered, ['https://example.test/']);
  assert.deepEqual(h.calls, [svg]);
  assert.deepEqual(service.peekSiteIcon(request), { status: 'ready', src: svg });
  const reloaded = createSiteIconService(h.deps);
  reloaded.watchSiteIcon(request, () => {});
  await tick();
  assert.deepEqual(reloaded.peekSiteIcon(request), { status: 'ready', src: svg });
  assert.deepEqual(h.calls, [svg], 'Discovered metadata survives reload without another fetch');
});

test('automatic display discovers declarations after the usual favicon fails', async () => {
  const h = harness();
  const svg = 'https://example.test/brand/icon.svg';
  h.deps.discover = async () => [{ url: svg, kind: 'icon', width: 512, height: 512 }];
  h.deps.load = async source => {
    h.calls.push(source);
    if (source !== svg) throw new Error('not found');
    return {};
  };
  const service = createSiteIconService(h.deps);
  service.watchSiteIcon(request, () => {});
  await tick();
  assert.deepEqual(service.peekSiteIcon(request), { status: 'ready', src: svg });
});

test('discovered CDN URLs survive reload and failed refresh preserves the previous image', async () => {
  const h = harness();
  const source = 'https://cdn.example.test/brand.svg';
  h.deps.discover = async () => [{ url: source, kind: 'icon', width: 512, height: 512 }];
  await createSiteIconService(h.deps).refreshSiteIcon(request);
  const service = createSiteIconService(h.deps);
  service.watchSiteIcon(request, () => {});
  await tick();
  assert.deepEqual(service.peekSiteIcon(request), { status: 'ready', src: source });
  h.deps.discover = async () => { throw new Error('CORS'); };
  h.fail();
  await assert.rejects(service.refreshSiteIcon(request));
  assert.deepEqual(service.peekSiteIcon(request), { status: 'ready', src: source });
});

test('clearing during discovery prevents late candidates from loading or persisting', async () => {
  const h = harness();
  const result = deferred<SiteIconCandidate[]>();
  let signal: AbortSignal | undefined;
  h.deps.discover = (_url, options) => {
    signal = options.signal;
    return result.promise;
  };
  const service = createSiteIconService(h.deps);
  const refresh = service.refreshSiteIcon(request);
  const rejected = assert.rejects(refresh, /cancelled/);
  await tick();
  await service.clearSiteIconCache();
  assert.equal(signal?.aborted, true);
  result.resolve([{ url: 'https://cdn.example.test/late.svg', kind: 'icon', width: 512, height: 512 }]);
  await rejected;
  assert.deepEqual(h.calls, []);
  assert.equal(h.records.size, 0);
});

test('refresh leaves explicit icons and text choices untouched instead of discovering replacements', async () => {
  const h = harness();
  let searches = 0;
  h.deps.discover = async () => { searches++; return []; };
  const service = createSiteIconService(h.deps);
  await service.refreshSiteIcon({ ...request, icon: 'https://example.test/chosen.svg', iconMode: 'custom' });
  await assert.rejects(service.refreshSiteIcon({ ...request, iconMode: 'text' }));
  assert.deepEqual(h.calls, ['https://example.test/chosen.svg']);
  assert.equal(searches, 0);
});
test('peek is side-effect free; watch immediately emits loading and shares origin resolution', async () => {
  const h = harness();
  const service = createSiteIconService(h.deps);
  assert.deepEqual(service.peekSiteIcon(request), { status: 'loading' });
  assert.equal(h.calls.length, 0);
  const states: SiteIconState[] = [];
  service.watchSiteIcon(request, state => states.push(state));
  service.watchSiteIcon({ url: 'https://example.test/another' }, () => {});
  assert.deepEqual(states, [{ status: 'loading' }]);
  await tick();
  assert.deepEqual(h.calls, ['https://example.test/favicon.ico']);
  assert.deepEqual(states.at(-1), { status: 'ready', src: 'https://example.test/favicon.ico' });
  assert.deepEqual(service.peekSiteIcon(request), states.at(-1));
  const cached: SiteIconState[] = [];
  service.watchSiteIcon(request, state => cached.push(state));
  assert.deepEqual(cached[0], states.at(-1));
});

test('explicit text mode never requests images, including provider and saved image', async () => {
  const h = harness();
  const service = createSiteIconService(h.deps);
  const input = { ...request, icon: 'https://custom.test/icon.png', iconMode: 'text' as const };
  assert.deepEqual(service.peekSiteIcon(input), { status: 'fallback' });
  service.watchSiteIcon(input, () => {});
  await tick();
  assert.equal(h.calls.length, 0);
});

test('automatically selected high resolution source gets normal seven day refresh', async () => {
  const h = harness();
  const service = createSiteIconService(h.deps);
  const input = { ...request, icon: 'https://example.test/apple-touch-icon.png', iconMode: 'auto' as const };
  await service.refreshSiteIcon(input);
  h.advance(7 * DAY);
  service.watchSiteIcon(input, () => {});
  await tick();
  assert.deepEqual(h.calls, [input.icon, input.icon]);
});

test('saved automatic provider source cannot bypass a subsequently disabled provider', async () => {
  const h = harness();
  const service = createSiteIconService(h.deps);
  await service.refreshSiteIcon({
    ...request, icon: 'https://www.google.com/s2/favicons?domain=example.test&sz=128', iconMode: 'auto',
  });
  assert.deepEqual(h.calls, ['https://example.test/favicon.ico']);
});

test('rejects unsafe page URLs before deriving any icon source', async () => {
  const h = harness();
  const service = createSiteIconService(h.deps);
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,hi', '/relative', 'https://a:b@example.test', 'https://example.test/a\nb']) {
    const states: SiteIconState[] = [];
    service.watchSiteIcon({ url, icon: 'https://images.test/good.png' }, state => states.push(state));
    await tick();
    assert.equal(states.at(-1)?.status, 'fallback', url);
  }
  assert.equal(h.calls.length, 0);
});

test('orders explicit, selected platform and official icons without a provider', async () => {
  const h = harness();
  h.fail();
  const service = createSiteIconService(h.deps);
  await assert.rejects(service.refreshSiteIcon({
    ...request, icon: 'https://images.test/custom.png', platformIcon: 'https://platform.test/icon.png',
  }));
  assert.deepEqual(h.calls, [
    'https://images.test/custom.png', 'https://platform.test/icon.png',
    'https://example.test/favicon.ico',
  ]);
  assert.ok([...h.records.values()].every(record => !JSON.stringify(record).includes('secret')));
});

test('unsafe or relative explicit icons are skipped and provider is disabled by default', async () => {
  const h = harness();
  h.fail();
  const service = createSiteIconService(h.deps);
  await assert.rejects(service.refreshSiteIcon({
    ...request, icon: 'data:image/svg+xml,<svg/>', platformIcon: '/relative.png',
  }));
  assert.deepEqual(h.calls, ['https://example.test/favicon.ico']);
});

test('7-day stale auto refresh retains success and backs off failed refresh for 24 hours', async () => {
  const h = harness();
  const service = createSiteIconService(h.deps);
  await service.refreshSiteIcon(request);
  h.advance(7 * DAY);
  h.fail();
  const states: SiteIconState[] = [];
  service.watchSiteIcon(request, state => states.push(state));
  await tick();
  assert.equal(h.calls.length, 2);
  assert.ok(states.every(state => state.status === 'ready'));
  service.watchSiteIcon(request, () => {});
  await tick();
  assert.equal(h.calls.length, 2);
  h.advance(DAY);
  service.watchSiteIcon(request, () => {});
  await tick();
  assert.equal(h.calls.length, 3);
  await assert.rejects(service.refreshSiteIcon(request));
  assert.equal(h.calls.length, 4);
  assert.equal(service.peekSiteIcon(request).status, 'ready');
});

test('failed uncached attempts wait 24h; explicit user successes never auto refresh', async () => {
  const h = harness();
  const service = createSiteIconService(h.deps);
  h.fail();
  await assert.rejects(service.refreshSiteIcon(request));
  service.watchSiteIcon(request, () => {});
  await tick();
  assert.equal(h.calls.length, 1);
  h.advance(DAY);
  h.fail(false);
  service.watchSiteIcon(request, () => {});
  await tick();
  assert.equal(h.calls.length, 2);
  const custom = { ...request, icon: 'https://custom.test/icon.png' };
  await service.refreshSiteIcon(custom);
  h.advance(100 * DAY);
  service.watchSiteIcon(custom, () => {});
  await tick();
  assert.equal(h.calls.length, 3);
  await service.refreshSiteIcon(custom);
  assert.equal(h.calls.length, 4);
});

test('reload hydrates metadata and blobs without another network request', async () => {
  const h = harness();
  h.deps.load = async source => { h.calls.push(source); return { blob: new Blob(['icon'], { type: 'image/png' }) }; };
  await createSiteIconService(h.deps).refreshSiteIcon(request);
  const service = createSiteIconService(h.deps);
  service.watchSiteIcon(request, () => {});
  await tick();
  assert.deepEqual(service.peekSiteIcon(request), { status: 'ready', src: 'blob:owned-2' });
  assert.equal(h.calls.length, 1);
});

test('persistence read/write failure degrades to memory but clear failure rejects', async () => {
  const h = harness();
  h.deps.persistence = {
    read: async () => { throw new Error('IDB unavailable'); },
    write: async () => { throw new Error('quota'); },
    clear: async () => { throw new Error('clear failed'); },
  };
  const service = createSiteIconService(h.deps);
  await service.refreshSiteIcon(request);
  assert.equal(service.peekSiteIcon(request).status, 'ready');
  await assert.rejects(service.clearSiteIconCache(), /clear failed/);
});

test('clear prevents inflight resurrection and waits for durable clearing', async () => {
  const h = harness();
  const pending = deferred<{ blob?: Blob }>();
  let loads = 0;
  h.deps.load = async () => {
    if (!loads++) return pending.promise;
    throw new Error('new attempt unavailable');
  };
  const service = createSiteIconService(h.deps);
  service.watchSiteIcon(request, () => {});
  await tick();
  await service.clearSiteIconCache();
  pending.resolve({ blob: new Blob(['icon']) });
  await tick();
  assert.ok([...h.records.values()].every(record => !record.source && !record.blob));
  assert.equal(service.peekSiteIcon(request).status, 'fallback');
});

test('active object URLs survive capacity pressure and are revoked on clear after notifying watchers', async () => {
  const h = harness();
  h.deps.load = async () => ({ blob: new Blob(['icon'], { type: 'image/png' }) });
  const service = createSiteIconService(h.deps);
  let current: SiteIconState = { status: 'loading' };
  service.watchSiteIcon(request, state => {
    if (current.src?.startsWith('blob:')) assert.ok(!h.revoked.includes(current.src));
    current = state;
  });
  await tick();
  const active = current.src!;
  for (let index = 0; index < 260; index++) {
    await service.refreshSiteIcon({ url: `https://site-${index}.test` });
  }
  assert.ok(!h.revoked.includes(active));
  await service.clearSiteIconCache();
  assert.equal(current.status, 'loading');
  assert.ok(h.revoked.includes(active));
  await tick();
  assert.equal(current.status, 'ready');
});

// Small PNG header fixtures exercise pre-decode validation; decoding is an injected browser boundary.
function png(width = 32, height = 32) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
function transport(fetch: typeof globalThis.fetch) {
  const decoded: Blob[] = [];
  const images: string[] = [];
  const loader = icons.createSiteIconLoader({
    fetch,
    decode: async (blob: Blob) => { decoded.push(blob); },
    loadImage: async (source: string) => { images.push(source); },
    timeoutMs: 25,
  });
  return { loader, decoded, images };
}
test('fetch revalidates HTTP cache without credentials/referrer and decodes a bounded CORS raster', async () => {
  let init: RequestInit | undefined;
  const t = transport(async (_url, options) => {
    init = options;
    return new Response(png(), { headers: { 'content-type': 'image/png' } });
  });
  const result = await t.loader('https://example.test/favicon.ico', new AbortController().signal);
  assert.equal(init?.mode, 'cors');
  assert.equal(init?.credentials, 'omit');
  assert.equal(init?.referrerPolicy, 'no-referrer');
  assert.equal(init?.cache, 'no-cache');
  assert.equal(result.blob?.type, 'image/png');
  assert.equal(t.decoded.length, 1);
  assert.equal(t.images.length, 0);
});

test('rejects known oversized, streamed oversized, nonimages and giant dimensions without Image bypass', async () => {
  for (const response of [
    new Response(png(), { headers: { 'content-type': 'image/png', 'content-length': '524289' } }),
    new Response(new Uint8Array(524289), { headers: { 'content-type': 'image/png' } }),
    new Response('html', { headers: { 'content-type': 'text/html' } }),
    new Response(png(100000, 100000), { headers: { 'content-type': 'image/png' } }),
    new Response('not a png', { headers: { 'content-type': 'image/png' } }),
    new Response(png(), { status: 404, headers: { 'content-type': 'image/png' } }),
  ]) {
    const t = transport(async () => response);
    await assert.rejects(t.loader('https://example.test/favicon.ico', new AbortController().signal));
    assert.equal(t.decoded.length, 0);
    assert.equal(t.images.length, 0);
  }
});

test('CORS rejection or opaque response uses one Image probe and persists no opaque blob', async () => {
  for (const fetch of [
    async () => { throw new TypeError('Failed to fetch'); },
    async () => ({ type: 'opaque' }) as Response,
  ]) {
    const t = transport(fetch);
    assert.deepEqual(await t.loader('https://example.test/favicon.ico', new AbortController().signal), {});
    assert.deepEqual(t.images, ['https://example.test/favicon.ico']);
    assert.equal(t.decoded.length, 0);
  }
});

test('decode failure never falls back to loading the unvalidated source URL', async () => {
  let probes = 0;
  const loader = icons.createSiteIconLoader({
    fetch: async () => new Response(png(), { headers: { 'content-type': 'image/png' } }),
    decode: async () => { throw new Error('decode failed'); },
    loadImage: async () => { probes++; },
    timeoutMs: 25,
  });
  await assert.rejects(loader('https://example.test/favicon.ico', new AbortController().signal), /decode failed/);
  assert.equal(probes, 0);
});

test('fetch and Image probes time out and abort without hanging or retry loops', async () => {
  for (const corsFails of [false, true]) {
    let probes = 0;
    const loader = icons.createSiteIconLoader({
      fetch: async () => {
        if (corsFails) throw new TypeError('CORS');
        return new Promise<Response>(() => {});
      },
      decode: async () => {},
      loadImage: async () => { probes++; return new Promise<void>(() => {}); },
      timeoutMs: 5,
    });
    await assert.rejects(loader('https://example.test/favicon.ico', new AbortController().signal), /timed out/);
    assert.equal(probes, corsFails ? 1 : 0);
  }
});

test('manual refresh shares inflight resolution and duplicate source probes across different requests', async () => {
  const h = harness();
  const pending = deferred<{ blob?: Blob }>();
  h.deps.load = async source => { h.calls.push(source); return pending.promise; };
  const service = createSiteIconService(h.deps);
  const first = { ...request, icon: 'https://shared.test/icon.png' };
  const second = { url: 'https://other.test', icon: 'https://shared.test/icon.png' };
  const a = service.refreshSiteIcon(first);
  const b = service.refreshSiteIcon(first);
  const c = service.refreshSiteIcon(second);
  await tick();
  pending.resolve({});
  await Promise.all([a, b, c]);
  assert.deepEqual(h.calls, ['https://shared.test/icon.png']);
  assert.equal(service.peekSiteIcon(second).src, 'https://shared.test/icon.png');
});

test('stale-refresh backoff survives reload', async () => {
  const h = harness();
  await createSiteIconService(h.deps).refreshSiteIcon(request);
  h.advance(8 * DAY);
  h.fail();
  await assert.rejects(createSiteIconService(h.deps).refreshSiteIcon(request));
  const reloaded = createSiteIconService(h.deps);
  reloaded.watchSiteIcon(request, () => {});
  await tick();
  assert.equal(h.calls.length, 2);
  assert.equal(reloaded.peekSiteIcon(request).status, 'ready');
});

test('a successful explicit source is reused across different page origins, not just inflight', async () => {
  const h = harness();
  const service = createSiteIconService(h.deps);
  const icon = 'https://shared.test/icon.png';
  await service.refreshSiteIcon({ ...request, icon });
  service.watchSiteIcon({ url: 'https://different.test/page', icon }, () => {});
  await tick();
  assert.deepEqual(h.calls, [icon]);
});

test('legacy provider opt-in is ignored for public and private hosts', async () => {
  const h = harness();
  h.fail();
  const service = createSiteIconService(h.deps);
  h.preferences.set('jigeqiu.site-icons.third-party.v1', 'true');
  for (const host of ['example.com', 'localhost', 'localhost.localdomain', 'router', 'printer.local', 'app.internal', 'home.lan',
    '127.0.0.1', '10.0.0.1', '172.16.2.1', '192.168.1.1', '169.254.1.1', '[::1]', '[fd00::1]', '8.8.8.8']) {
    await assert.rejects(service.refreshSiteIcon({ url: `http://${host}/private` }));
  }
  assert.ok(h.calls.every(source => !source.includes('google.com')));
});

test('clearing the cache aborts a durable write already in flight', async () => {
  const h = harness();
  const started = deferred<void>();
  let aborted = false;
  const service = createSiteIconService({
    ...h.deps,
    persistence: {
      ...h.deps.persistence,
      write: async (_record, signal) => {
        started.resolve();
        return new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')); });
        });
      },
    },
  });
  const work = service.refreshSiteIcon(request);
  await started.promise;
  const cleared = service.clearSiteIconCache();
  assert.equal(aborted, true);
  await assert.rejects(work, /cancelled/i);
  await cleared;
});

test('external SVG URLs use Image sandbox and metadata only, never SVG Blob decoding', async () => {
  const response = new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', {
    headers: { 'content-type': 'image/svg+xml' },
  });
  const t = transport(async () => response);
  assert.deepEqual(await t.loader('https://images.test/logo.svg', new AbortController().signal), {});
  assert.deepEqual(t.images, ['https://images.test/logo.svg']);
  assert.equal(t.decoded.length, 0);
  assert.equal(response.bodyUsed, true);
  await assert.rejects(t.loader('data:image/svg+xml,<svg/>', new AbortController().signal));
});

test('successful clear restarts mounted watchers without enabling the provider', async () => {
  const h = harness();
  const service = createSiteIconService(h.deps);
  service.watchSiteIcon(request, () => {});
  await tick();
  await service.clearSiteIconCache();
  await tick();
  assert.deepEqual(h.calls, ['https://example.test/favicon.ico', 'https://example.test/favicon.ico']);
  assert.equal(service.peekSiteIcon(request).status, 'ready');
});

// A transactional storage boundary, not a cache implementation: production code owns
// all retention, ordering, size limits and cancellation decisions.
function idbHarness() {
  const records = new Map<string, SiteIconRecord>();
  let abortNextWrite = false;
  const database = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction(_name: string, mode: string) {
      const snapshot = new Map(records);
      let stopped = false;
      const tasks: (() => void)[] = [];
      const tx = {
        error: null as Error | null,
        oncomplete: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
        onabort: undefined as (() => void) | undefined,
        abort() { stopped = true; tx.onabort?.(); },
        objectStore() {
          function queue(action: () => unknown) {
            const request = { result: undefined as unknown, onsuccess: undefined as (() => void) | undefined };
            tasks.push(() => { request.result = action(); request.onsuccess?.(); });
            return request;
          }
          return {
            get: (key: string) => queue(() => snapshot.get(key)),
            put: (record: SiteIconRecord) => queue(() => snapshot.set(record.key, record)),
            getAll: () => queue(() => [...snapshot.values()]),
            delete: (key: string) => queue(() => snapshot.delete(key)),
            clear: () => queue(() => snapshot.clear()),
          };
        },
      };
      setImmediate(() => {
        if (stopped) return;
        if (mode === 'readwrite' && abortNextWrite) {
          abortNextWrite = false;
          tx.error = new Error('transaction failed');
          tx.abort();
          return;
        }
        while (tasks.length && !stopped) tasks.shift()!();
        if (stopped) return;
        if (mode === 'readwrite') {
          records.clear();
          for (const [key, value] of snapshot) records.set(key, value);
        }
        tx.oncomplete?.();
      });
      return tx;
    },
  };
  const factory = {
    open() {
      const request = { result: database, onsuccess: undefined as (() => void) | undefined };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } as unknown as IDBFactory;
  return { records, factory, failNextWrite: () => { abortNextWrite = true; } };
}

test('durable store caps entries at 256 and evicts oldest metadata, including failures', async () => {
  const h = idbHarness();
  const store = createSiteIconPersistence(h.factory);
  for (let index = 0; index < 257; index++) {
    await store.write({ key: `icon-${index}`, updatedAt: 0, failedAt: index, accessedAt: index });
  }
  assert.equal(h.records.size, 256);
  assert.equal(await store.read('icon-0'), undefined);
  assert.equal((await store.read('icon-256'))?.failedAt, 256);
});

test('durable store caps blob bytes at 20 MiB and rejects individual blobs over 512 KiB', async () => {
  const h = idbHarness();
  const store = createSiteIconPersistence(h.factory);
  const blob = new Blob([new Uint8Array(512 * 1024)], { type: 'image/png' });
  for (let index = 0; index < 41; index++) {
    await store.write({ key: `icon-${index}`, source: 'https://example.test/icon.png', blob,
      updatedAt: index, accessedAt: index });
  }
  assert.equal(h.records.size, 40);
  assert.equal(await store.read('icon-0'), undefined);
  assert.equal([...h.records.values()].reduce((sum, record) => sum + record.blob!.size, 0), 20 * 1024 * 1024);
  await assert.rejects(store.write({
    key: 'huge', blob: new Blob([new Uint8Array(524289)]), updatedAt: 100, accessedAt: 100,
  }), /byte limit/);
  assert.equal(h.records.size, 40);
});

test('durable clear waits for commit, reports failure, and touches only icon records', async () => {
  const h = idbHarness();
  const store = createSiteIconPersistence(h.factory);
  await store.write({ key: 'icon', updatedAt: 1, accessedAt: 1 });
  h.failNextWrite();
  await assert.rejects(store.clear(), /transaction failed/);
  assert.equal(h.records.size, 1);
  await store.clear();
  assert.equal(h.records.size, 0);
});

test('durable writes with a cancelled generation never commit', async () => {
  const h = idbHarness();
  const store = createSiteIconPersistence(h.factory);
  await store.read('initialize');
  const controller = new AbortController();
  const work = store.write({ key: 'old-generation', updatedAt: 1, accessedAt: 1 }, controller.signal);
  await Promise.resolve();
  controller.abort();
  await assert.rejects(work);
  assert.equal(h.records.size, 0);
});

test('manual refresh upgrades a concurrent fresh-cache hydration into a real attempt', async () => {
  const h = harness();
  await createSiteIconService(h.deps).refreshSiteIcon(request);
  const service = createSiteIconService(h.deps);
  service.watchSiteIcon(request, () => {});
  h.fail();
  await assert.rejects(service.refreshSiteIcon(request));
  assert.equal(h.calls.length, 2);
  assert.equal(service.peekSiteIcon(request).status, 'ready');
});

for (const icon of [undefined, 'https://custom.test/icon.png']) {
  const label = icon ? 'explicit user icon' : 'official icon';
  const source = icon ?? 'https://example.test/favicon.ico';

  test(`hydration discards a blob-shaped object and resolves the ${label} with strict object URLs`, async () => {
    const h = harness();
    h.deps.createObjectURL = URL.createObjectURL;
    h.deps.revokeObjectURL = URL.revokeObjectURL;
    h.deps.persistence.read = async key => ({
      key, source, blob: { size: 1 } as Blob, updatedAt: 1, accessedAt: 1,
    });
    const service = createSiteIconService(h.deps);
    const states: SiteIconState[] = [];
    service.watchSiteIcon({ ...request, icon }, state => states.push(state));
    await tick();
    assert.deepEqual(h.calls, [source]);
    assert.deepEqual(states.at(-1), { status: 'ready', src: source });
    assert.equal([...h.records.values()][0]?.blob, undefined);
  });

  test(`hydration retries the ${label} after valid Blob object-URL allocation fails`, async () => {
    const h = harness();
    const blob = new Blob(['icon'], { type: 'image/png' });
    h.deps.persistence.read = async key => ({
      key, source, blob, updatedAt: 1, accessedAt: 1,
    });
    h.deps.createObjectURL = value => {
      // Exercise native Blob validation before simulating an allocation failure.
      const url = URL.createObjectURL(value);
      URL.revokeObjectURL(url);
      throw new Error('Object URL allocation unavailable');
    };
    const service = createSiteIconService(h.deps);
    const states: SiteIconState[] = [];
    service.watchSiteIcon({ ...request, icon }, state => states.push(state));
    await tick();
    assert.deepEqual(h.calls, [source]);
    assert.deepEqual(states.at(-1), { status: 'ready', src: source });
    assert.equal([...h.records.values()][0]?.blob, undefined);
  });
}

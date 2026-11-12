import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createSiteIconDiscovery, discoverSiteIcons, rankSiteIconCandidates, type SiteIconCandidate,
} from '../../src/services/site-icon-discovery';

const origin = 'https://example.test';
const page = `${origin}/private/page?token=secret#fragment`;
const common = [
  'favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'apple-touch-icon-precomposed.png',
  'favicon-192x192.png', 'favicon-32x32.png',
].map(path => `${origin}/${path}`);
const options = () => ({ signal: new AbortController().signal });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function response(text: string, url = `${origin}/`, headers: Record<string, string> = {}) {
  const result = new Response(text, { headers });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}

// Model only the browser transport boundary; discovery owns queuing, validation,
// request policy, image lifecycle and all ranking decisions.
function harness() {
  const requests: { url: string; init: RequestInit }[] = [];
  const probes: string[] = [];
  const imageEvents: { image: HTMLImageElement; source: string }[] = [];
  const cleared: string[] = [];
  const sizes = new Map<string, [number, number]>();
  let active = 0;
  let peak = 0;
  let autoImages = true;
  const h = {
    requests, probes, imageEvents, cleared, sizes,
    fetch: async (_url: string, _init: RequestInit): Promise<Response> => { throw new TypeError('CORS denied'); },
    get peak() { return peak; },
    manualImages() { autoImages = false; },
    finish(image: HTMLImageElement, source: string) {
      active--;
      const size = sizes.get(source);
      if (size) {
        Object.defineProperties(image, {
          naturalWidth: { configurable: true, value: size[0] },
          naturalHeight: { configurable: true, value: size[1] },
        });
        image.onload?.({} as Event);
      } else image.onerror?.({} as Event);
    },
    discover: (_url: string, _options: Parameters<typeof discoverSiteIcons>[1]): Promise<SiteIconCandidate[]> =>
      Promise.resolve([]),
  };
  h.discover = createSiteIconDiscovery({
    fetch: (async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return h.fetch(url, init);
    }) as typeof fetch,
    createImage() {
      let source = '';
      const image = {
        onload: null, onerror: null, referrerPolicy: '', naturalWidth: 0, naturalHeight: 0,
        get src() { return source; },
        set src(value: string) {
          if (!value) { cleared.push(source); active--; source = ''; return; }
          assert.equal(this.referrerPolicy, 'no-referrer');
          source = value;
          probes.push(value);
          active++;
          peak = Math.max(peak, active);
          imageEvents.push({ image: image as unknown as HTMLImageElement, source });
          if (autoImages) queueMicrotask(() => h.finish(image as unknown as HTMLImageElement, value));
        },
      };
      return image as unknown as HTMLImageElement;
    },
    timeoutMs: 30,
  });
  return h;
}

test('exports the agreed default discover function', () => {
  assert.equal(typeof discoverSiteIcons, 'function');
});

test('ranks actual square resolution ahead of tiny icons and wide logos without inferring SVG quality', () => {
  const make = (url: string, width: number, height: number, kind: SiteIconCandidate['kind'] = 'icon') =>
    ({ url: `${origin}/${url}`, width, height, kind });
  const input = [
    make('wide.png', 1200, 160, 'logo'), make('tiny.svg', 16, 16),
    make('sharp.png', 192, 192), make('medium.png', 128, 128), make('a.png', 192, 192),
  ];
  const snapshot = structuredClone(input);
  const ranked = rankSiteIconCandidates(input);
  assert.equal(ranked[0].url, `${origin}/a.png`);
  assert.ok(ranked.findIndex(c => c.url.endsWith('sharp.png')) < ranked.findIndex(c => c.url.endsWith('medium.png')));
  assert.ok(ranked.findIndex(c => c.url.endsWith('medium.png')) < ranked.findIndex(c => c.url.endsWith('wide.png')));
  assert.ok(ranked.findIndex(c => c.url.endsWith('sharp.png')) < ranked.findIndex(c => c.url.endsWith('tiny.svg')));
  assert.deepEqual(rankSiteIconCandidates([...input].reverse()), ranked);
  assert.deepEqual(input, snapshot);
  assert.equal(rankSiteIconCandidates([make('large', 512, 512), make('small', 192, 192)], 512)[0].width, 512);
});

test('CORS denial falls back only to six known paths, yielding loadable measured candidates and progress', async () => {
  const h = harness();
  h.sizes.set(common[0], [32, 32]);
  h.sizes.set(common[2], [180, 180]);
  const emitted: SiteIconCandidate[] = [];
  const result = await h.discover(page, { ...options(), onCandidate: c => emitted.push(c) });
  assert.deepEqual(h.probes, common);
  assert.deepEqual(result.map(c => [c.url, c.width, c.height]), [
    [common[2], 180, 180], [common[0], 32, 32],
  ]);
  assert.deepEqual(rankSiteIconCandidates(emitted), result);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, `${origin}/`);
  assert.equal(h.requests[0].init.mode, 'cors');
  assert.equal(h.requests[0].init.credentials, 'omit');
  assert.equal(h.requests[0].init.referrerPolicy, 'no-referrer');
  assert.ok(h.peak <= 3);
});

test('candidate validation shares the three-worker budget and finishes before publishing candidates', async () => {
  const h = harness();
  for (const source of common) h.sizes.set(source, [180, 180]);
  const releases: (() => void)[] = [];
  const published: SiteIconCandidate[] = [];
  const work = h.discover(page, {
    ...options(),
    validateCandidate: () => new Promise<void>(resolve => releases.push(resolve)),
    onCandidate: candidate => published.push(candidate),
  });
  await tick();
  assert.equal(releases.length, 3, 'Each of the first three workers waits for validation');
  assert.equal(h.probes.length, 3, 'Pending validation prevents queued image probes from starting');
  assert.equal(published.length, 0, 'Unverified candidates cannot be selected');
  releases.splice(0).forEach(resolve => resolve());
  await tick();
  assert.equal(releases.length, 3);
  releases.splice(0).forEach(resolve => resolve());
  assert.equal((await work).length, 6);
});

test('unsafe inputs perform no fetch or image requests', async () => {
  const h = harness();
  for (const url of ['data:x', 'javascript:alert(1)', '/relative', 'https://a:b@example.test',
    'https://example.test/a\nb', 'https:\\\\example.test', 'https://example.test/\u007f']) {
    assert.deepEqual(await h.discover(url, options()), [], url);
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.probes.length, 0);
});

test('discovery never requests a provider for public or private hostnames', async () => {
  for (const host of ['localhost', 'x.localhost', 'x.localdomain', 'x.local', 'x.internal',
    'x.lan', 'x.home', 'x.arpa', 'x.onion', 'x.invalid', '127.0.0.1', '[::1]', 'printer']) {
    const h = harness();
    await h.discover(`https://${host}/secret?token=private`, options());
    assert.ok(h.probes.every(url => !url.includes('google.com')), host);
  }
  const h = harness();
  await h.discover(page, options());
  assert.deepEqual(h.probes, common);
  assert.ok(h.probes.every(url => !url.includes('secret')));
});

test('inert HTML resolves icons, safe base, final URLs and one manifest, ignoring covers and declared sizes', async () => {
  const h = harness();
  h.fetch = async url => url === `${origin}/` ? response(`
    <base href="/assets/">
    <link rel="ICON shortcut" href="sharp.png#duplicate" sizes="9000x9000">
    <link rel="icon" href="sharp.png">
    <link rel="apple-touch-icon-precomposed" href="//cdn.test/touch.png">
    <link rel="manifest" href="app.webmanifest">
    <link rel="manifest" href="never.webmanifest">
    <meta property="og:image" content="https://tracker.test/cover.jpg">
    <script>fetch('https://tracker.test/script')</script>
    <img src="https://tracker.test/pixel"><img class="brand-logo" src="brand.png">
    <img alt="Company Logo" src="logo2.png"><img id="logo3" src="logo3.png">
  `, 'https://redirect.test/home/') : response(JSON.stringify({
    icons: [{ src: '../manifest.png', sizes: '1x1' }],
  }), 'https://cdn.test/apps/final.webmanifest');
  for (const url of ['https://redirect.test/assets/sharp.png', 'https://cdn.test/touch.png',
    'https://cdn.test/manifest.png', 'https://redirect.test/assets/brand.png',
    'https://redirect.test/assets/logo2.png']) h.sizes.set(url, [192, 192]);
  const result = await h.discover(page, options());
  assert.equal(result.length, 5);
  assert.equal(result.find(c => c.url.endsWith('/sharp.png'))?.width, 192);
  assert.equal(result.find(c => c.url.endsWith('/manifest.png'))?.kind, 'manifest');
  assert.equal(result.find(c => c.url.endsWith('/touch.png'))?.kind, 'touch');
  assert.equal(result.find(c => c.url.endsWith('/brand.png'))?.kind, 'logo');
  assert.equal(h.probes.filter(url => url.endsWith('/sharp.png')).length, 1);
  assert.ok(h.probes.every(url => !/tracker|logo3/.test(url)));
  assert.deepEqual(h.requests.map(r => r.url), [`${origin}/`, 'https://redirect.test/assets/app.webmanifest']);
});

test('rejects unsafe declaration and base URLs, template contents, and unusable image dimensions', async () => {
  const h = harness();
  h.fetch = async () => response(`
    <base href="javascript:bad"><link rel="icon" href="/good.png">
    <link rel="icon" href="https://u:p@bad.test/x">
    <link rel="icon" href="data:image/png,bad">
    <link rel="icon" href="https:\\\\bad.test/x">
    <link rel="icon" href="/bad&#10;name.png">
    <template><link rel="icon" href="/template.png"></template>
  `);
  h.sizes.set(`${origin}/good.png`, [256, 256]);
  h.sizes.set(common[0], [2049, 200]);
  h.sizes.set(common[1], [0, 32]);
  h.sizes.set(common[2], [32, Number.NaN]);
  h.sizes.set(common[3], [2048, 2048]);
  const result = await h.discover(page, options());
  assert.deepEqual(new Set(result.map(c => c.url)), new Set([`${origin}/good.png`, common[3]]));
  assert.deepEqual(new Set(h.probes), new Set([...common, `${origin}/good.png`]));
});

test('bounds manifests to eight icons, total candidates to sixteen, and probes to three concurrent images', async () => {
  const h = harness();
  h.fetch = async url => url.endsWith('.webmanifest')
    ? response(JSON.stringify({ icons: Array.from({ length: 40 }, (_, i) => ({ src: `/manifest-${i}.png` })) }))
    : response('<link rel="manifest" href="/app.webmanifest"><img id="logo" src="/logo.png"><img id="logo2" src="/logo2.png">');
  for (let i = 0; i < 40; i++) h.sizes.set(`${origin}/manifest-${i}.png`, [192, 192]);
  for (const url of [...common, `${origin}/logo.png`, `${origin}/logo2.png`]) h.sizes.set(url, [192, 192]);
  const result = await h.discover(page, options());
  assert.equal(h.probes.filter(url => url.includes('/manifest-')).length, 8);
  assert.equal(h.probes.length, 16);
  assert.ok(result.length <= 16);
  assert.equal(h.peak, 3);
});

test('stream limits cancel oversized HTML and manifest bodies without parsing partial text', async () => {
  for (const manifest of [false, true]) {
    const h = harness();
    let cancelled = false;
    const limit = (manifest ? 64 : 256) * 1024;
    h.fetch = async url => {
      if (manifest && url === `${origin}/`) return response('<link rel="manifest" href="/app.webmanifest">');
      let sent = false;
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true;
            const text = manifest ? '{"icons":[{"src":"/forbidden.png"}]}' : '<link rel="icon" href="/forbidden.png">';
            controller.enqueue(new TextEncoder().encode(text.padEnd(limit + 1, ' ')));
          }
        },
        cancel() { cancelled = true; },
      }));
    };
    assert.deepEqual(await h.discover(page, options()), []);
    assert.equal(cancelled, true);
    assert.deepEqual(h.probes, common);
  }
});

test('oversized content-length and unsafe final response URLs are rejected before reading', async () => {
  for (const unsafeFinal of [false, true]) {
    const h = harness();
    let cancelled = false;
    h.fetch = async () => {
      const result = new Response(new ReadableStream({
        cancel() { cancelled = true; },
      }), { headers: unsafeFinal ? {} : { 'content-length': '262145' } });
      Object.defineProperty(result, 'url', { value: unsafeFinal ? 'https://u:p@bad.test/' : `${origin}/` });
      return result;
    };
    await h.discover(page, options());
    assert.equal(cancelled, true);
    assert.deepEqual(h.probes, common);
  }
});

test('already aborted requests reject without side effects', async () => {
  const h = harness();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(h.discover(page, { ...options(), signal: controller.signal }), { name: 'AbortError' });
  assert.equal(h.requests.length, 0);
  assert.equal(h.probes.length, 0);
});

test('abort clears active images, cancels a stalled body, stops queued work and suppresses stale progress', async () => {
  const h = harness();
  h.manualImages();
  let cancelled = false;
  h.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const controller = new AbortController();
  const emitted: SiteIconCandidate[] = [];
  const work = h.discover(page, { ...options(), signal: controller.signal, onCandidate: c => emitted.push(c) });
  const rejected = assert.rejects(work, { name: 'AbortError' });
  await tick();
  controller.abort();
  await rejected;
  assert.equal(cancelled, true);
  assert.ok(h.cleared.length <= 3);
  assert.ok(h.probes.length <= 3);
  assert.deepEqual(emitted, []);
  for (const { image } of h.imageEvents) assert.equal(image.onload, null);
});

test('timeouts bound uncooperative fetch and image loads, with ordinary fallback', async () => {
  const h = harness();
  h.fetch = () => new Promise(() => {});
  h.sizes.set(common[0], [32, 32]);
  assert.equal((await h.discover(page, options())).length, 1);
  const stalled = harness();
  stalled.manualImages();
  assert.deepEqual(await stalled.discover(page, options()), []);
  assert.equal(stalled.cleared.length, 6);
  assert.ok(stalled.peak <= 3);
});

test('abort during image probes clears exactly the three active images and never starts queued probes', async () => {
  const h = harness();
  h.manualImages();
  const controller = new AbortController();
  let notifications = 0;
  const work = h.discover(page, {
    ...options(), signal: controller.signal, onCandidate: () => { notifications++; },
  });
  await tick();
  assert.equal(h.probes.length, 3);
  controller.abort();
  await assert.rejects(work, { name: 'AbortError' });
  assert.equal(h.probes.length, 3);
  assert.equal(h.cleared.length, 3);
  assert.equal(notifications, 0);
  for (const { image } of h.imageEvents) {
    assert.equal(image.onload, null);
    assert.equal(image.onerror, null);
    assert.equal(image.src, '');
  }
});

test('stream read deadlines cancel stalled metadata and preserve loadable fallback icons', async () => {
  const h = harness();
  let cancelled = false;
  h.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  h.sizes.set(common[0], [32, 32]);
  assert.deepEqual((await h.discover(page, options())).map(c => c.url), [common[0]]);
  assert.equal(cancelled, true);
});

test('multi-chunk streaming uses byte counts and cancels before parsing an oversized UTF-8 document', async () => {
  const h = harness();
  let cancelled = false;
  let chunk = 0;
  h.fetch = async () => new Response(new ReadableStream({
    pull(controller) {
      if (chunk++ === 0) controller.enqueue(new TextEncoder().encode('<link rel="icon" href="/forbidden.png">'));
      else if (chunk === 2) controller.enqueue(new TextEncoder().encode('界'.repeat(90_000)));
    },
    cancel() { cancelled = true; },
  }));
  await h.discover(page, options());
  assert.equal(cancelled, true);
  assert.deepEqual(h.probes, common);
});

test('bad manifest JSON and HTTP errors are ordinary fallback, never no-cors retries', async () => {
  for (const kind of ['json', 'http', 'opaque']) {
    const h = harness();
    h.fetch = async url => {
      if (url === `${origin}/`) return response('<link rel="manifest" href="/app.webmanifest">');
      if (kind === 'http') return new Response('no', { status: 403 });
      if (kind === 'opaque') {
        const result = response('{"icons":[{"src":"/forbidden.png"}]}');
        Object.defineProperty(result, 'type', { value: 'opaque' });
        return result;
      }
      return response('{"icons":');
    };
    h.sizes.set(common[0], [32, 32]);
    assert.equal((await h.discover(page, options())).length, 1);
    assert.equal(h.requests.length, 2);
    assert.ok(h.requests.every(r => r.init.mode === 'cors' &&
      r.init.credentials === 'omit' && r.init.referrerPolicy === 'no-referrer'));
    assert.deepEqual(h.probes, common);
  }
});

import { parse, type DefaultTreeAdapterMap } from 'parse5';

export type SiteIconCandidate = {
  url: string;
  width: number;
  height: number;
  kind: 'icon' | 'touch' | 'manifest' | 'logo' | 'custom';
};
type DiscoveryOptions = {
  signal: AbortSignal;
  onCandidate?: (candidate: SiteIconCandidate) => void;
  validateCandidate?: (source: string, signal: AbortSignal) => Promise<unknown>;
};
type Dependencies = {
  fetch: typeof globalThis.fetch;
  createImage: () => HTMLImageElement;
  timeoutMs?: number;
};
const COMMON_PATHS = [
  'favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'apple-touch-icon-precomposed.png',
  'favicon-192x192.png', 'favicon-32x32.png',
];
const MAX_CANDIDATES = 16;
type Source = Pick<SiteIconCandidate, 'url' | 'kind'>;

function safeURL(value: string, base?: string): URL | undefined {
  if (!value || value.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = base ? new URL(value, base) : new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return;
    url.hash = '';
    return url;
  } catch { return; }
}

function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Icon discovery cancelled', 'AbortError');
}

// Every operation owns its deadline and cancellation, including transports which
// fail to settle their promises when aborted.
async function bounded<T>(signal: AbortSignal, timeoutMs: number, task: (signal: AbortSignal) => Promise<T>) {
  checkAbort(signal);
  const controller = new AbortController();
  let rejectCancelled!: (error: Error) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
  const cancel = (error: Error) => {
    controller.abort();
    rejectCancelled(error);
  };
  const abort = () => cancel(new DOMException('Icon discovery cancelled', 'AbortError'));
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => cancel(new Error('Icon discovery timed out')), timeoutMs);
  try { return await Promise.race([task(controller.signal), cancelled]); }
  finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

async function readText(
  deps: Dependencies, url: string, limit: number, signal: AbortSignal,
): Promise<{ text: string; url: string }> {
  return bounded(signal, deps.timeoutMs ?? 5000, async requestSignal => {
    const response = await deps.fetch(url, {
      mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: requestSignal,
    });
    const finalURL = safeURL(response.url || url);
    if (requestSignal.aborted || !response.ok || response.type === 'opaque' || !finalURL ||
        Number(response.headers.get('content-length')) > limit || !response.body) {
      void response.body?.cancel().catch(() => {});
      throw new Error('Unreadable icon metadata');
    }
    const reader = response.body.getReader();
    const cancelReader = () => { void reader.cancel().catch(() => {}); };
    requestSignal.addEventListener('abort', cancelReader, { once: true });
    let bytes = 0;
    let text = '';
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        checkAbort(requestSignal);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limit) {
          cancelReader();
          throw new Error('Icon metadata exceeds byte limit');
        }
        text += decoder.decode(value, { stream: true });
      }
      return { text: text + decoder.decode(), url: finalURL.href };
    } finally {
      requestSignal.removeEventListener('abort', cancelReader);
      reader.releaseLock();
    }
  });
}

function htmlSources(text: string, finalURL: string) {
  type Element = DefaultTreeAdapterMap['element'];
  const elements: Element[] = [];
  const stack: DefaultTreeAdapterMap['node'][] = [parse(text)];
  while (stack.length) {
    const node = stack.pop()!;
    if ('tagName' in node) elements.push(node);
    // Template content is a separate fragment, deliberately never traversed.
    if ('childNodes' in node) {
      for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
    }
  }
  const attr = (element: Element, name: string) => element.attrs.find(a => a.name === name)?.value ?? '';
  const baseElement = elements.find(element => element.tagName === 'base' && attr(element, 'href'));
  const base = (baseElement && safeURL(attr(baseElement, 'href'), finalURL)?.href) || finalURL;
  const icons: Source[] = [];
  const logos: Source[] = [];
  let manifest: string | undefined;
  for (const element of elements) {
    if (element.tagName === 'link') {
      const rel = attr(element, 'rel').toLowerCase().split(/\s+/);
      const url = safeURL(attr(element, 'href'), base)?.href;
      if (!url) continue;
      const touch = rel.some(token => token === 'apple-touch-icon' || token === 'apple-touch-icon-precomposed');
      if (touch || rel.includes('icon')) icons.push({ url, kind: touch ? 'touch' : 'icon' });
      if (rel.includes('manifest') && !manifest) manifest = url;
    }
    if (element.tagName === 'img' && logos.length < 2 &&
        /logo/i.test(`${attr(element, 'id')} ${attr(element, 'class')} ${attr(element, 'alt')}`)) {
      const url = safeURL(attr(element, 'src'), base)?.href;
      if (url) logos.push({ url, kind: 'logo' });
    }
  }
  return { icons, logos, manifest };
}

function probeImage(deps: Dependencies, source: string, signal: AbortSignal) {
  return bounded(signal, deps.timeoutMs ?? 5000, requestSignal =>
    new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = deps.createImage();
      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
        requestSignal.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        image.src = '';
        reject(new DOMException('Icon discovery cancelled', 'AbortError'));
      };
      image.referrerPolicy = 'no-referrer';
      image.onload = () => {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        cleanup();
        if (![width, height].every(size => Number.isInteger(size) && size > 0 && size <= 2048)) {
          reject(new Error('Invalid icon dimensions'));
        } else resolve({ width, height });
      };
      image.onerror = () => { cleanup(); reject(new Error('Icon image failed to load')); };
      requestSignal.addEventListener('abort', abort, { once: true });
      image.src = source;
    }));
}

export function rankSiteIconCandidates(candidates: SiteIconCandidate[], targetPixels = 160): SiteIconCandidate[] {
  const target = Number.isFinite(targetPixels) && targetPixels > 0 ? targetPixels : 160;
  const score = (candidate: SiteIconCandidate) => {
    const short = Math.min(candidate.width, candidate.height);
    const long = Math.max(candidate.width, candidate.height);
    if (!Number.isFinite(short) || !Number.isFinite(long) || short <= 0) return -Infinity;
    return Math.min(short / target, 1) * 100 + short / long * 100 -
      Math.abs(Math.log2(short / target)) * 5;
  };
  const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return [...candidates].sort((a, b) => score(b) - score(a) ||
    compareText(a.url, b.url) || compareText(a.kind, b.kind) || b.width - a.width || b.height - a.height);
}

export function createSiteIconDiscovery(deps: Dependencies) {
  return async (url: string, options: DiscoveryOptions): Promise<SiteIconCandidate[]> => {
    checkAbort(options.signal);
    const page = safeURL(url);
    if (!page) return [];
    const sources = new Map<string, Source>();
    const add = (source: Source) => {
      if (sources.size < MAX_CANDIDATES && !sources.has(source.url)) sources.set(source.url, source);
    };
    for (const path of COMMON_PATHS) {
      add({ url: `${page.origin}/${path}`, kind: path.startsWith('apple-') ? 'touch' : 'icon' });
    }
    try {
      const html = await readText(deps, `${page.origin}/`, 256 * 1024, options.signal);
      checkAbort(options.signal);
      const declarations = htmlSources(html.text, html.url);
      for (const source of declarations.icons) add(source);
      if (declarations.manifest && sources.size < MAX_CANDIDATES) {
        try {
          const manifest = await readText(deps, declarations.manifest, 64 * 1024, options.signal);
          checkAbort(options.signal);
          const data: unknown = JSON.parse(manifest.text);
          if (data && typeof data === 'object' && 'icons' in data && Array.isArray(data.icons)) {
            for (const icon of data.icons.slice(0, 8)) {
              if (!icon || typeof icon !== 'object' || typeof icon.src !== 'string') continue;
              const source = safeURL(icon.src, manifest.url);
              if (source) add({ url: source.href, kind: 'manifest' });
            }
          }
        } catch { checkAbort(options.signal); }
      }
      for (const source of declarations.logos) add(source);
    } catch {
      // Cross-origin metadata is optional; image-only fallbacks remain useful.
      checkAbort(options.signal);
    }
    checkAbort(options.signal);
    const queue = [...sources.values()];
    const results: SiteIconCandidate[] = [];
    let index = 0;
    const worker = async () => {
      while (index < queue.length) {
        checkAbort(options.signal);
        const source = queue[index++];
        let dimensions: { width: number; height: number };
        try {
          dimensions = await probeImage(deps, source.url, options.signal);
          if (options.validateCandidate) {
            await bounded(options.signal, deps.timeoutMs ?? 5000, signal => options.validateCandidate!(source.url, signal));
          }
        }
        catch { checkAbort(options.signal); continue; }
        checkAbort(options.signal);
        const candidate = { ...source, ...dimensions };
        results.push(candidate);
        options.onCandidate?.({ ...candidate });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
    checkAbort(options.signal);
    return rankSiteIconCandidates(results);
  };
}
const browserDiscovery = createSiteIconDiscovery({
  fetch: (...args) => globalThis.fetch(...args),
  createImage: () => new Image(),
});
export async function discoverSiteIcons(url: string, options: DiscoveryOptions): Promise<SiteIconCandidate[]> {
  return browserDiscovery(url, options);
}

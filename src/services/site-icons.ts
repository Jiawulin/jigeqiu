import { createSiteIconPersistence } from './site-icon-persistence';
import type { SiteIconMode } from '../types';
import { discoverSiteIcons, type SiteIconCandidate } from './site-icon-discovery';

export type SiteIconRequest = { url: string; icon?: string; iconMode?: SiteIconMode; platformIcon?: string };
export type SiteIconState = { status: 'loading' | 'ready' | 'fallback'; src?: string };
export type SiteIconRecord = {
  key: string; source?: string; blob?: Blob; discovered?: boolean; updatedAt: number; failedAt?: number; accessedAt: number;
};
export interface SiteIconPersistence {
  read(key: string): Promise<SiteIconRecord | undefined>;
  write(record: SiteIconRecord, signal?: AbortSignal): Promise<void>;
  clear(): Promise<void>;
}
interface Dependencies {
  now: () => number;
  load: (source: string, signal: AbortSignal) => Promise<{ blob?: Blob }>;
  persistence: SiteIconPersistence;
  discover: (url: string, options: { signal: AbortSignal }) => Promise<SiteIconCandidate[]>;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
}
const DAY = 86_400_000;
const MAX_ENTRIES = 256;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 512 * 1024;
const LOADING: SiteIconState = Object.freeze({ status: 'loading' });
const FALLBACK: SiteIconState = Object.freeze({ status: 'fallback' });

function safeURL(value?: string): URL | undefined {
  if (!value || value.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return;
    url.hash = '';
    return url;
  } catch { return; }
}
function isLegacyProvider(url?: URL) {
  return url?.hostname === 'www.google.com' && url.pathname.startsWith('/s2/favicons');
}
function candidates(request: SiteIconRequest) {
  const page = safeURL(request.url);
  if (!page || request.iconMode === 'text') return { sources: [] as string[], userSource: undefined as string | undefined };
  const selectedURL = safeURL(request.icon);
  const selectedSource = request.iconMode !== 'custom' && isLegacyProvider(selectedURL)
    ? undefined : selectedURL?.href;
  const userSource = request.iconMode === 'auto' ? undefined : selectedSource;
  const sources = [selectedSource, safeURL(request.platformIcon)?.href, `${page.origin}/favicon.ico`];
  return { sources: [...new Set(sources.filter((source): source is string => !!source))], userSource };
}
type Entry = {
  key: string; sources: string[]; userSource?: string; state: SiteIconState;
  record?: SiteIconRecord; hydrated: boolean; inflight?: Promise<void>; forceRequested?: boolean;
  controller?: AbortController; watchers: Set<Watcher>; accessedAt: number; ownedURL?: string;
  origin?: string; automatic: boolean;
};
type Watcher = { request: SiteIconRequest; listener: (state: SiteIconState) => void; entry: Entry };

export function createSiteIconService(deps: Dependencies) {
  let generation = 0;
  let durableQueue = Promise.resolve();
  let clearBarrier = Promise.resolve();
  const entries = new Map<string, Entry>();
  const watchers = new Set<Watcher>();
  const sourceLoads = new Map<string, Promise<{ blob?: Blob }>>();
  function entryFor(request: SiteIconRequest): Entry {
    const { sources, userSource } = candidates(request);
    // Retain the old provider-disabled cache identity without reading its preference.
    const key = JSON.stringify([false, sources, userSource ?? null]);
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, sources, userSource, state: sources.length ? LOADING : FALLBACK,
        hydrated: false, watchers: new Set(), accessedAt: deps.now(),
        origin: safeURL(request.url)?.origin,
        automatic: request.iconMode !== 'text' && request.iconMode !== 'custom' && !userSource };
      entries.set(key, entry);
    }
    entry.accessedAt = deps.now();
    return entry;
  }
  function emit(entry: Entry, state: SiteIconState) {
    entry.state = state;
    for (const watcher of [...entry.watchers]) watcher.listener(state);
  }
  function revoke(entry: Entry) {
    if (entry.ownedURL) deps.revokeObjectURL(entry.ownedURL);
    entry.ownedURL = undefined;
  }
  function trim() {
    let bytes = [...entries.values()].reduce((total, entry) => total + (entry.record?.blob?.size ?? 0), 0);
    for (const entry of [...entries.values()].sort((a, b) => a.accessedAt - b.accessedAt)) {
      if (entries.size <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
      if (entry.watchers.size || entry.inflight) continue;
      entries.delete(entry.key);
      bytes -= entry.record?.blob?.size ?? 0;
      revoke(entry);
    }
  }
  function showRecord(entry: Entry, record: SiteIconRecord) {
    const previous = entry.ownedURL;
    const src = record.blob ? deps.createObjectURL(record.blob) : record.source!;
    entry.ownedURL = record.blob ? src : undefined;
    entry.record = record;
    emit(entry, { status: 'ready', src });
    if (previous) deps.revokeObjectURL(previous);
  }
  function persist(record: SiteIconRecord, epoch: number, signal: AbortSignal) {
    const operation = durableQueue.then(async () => {
      if (epoch === generation) await deps.persistence.write(record, signal);
    });
    durableQueue = operation.catch(() => {});
    return durableQueue;
  }
  function due(entry: Entry) {
    const record = entry.record;
    if (record?.failedAt !== undefined && deps.now() - record.failedAt < DAY) return false;
    if (!record?.source) return true;
    if (record.source === entry.userSource) return false;
    return deps.now() - record.updatedAt >= 7 * DAY;
  }
  function resolve(entry: Entry, force = false): Promise<void> {
    if (force) entry.forceRequested = true;
    if (entry.inflight) return entry.inflight;
    if (!entry.sources.length) return force ? Promise.reject(new Error('No image source selected')) : Promise.resolve();
    const epoch = generation;
    const controller = new AbortController();
    entry.controller = controller;
    const current = () => epoch === generation && !controller.signal.aborted;
    const operation = (async () => {
      await clearBarrier;
      if (!current()) throw new Error('Icon resolution cancelled');
      if (!entry.hydrated) {
        entry.hydrated = true;
        try {
          const record = await deps.persistence.read(entry.key);
          if (!current()) throw new Error('Icon resolution cancelled');
          if (record && record.key === entry.key && Number.isFinite(record.updatedAt) &&
              (!record.source || entry.sources.includes(record.source) ||
                (entry.automatic && record.discovered === true && !!safeURL(record.source) && !isLegacyProvider(safeURL(record.source)))) &&
              (record.blob === undefined || (record.blob instanceof Blob && record.blob.size <= MAX_IMAGE_BYTES))) {
            if (record.source) showRecord(entry, record);
            else {
              entry.record = record;
              emit(entry, FALLBACK);
            }
          }
        } catch {
          // Unusable cached images must not suppress resolution through success TTLs.
          entry.record = undefined;
        }
      }
      if (!current()) throw new Error('Icon resolution cancelled');
      if (!entry.forceRequested && !due(entry)) return;
      let lastError: unknown = new Error('No usable site icon');
      let searched = false;
      const queue = [...entry.sources];
      const discovered = new Set<string>();
      const search = async () => {
        searched = true;
        if (!entry.automatic || !entry.origin) return [];
        try {
          const items = await deps.discover(`${entry.origin}/`, { signal: controller.signal });
          if (!current()) throw new Error('Icon resolution cancelled');
          return items.filter(item => item.kind !== 'logo').flatMap(item => {
            const url = safeURL(item.url);
            if (!url || isLegacyProvider(url)) return [];
            discovered.add(url.href);
            return [url.href];
          });
        } catch (cause) {
          if (!current()) throw new Error('Icon resolution cancelled');
          lastError = cause;
          return [];
        }
      };
      if (entry.forceRequested && entry.automatic) queue.unshift(...await search());
      const tried = new Set<string>();
      for (let index = 0; index < queue.length; index++) {
        const source = queue[index];
        if (tried.has(source)) continue;
        tried.add(source);
        try {
          const reusable = !entry.forceRequested && [...entries.values()].find(other =>
            other !== entry && other.record?.source === source && !due(other))?.record;
          if (reusable) {
            const record = { ...reusable, key: entry.key, accessedAt: deps.now() };
            showRecord(entry, record);
            await persist(record, epoch, controller.signal);
            if (!current()) throw new Error('Icon resolution cancelled');
            return;
          }
          const sourceKey = source;
          let load = sourceLoads.get(sourceKey);
          if (!load) {
            load = deps.load(source, controller.signal);
            sourceLoads.set(sourceKey, load);
            const shared = load;
            void load.finally(() => {
              if (sourceLoads.get(sourceKey) === shared) sourceLoads.delete(sourceKey);
            }).catch(() => {});
          }
          const result = await load;
          if (!current()) throw new Error('Icon resolution cancelled');
          if (result.blob && result.blob.size > MAX_IMAGE_BYTES) throw new Error('Icon exceeds byte limit');
          const record: SiteIconRecord = {
            key: entry.key, source, blob: result.blob, discovered: discovered.has(source),
            updatedAt: deps.now(), accessedAt: deps.now(),
          };
          showRecord(entry, record);
          await persist(record, epoch, controller.signal);
          if (!current()) throw new Error('Icon resolution cancelled');
          return;
        } catch (error) {
          if (!current()) throw new Error('Icon resolution cancelled');
          lastError = error;
          if (index === queue.length - 1 && !searched && entry.automatic) queue.push(...await search());
        }
      }
      const record: SiteIconRecord = {
        ...entry.record, key: entry.key, updatedAt: entry.record?.updatedAt ?? 0,
        failedAt: deps.now(), accessedAt: deps.now(),
      };
      entry.record = record;
      if (entry.state.status !== 'ready') emit(entry, FALLBACK);
      await persist(record, epoch, controller.signal);
      if (!current()) throw new Error('Icon resolution cancelled');
      throw lastError;
    })();
    entry.inflight = operation.finally(() => {
      entry.inflight = undefined;
      entry.forceRequested = false;
      trim();
    });
    return entry.inflight;
  }
  function invalidate(state: SiteIconState) {
    generation++;
    sourceLoads.clear();
    const oldEntries = [...entries.values()];
    entries.clear();
    for (const entry of oldEntries) {
      entry.controller?.abort();
      emit(entry, state);
    }
    for (const entry of oldEntries) revoke(entry);
    return oldEntries;
  }
  return {
    peekSiteIcon(request: SiteIconRequest): SiteIconState {
      const { sources, userSource } = candidates(request);
      return entries.get(JSON.stringify([false, sources, userSource ?? null]))?.state ??
        (sources.length ? LOADING : FALLBACK);
    },
    watchSiteIcon(request: SiteIconRequest, listener: (state: SiteIconState) => void) {
      const entry = entryFor(request);
      const watcher: Watcher = { request: { ...request }, listener, entry };
      watchers.add(watcher);
      entry.watchers.add(watcher);
      listener(entry.state);
      void resolve(entry).catch(() => {});
      return () => { watchers.delete(watcher); watcher.entry.watchers.delete(watcher); trim(); };
    },
    refreshSiteIcon(request: SiteIconRequest) { return resolve(entryFor(request), true); },
    async clearSiteIconCache() {
      invalidate(FALLBACK);
      for (const watcher of watchers) {
        watcher.entry.watchers.delete(watcher);
        const entry = entryFor(watcher.request);
        entry.hydrated = true;
        entry.state = FALLBACK;
        watcher.entry = entry;
        entry.watchers.add(watcher);
      }
      const operation = durableQueue.then(() => deps.persistence.clear());
      durableQueue = operation.catch(() => {});
      clearBarrier = durableQueue;
      await operation;
      for (const entry of new Set([...watchers].map(watcher => watcher.entry))) {
        emit(entry, entry.sources.length ? LOADING : FALLBACK);
        void resolve(entry).catch(() => {});
      }
    },
  };
}
interface LoaderDependencies {
  fetch: typeof globalThis.fetch;
  decode: (blob: Blob, signal: AbortSignal) => Promise<void>;
  loadImage: (source: string, signal: AbortSignal) => Promise<void>;
  timeoutMs?: number;
}
function checkDimensions(width: number, height: number) {
  if (!width || !height || width > 2048 || height > 2048 || width * height > 4_194_304) {
    throw new Error('Icon dimensions exceed limit');
  }
}
function checkRaster(bytes: Uint8Array, type: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (type === 'image/png' && bytes.length >= 33 &&
      bytes[0] === 137 && ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') {
    checkDimensions(view.getUint32(16), view.getUint32(20));
    return;
  }
  if (type === 'image/gif' && bytes.length >= 10 && /^GIF8[79]a$/.test(ascii(0, 6))) {
    checkDimensions(view.getUint16(6, true), view.getUint16(8, true));
    return;
  }
  if (['image/x-icon', 'image/vnd.microsoft.icon', 'image/ico'].includes(type) &&
      bytes.length >= 22 && view.getUint16(0, true) === 0 && view.getUint16(2, true) === 1) {
    const count = view.getUint16(4, true);
    if (!count || count > 256 || 6 + count * 16 > bytes.length) throw new Error('Invalid icon directory');
    for (let i = 0; i < count; i++) {
      const offset = 6 + i * 16;
      checkDimensions(bytes[offset] || 256, bytes[offset + 1] || 256);
      const size = view.getUint32(offset + 8, true);
      const start = view.getUint32(offset + 12, true);
      if (start < 6 + count * 16 || start + size > bytes.length || size < 8) throw new Error('Invalid icon frame');
      const frame = bytes.subarray(start, start + size);
      if (frame[0] === 137) checkRaster(frame, 'image/png');
      else {
        if (size < 40) throw new Error('Invalid icon bitmap');
        const dib = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
        checkDimensions(Math.abs(dib.getInt32(4, true)), Math.abs(dib.getInt32(8, true)) / 2);
      }
    }
    return;
  }
  if (type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
        checkDimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
        return;
      }
      offset += length;
    }
  }
  if (type === 'image/webp' && bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    const uint24 = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
    if (chunk === 'VP8X') {
      checkDimensions(uint24(24) + 1, uint24(27) + 1);
      return;
    }
    if (chunk === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      checkDimensions(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
      return;
    }
    if (chunk === 'VP8L' && bytes[20] === 47) {
      const bits = view.getUint32(21, true);
      checkDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      return;
    }
  }
  throw new Error('Unsupported or malformed raster icon');
}

export function createSiteIconLoader(deps: LoaderDependencies) {
  return async (source: string, signal: AbortSignal): Promise<{ blob?: Blob }> => {
    if (!safeURL(source)) throw new Error('Invalid icon URL');
    const controller = new AbortController();
    let rejectCancelled!: (reason: Error) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
    const cancel = (message: string) => {
      controller.abort();
      rejectCancelled(new Error(message));
    };
    const abort = () => cancel('Icon resolution cancelled');
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => cancel('Icon request timed out'), deps.timeoutMs ?? 8000);
    const task = async (): Promise<{ blob?: Blob }> => {
      if (signal.aborted) throw new Error('Icon resolution cancelled');
      let response: Response;
      try {
        response = await deps.fetch(source, {
          mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
          cache: 'no-cache', signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted || !(error instanceof TypeError)) throw error;
        await deps.loadImage(source, controller.signal);
        return {};
      }
      if (controller.signal.aborted) throw new Error('Icon resolution cancelled');
      if (response.type === 'opaque') {
        await deps.loadImage(source, controller.signal);
        return {};
      }
      if (!response.ok || (response.url && !safeURL(response.url))) throw new Error('Icon HTTP failure');
      const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
      if (type === 'image/svg+xml') {
        void response.body?.cancel().catch(() => {});
        await deps.loadImage(source, controller.signal);
        return {};
      }
      if (!/^image\/(png|gif|jpeg|webp|x-icon|vnd\.microsoft\.icon|ico)$/.test(type)) {
        void response.body?.cancel().catch(() => {});
        throw new Error('Unsupported icon content type');
      }
      if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
        void response.body?.cancel().catch(() => {});
        throw new Error('Icon exceeds byte limit');
      }
      if (!response.body) throw new Error('Empty icon response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      const cancelReader = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', cancelReader, { once: true });
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (controller.signal.aborted) throw new Error('Icon resolution cancelled');
          if (done) break;
          size += value.byteLength;
          if (size > MAX_IMAGE_BYTES) {
            cancelReader();
            throw new Error('Icon exceeds byte limit');
          }
          chunks.push(value);
        }
      } finally {
        controller.signal.removeEventListener('abort', cancelReader);
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      checkRaster(bytes, type);
      const blob = new Blob([bytes], { type });
      await deps.decode(blob, controller.signal);
      if (controller.signal.aborted) throw new Error('Icon resolution cancelled');
      return { blob };
    };
    try { return await Promise.race([task(), cancelled]); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  };
}

function loadBrowserImage(source: string, signal: AbortSignal): Promise<void> {
  // Image-only sources follow HTTP cache policy; query busting could invalidate signed URLs.
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined' || signal.aborted) {
      reject(new Error('Image loading unavailable'));
      return;
    }
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener('abort', abort);
    };
    const abort = () => { cleanup(); image.src = ''; reject(new Error('Icon resolution cancelled')); };
    image.onload = () => {
      cleanup();
      try { checkDimensions(image.naturalWidth, image.naturalHeight); resolve(); }
      catch (error) { reject(error); }
    };
    image.onerror = () => { cleanup(); reject(new Error('Icon image failed to load')); };
    signal.addEventListener('abort', abort, { once: true });
    image.src = source;
  });
}
const browserLoad = createSiteIconLoader({
  fetch: (...args) => globalThis.fetch(...args),
  loadImage: loadBrowserImage,
  async decode(blob, signal) {
    const url = URL.createObjectURL(blob);
    try { await loadBrowserImage(url, signal); }
    finally { URL.revokeObjectURL(url); }
  },
});
export const validateSiteIconSource = (source: string, signal: AbortSignal): Promise<{ blob?: Blob }> =>
  browserLoad(source, signal);
export const discoverValidatedSiteIcons = (url: string, options: {
  signal: AbortSignal; onCandidate?: (candidate: SiteIconCandidate) => void;
}): Promise<SiteIconCandidate[]> => discoverSiteIcons(url, { ...options, validateCandidate: validateSiteIconSource });
let singleton: ReturnType<typeof createSiteIconService> | undefined;
function service() {
  return singleton ??= createSiteIconService({
    now: Date.now,
    load: browserLoad,
    discover: discoverValidatedSiteIcons,
    persistence: createSiteIconPersistence(),
    createObjectURL: blob => URL.createObjectURL(blob),
    revokeObjectURL: url => URL.revokeObjectURL(url),
  });
}
export const peekSiteIcon = (request: SiteIconRequest): SiteIconState => service().peekSiteIcon(request);
export const watchSiteIcon = (request: SiteIconRequest, listener: (state: SiteIconState) => void): (() => void) =>
  service().watchSiteIcon(request, listener);
export const refreshSiteIcon = (request: SiteIconRequest): Promise<void> => service().refreshSiteIcon(request);
export const clearSiteIconCache = (): Promise<void> => service().clearSiteIconCache();

export const WALLPAPER_MAX_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const BUILTIN_WALLPAPERS = [
  { id: 'snow-mountain', label: 'managerWallpaperSnow' },
  { id: 'misty-mountains', label: 'wallpaperMistyMountains' },
  { id: 'corner-tower', label: 'wallpaperCornerTower' },
  { id: 'green-lake', label: 'wallpaperGreenLake' },
] as const;
export type BuiltinWallpaper = typeof BUILTIN_WALLPAPERS[number]['id'];
export interface WallpaperEntry {
  id: string;
  name: string;
  createdAt: number | null;
  thumbnail?: Blob;
}
const CHANGE_EVENT = 'wallpaper-change';

export function notifyWallpaperChange(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANGE_EVENT);
    channel.postMessage('changed');
    channel.close();
  }
}

export function subscribeWallpaperChange(listener: () => void): () => void {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANGE_EVENT) : undefined;
  if (channel) channel.onmessage = listener;
  const visible = () => { if (document.visibilityState === 'visible') listener(); };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('focus', listener);
  document.addEventListener('visibilitychange', visible);
  return () => {
    channel?.close();
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('focus', listener);
    document.removeEventListener('visibilitychange', visible);
  };
}

export async function mutateWallpaper<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (!navigator.locks) throw new Error('WALLPAPER_LOCK');
  return navigator.locks.request('jigeqiu-wallpapers-mutation', { signal }, async () => {
    signal.throwIfAborted();
    return action();
  });
}

export function validateWallpaper(file: Pick<File, 'type' | 'size'>): void {
  if (!TYPES.has(file.type)) throw new Error('WALLPAPER_FORMAT');
  if (!file.size || file.size > WALLPAPER_MAX_BYTES) throw new Error('WALLPAPER_SIZE');
}

export function visibleWallpaper(preset: string): BuiltinWallpaper {
  return BUILTIN_WALLPAPERS.find(item => item.id === preset)?.id ?? 'snow-mountain';
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('WALLPAPER_STORAGE'));
    };
    const timer = setTimeout(fail, 5000);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open('jigeqiu-wallpapers-v1', 2);
    } catch {
      fail();
      return;
    }
    request.onupgradeneeded = () => {
      if (settled) { request.transaction?.abort(); return; }
      if (!request.result.objectStoreNames.contains('images')) request.result.createObjectStore('images');
      if (!request.result.objectStoreNames.contains('metadata')) request.result.createObjectStore('metadata');
    };
    request.onerror = request.onblocked = fail;
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      clearTimeout(timer);
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function transaction<T>(
  mode: IDBTransactionMode, operation: (tx: IDBTransaction) => () => T,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['images', 'metadata'], mode);
      let result: () => T;
      tx.oncomplete = () => {
        try { resolve(result()); } catch (cause) { reject(cause); }
      };
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('WALLPAPER_STORAGE'));
      try { result = operation(tx); }
      catch (cause) {
        try { tx.abort(); } catch { /* An operation may have already aborted the transaction. */ }
        reject(cause);
      }
    });
  } finally {
    db.close();
  }
}

export async function saveWallpaper(file: File, signal?: AbortSignal): Promise<string> {
  validateWallpaper(file);
  const image = await createImageBitmap(file);
  let thumbnail: Blob;
  try {
    if (!image.width || !image.height || image.width * image.height > 40_000_000) {
      throw new Error('WALLPAPER_DIMENSIONS');
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(320, image.width);
    canvas.height = Math.max(1, Math.round(image.height * canvas.width / image.width));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('WALLPAPER_THUMBNAIL');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    thumbnail = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('WALLPAPER_THUMBNAIL')), 'image/webp', 0.65,
    ));
  } finally {
    image.close();
  }
  signal?.throwIfAborted();
  const id = crypto.randomUUID();
  await transaction('readwrite', tx => {
    signal?.throwIfAborted();
    tx.objectStore('images').put(file, id);
    tx.objectStore('metadata').put({ id, name: file.name, createdAt: Date.now(), thumbnail } satisfies WallpaperEntry, id);
    return () => undefined;
  });
  notifyWallpaperChange();
  return id;
}

export async function readWallpaper(id: string): Promise<Blob | undefined> {
  const value: unknown = await transaction('readonly', tx => {
    const request = tx.objectStore('images').get(id);
    return () => request.result;
  });
  return value instanceof Blob ? value : undefined;
}

export async function removeWallpaper(id: string): Promise<void> {
  await transaction('readwrite', tx => {
    tx.objectStore('images').delete(id);
    tx.objectStore('metadata').delete(id);
    return () => undefined;
  });
  notifyWallpaperChange();
}

export async function listWallpapers(): Promise<WallpaperEntry[]> {
  return transaction('readonly', tx => {
    const images = tx.objectStore('images');
    const keys = images.getAllKeys();
    const metadata = tx.objectStore('metadata').getAll();
    const legacy: WallpaperEntry[] = [];
    metadata.onsuccess = () => {
      const known = new Set((metadata.result as unknown[]).flatMap(value =>
        value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? [value.id] : []));
      for (const key of keys.result) {
        if (typeof key !== 'string') { tx.abort(); return; }
        if (known.has(key)) { legacy.push({ id: key, name: '', createdAt: null }); continue; }
        const request = images.get(key);
        request.onsuccess = () => {
          const blob: unknown = request.result;
          if (!(blob instanceof Blob)) { tx.abort(); return; }
          legacy.push({ id: key, name: blob instanceof File ? blob.name : '', createdAt: null });
        };
      }
    };
    return () => {
      const entries = new Map<string, WallpaperEntry>();
      for (const value of metadata.result as unknown[]) {
        if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string'
          || !('name' in value) || typeof value.name !== 'string'
          || !('createdAt' in value) || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)
          || !('thumbnail' in value) || !(value.thumbnail instanceof Blob)) throw new Error('WALLPAPER_METADATA');
        entries.set(value.id, { id: value.id, name: value.name, createdAt: value.createdAt, thumbnail: value.thumbnail });
      }
      return legacy.map(entry => entries.get(entry.id) ?? entry)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.id.localeCompare(b.id));
    };
  });
}

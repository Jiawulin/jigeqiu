import {
  createSiteIconLoader,
  createSiteIconService,
} from '../../src/services/site-icons';
import { createSiteIconPersistence } from '../../src/services/site-icon-persistence';
import { browserPermissions, permissionFetch } from './network';
import { applicationStorage, mutateStorage } from '../../src/services/application-storage';
export * from '../../src/services/site-icons';

function loadImage(source: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      image.src = '';
      reject(new DOMException('Image cancelled', 'AbortError'));
    };
    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      cleanup();
      const { naturalWidth: width, naturalHeight: height } = image;
      if (width > 0 && height > 0 && width <= 2048 && height <= 2048) resolve();
      else reject(new Error('Invalid icon dimensions'));
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('Icon image failed'));
    };
    signal.addEventListener('abort', abort, { once: true });
    image.src = source;
  });
}

const load = createSiteIconLoader({
  fetch: permissionFetch,
  loadImage,
  async decode(blob, signal) {
    const url = URL.createObjectURL(blob);
    try {
      await loadImage(url, signal);
    } finally {
      URL.revokeObjectURL(url);
    }
  },
});
const service = createSiteIconService({
  now: Date.now,
  load,
  persistence: createSiteIconPersistence(),
  preferences: {
    getItem: (key) => applicationStorage().getItem(key),
    setItem: (key, value) => {
      if (applicationStorage().getItem(key) !== value) applicationStorage().setItem(key, value);
    },
  },
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
});
const permissionChanged = () => {
  void service.clearSiteIconCache().catch(() => {});
};
browserPermissions().onAdded.addListener(permissionChanged);
browserPermissions().onRemoved.addListener(permissionChanged);

export const validateSiteIconSource = load;
export const peekSiteIcon = service.peekSiteIcon;
export const watchSiteIcon = service.watchSiteIcon;
export const refreshSiteIcon = service.refreshSiteIcon;
export const clearSiteIconCache = service.clearSiteIconCache;
export const getThirdPartyIconsEnabled = service.getThirdPartyIconsEnabled;
export const setThirdPartyIconsEnabled = async (enabled: boolean): Promise<void> => {
  await mutateStorage(() => applicationStorage().setItem('jigeqiu.site-icons.third-party.v1', String(enabled)));
  service.setThirdPartyIconsEnabled(enabled);
};
window.addEventListener('application-storage-change', () => {
  try { service.setThirdPartyIconsEnabled(applicationStorage().getItem('jigeqiu.site-icons.third-party.v1') === 'true'); }
  catch { /* Keep the last committed preference when storage is unavailable. */ }
});
export const subscribeIconPreferences = service.subscribeIconPreferences;

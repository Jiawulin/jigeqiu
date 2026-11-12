import { selectLocale } from '../../src/i18n/locale';
import { extensionMessages } from '../../src/i18n/extension';
import { normalizeBookmarkUrl } from '../../src/services/bookmark-input';
import { STATE_KEY } from '../storage/local';

export const MENU_ID = 'jigeqiu-save-page';
export const CAPTURE_PREFIX = 'jigeqiu-capture:';
export const CAPTURE_COMMAND = 'save-current-page';
export interface CaptureDraft {
  url?: string;
  title?: string;
  error?: 'unsupported';
  windowId?: number;
}
export interface SessionArea {
  get(key: string | null): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(key: string | string[]): Promise<void>;
}
export interface WindowBounds { left?: number; top?: number; width?: number; height?: number }
export function centeredCaptureBounds(parent: WindowBounds) {
  if (![parent.left, parent.top, parent.width, parent.height].every(Number.isFinite)
    || parent.width! <= 0 || parent.height! <= 0) return { width: 560, height: 760 };
  const width = Math.min(560, parent.width!);
  const height = Math.min(760, parent.height!);
  return { width, height,
    left: Math.round(parent.left! + (parent.width! - width) / 2),
    top: Math.round(parent.top! + (parent.height! - height) / 2) };
}
interface Dependencies {
  session: SessionArea;
  local: { get(key: string): Promise<Record<string, unknown>> };
  menus: {
    removeAll(): Promise<void>;
    create(options: { id: string; title: string; contexts: ['page']; documentUrlPatterns: string[] }): unknown;
  };
  windows: {
    create(options: { url: string; type: 'popup'; width: number; height: number; left?: number; top?: number }): Promise<{ id?: number }>;
    get(id: number): Promise<WindowBounds & { id?: number }>;
    getLastFocused(): Promise<WindowBounds>;
  };
  getURL(path: string): string;
  languages(): readonly string[];
  uuid(): string;
}

export function captureKey(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    throw new Error('INVALID_CAPTURE');
  return CAPTURE_PREFIX + id;
}

export function parseCapture(value: unknown): CaptureDraft {
  if (!value || typeof value !== 'object') throw new Error('INVALID_CAPTURE');
  const draft = value as CaptureDraft;
  if (draft.error === 'unsupported') return { error: 'unsupported' };
  if (typeof draft.url !== 'string' || !/^https?:\/\//i.test(draft.url)
    || (draft.title !== undefined && typeof draft.title !== 'string')) throw new Error('INVALID_CAPTURE');
  return { url: normalizeBookmarkUrl(draft.url), title: draft.title };
}

export function createCaptureController(deps: Dependencies) {
  // Menu updates are serialized so overlapping storage events cannot create duplicates.
  let menuQueue = Promise.resolve();
  return {
    syncMenu() {
      const next = menuQueue.catch(() => {}).then(async () => {
        const saved = await deps.local.get(STATE_KEY);
        const state = saved[STATE_KEY] as { data?: Record<string, string> } | undefined;
        let language: unknown;
        try { language = JSON.parse(state?.data?.jipage_settings_v1 ?? 'null')?.language; }
        catch { /* A malformed preference must not prevent the menu from working. */ }
        const locale = selectLocale(language, deps.languages());
        await deps.menus.removeAll();
        deps.menus.create({
          id: MENU_ID, title: extensionMessages.extensionCaptureMenu[locale],
          contexts: ['page'], documentUrlPatterns: ['http://*/*', 'https://*/*'],
        });
      });
      menuQueue = next;
      return next;
    },
    async open(tab?: { url?: string; title?: string; windowId?: number }) {
      let draft: CaptureDraft;
      try { draft = parseCapture(tab); }
      catch { draft = { error: 'unsupported' }; }
      const key = captureKey(deps.uuid());
      await deps.session.set({ [key]: draft });
      try {
        let parent: WindowBounds = {};
        try {
          parent = tab?.windowId === undefined
            ? await deps.windows.getLastFocused() : await deps.windows.get(tab.windowId);
        } catch { /* Position lookup must not prevent capture. */ }
        const window = await deps.windows.create({
          url: deps.getURL(`index.html?capture=${key.slice(CAPTURE_PREFIX.length)}`),
          type: 'popup', ...centeredCaptureBounds(parent),
        });
        if (window.id === undefined) throw new Error('CAPTURE_WINDOW_FAILED');
        await deps.session.set({ [key]: { ...draft, windowId: window.id } });
        // A very quickly closed window may precede the session association.
        try { await deps.windows.get(window.id); }
        catch { await deps.session.remove(key); }
      } catch (cause) {
        await deps.session.remove(key);
        throw cause;
      }
    },
    async closed(id: number) {
      const entries = await deps.session.get(null);
      const keys = Object.entries(entries).filter(([key, value]) =>
        key.startsWith(CAPTURE_PREFIX) && (value as CaptureDraft)?.windowId === id).map(([key]) => key);
      if (keys.length) await deps.session.remove(keys);
    },
    async prune() {
      const entries = await deps.session.get(null);
      for (const [key, value] of Object.entries(entries)) {
        if (!key.startsWith(CAPTURE_PREFIX)) continue;
        const id = (value as CaptureDraft)?.windowId;
        if (id === undefined) { await deps.session.remove(key); continue; }
        try { await deps.windows.get(id); }
        catch { await deps.session.remove(key); }
      }
    },
  };
}

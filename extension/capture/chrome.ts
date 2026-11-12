import type { SessionArea, WindowBounds } from './controller';

interface EventSource<Args extends unknown[]> {
  addListener(listener: (...args: Args) => void): void;
}
export interface CaptureChrome {
  runtime: {
    getURL(path: string): string;
    onInstalled: EventSource<[]>;
    onStartup: EventSource<[]>;
  };
  storage: {
    session: SessionArea;
    local: { get(key: string): Promise<Record<string, unknown>> };
    onChanged: EventSource<[Record<string, unknown>, string]>;
  };
  contextMenus: {
    removeAll(): Promise<void>;
    create(options: { id: string; title: string; contexts: ['page']; documentUrlPatterns: string[] }): unknown;
    onClicked: EventSource<[{ menuItemId: string | number }, { url?: string; title?: string; windowId?: number } | undefined]>;
  };
  commands: { onCommand: EventSource<[string, { url?: string; title?: string; windowId?: number } | undefined]> };
  tabs: { query(options: { active: boolean; currentWindow: boolean }): Promise<{ url?: string; title?: string; windowId?: number }[]> };
  windows: {
    create(options: { url: string; type: 'popup'; width: number; height: number; left?: number; top?: number }): Promise<{ id?: number }>;
    get(id: number): Promise<WindowBounds & { id?: number }>;
    getLastFocused(): Promise<WindowBounds>;
    onRemoved: EventSource<[number]>;
  };
}
export const captureChrome = () =>
  (globalThis as typeof globalThis & { chrome: CaptureChrome }).chrome;

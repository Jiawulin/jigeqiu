import type { SearchEngine } from '../../types';
import type { Layout } from '../../domain/assets/model';
import { ASSET_LIMITS, captureJsonInput, validateSnapshot } from '../../domain/assets/validation';
import { exportPrototypeAssets, prototypeAssetSnapshot, type JsonAssetState } from './prototype-json';
import { emptyDesktopLayout, reconcileDesktopLayout, validateDesktopLayout } from '../desktop-library';

export const WORKBENCH_FORMAT = 'jigeqiu-workbench';
export interface WorkbenchOptions { desktop: boolean; taskbar: boolean; search: boolean }
export interface WorkbenchState {
  assets: JsonAssetState;
  layout: Layout;
  taskbar: string[];
  search: { engines: SearchEngine[]; defaultEngineId: string };
  trashIds?: string[];
}
export interface WorkbenchBackup {
  format: typeof WORKBENCH_FORMAT; schemaVersion: 1; exportedAt: number;
  assets: JsonAssetState;
  desktop?: Layout;
  taskbar?: string[];
  search?: WorkbenchState['search'];
}
export interface WorkbenchPreview {
  exportedAt: number; options: WorkbenchOptions; available: WorkbenchOptions;
  next: WorkbenchState;
  removed: { desktop: { id: string; title: string }[]; taskbar: { id: string; title: string }[] };
  current: WorkbenchInventory;
}
export interface WorkbenchInventory {
  bookmarks: number; folders: number; collections: number; desktop: number; desktopFolders: number; taskbar: number; search: number;
}
function invalid(): never { throw new Error('IMPORT_INVALID'); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validateState(assets: JsonAssetState, layout: Layout = emptyDesktopLayout()): void {
  const snapshot = prototypeAssetSnapshot(assets);
  // Unlike bookmark exchange, full restore must validate original nested identities.
  snapshot.collections = snapshot.collections.map((collection, index) => {
    const content = assets.collections[index].assetContent;
    return content ? { ...collection, ...structuredClone(content) } : collection;
  });
  snapshot.layout = layout;
  if (!validateSnapshot(snapshot).ok) invalid();
}
function restoreAssets(value: unknown): JsonAssetState {
  if (!record(value) || !Array.isArray(value.bookmarks) || !Array.isArray(value.folders) || !Array.isArray(value.collections)
    || Object.keys(value).some(k => !['bookmarks', 'folders', 'collections'].includes(k))) invalid();
  const state = structuredClone(value) as unknown as JsonAssetState;
  for (const b of state.bookmarks) {
    if (!record(b) || !Number.isFinite(b.order) || typeof b.domain !== 'string'
      || (b.iconBg !== undefined && typeof b.iconBg !== 'string')
      || (b.iconMode !== undefined && !['text', 'auto', 'custom'].includes(b.iconMode))
      || (b.icon !== undefined && typeof b.icon !== 'string')) invalid();
  }
  const bookmarks = new Map(state.bookmarks.map(b => [b.id, b]));
  for (const f of state.folders) {
    if (!record(f) || !Number.isFinite(f.order) || !Array.isArray(f.bookmarkIds)
      || new Set(f.bookmarkIds).size !== f.bookmarkIds.length
      || f.bookmarkIds.some(id => bookmarks.get(id)?.folderId !== f.id)
      || state.bookmarks.some(b => b.folderId === f.id && !f.bookmarkIds.includes(b.id))) invalid();
  }
  for (const c of state.collections) {
    if (!record(c) || !Array.isArray(c.items)) invalid();
    if (c.items.some(item => !record(item) || (item.bookmarkId && !bookmarks.has(item.bookmarkId)))) invalid();
  }
  // The existing asset validator enforces identities, hierarchy, URLs and content budgets.
  exportPrototypeAssets(state, 0);
  validateState(state);
  return state;
}
export function validateWorkbenchSearch(value: unknown): WorkbenchState['search'] {
  const fail = (reason: string): never => { throw new Error(`SEARCH_${reason}`); };
  if (!record(value) || !Array.isArray(value.engines) || typeof value.defaultEngineId !== 'string') return fail('INVALID');
  const ids = new Set<string>();
  const commands = new Set<string>();
  for (const engine of value.engines) {
    if (!record(engine) || ['id', 'name', 'keyword', 'urlTemplate'].some(k =>
      typeof engine[k] !== 'string' || !(engine[k] as string).trim())
      || (engine.icon !== undefined && typeof engine.icon !== 'string')
      || ['isDefault', 'isEnabled', 'isCustom'].some(k => engine[k] !== undefined && typeof engine[k] !== 'boolean')) fail('INVALID');
    const id = engine.id as string;
    const command = (engine.keyword as string).trim().replace(/^\//, '').toLowerCase();
    if (!command || /\s/.test(command)) fail('COMMAND_INVALID');
    if (ids.has(id)) fail('INVALID');
    if (commands.has(command)) fail('COMMAND_CONFLICT');
    ids.add(id); commands.add(command);
    const template = engine.urlTemplate as string;
    if (!template.includes('{query}')) fail('TEMPLATE_INVALID');
    try {
      const url = new URL(template.replaceAll('{query}', 'test'));
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) fail('TEMPLATE_INVALID');
    } catch { fail('TEMPLATE_INVALID'); }
  }
  if (value.engines.length === 0 ? value.defaultEngineId !== ''
    : !value.engines.some(e => e.id === value.defaultEngineId && e.isEnabled !== false)) fail('DEFAULT_INVALID');
  const search = structuredClone(value) as unknown as WorkbenchState['search'];
  search.engines = search.engines.map(engine => ({
    ...engine, icon: engine.icon ?? '', isDefault: engine.id === search.defaultEngineId,
  }));
  return search;
}
function pins(value: unknown, assets: JsonAssetState): string[] {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string'
    || !assets.bookmarks.some(b => b.id === id)) || new Set(value).size !== value.length) invalid();
  return [...value];
}
export function parseWorkbench(text: string): WorkbenchBackup {
  if (new TextEncoder().encode(text).byteLength > ASSET_LIMITS.bytes) throw new Error('IMPORT_TOO_LARGE');
  let input: unknown;
  try { input = JSON.parse(text); } catch { invalid(); }
  const capture = captureJsonInput(input);
  if (!capture.ok) invalid();
  input = capture.value;
  if (!record(input) || input.format !== WORKBENCH_FORMAT || input.schemaVersion !== 1) throw new Error('UNSUPPORTED_VERSION');
  if (!Number.isSafeInteger(input.exportedAt) || (input.exportedAt as number) < 0
    || Object.keys(input).some(k => !['format', 'schemaVersion', 'exportedAt', 'assets', 'desktop', 'taskbar', 'search'].includes(k))) invalid();
  const assets = restoreAssets(input.assets);
  const desktop = Object.hasOwn(input, 'desktop') ? validateDesktopLayout(assets, input.desktop) : undefined;
  if (desktop) validateState(assets, desktop);
  return {
    format: WORKBENCH_FORMAT, schemaVersion: 1, exportedAt: input.exportedAt as number, assets,
    ...(desktop ? { desktop } : {}),
    ...(Object.hasOwn(input, 'taskbar') ? { taskbar: pins(input.taskbar, assets) } : {}),
    ...(Object.hasOwn(input, 'search') ? { search: validateWorkbenchSearch(input.search) } : {}),
  };
}
export function exportWorkbench(state: WorkbenchState, at: number): string {
  const assets = structuredClone(state.assets);
  for (const b of assets.bookmarks) delete b.lastUsedAt;
  const output = JSON.stringify({
    format: WORKBENCH_FORMAT, schemaVersion: 1, exportedAt: at, assets,
    desktop: state.layout, taskbar: state.taskbar, search: state.search,
  }, null, 2);
  parseWorkbench(output);
  return output;
}
export function workbenchAssetText(text: string): string {
  const backup = parseWorkbench(text);
  return exportPrototypeAssets(backup.assets, backup.exportedAt);
}
export function previewWorkbench(backup: WorkbenchBackup, current: WorkbenchState, options: WorkbenchOptions): WorkbenchPreview {
  const ids = new Set([...backup.assets.bookmarks, ...backup.assets.folders, ...backup.assets.collections,
    ...(options.desktop && backup.desktop ? [...backup.desktop.shortcuts, ...backup.desktop.folders] : [])].map(b => b.id));
  if (current.trashIds?.some(id => ids.has(id))) throw new Error('TRASH_ID_CONFLICT');
  const available = { desktop: backup.desktop !== undefined, taskbar: backup.taskbar !== undefined, search: backup.search !== undefined };
  const selected = {
    desktop: options.desktop && available.desktop, taskbar: options.taskbar && available.taskbar, search: options.search && available.search,
  };
  const bookmarks = new Map(current.assets.bookmarks.map(b => [b.id, b.title]));
  const valid = new Set(backup.assets.bookmarks.map(b => b.id));
  const removed = {
    desktop: selected.desktop ? [] : current.layout.shortcuts.filter(s => !valid.has(s.bookmarkId))
      .map(s => ({ id: s.bookmarkId, title: bookmarks.get(s.bookmarkId) ?? s.bookmarkId })),
    taskbar: selected.taskbar ? [] : current.taskbar.filter(id => !valid.has(id)).map(id => ({ id, title: bookmarks.get(id) ?? id })),
  };
  const layout = selected.desktop ? backup.desktop! : reconcileDesktopLayout(current.assets, backup.assets, current.layout);
  validateState(backup.assets, layout);
  return {
    exportedAt: backup.exportedAt, available, options: selected, removed,
    current: { bookmarks: current.assets.bookmarks.length, folders: current.assets.folders.length,
      collections: current.assets.collections.length, desktop: current.layout.shortcuts.length,
      desktopFolders: current.layout.folders.length, taskbar: current.taskbar.length, search: current.search.engines.length },
    next: {
      assets: backup.assets,
      layout,
      taskbar: selected.taskbar ? backup.taskbar! : current.taskbar.filter(id => valid.has(id)),
      search: selected.search ? backup.search! : current.search,
    },
  };
}

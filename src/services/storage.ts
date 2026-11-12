import {
  Bookmark,
  Folder,
  Category,
  Tag,
  Collection,
  SearchEngine,
  Plugin,
  Submission,
  UserSettings,
} from '../types';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_TAGS,
  DEFAULT_SEARCH_ENGINES,
  DEFAULT_PLUGINS,
  DEFAULT_USER_SETTINGS,
} from '../data/defaultData';
import { normalizeBookmarkUrl, parseBookmarkKeywords, normalizeBookmarkIcon } from './bookmark-input';
import type { Layout } from '../domain/assets/model';
import {
  applyDesktopActions, emptyDesktopLayout, reconcileDesktopLayout, validateDesktopLayout,
  type DesktopAction, type DesktopLibrary,
} from './desktop-library';
import {
  exportPrototypeAssets, preparePrototypeJsonImport, type JsonAssetPreview,
} from './import-export/prototype-json';
import { collectionSections } from './collection-content';
import { ASSET_LIMITS } from '../domain/assets/validation';
import { readBookmarkTrash, type BookmarkTrashEntry } from './bookmark-trash';
import { detachCollectionBookmarks, folderSubtree, readFolderTrash, type FolderTrashEntry } from './folder-trash';
import { exportBookmarkHtml } from './import-export/bookmark-html-export';
import { SEARCH_ENGINE_PRESETS } from '../data/search-engine-presets';
import { searchEnginePresetStatus } from './search-engine-presets';
import { createTranslator } from '../i18n';
import { selectLocale } from '../i18n/locale';
import { USER_SETTINGS_KEY } from './user-locale';
import { applicationStorage, hasApplicationStorageDriver, mutateStorage } from './application-storage';
import { commitRestoreRecords, RESTORE_JOURNAL, type RestoreRecord } from './restore-journal';
import {
  exportWorkbench, parseWorkbench, previewWorkbench, validateWorkbenchSearch, workbenchAssetText,
  WORKBENCH_FORMAT, type WorkbenchOptions, type WorkbenchPreview, type WorkbenchState, type WorkbenchInventory,
} from './import-export/workbench';

const STORAGE_KEYS = {
  LIBRARY: 'jipage_library_v2',
  BOOKMARKS: 'jipage_bookmarks_v1',
  FOLDERS: 'jipage_folders_v1',
  CATEGORIES: 'jipage_categories_v1',
  TAGS: 'jipage_tags_v1',
  COLLECTIONS: 'jipage_collections_v1',
  SEARCH_ENGINES: 'jipage_search_engines_v1',
  PLUGINS: 'jipage_plugins_v1',
  SUBMISSIONS: 'jipage_submissions_v1',
  SETTINGS: USER_SETTINGS_KEY,
  RECENT_SEARCHES: 'jipage_recent_searches_v1',
  RECENT_USED: 'jipage_recent_used_v1',
};

// URL normalizer for duplicate checking
export function normalizeUrl(url: string): string {
  try {
    let clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) {
      clean = 'https://' + clean;
    }
    const parsed = new URL(clean);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    return `${parsed.protocol}//${host}${pathname}${parsed.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

// Extract domain from URL
export function extractDomain(url: string): string {
  try {
    let clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) {
      clean = 'https://' + clean;
    }
    const parsed = new URL(clean);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || url;
  }
}

// Generate brand color from domain name hash
export function getDomainColor(domain: string): string {
  const colors = [
    '#2563eb', '#0d9488', '#059669', '#d97706', '#dc2626',
    '#7c3aed', '#db2777', '#475569', '#ea580c', '#0284c7'
  ];
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = (hash << 5) - hash + domain.charCodeAt(i);
    hash |= 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

export class StorageManager {
  async mutate<T>(action: () => T): Promise<T> {
    // Business methods update optimistic baselines while staging a transaction.
    let baselines: (string | undefined)[] | undefined;
    try { return await mutateStorage(() => {
      baselines = [this.pageBase, this.bookmarkBase, this.folderBase, this.desktopBase,
        this.collectionBase, this.trashBase, this.folderTrashBase, this.dockBase];
      return action();
    }); }
    catch (cause) {
      if (baselines) [this.pageBase, this.bookmarkBase, this.folderBase, this.desktopBase,
        this.collectionBase, this.trashBase, this.folderTrashBase, this.dockBase] = baselines;
      throw cause;
    }
  }
  private pageBase: string | undefined;
  private bookmarkBase: string | undefined;
  private folderBase: string | undefined;
  private desktopBase: string | undefined;
  private collectionBase: string | undefined;
  private trashBase: string | undefined;
  private folderTrashBase: string | undefined;
  private dockBase: string | undefined;
  private readonly jsonPreviews = new WeakMap<JsonAssetPreview, { source: string; candidate: string }>();
  private readonly workbenchPreviews = new WeakMap<WorkbenchPreview, {
    source: string; candidate: string; records: RestoreRecord[];
  }>();
  private readonly librarySnapshots = new WeakMap<DesktopLibrary, string>();

  private sourceRaw(): string {
    return JSON.stringify({
      [STORAGE_KEYS.LIBRARY]: applicationStorage().getItem(STORAGE_KEYS.LIBRARY),
      [STORAGE_KEYS.BOOKMARKS]: applicationStorage().getItem(STORAGE_KEYS.BOOKMARKS),
      [STORAGE_KEYS.FOLDERS]: applicationStorage().getItem(STORAGE_KEYS.FOLDERS),
      [STORAGE_KEYS.COLLECTIONS]: applicationStorage().getItem(STORAGE_KEYS.COLLECTIONS),
    });
  }

  hasLibraryChanges(): boolean {
    return this.pageBase !== undefined && this.pageBase !== this.sourceRaw();
  }

  private envelope(raw: string | null): Record<string, unknown> | null {
    if (raw === null) return null;
    try {
      const data = JSON.parse(raw);
      if (!data || data.version !== 1 || !Array.isArray(data.bookmarks) || !Array.isArray(data.folders)) {
        throw new Error('CORRUPT_DATA');
      }
      readBookmarkTrash(data.bookmarkTrash);
      readFolderTrash(data.folderTrash);
      if (data.dockBookmarkIds !== undefined && (!Array.isArray(data.dockBookmarkIds)
        || data.dockBookmarkIds.some((id: unknown) => typeof id !== 'string'))) throw new Error('CORRUPT_DATA');
      return data;
    } catch {
      throw new Error('CORRUPT_DATA');
    }
  }

  getDesktopLayout(): Layout {
    const library = this.readLibrary();
    const source = this.librarySnapshots.get(library)!;
    const data = this.envelope(JSON.parse(source)[STORAGE_KEYS.LIBRARY]);
    this.desktopBase ??= source;
    return data && Object.hasOwn(data, 'desktopLayout')
      ? validateDesktopLayout(library, data.desktopLayout) : validateDesktopLayout(library, emptyDesktopLayout());
  }

  executeDesktop(actions: DesktopAction[]): Layout {
    const current = this.readLibrary();
    const source = this.librarySnapshots.get(current)!;
    if (this.desktopBase !== undefined && this.desktopBase !== source) throw new Error('CONFLICT');
    const data = this.envelope(JSON.parse(source)[STORAGE_KEYS.LIBRARY]);
    const base = data && Object.hasOwn(data, 'desktopLayout')
      ? validateDesktopLayout(current, data.desktopLayout) : validateDesktopLayout(current, emptyDesktopLayout());
    const layout = applyDesktopActions(current, base, actions);
    this.commitLibrary(current, current, layout);
    return layout;
  }

  setDesktopPins(bookmarkIds: string[], pinned: boolean): Layout {
    const current = this.readLibrary();
    this.assertAssetBaseline(current);
    const ids = [...new Set(bookmarkIds)];
    if (ids.some(id => !current.bookmarks.some(bookmark => bookmark.id === id))) throw new Error('INVALID_REFERENCE');
    const layout = this.getDesktopLayout();
    const existing = new Set(layout.shortcuts.map(shortcut => shortcut.bookmarkId));
    const selected = ids.filter(id => pinned ? !existing.has(id) : existing.has(id));
    if (!selected.length) return layout;
    let index = layout.root.length;
    return this.executeDesktop(selected.map(bookmarkId => pinned
      ? { type: 'desktop.pin', bookmarkId, shortcutId: crypto.randomUUID(), to: { kind: 'root', index: index++ } }
      : { type: 'desktop.unpin', bookmarkId }));
  }

  saveManualBookmark(
    input: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'>, existingId?: string,
    desktopTarget?: { folderId?: string } | null,
  ): Bookmark {
    const current = this.readLibrary();
    if ((this.bookmarkBase !== undefined && this.bookmarkBase !== JSON.stringify(current.bookmarks))
      || (this.folderBase !== undefined && this.folderBase !== JSON.stringify(current.folders))) throw new Error('CONFLICT');
    const url = normalizeBookmarkUrl(input.url);
    if (current.bookmarks.some(item => item.id !== existingId && normalizeBookmarkUrl(item.url) === url)) throw new Error('DUPLICATE');
    if (input.folderId && !current.folders.some(folder => folder.id === input.folderId)) throw new Error('INVALID_REFERENCE');
    const previous = existingId ? current.bookmarks.find(item => item.id === existingId) : undefined;
    if (existingId && !previous) throw new Error('NOT_FOUND');
    const layout = this.getDesktopLayout();
    if (this.desktopBase !== this.librarySnapshots.get(current)) throw new Error('CONFLICT');
    const bookmark: Bookmark = {
      ...input, title: input.title.trim() || extractDomain(url), url, domain: extractDomain(url),
      ...normalizeBookmarkIcon(input.icon, input.iconMode),
      keywords: parseBookmarkKeywords((input.keywords ?? []).join(',')),
      id: previous?.id ?? crypto.randomUUID(), createdAt: previous?.createdAt ?? Date.now(), updatedAt: Date.now(),
      ...(!previous ? { pinnedToDesktop: false } : {}),
    };
    const bookmarks = previous
      ? current.bookmarks.map(item => item.id === previous.id ? bookmark : item)
      : [...current.bookmarks, bookmark];
    const folders = current.folders.map(folder => ({
      ...folder,
      bookmarkIds: previous?.folderId === bookmark.folderId && folder.id === bookmark.folderId
        ? [...folder.bookmarkIds] : [
        ...folder.bookmarkIds.filter(id => id !== bookmark.id),
        ...(folder.id === bookmark.folderId ? [bookmark.id] : []),
      ],
    }));
    const next = { bookmarks, folders };
    let nextLayout = layout;
    const target = desktopTarget === undefined ? (input.pinnedToDesktop ? {} : null) : desktopTarget;
    if (!previous && target !== null) {
      const folder = target.folderId === undefined ? undefined : layout.folders.find(item => item.id === target.folderId);
      if (target.folderId !== undefined && !folder) throw new Error('INVALID_REFERENCE');
      nextLayout = applyDesktopActions(next, layout, [{
        type: 'desktop.pin', bookmarkId: bookmark.id, shortcutId: crypto.randomUUID(),
        to: folder ? { kind: 'folder', folderId: folder.id, index: folder.shortcutIds.length }
          : { kind: 'root', index: layout.root.length },
      }]);
    }
    this.commitLibrary(current, next, nextLayout);
    return bookmark;
  }
  readLibrary(): { bookmarks: Bookmark[]; folders: Folder[] } {
    const source = this.sourceRaw();
    const values = JSON.parse(source) as Record<string, string | null>;
    const data = this.envelope(values[STORAGE_KEYS.LIBRARY]);
    let result: DesktopLibrary;
    try {
      result = data ? { bookmarks: data.bookmarks as Bookmark[], folders: data.folders as Folder[] } : {
        bookmarks: values[STORAGE_KEYS.BOOKMARKS] === null ? [] : JSON.parse(values[STORAGE_KEYS.BOOKMARKS]!),
        folders: values[STORAGE_KEYS.FOLDERS] === null ? [] : JSON.parse(values[STORAGE_KEYS.FOLDERS]!),
      };
      if (!Array.isArray(result.bookmarks) || !Array.isArray(result.folders)) throw new Error('CORRUPT_DATA');
      if (data && Object.hasOwn(data, 'desktopLayout')) {
        validateDesktopLayout(result, data.desktopLayout);
        this.desktopBase ??= source;
      }
    } catch {
      throw new Error('CORRUPT_DATA');
    }
    this.librarySnapshots.set(result, source);
    this.pageBase ??= source;
    return result;
  }

  commitImportedLibrary(
    expected: { bookmarks: Bookmark[]; folders: Folder[] },
    next: { bookmarks: Bookmark[]; folders: Folder[] },
  ): void {
    this.commitLibrary(expected, next);
  }

  private commitLibrary(expected: DesktopLibrary, next: DesktopLibrary, desktopLayout?: Layout, collections?: Collection[],
    extras?: { bookmarkTrash?: BookmarkTrashEntry[]; folderTrash?: FolderTrashEntry[]; dockBookmarkIds?: string[] }): void {
    this.assertRestoreReady();
    if (extras?.bookmarkTrash !== undefined) readBookmarkTrash(extras.bookmarkTrash);
    if (extras?.folderTrash !== undefined) readFolderTrash(extras.folderTrash);
    const current = this.readLibrary();
    const source = this.librarySnapshots.get(current)!;
    const expectedRaw = this.librarySnapshots.get(expected);
    const data = this.envelope(JSON.parse(source)[STORAGE_KEYS.LIBRARY]);
    const active = data && Object.hasOwn(data, 'desktopLayout');
    if ((this.pageBase !== undefined && this.pageBase !== source)
      || (expectedRaw !== undefined && expectedRaw !== source)
      || (active && this.desktopBase !== undefined && this.desktopBase !== source)
      || JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('CONFLICT');
    const layout = desktopLayout === undefined
      ? (active ? reconcileDesktopLayout(current, next, data.desktopLayout) : undefined)
      : validateDesktopLayout(next, desktopLayout);
    const serialized = JSON.stringify({
      ...data, version: 1, bookmarks: next.bookmarks, folders: next.folders,
      ...(layout === undefined ? {} : { desktopLayout: layout }),
      ...(collections === undefined ? {} : { collections }),
      ...extras,
    });
    if (this.sourceRaw() !== source) throw new Error('CONFLICT');
    // A single setItem makes the bookmark+folder import indivisible; old keys remain untouched.
    applicationStorage().setItem(STORAGE_KEYS.LIBRARY, serialized);
    let committedSource: string;
    try {
      if (applicationStorage().getItem(STORAGE_KEYS.LIBRARY) !== serialized) throw new Error('COMMIT_UNCERTAIN');
      committedSource = this.sourceRaw();
      const committed = JSON.parse(committedSource) as Record<string, string | null>;
      const original = JSON.parse(source) as Record<string, string | null>;
      if (committed[STORAGE_KEYS.LIBRARY] !== serialized
        || Object.keys(original).some(key => key !== STORAGE_KEYS.LIBRARY && committed[key] !== original[key])) {
        throw new Error('COMMIT_UNCERTAIN');
      }
    } catch {
      throw new Error('COMMIT_UNCERTAIN');
    }
    this.bookmarkBase = JSON.stringify(next.bookmarks);
    this.folderBase = JSON.stringify(next.folders);
    this.desktopBase = committedSource;
    this.pageBase = this.desktopBase;
    if (collections !== undefined) this.collectionBase = JSON.stringify(collections);
    if (extras?.bookmarkTrash !== undefined) this.trashBase = JSON.stringify(extras.bookmarkTrash);
    if (extras?.folderTrash !== undefined) this.folderTrashBase = JSON.stringify(extras.folderTrash);
    if (extras?.dockBookmarkIds !== undefined) this.dockBase = JSON.stringify(extras.dockBookmarkIds);
  }

  private safeGet<T>(key: string, fallback: T): T {
    try {
      const data = applicationStorage().getItem(key);
      if (!data) return fallback;
      return JSON.parse(data) as T;
    } catch (e) {
      console.warn(`Failed reading ${key} from localStorage, using fallback:`, e);
      return fallback;
    }
  }

  private safeSet<T>(key: string, value: T): void {
    this.assertRestoreReady();
    try {
      applicationStorage().setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(`Failed writing ${key} to localStorage:`, e);
    }
  }

  private writeRequired<T>(key: string, value: T): void {
    this.assertRestoreReady();
    const serialized = JSON.stringify(value);
    applicationStorage().setItem(key, serialized);
    try {
      if (applicationStorage().getItem(key) !== serialized) throw new Error('COMMIT_UNCERTAIN');
    } catch {
      // A successful write followed by a failed verification is not a rollback.
      throw new Error('COMMIT_UNCERTAIN');
    }
  }

  // Bookmarks
  getBookmarks(): Bookmark[] {
    const bookmarks = this.readLibrary().bookmarks;
    this.bookmarkBase ??= JSON.stringify(bookmarks);
    return bookmarks;
  }

  saveBookmarks(bookmarks: Bookmark[]): void {
    const current = this.readLibrary();
    if ((this.bookmarkBase !== undefined && this.bookmarkBase !== JSON.stringify(current.bookmarks))
      || (this.folderBase !== undefined && this.folderBase !== JSON.stringify(current.folders))) throw new Error('CONFLICT');
    this.commitImportedLibrary(current, { ...current, bookmarks });
  }

  findDuplicate(url: string, excludeId?: string): Bookmark | undefined {
    const norm = normalizeUrl(url);
    const bookmarks = this.getBookmarks();
    return bookmarks.find(b => b.id !== excludeId && normalizeUrl(b.url) === norm);
  }

  addBookmark(bookmark: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'>): Bookmark {
    const bookmarks = this.getBookmarks();
    const newBookmark: Bookmark = {
      ...bookmark,
      id: `bm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    bookmarks.unshift(newBookmark);
    this.saveBookmarks(bookmarks);
    return newBookmark;
  }

  updateBookmark(id: string, updates: Partial<Bookmark>): Bookmark | null {
    const bookmarks = this.getBookmarks();
    const index = bookmarks.findIndex(b => b.id === id);
    if (index === -1) return null;
    bookmarks[index] = {
      ...bookmarks[index],
      ...updates,
      updatedAt: Date.now(),
    };
    this.saveBookmarks(bookmarks);
    return bookmarks[index];
  }

  deleteBookmark(id: string): Bookmark | null {
    if (!this.getBookmarks().some(bookmark => bookmark.id === id)) return null;
    return this.deleteBookmarks([id])[0];
  }

  deleteBookmarks(bookmarkIds: string[]): Bookmark[] {
    const current = this.readLibrary();
    this.assertAssetBaseline(current);
    const ids = [...new Set(bookmarkIds)];
    const selected = new Set(ids);
    if (ids.some(id => !current.bookmarks.some(bookmark => bookmark.id === id))) throw new Error('INVALID_REFERENCE');
    if (!ids.length) return [];
    const deleted = current.bookmarks.filter(bookmark => selected.has(bookmark.id));
    const existingTrash = this.getBookmarkTrash();
    if (this.trashBase !== JSON.stringify(existingTrash)) throw new Error('CONFLICT');
    const deletedAt = Date.now();
    const batchId = crypto.randomUUID();
    const bookmarkTrash = [...deleted.map(bookmark => ({
      id: crypto.randomUUID(), deletedAt, batchId, bookmark: structuredClone(bookmark),
      folderIndex: Math.max(0, current.folders.find(folder => folder.id === bookmark.folderId)
        ?.bookmarkIds.indexOf(bookmark.id) ?? 0),
      bookmarkIndex: current.bookmarks.findIndex(item => item.id === bookmark.id),
    })), ...existingTrash];
    readBookmarkTrash(bookmarkTrash);
    const collections = detachCollectionBookmarks(this.getCollections(), selected);
    this.commitLibrary(current, {
      bookmarks: current.bookmarks.filter(bookmark => !selected.has(bookmark.id)),
      folders: current.folders.map(folder => ({ ...folder, bookmarkIds: folder.bookmarkIds.filter(value => !selected.has(value)) })),
    }, undefined, collections, {
      bookmarkTrash, dockBookmarkIds: (this.getUserSettings().dockBookmarkIds ?? []).filter(value => !selected.has(value)),
    });
    return deleted;
  }

  private assertAssetBaseline(current: DesktopLibrary): void {
    if ((this.bookmarkBase !== undefined && this.bookmarkBase !== JSON.stringify(current.bookmarks))
      || (this.folderBase !== undefined && this.folderBase !== JSON.stringify(current.folders))) throw new Error('CONFLICT');
  }

  getBookmarkTrash(): BookmarkTrashEntry[] {
    const trash = readBookmarkTrash(this.envelope(applicationStorage().getItem(STORAGE_KEYS.LIBRARY))?.bookmarkTrash);
    this.trashBase ??= JSON.stringify(trash);
    return trash;
  }

  private activeBookmarkUrls(bookmarks: Bookmark[]): Set<string> {
    return new Set(bookmarks.flatMap(bookmark => {
      try { return [normalizeBookmarkUrl(bookmark.url)]; }
      catch { return []; } // Unrelated legacy URLs stay untouched, but cannot collide with a valid HTTP(S) URL.
    }));
  }

  restoreTrashedBookmark(entryId: string): Bookmark {
    const current = this.readLibrary();
    this.assertAssetBaseline(current);
    const trash = this.getBookmarkTrash();
    if (this.trashBase !== JSON.stringify(trash)) throw new Error('CONFLICT');
    const entry = trash.find(item => item.id === entryId);
    if (!entry) throw new Error('NOT_FOUND');
    const url = normalizeBookmarkUrl(entry.bookmark.url);
    if (current.folders.some(item => item.id === entry.bookmark.id)
      || current.bookmarks.some(item => item.id === entry.bookmark.id)
      || this.activeBookmarkUrls(current.bookmarks).has(url)) throw new Error('DUPLICATE');
    const parent = current.folders.find(folder => folder.id === entry.bookmark.folderId);
    const bookmark = { ...entry.bookmark, folderId: parent?.id, pinnedToDesktop: false, updatedAt: Date.now() };
    // Earlier batch members still in Trash do not occupy an active array position.
    const batch = entry.batchId === undefined ? [] : trash.filter(item => item.batchId === entry.batchId);
    const folderIndex = entry.folderIndex - batch.filter(item =>
      item.bookmark.folderId === entry.bookmark.folderId && item.folderIndex < entry.folderIndex).length;
    const savedBookmarkIndex = entry.bookmarkIndex;
    const bookmarkIndex = savedBookmarkIndex === undefined ? current.bookmarks.length
      : savedBookmarkIndex - batch.filter(item =>
        item.bookmarkIndex !== undefined && item.bookmarkIndex < savedBookmarkIndex).length;
    const folders = current.folders.map(folder => {
      const ids = folder.bookmarkIds.filter(id => id !== bookmark.id);
      if (folder.id === parent?.id) ids.splice(Math.min(Math.max(0, folderIndex), ids.length), 0, bookmark.id);
      return { ...folder, bookmarkIds: ids };
    });
    const bookmarks = [...current.bookmarks];
    bookmarks.splice(Math.min(Math.max(0, bookmarkIndex), bookmarks.length), 0, bookmark);
    this.commitLibrary(current, { bookmarks, folders }, undefined, undefined,
      { bookmarkTrash: trash.filter(item => item.id !== entryId) });
    return bookmark;
  }

  purgeTrashedBookmark(entryId: string): void {
    const current = this.readLibrary();
    this.assertAssetBaseline(current);
    const trash = this.getBookmarkTrash();
    if (this.trashBase !== JSON.stringify(trash)) throw new Error('CONFLICT');
    const entry = trash.find(item => item.id === entryId);
    if (!entry) throw new Error('NOT_FOUND');
    // Purged members will never return; rebase their batch's saved positions atomically.
    const bookmarkTrash = trash.filter(item => item.id !== entryId).map(item => {
      if (entry.batchId === undefined || item.batchId !== entry.batchId) return item;
      return {
        ...item,
        ...(entry.bookmarkIndex !== undefined && item.bookmarkIndex !== undefined
          && item.bookmarkIndex > entry.bookmarkIndex ? { bookmarkIndex: item.bookmarkIndex - 1 } : {}),
        ...(item.bookmark.folderId === entry.bookmark.folderId && item.folderIndex > entry.folderIndex
          ? { folderIndex: item.folderIndex - 1 } : {}),
      };
    });
    this.commitLibrary(current, current, undefined, undefined, { bookmarkTrash });
  }

  restoreBookmark(bookmark: Bookmark): void {
    const deleted = this.getBookmarkTrash().find(item => item.bookmark.id === bookmark.id);
    if (deleted) { this.restoreTrashedBookmark(deleted.id); return; }
    const bookmarks = this.getBookmarks();
    if (!bookmarks.some(b => b.id === bookmark.id)) {
      bookmarks.unshift(bookmark);
      this.saveBookmarks(bookmarks);
    }
  }

  recordSiteVisit(id: string): void {
    // Visit history is optional; stale pages may still open their existing links.
    if (this.hasLibraryChanges()) return;
    const bookmarks = this.getBookmarks();
    const bm = bookmarks.find(b => b.id === id);
    if (bm) {
      bm.lastUsedAt = Date.now();
      this.saveBookmarks(bookmarks);
    }

    const recent = this.getRecentUsed();
    const next = [id, ...recent.filter(item => item !== id)].slice(0, 12);
    this.safeSet(STORAGE_KEYS.RECENT_USED, next);
  }

  getRecentUsed(): string[] {
    return this.safeGet<string[]>(STORAGE_KEYS.RECENT_USED, []);
  }

  // Folders
  getFolders(): Folder[] {
    const folders = this.readLibrary().folders;
    this.folderBase ??= JSON.stringify(folders);
    return folders;
  }

  saveFolders(folders: Folder[]): void {
    const current = this.readLibrary();
    if ((this.folderBase !== undefined && this.folderBase !== JSON.stringify(current.folders))
      || (this.bookmarkBase !== undefined && this.bookmarkBase !== JSON.stringify(current.bookmarks))) throw new Error('CONFLICT');
    this.commitImportedLibrary(current, { ...current, folders });
  }

  moveBookmarks(bookmarkIds: string[], targetFolderId?: string): void {
    const current = this.readLibrary();
    this.assertAssetBaseline(current);
    const ids = [...new Set(bookmarkIds)];
    const selected = new Set(ids);
    if ((targetFolderId !== undefined && !current.folders.some(folder => folder.id === targetFolderId))
      || ids.some(id => !current.bookmarks.some(bookmark => bookmark.id === id))) throw new Error('INVALID_REFERENCE');
    if (!ids.length) return;
    const now = Date.now();
    const bookmarks = current.bookmarks.map(bookmark => selected.has(bookmark.id)
      ? { ...bookmark, folderId: targetFolderId, updatedAt: now } : bookmark);
    const folders = current.folders.map(folder => ({
      ...folder,
      bookmarkIds: folder.id === targetFolderId
        ? [...new Set([...folder.bookmarkIds, ...ids])]
        : folder.bookmarkIds.filter(id => !selected.has(id)),
    }));
    this.commitLibrary(current, { bookmarks, folders });
  }

  createFolder(name: string, initialBookmarkIds: string[] = [], parentId?: string): Folder {
    const current = this.readLibrary();
    if ((this.folderBase !== undefined && this.folderBase !== JSON.stringify(current.folders))
      || (this.bookmarkBase !== undefined && this.bookmarkBase !== JSON.stringify(current.bookmarks))) throw new Error('CONFLICT');
    const ids = [...new Set(initialBookmarkIds)];
    if ((parentId !== undefined && !current.folders.some(folder => folder.id === parentId))
      || ids.some(id => !current.bookmarks.some(bookmark => bookmark.id === id))) throw new Error('INVALID_REFERENCE');
    const selected = new Set(ids);
    const newFolder: Folder = {
      id: crypto.randomUUID(),
      name,
      parentId,
      bookmarkIds: ids,
      pinnedToDesktop: !parentId, // Subfolders are contained within parent folder
      order: current.folders.length + 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    // Build archive membership and bookmark destinations before the single commit.
    const folders = [...current.folders.map(folder => ({
      ...folder, bookmarkIds: folder.bookmarkIds.filter(id => !selected.has(id)),
    })), newFolder];
    const bookmarks = current.bookmarks.map(bookmark => selected.has(bookmark.id)
      ? { ...bookmark, folderId: newFolder.id, pinnedToDesktop: false, updatedAt: newFolder.updatedAt }
      : bookmark);
    this.commitLibrary(current, { bookmarks, folders });
    return newFolder;
  }

  updateFolder(id: string, updates: Partial<Folder>): Folder | null {
    const folders = this.getFolders();
    const index = folders.findIndex(f => f.id === id);
    if (index === -1) return null;
    folders[index] = {
      ...folders[index],
      ...updates,
      updatedAt: Date.now(),
    };
    this.saveFolders(folders);
    return folders[index];
  }

  deleteFolder(id: string): void {
    const current = this.readLibrary();
    this.assertAssetBaseline(current);
    const target = current.folders.find(folder => folder.id === id);
    if (!target) throw new Error('NOT_FOUND');
    const direct = current.bookmarks.filter(bookmark => bookmark.folderId === id);
    const directIds = [...target.bookmarkIds.filter(value => direct.some(bookmark => bookmark.id === value)),
      ...direct.filter(bookmark => !target.bookmarkIds.includes(bookmark.id)).map(bookmark => bookmark.id)];
    const folders = current.folders.filter(folder => folder.id !== id).map(folder => ({
      ...folder,
      ...(folder.parentId === id ? { parentId: target.parentId } : {}),
      ...(folder.id === target.parentId ? { bookmarkIds: [...folder.bookmarkIds, ...directIds] } : {}),
    }));
    // Folder rows sort by order, so lift children into the dissolved row's position.
    const siblings = current.folders.filter(folder => folder.parentId === target.parentId)
      .sort((a, b) => a.order - b.order);
    const children = current.folders.filter(folder => folder.parentId === id).sort((a, b) => a.order - b.order);
    const order = siblings.flatMap(folder => folder.id === id ? children : [folder]);
    order.forEach((folder, index) => { const next = folders.find(item => item.id === folder.id)!; next.order = index; });
    this.commitLibrary(current, {
      folders, bookmarks: current.bookmarks.map(bookmark => bookmark.folderId === id
        ? { ...bookmark, folderId: target.parentId } : bookmark),
    });
  }

  getFolderTrash(): FolderTrashEntry[] {
    const entries = readFolderTrash(this.envelope(applicationStorage().getItem(STORAGE_KEYS.LIBRARY))?.folderTrash);
    this.folderTrashBase ??= JSON.stringify(entries);
    return entries;
  }

  trashFolder(id: string): void {
    const current = this.readLibrary();
    this.assertAssetBaseline(current);
    const existing = this.getFolderTrash();
    if (this.folderTrashBase !== JSON.stringify(existing)) throw new Error('CONFLICT');
    const ids = folderSubtree(current, id);
    const removed = new Set(current.bookmarks.filter(bookmark => ids.has(bookmark.folderId!)).map(bookmark => bookmark.id));
    const entry: FolderTrashEntry = {
      id: crypto.randomUUID(), deletedAt: Date.now(), rootId: id,
      folders: current.folders.flatMap((folder, index) => ids.has(folder.id) ? [{ folder, index }] : []),
      bookmarks: current.bookmarks.flatMap((bookmark, index) => removed.has(bookmark.id) ? [{ bookmark, index }] : []),
    };
    const folders = current.folders.filter(folder => !ids.has(folder.id))
      .map(folder => ({ ...folder, bookmarkIds: folder.bookmarkIds.filter(value => !removed.has(value)) }));
    this.commitLibrary(current, { folders, bookmarks: current.bookmarks.filter(bookmark => !removed.has(bookmark.id)) },
      undefined, detachCollectionBookmarks(this.getCollections(), removed), {
        folderTrash: [entry, ...existing],
        dockBookmarkIds: (this.getUserSettings().dockBookmarkIds ?? []).filter(value => !removed.has(value)),
      });
  }

  restoreTrashedFolder(entryId: string): void {
    const current = this.readLibrary();
    this.assertAssetBaseline(current);
    const trash = this.getFolderTrash();
    if (this.folderTrashBase !== JSON.stringify(trash)) throw new Error('CONFLICT');
    const entry = trash.find(item => item.id === entryId);
    if (!entry) throw new Error('NOT_FOUND');
    const occupied = new Set([...current.bookmarks, ...current.folders].map(item => item.id));
    const layout = this.getDesktopLayout();
    const activeUrls = this.activeBookmarkUrls(current.bookmarks);
    for (const item of [...(layout?.folders ?? []), ...(layout?.shortcuts ?? []), ...(layout?.dock ?? [])]) occupied.add(item.id);
    if (entry.folders.some(({ folder }) => occupied.has(folder.id))
      || entry.bookmarks.some(({ bookmark }) => occupied.has(bookmark.id)
        || activeUrls.has(normalizeBookmarkUrl(bookmark.url)))) {
      throw new Error('DUPLICATE');
    }
    const folders = [...current.folders];
    const bookmarks = [...current.bookmarks];
    for (const { folder, index } of [...entry.folders].sort((a, b) => a.index - b.index)) {
      const parentId = folder.id === entry.rootId && !current.folders.some(item => item.id === folder.parentId)
        ? undefined : folder.parentId;
      folders.splice(Math.min(index, folders.length), 0, { ...folder, parentId, pinnedToDesktop: false });
    }
    for (const { bookmark, index } of [...entry.bookmarks].sort((a, b) => a.index - b.index)) {
      bookmarks.splice(Math.min(index, bookmarks.length), 0, { ...bookmark, pinnedToDesktop: false });
    }
    this.commitLibrary(current, { bookmarks, folders }, undefined, undefined,
      { folderTrash: trash.filter(item => item.id !== entryId) });
  }

  purgeTrashedFolder(entryId: string): void {
    const current = this.readLibrary();
    this.assertAssetBaseline(current);
    const trash = this.getFolderTrash();
    if (this.folderTrashBase !== JSON.stringify(trash)) throw new Error('CONFLICT');
    if (!trash.some(item => item.id === entryId)) throw new Error('NOT_FOUND');
    this.commitLibrary(current, current, undefined, undefined, { folderTrash: trash.filter(item => item.id !== entryId) });
  }

  // Categories
  getCategories(): Category[] {
    return this.safeGet<Category[]>(STORAGE_KEYS.CATEGORIES, DEFAULT_CATEGORIES);
  }

  saveCategories(categories: Category[]): void {
    this.safeSet(STORAGE_KEYS.CATEGORIES, categories);
  }

  createCategory(name: string, icon = 'Folder', color = '#0ea5e9'): Category {
    const categories = this.getCategories();
    const newCat: Category = {
      id: `cat-${Date.now()}`,
      name,
      icon,
      color,
      order: categories.length + 1,
    };
    categories.push(newCat);
    this.saveCategories(categories);
    return newCat;
  }

  updateCategory(id: string, updates: Partial<Category>): Category | null {
    const categories = this.getCategories();
    const index = categories.findIndex(c => c.id === id);
    if (index === -1) return null;
    categories[index] = {
      ...categories[index],
      ...updates,
    };
    this.saveCategories(categories);
    return categories[index];
  }

  deleteCategory(id: string, fallbackCategoryId?: string): void {
    const categories = this.getCategories().filter(c => c.id !== id);
    this.saveCategories(categories);

    // Reassign bookmarks in this category
    const targetCatId = fallbackCategoryId || 'cat-inbox';
    const bookmarks = this.getBookmarks();
    bookmarks.forEach(bm => {
      if (bm.category === id) {
        bm.category = targetCatId;
      }
    });
    this.saveBookmarks(bookmarks);
  }

  // Tags
  getTags(): Tag[] {
    return this.safeGet<Tag[]>(STORAGE_KEYS.TAGS, DEFAULT_TAGS);
  }

  saveTags(tags: Tag[]): void {
    this.safeSet(STORAGE_KEYS.TAGS, tags);
  }

  createTag(name: string, color?: string): Tag {
    const tags = this.getTags();
    const existing = tags.find(t => t.name.toLowerCase() === name.trim().toLowerCase());
    if (existing) return existing;
    const newTag: Tag = {
      id: `tag-${Date.now()}`,
      name: name.trim(),
      color: color || '#6366f1',
      createdAt: Date.now(),
    };
    tags.push(newTag);
    this.saveTags(tags);
    return newTag;
  }

  // Collections
  getCollections(): Collection[] {
    const raw = applicationStorage().getItem(STORAGE_KEYS.LIBRARY);
    const data = this.envelope(raw);
    let collections: Collection[];
    try {
      const legacy = applicationStorage().getItem(STORAGE_KEYS.COLLECTIONS);
      collections = data && Object.hasOwn(data, 'collections')
        ? data.collections as Collection[] : legacy === null ? [] : JSON.parse(legacy);
      if (!Array.isArray(collections)) throw new Error('CORRUPT_DATA');
    } catch { throw new Error('CORRUPT_DATA'); }
    this.collectionBase ??= JSON.stringify(collections);
    return collections;
  }

  saveCollections(collections: Collection[]): void {
    const library = this.readLibrary();
    const current = this.getCollections();
    if (this.collectionBase !== JSON.stringify(current)) throw new Error('CONFLICT');
    this.commitLibrary(library, library, undefined, collections);
  }

  createCollection(data: Omit<Collection, 'id' | 'createdAt' | 'updatedAt'>): Collection {
    const collections = this.getCollections();
    const newCollection: Collection = {
      ...data,
      id: `col-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    collections.unshift(newCollection);
    this.saveCollections(collections);
    return newCollection;
  }

  cloneCollection(sourceCollection: Collection): Collection {
    const content = structuredClone(sourceCollection.assetContent ?? {
      cover: null, provenance: sourceCollection.clonedFromId
        ? [{ sourceId: sourceCollection.clonedFromId, title: null, author: null, url: null }] : [],
      sections: collectionSections(sourceCollection),
    });
    if (!content.provenance.some(source => source.sourceId === sourceCollection.id)) {
      content.provenance.push({
        sourceId: sourceCollection.id, title: sourceCollection.title,
        author: sourceCollection.authorName || null, url: null,
      });
    }
    const cloned: Collection = {
      ...structuredClone(sourceCollection),
      assetContent: content,
      id: `col-${crypto.randomUUID()}`,
      title: `${sourceCollection.title.slice(0, ASSET_LIMITS.titleLength - ' (副本)'.length)} (副本)`,
      authorId: 'user-me',
      authorName: '我的网址单',
      visibility: 'private',
      isPinnedToDesktop: false,
      isFavorited: false,
      isCloned: true,
      clonedFromId: sourceCollection.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const collections = this.getCollections();
    collections.unshift(cloned);
    this.saveCollections(collections);
    return cloned;
  }

  updateCollection(collection: Collection): Collection {
    const current = this.getCollections();
    const index = current.findIndex(item => item.id === collection.id);
    if (index < 0) throw new Error('NOT_FOUND');
    const updated = { ...structuredClone(collection), createdAt: current[index].createdAt, updatedAt: Date.now() };
    this.saveCollections(current.map((item, i) => i === index ? updated : item));
    return updated;
  }

  deleteCollection(id: string): void {
    const current = this.getCollections();
    if (!current.some(item => item.id === id)) throw new Error('NOT_FOUND');
    this.saveCollections(current.filter(item => item.id !== id));
  }

  // Search Engines
  getSearchEngines(): SearchEngine[] {
    return this.safeGet<SearchEngine[]>(STORAGE_KEYS.SEARCH_ENGINES, DEFAULT_SEARCH_ENGINES)
      .map(engine => ({ ...engine }));
  }

  saveSearchEngines(engines: SearchEngine[]): void {
    this.writeRequired(STORAGE_KEYS.SEARCH_ENGINES, engines);
  }

  private readSearchEnginesForMutation(): { baseline: string | null; engines: SearchEngine[] } {
    const baseline = applicationStorage().getItem(STORAGE_KEYS.SEARCH_ENGINES);
    let data: unknown;
    try { data = baseline === null ? DEFAULT_SEARCH_ENGINES : JSON.parse(baseline); }
    catch { throw new Error('CORRUPT_DATA'); }
    if (!Array.isArray(data) || data.some(engine => !engine || typeof engine !== 'object'
      || ['id', 'name', 'keyword', 'urlTemplate', 'icon'].some(field => typeof engine[field] !== 'string')
      || typeof engine.isDefault !== 'boolean'
      || (engine.isEnabled !== undefined && typeof engine.isEnabled !== 'boolean')
      || (engine.isCustom !== undefined && typeof engine.isCustom !== 'boolean'))) throw new Error('CORRUPT_DATA');
    if (new Set(data.map(engine => engine.id)).size !== data.length) throw new Error('CORRUPT_DATA');
    return { baseline, engines: data.map(engine => ({ ...engine })) };
  }

  reorderSearchEngines(ids: readonly string[], expectedIds: readonly string[]): SearchEngine[] {
    const { baseline, engines } = this.readSearchEnginesForMutation();
    const currentIds = engines.map(engine => engine.id);
    if (JSON.stringify(currentIds) !== JSON.stringify(expectedIds)) throw new Error('CONFLICT');
    const byId = new Map(engines.map(engine => [engine.id, engine]));
    if (ids.length !== engines.length || new Set(ids).size !== ids.length
      || ids.some(id => !byId.has(id))) throw new Error('INVALID_ORDER');
    const ordered = ids.map(id => byId.get(id)!);
    if (applicationStorage().getItem(STORAGE_KEYS.SEARCH_ENGINES) !== baseline) throw new Error('CONFLICT');
    if (JSON.stringify(currentIds) !== JSON.stringify(ids)) this.saveSearchEngines(ordered);
    return ordered;
  }

  addSearchEnginePresets(ids: readonly string[], language?: string): { engines: SearchEngine[]; addedCount: number } {
    const selected = new Set(ids);
    if (ids.some(id => !SEARCH_ENGINE_PRESETS.some(preset => preset.id === id))) throw new Error('INVALID_PRESET');
    // Unlike the display fallback, a batch write must refuse damaged or unknown data.
    const { baseline, engines } = this.readSearchEnginesForMutation();
    const t = createTranslator(language);
    let addedCount = 0;
    for (const preset of SEARCH_ENGINE_PRESETS) {
      if (!selected.has(preset.id) || searchEnginePresetStatus(preset, engines) !== 'available') continue;
      engines.push({
        id: preset.id, name: t(preset.nameKey), keyword: preset.keyword, urlTemplate: preset.urlTemplate,
        icon: 'Search', isDefault: false, isEnabled: true, isCustom: true,
      });
      addedCount++;
    }
    if (applicationStorage().getItem(STORAGE_KEYS.SEARCH_ENGINES) !== baseline) throw new Error('CONFLICT');
    if (addedCount > 0) this.saveSearchEngines(engines);
    return { engines, addedCount };
  }

  createSearchEngine(name: string, keyword: string, urlTemplate: string, isEnabled = true): SearchEngine {
    const engines = this.getSearchEngines();
    const newEngine: SearchEngine = {
      id: `engine-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name,
      keyword: keyword.trim().toLowerCase(),
      urlTemplate: urlTemplate.trim(),
      icon: 'Search',
      isDefault: false,
      isEnabled,
      isCustom: true,
    };
    engines.push(newEngine);
    this.saveSearchEngines(engines);
    return newEngine;
  }

  updateSearchEngine(id: string, updates: Partial<SearchEngine>): SearchEngine | null {
    const engines = this.getSearchEngines();
    const index = engines.findIndex(e => e.id === id);
    if (index === -1) return null;
    engines[index] = { ...engines[index], ...updates };
    this.saveSearchEngines(engines);
    return engines[index];
  }

  deleteSearchEngine(id: string): void {
    const engines = this.getSearchEngines().filter(e => e.id !== id);
    this.saveSearchEngines(engines);
  }

  // Plugins
  getPlugins(): Plugin[] {
    return this.safeGet<Plugin[]>(STORAGE_KEYS.PLUGINS, DEFAULT_PLUGINS);
  }

  savePlugins(plugins: Plugin[]): void {
    this.safeSet(STORAGE_KEYS.PLUGINS, plugins);
  }

  togglePluginInstall(pluginId: string): boolean {
    const plugins = this.getPlugins();
    const p = plugins.find(item => item.id === pluginId);
    if (!p) return false;
    p.installed = !p.installed;
    if (!p.installed) {
      p.pinnedToDesktop = false;
    }
    this.savePlugins(plugins);
    return p.installed;
  }

  // Submissions
  getSubmissions(): Submission[] {
    const defaults: Submission[] = [
      {
        id: 'sub-1',
        type: 'site',
        title: 'HuggingFace',
        url: 'https://huggingface.co',
        description: '全球最大的开源 AI 模型与数据集社区',
        category: 'cat-dev',
        tags: ['tag-open-source'],
        recommendationReason: '汇聚最前沿开源大模型权重与体验 Demo',
        status: 'approved',
        createdAt: Date.now() - 86400000 * 3,
        updatedAt: Date.now() - 86400000 * 2,
        reviewNotes: '内容充实，已收录至平台精选',
      },
      {
        id: 'sub-2',
        type: 'collection',
        title: '现代 CSS 新特性与实验库',
        description: '整理了 CSS Subgrid、Anchor Positioning 等前沿实验案例',
        category: 'cat-dev',
        tags: ['tag-graphics', 'tag-doc'],
        recommendationReason: '适合前端进阶学习',
        status: 'pending',
        isAiDraft: true,
        createdAt: Date.now() - 86400000 * 1,
        updatedAt: Date.now() - 86400000 * 1,
      },
    ];
    return this.safeGet<Submission[]>(STORAGE_KEYS.SUBMISSIONS, defaults);
  }

  saveSubmissions(submissions: Submission[]): void {
    this.safeSet(STORAGE_KEYS.SUBMISSIONS, submissions);
  }

  addSubmission(sub: Omit<Submission, 'id' | 'createdAt' | 'updatedAt'>): Submission {
    const list = this.getSubmissions();
    const newSub: Submission = {
      ...sub,
      id: `sub-${Date.now()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    list.unshift(newSub);
    this.saveSubmissions(list);
    return newSub;
  }

  // Settings
  getUserSettings(): UserSettings {
    const saved = this.safeGet<Partial<UserSettings> | null>(STORAGE_KEYS.SETTINGS, null);
    const settings: UserSettings = {
      ...DEFAULT_USER_SETTINGS, ...saved, language: selectLocale(saved?.language), customWallpaperFit: 'cover',
    };
    const data = this.envelope(applicationStorage().getItem(STORAGE_KEYS.LIBRARY));
    const effective = data?.dockBookmarkIds ? { ...settings, dockBookmarkIds: data.dockBookmarkIds as string[] } : settings;
    this.dockBase ??= JSON.stringify(effective.dockBookmarkIds ?? []);
    return effective;
  }

  saveUserSettings(settings: Partial<UserSettings>): UserSettings {
    const current = this.getUserSettings();
    const updated = { ...current, ...settings };
    if (settings.dockBookmarkIds !== undefined) {
      if (this.dockBase !== JSON.stringify(current.dockBookmarkIds ?? [])) throw new Error('CONFLICT');
      const library = this.readLibrary();
      this.assertAssetBaseline(library);
      this.commitLibrary(library, library, undefined, undefined, { dockBookmarkIds: settings.dockBookmarkIds });
      if (Object.keys(settings).length === 1) return updated;
    }
    this.writeRequired(STORAGE_KEYS.SETTINGS, updated);
    return updated;
  }

  // Recent Searches
  getRecentSearches(): string[] {
    return this.safeGet<string[]>(STORAGE_KEYS.RECENT_SEARCHES, ['JSON', '设计灵感', '代码规范', '计算器']);
  }

  addRecentSearch(query: string): void {
    const trimmed = query.trim();
    if (!trimmed) return;
    const searches = this.getRecentSearches();
    const updated = [trimmed, ...searches.filter(s => s !== trimmed)].slice(0, 8);
    this.safeSet(STORAGE_KEYS.RECENT_SEARCHES, updated);
  }

  clearRecentSearches(): void {
    this.safeSet(STORAGE_KEYS.RECENT_SEARCHES, []);
  }

  // HTML Bookmarks Parser
  parseHtmlBookmarks(htmlContent: string): {
    title: string;
    url: string;
    folderPath?: string;
    addDate?: number;
  }[] {
    const results: { title: string; url: string; folderPath?: string; addDate?: number }[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    const traverse = (node: Element, currentPath: string[]) => {
      for (const child of Array.from(node.children)) {
        if (child.tagName === 'DT') {
          // Check for folder header H3
          const h3 = child.querySelector(':scope > H3, :scope > h3');
          if (h3) {
            const folderName = h3.textContent?.trim() || '未命名文件夹';
            const dl = child.querySelector(':scope > DL, :scope > dl');
            if (dl) {
              traverse(dl, [...currentPath, folderName]);
            }
          }

          // Check for bookmark link A
          const a = child.querySelector(':scope > A, :scope > a');
          if (a) {
            const href = a.getAttribute('href') || '';
            const title = a.textContent?.trim() || href;
            const addDateStr = a.getAttribute('add_date');
            const addDate = addDateStr ? parseInt(addDateStr, 10) * 1000 : undefined;
            if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
              results.push({
                title,
                url: href,
                folderPath: currentPath.join(' / '),
                addDate,
              });
            }
          }
        } else if (child.tagName === 'DL' || child.tagName === 'dl') {
          traverse(child, currentPath);
        }
      }
    };

    traverse(doc.body, []);
    return results;
  }

  // HTML Netscape Bookmarks Generator
  exportHtmlBookmarks(): string {
    const { bookmarks, folders } = this.readLibrary();
    return exportBookmarkHtml(bookmarks, folders);
  }

  // Asset exchange intentionally excludes preferences, history and desktop layout.
  exportJsonBackup(): string {
    return exportPrototypeAssets({ ...this.readLibrary(), collections: this.getCollections() }, Date.now());
  }

  private workbenchSource(): string {
    return JSON.stringify([this.sourceRaw(), applicationStorage().getItem(STORAGE_KEYS.SEARCH_ENGINES),
      applicationStorage().getItem(STORAGE_KEYS.SETTINGS)]);
  }

  private assertRestoreReady(): void {
    if (applicationStorage().getItem(RESTORE_JOURNAL) !== null) throw new Error('RESTORE_RECOVERY_REQUIRED');
  }

  private readWorkbench(): WorkbenchState {
    const library = this.readLibrary();
    const data = this.envelope(applicationStorage().getItem(STORAGE_KEYS.LIBRARY));
    const settingsRaw = applicationStorage().getItem(STORAGE_KEYS.SETTINGS);
    let settings: Record<string, unknown> = {};
    try {
      if (settingsRaw !== null) {
        const parsed = JSON.parse(settingsRaw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        settings = parsed;
      }
    } catch { throw new Error('CORRUPT_DATA'); }
    let engines: SearchEngine[];
    try {
      const raw = applicationStorage().getItem(STORAGE_KEYS.SEARCH_ENGINES);
      engines = raw === null ? structuredClone(DEFAULT_SEARCH_ENGINES) : JSON.parse(raw);
    } catch { throw new Error('CORRUPT_DATA'); }
    let search: WorkbenchState['search'];
    try {
      search = validateWorkbenchSearch({
        engines, defaultEngineId: settings.defaultSearchEngineId ?? DEFAULT_USER_SETTINGS.defaultSearchEngineId,
      });
    } catch (cause) {
      throw new Error(cause instanceof Error && cause.message.startsWith('SEARCH_') ? `BACKUP_${cause.message}` : 'BACKUP_SEARCH_INVALID');
    }
    const rawTaskbar = data?.dockBookmarkIds ?? settings.dockBookmarkIds ?? [];
    if (!Array.isArray(rawTaskbar) || rawTaskbar.some(id => typeof id !== 'string')
      || new Set(rawTaskbar).size !== rawTaskbar.length) throw new Error('BACKUP_TASKBAR_INVALID');
    const activeIds = new Set(library.bookmarks.map(b => b.id));
    const demoDefaults = new Set(DEFAULT_USER_SETTINGS.dockBookmarkIds);
    // Saving unrelated preferences historically persisted invisible demo taskbar IDs.
    const taskbar = rawTaskbar.filter(id => activeIds.has(id) || !demoDefaults.has(id));
    if (taskbar.some(id => !activeIds.has(id))) throw new Error('BACKUP_TASKBAR_INVALID');
    return {
      assets: { ...library, collections: this.getCollections() }, layout: this.getDesktopLayout(),
      taskbar: taskbar as string[], search,
      trashIds: [
        ...readBookmarkTrash(data?.bookmarkTrash).map(e => e.bookmark.id),
        ...readFolderTrash(data?.folderTrash).flatMap(e => [...e.bookmarks.map(r => r.bookmark.id), ...e.folders.map(r => r.folder.id)]),
      ],
    };
  }

  exportWorkbenchBackup(): string {
    this.assertRestoreReady();
    const source = this.workbenchSource();
    const result = exportWorkbench(this.readWorkbench(), Date.now());
    if (source !== this.workbenchSource()) throw new Error('CONFLICT');
    return result;
  }

  getWorkbenchInventory(): WorkbenchInventory {
    this.assertRestoreReady();
    const source = this.workbenchSource();
    const state = this.readWorkbench();
    if (source !== this.workbenchSource()) throw new Error('CONFLICT');
    return {
      bookmarks: state.assets.bookmarks.length, folders: state.assets.folders.length,
      collections: state.assets.collections.length, desktop: state.layout.shortcuts.length,
      desktopFolders: state.layout.folders.length, taskbar: state.taskbar.length, search: state.search.engines.length,
    };
  }

  previewWorkbenchRestore(text: string, options?: WorkbenchOptions): WorkbenchPreview {
    this.assertRestoreReady();
    const source = this.workbenchSource();
    const backup = parseWorkbench(text);
    const preview = previewWorkbench(backup, this.readWorkbench(), options ?? { desktop: true, taskbar: true, search: true });
    const before = applicationStorage().getItem(STORAGE_KEYS.LIBRARY);
    const data = this.envelope(before);
    const next = preview.next;
    const records: RestoreRecord[] = [{
      key: STORAGE_KEYS.LIBRARY, before,
      after: JSON.stringify({ ...data, version: 1, ...next.assets, desktopLayout: next.layout, dockBookmarkIds: next.taskbar }),
    }];
    if (preview.options.search) {
      const settingsBefore = applicationStorage().getItem(STORAGE_KEYS.SETTINGS);
      records.push({ key: STORAGE_KEYS.SEARCH_ENGINES, before: applicationStorage().getItem(STORAGE_KEYS.SEARCH_ENGINES),
        after: JSON.stringify(next.search.engines) });
      records.push({ key: STORAGE_KEYS.SETTINGS, before: settingsBefore,
        after: JSON.stringify({ ...(settingsBefore === null ? {} : JSON.parse(settingsBefore)),
          defaultSearchEngineId: next.search.defaultEngineId }) });
    }
    if (source !== this.workbenchSource()) throw new Error('CONFLICT');
    this.workbenchPreviews.set(preview, { source, candidate: JSON.stringify(preview), records });
    return preview;
  }

  async restoreWorkbench(preview: WorkbenchPreview, active: () => boolean = () => true): Promise<void> {
    const ticket = this.workbenchPreviews.get(preview);
    if (!ticket || ticket.candidate !== JSON.stringify(preview)) throw new Error('PREVIEW_STALE');
    if (!navigator.locks?.request) throw new Error('LOCK_UNAVAILABLE');
    await navigator.locks.request('jigeqiu:prototype:library-import', () =>
      navigator.locks.request('jigeqiu:prototype:search-engines', async () => {
        if (!active()) throw new Error('CANCELLED');
        if (this.workbenchPreviews.get(preview) !== ticket) throw new Error('PREVIEW_STALE');
        await this.mutate(() => {
          if (!active()) throw new Error('CANCELLED');
          if (ticket.source !== this.workbenchSource()) throw new Error('CONFLICT');
          commitRestoreRecords(applicationStorage(), ticket.records, !hasApplicationStorageDriver());
        });
        this.workbenchPreviews.delete(preview);
        this.pageBase = this.bookmarkBase = this.folderBase = this.desktopBase = undefined;
        this.collectionBase = this.trashBase = this.folderTrashBase = this.dockBase = undefined;
      }));
  }

  previewJsonAssetImport(text: string, keepCopies = false): JsonAssetPreview {
    try {
      if (JSON.parse(text)?.format === WORKBENCH_FORMAT) text = workbenchAssetText(text);
    } catch (cause) {
      if (cause instanceof SyntaxError) throw new Error('IMPORT_INVALID');
      throw cause;
    }
    const source = this.sourceRaw();
    const preview = preparePrototypeJsonImport(text, {
      ...this.readLibrary(), collections: this.getCollections(),
    }, keepCopies, () => crypto.randomUUID(), Date.now());
    if (this.sourceRaw() !== source) throw new Error('CONFLICT');
    this.jsonPreviews.set(preview, { source, candidate: JSON.stringify(preview) });
    return preview;
  }

  commitJsonAssetImport(preview: JsonAssetPreview): void {
    const ticket = this.jsonPreviews.get(preview);
    if (!ticket || ticket.candidate !== JSON.stringify(preview)) throw new Error('PREVIEW_STALE');
    if (this.sourceRaw() !== ticket.source) throw new Error('CONFLICT');
    if (preview.counts.bookmarks + preview.counts.folders + preview.counts.collections === 0) {
      return;
    }
    const current = this.readLibrary();
    this.commitLibrary(current, preview.next, undefined, preview.next.collections);
  }

  // Legacy direct replacement is disabled: callers must retain and confirm a preview.
  importJsonBackup(jsonString: string): boolean {
    return false;
  }

  resetAllData(): void {
    this.assertRestoreReady();
    if (this.hasLibraryChanges()) throw new Error('CONFLICT');
    Object.values(STORAGE_KEYS).forEach(key => applicationStorage().removeItem(key));
  }
}

export const storage = new StorageManager();

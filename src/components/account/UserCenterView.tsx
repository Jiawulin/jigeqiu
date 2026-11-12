import React, { useState, useMemo } from 'react';
import { Pagination } from '../common/Pagination';
import { WallpaperSettings } from '../common/WallpaperSettings';
import {
  Bookmark,
  Folder,
  SearchEngine,
  UserSettings,
  AppearanceMode,
} from '../../types';
import { FaviconImage } from '../common/FaviconImage';
import { BookmarkDialog } from '../common/BookmarkDialog';
import { FolderTreeSelect } from '../common/FolderTreeSelect';
import { buildFolderTree, indexFolderPaths, visibleFolderRows } from '../common/folder-tree';
import { IconCacheSettings } from '../common/IconCacheSettings';
import { storage } from '../../services/storage';
import {
  BookmarkCheck,
  Folder as FolderIcon,
  FolderPlus,
  FolderTree,
  Search,
  Trash2,
  Edit2,
  Plus,
  Library,
  Check,
  RotateCcw,
  ExternalLink,
  Sparkles,
  ChevronRight,
  ChevronDown,
  ToggleLeft,
  ToggleRight,
  Play,
  Pin,
  PinOff,
  MoveRight,
  FolderOpen,
  X,
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { AssetTransferPage } from './AssetTransferPage';
import { SearchEnginePresetPicker } from './SearchEnginePresetPicker';
import { SearchEngineOrderList } from './SearchEngineOrderList';
import { SEARCH_ENGINE_PRESETS } from '../../data/search-engine-presets';
import { withSearchEngineMutation } from '../../services/search-engine-mutation';
import type { ManagementSection } from './ManagementShell';
import { folderSubtree } from '../../services/folder-trash';
import { withCollectionMutation } from '../../services/collection-mutation';
import { preferenceSaveError } from '../../services/preference-save-error';
import { commitAndRefresh } from '../../services/library-mutation';
import { createTranslator } from '../../i18n';
import type { OnboardingTaskContext } from '../onboarding/types';
import { buildBookmarkSearchIndex, searchBookmarkIds } from '../../services/bookmark-search';

interface UserCenterViewProps {
  onboarding?: OnboardingTaskContext;
  initialTab?: Exclude<ManagementSection, 'collections' | 'trash'>;
  onSectionChange?: (section: Exclude<ManagementSection, 'collections' | 'trash'>) => void;
  initialBookmarkId?: string | null;
  initialFolderId?: string | null;
  onFolderRevealed?: () => void;
  onBookmarkRevealed?: () => void;
  bookmarks: Bookmark[];
  folders: Folder[];
  searchEngines: SearchEngine[];
  userSettings: UserSettings;
  onSearchEnginesChanged: (engines: SearchEngine[]) => void;
  onUpdateSettings: (settings: Partial<UserSettings>) => boolean | void | Promise<boolean | void>;
  onShowToast: (message: string, actionText?: string, onAction?: () => void) => void;
  /** Read and publish the saved library only; this notification must never write. */
  onLibraryChanged: () => void;
  desktopBookmarkIds?: string[];
  onSetDesktopPins: (ids: string[], pinned: boolean) => void | Promise<void>;
}

export const UserCenterView: React.FC<UserCenterViewProps> = ({
  onboarding,
  initialTab,
  onSectionChange,
  initialBookmarkId,
  initialFolderId,
  onFolderRevealed,
  onBookmarkRevealed,
  bookmarks,
  folders,
  searchEngines,
  userSettings,
  onSearchEnginesChanged,
  onUpdateSettings,
  onShowToast,
  onLibraryChanged,
  desktopBookmarkIds,
  onSetDesktopPins,
}) => {
  const t = createTranslator(userSettings.language);
  const isDesktopPinned = (bookmark: Bookmark) => desktopBookmarkIds
    ? desktopBookmarkIds.includes(bookmark.id) : bookmark.pinnedToDesktop;
  const [activeTab, setInternalTab] = useState<Exclude<ManagementSection, 'collections' | 'trash'>>(initialTab || 'bookmarks');
  const setActiveTab = (section: typeof activeTab) => {
    setInternalTab(section);
    onSectionChange?.(section);
  };

  React.useEffect(() => {
    if (initialTab) {
      setInternalTab(initialTab);
    }
  }, [initialTab]);

  // ========================================================
  // Chrome-Style Bookmark Manager State (文件夹层级与全量书签库)
  // ========================================================
  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const folderPaths = useMemo(() => indexFolderPaths(folders), [folders]);
  const [bookmarkSearch, setBookmarkSearch] = useState('');
  const bookmarkSearchIndex = useMemo(() => buildBookmarkSearchIndex(bookmarks, bookmark =>
    bookmark.folderId ? (folderPaths.get(bookmark.folderId) ?? []).map(folder => folder.name).join(' / ') : ''),
  [bookmarks, folderPaths]);
  const matchingBookmarkIds = useMemo(() => searchBookmarkIds(bookmarkSearchIndex, bookmarkSearch), [bookmarkSearchIndex, bookmarkSearch]);
  const [selectedBmIds, setSelectedBmIds] = useState<string[]>([]);

  // Modals for Bookmark Manager
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [isAddBookmarkOpen, setIsAddBookmarkOpen] = useState(false);
  const [removingFolder, setRemovingFolder] = useState<Folder | null>(null);
  const [folderRemovalError, setFolderRemovalError] = useState<{ cause: unknown } | null>(null);
  const [folderRemovalBusy, setFolderRemovalBusy] = useState(false);
  const folderRemovalPending = React.useRef(false);
  const folderRemovalMounted = React.useRef(true);
  React.useEffect(() => {
    folderRemovalMounted.current = true;
    return () => { folderRemovalMounted.current = false; };
  }, []);

  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParentId, setNewFolderParentId] = useState<string>('none');
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => {
    // Default expand all folders that have subfolders
    const set = new Set<string>();
    folders.forEach(f => {
      if (folders.some(child => child.parentId === f.id)) {
        set.add(f.id);
      }
    });
    return set;
  });

  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [editFolderParentId, setEditFolderParentId] = useState<string>('none');

  const [isBatchMoveOpen, setIsBatchMoveOpen] = useState(false);
  const [batchTargetFolderId, setBatchTargetFolderId] = useState('unorganized');
  const [libraryMutationBusy, setLibraryMutationBusy] = useState(false);
  const [libraryMutationError, setLibraryMutationError] = useState<{ cause: unknown } | null>(null);
  const libraryMutationPending = React.useRef(false);
  React.useEffect(() => {
    setLibraryMutationError(null);
  }, [isCreateFolderOpen, isBatchMoveOpen, editingFolder?.id]);

  // Bookmark Table Pagination State
  const [bmPage, setBmPage] = useState(1);
  const [bmPageSize, setBmPageSize] = useState(15);

  // Alfred-style Search Engine Manager State
  const [isAddEngineOpen, setIsAddEngineOpen] = useState(false);
  const [isPresetPickerOpen, setIsPresetPickerOpen] = useState(false);
  const [editingEngine, setEditingEngine] = useState<SearchEngine | null>(null);
  const [engineFormName, setEngineFormName] = useState('');
  const [engineFormKeyword, setEngineFormKeyword] = useState('');
  const [engineFormUrl, setEngineFormUrl] = useState('');
  const [engineFormEnabled, setEngineFormEnabled] = useState(true);
  const [testEngineModal, setTestEngineModal] = useState<SearchEngine | null>(null);
  const [testEngineQuery, setTestEngineQuery] = useState('记个球');
  const [pendingDeleteEngine, setPendingDeleteEngine] = useState<{ id: string; name: string } | null>(null);
  const [deleteEngineError, setDeleteEngineError] = useState<{ cause: unknown } | null>(null);
  const [deleteEngineBusy, setDeleteEngineBusy] = useState(false);
  const [engineSaveError, setEngineSaveError] = useState<
    { kind: 'template-validation' } | { kind: 'cause'; cause: unknown } | null
  >(null);
  React.useEffect(() => { setEngineSaveError(null); }, [isAddEngineOpen]);
  const [htmlExportError, setHtmlExportError] = useState(false);
  const engineMutationPending = React.useRef(false);
  const engineEditorGeneration = React.useRef(0);
  React.useEffect(() => {
    engineEditorGeneration.current++;
    return () => { engineEditorGeneration.current++; };
  }, [activeTab, isAddEngineOpen, editingEngine?.id, pendingDeleteEngine?.id]);
  const runEngineMutation = (action: () => void | Promise<void>, onError: (error: unknown) => void) => {
    if (engineMutationPending.current) return;
    engineMutationPending.current = true;
    const generation = engineEditorGeneration.current;
    return withSearchEngineMutation(async () => {
      try { await action(); } catch (error) { onError(error); }
      finally { engineMutationPending.current = false; }
    }, () => folderRemovalMounted.current && engineEditorGeneration.current === generation).catch(error => {
      engineMutationPending.current = false;
      if (!(error instanceof Error && error.message === 'CANCELLED')) onError(error);
    });
  };

  // Search the whole library; folder selection only limits browsing without a query.
  const filteredBookmarks = useMemo(() => {
    let list = bookmarks;

    if (!bookmarkSearch.trim() && selectedFolderId === 'unorganized') {
      list = list.filter(bm => !bm.folderId);
    } else if (!bookmarkSearch.trim() && selectedFolderId !== 'all') {
      list = list.filter(bm => bm.folderId === selectedFolderId);
    }

    list = list.filter(bm => matchingBookmarkIds.has(bm.id));

    return list;
  }, [bookmarks, selectedFolderId, matchingBookmarkIds, bookmarkSearch]);

  // Reset pagination when filter or folder changes
  React.useEffect(() => {
    if (!initialBookmarkId) setBmPage(1);
  }, [selectedFolderId, bookmarkSearch, bmPageSize]);

  // Pagination slicing
  const totalPages = Math.max(1, Math.ceil(filteredBookmarks.length / bmPageSize));
  const currentBookmarkPage = Math.min(bmPage, totalPages);
  React.useEffect(() => { setBmPage(currentBookmarkPage); }, [currentBookmarkPage]);
  const paginatedBookmarks = useMemo(() => {
    const start = (currentBookmarkPage - 1) * bmPageSize;
    return filteredBookmarks.slice(start, start + bmPageSize);
  }, [filteredBookmarks, currentBookmarkPage, bmPageSize]);

  React.useEffect(() => {
    if (!initialBookmarkId) return;
    const index = bookmarks.findIndex(bookmark => bookmark.id === initialBookmarkId);
    if (index < 0) { onBookmarkRevealed?.(); return; }
    setActiveTab('bookmarks');
    setSelectedFolderId('all');
    setBookmarkSearch('');
    setBmPage(Math.floor(index / bmPageSize) + 1);
  }, [initialBookmarkId, bookmarks, bmPageSize]);
  React.useEffect(() => {
    if (!initialBookmarkId || selectedFolderId !== 'all' || bookmarkSearch
      || !paginatedBookmarks.some(bookmark => bookmark.id === initialBookmarkId)) return;
    const row = Array.from(document.querySelectorAll<HTMLElement>('[data-library-bookmark]'))
      .find(element => element.dataset.libraryBookmark === initialBookmarkId);
    if (row) {
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: 'nearest' });
      onBookmarkRevealed?.();
    }
  }, [initialBookmarkId, selectedFolderId, bookmarkSearch, paginatedBookmarks, onBookmarkRevealed]);

  React.useEffect(() => {
    if (!initialFolderId) return;
    const path = folderPaths.get(initialFolderId);
    if (!path) { onFolderRevealed?.(); return; }
    setActiveTab('bookmarks');
    setSelectedFolderId(initialFolderId);
    setBookmarkSearch('');
    setSelectedBmIds([]);
    setBmPage(1);
    setExpandedFolderIds(previous => new Set([...previous, ...path.map(folder => folder.id)]));
  }, [initialFolderId, folderPaths]);
  React.useEffect(() => {
    if (!initialFolderId || selectedFolderId !== initialFolderId || bookmarkSearch || bmPage !== 1) return;
    const row = Array.from(document.querySelectorAll<HTMLElement>('[data-library-folder]'))
      .find(element => element.dataset.libraryFolder === initialFolderId);
    if (row) {
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: 'nearest' });
      onFolderRevealed?.();
    }
  }, [initialFolderId, selectedFolderId, bookmarkSearch, bmPage, expandedFolderIds, onFolderRevealed]);

  // Multi-level Folder Tree Builder (with depth and child expansion)
  const folderTree = useMemo(() => visibleFolderRows(buildFolderTree(folders), expandedFolderIds)
    .map(row => ({ folder: row.node.folder, depth: row.depth - 1, hasChildren: row.node.children.length > 0 })),
  [folders, expandedFolderIds]);

  // Direct subfolders for the currently selected folder
  const currentSubfolders = useMemo(() => {
    if (selectedFolderId === 'all' || selectedFolderId === 'unorganized') return [];
    return folders.filter(folder => folderPaths.get(folder.id)?.at(-2)?.id === selectedFolderId);
  }, [selectedFolderId, folders, folderPaths]);

  // Breadcrumbs chain navigation
  const breadcrumbs = useMemo(() => {
    if (selectedFolderId === 'all') return [{ id: 'all', name: t('managerAllLibraryBookmarks') }];
    if (selectedFolderId === 'unorganized') return [{ id: 'unorganized', name: t('managerUnorganized') }];

    const chain = (folderPaths.get(selectedFolderId) ?? []).map(folder => ({ id: folder.id, name: folder.name }));
    return [{ id: 'all', name: t('managerAllBookmarks') }, ...chain];
  }, [selectedFolderId, folderPaths, t]);

  // Toggle expand/collapse for a folder in the tree
  const toggleFolderExpand = (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolderIds(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  // Handle Desktop Shortcut Toggle (发送到桌面 / 从桌面移除)
  const handleToggleDesktopShortcut = async (bmId: string) => {
    const bm = bookmarks.find(b => b.id === bmId);
    if (!bm) return;

    const willPin = !isDesktopPinned(bm);
    try {
      await onSetDesktopPins([bmId], willPin);
      onShowToast(willPin ? t('managerDesktopShortcutAdded', { name: bm.title }) : t('managerDesktopShortcutRemoved'));
    } catch (error) {
      onShowToast(preferenceSaveError(error, userSettings.language, 'library'));
    }
  };

  // Handle Dock Shortcut Toggle (固定到程序坞 / 从程序坞移除)
  const handleToggleDockPin = async (bmId: string) => {
    const current = userSettings.dockBookmarkIds || [];
    const isPinned = current.includes(bmId);
    const next = isPinned ? current.filter(id => id !== bmId) : [...current, bmId];
    if (await onUpdateSettings({ dockBookmarkIds: next }) === false) return;
    onShowToast(t(isPinned ? 'managerTaskbarUnpinnedToast' : 'managerTaskbarPinnedToast'));
  };

  // Delete Bookmark completely from Library
  const [pendingDeleteBookmarkIds, setPendingDeleteBookmarkIds] = useState<string[]>([]);
  const [deleteBookmarkError, setDeleteBookmarkError] = useState<{ cause: unknown } | null>(null);
  const handleDeleteBookmarkFromLibrary = (bmId: string) => {
    setDeleteBookmarkError(null);
    setPendingDeleteBookmarkIds([bmId]);
  };

  // Batch Delete
  const handleBatchDelete = () => {
    if (selectedBmIds.length === 0) return;
    setDeleteBookmarkError(null);
    setPendingDeleteBookmarkIds([...selectedBmIds]);
  };
  const confirmBookmarkDeletion = async () => {
    if (!pendingDeleteBookmarkIds.length || libraryMutationPending.current) return;
    libraryMutationPending.current = true;
    setLibraryMutationBusy(true);
    setDeleteBookmarkError(null);
    const ids = [...pendingDeleteBookmarkIds];
    try {
      await withCollectionMutation(() => commitAndRefresh(() => storage.deleteBookmarks(ids), onLibraryChanged),
        () => folderRemovalMounted.current);
      if (!folderRemovalMounted.current) return;
      setPendingDeleteBookmarkIds([]);
      setSelectedBmIds(current => current.filter(id => !ids.includes(id)));
      onShowToast(t('bookmarksMovedToTrash', { count: ids.length }));
    } catch (error) {
      if (folderRemovalMounted.current) setDeleteBookmarkError({ cause: error });
    } finally {
      libraryMutationPending.current = false;
      if (folderRemovalMounted.current) setLibraryMutationBusy(false);
    }
  };

  // Batch Move Folder
  const handleExecuteBatchMoveFolder = async () => {
    if (selectedBmIds.length === 0 || libraryMutationPending.current) return;
    const targetFolder = batchTargetFolderId === 'unorganized' ? undefined : batchTargetFolderId;
    libraryMutationPending.current = true;
    setLibraryMutationBusy(true);
    setLibraryMutationError(null);
    try {
      await withCollectionMutation(() => commitAndRefresh(
        () => storage.moveBookmarks(selectedBmIds, targetFolder), onLibraryChanged),
        () => folderRemovalMounted.current);
      if (!folderRemovalMounted.current) return;
      setIsBatchMoveOpen(false);
      setSelectedBmIds([]);
      onShowToast(t('managerBookmarksMoved', { count: selectedBmIds.length }));
    } catch (error) {
      if (folderRemovalMounted.current) setLibraryMutationError({ cause: error });
    } finally {
      libraryMutationPending.current = false;
      if (folderRemovalMounted.current) setLibraryMutationBusy(false);
    }
  };

  // Batch Send to Desktop as Shortcuts
  const handleBatchPinToDesktop = async (pinned: boolean) => {
    if (selectedBmIds.length === 0) return;
    try {
      await onSetDesktopPins(selectedBmIds, pinned);
      onShowToast(pinned
        ? t('managerDesktopShortcutsAdded', { count: selectedBmIds.length })
        : t('managerDesktopShortcutRemoved'));
      setSelectedBmIds([]);
    } catch (error) {
      onShowToast(preferenceSaveError(error, userSettings.language, 'library'));
    }
  };

  // Create Folder (supports nested parentId)
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name || libraryMutationPending.current) return;
    const parentId = newFolderParentId === 'none' ? undefined : newFolderParentId;
    libraryMutationPending.current = true;
    setLibraryMutationBusy(true);
    setLibraryMutationError(null);
    try {
      const created = await withCollectionMutation(() => commitAndRefresh(
        () => storage.createFolder(name, [], parentId), onLibraryChanged),
        () => folderRemovalMounted.current);
      if (!folderRemovalMounted.current) return;
      if (parentId) setExpandedFolderIds(prev => new Set([...prev, parentId]));
      setNewFolderName('');
      setNewFolderParentId('none');
      setIsCreateFolderOpen(false);
      setSelectedFolderId(created.id);
      onShowToast(t('managerFolderCreatedToast', { name: created.name }));
    } catch (error) {
      if (folderRemovalMounted.current) setLibraryMutationError({ cause: error });
    } finally {
      libraryMutationPending.current = false;
      if (folderRemovalMounted.current) setLibraryMutationBusy(false);
    }
  };

  // Rename/Update Folder
  const handleRenameFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFolder || !editFolderName.trim() || libraryMutationPending.current) return;
    const parentId = editFolderParentId === 'none' ? undefined : editFolderParentId;
    libraryMutationPending.current = true;
    setLibraryMutationBusy(true);
    setLibraryMutationError(null);
    try {
      await withCollectionMutation(() => commitAndRefresh(() => storage.updateFolder(editingFolder.id, {
        name: editFolderName.trim(), parentId,
      }), onLibraryChanged), () => folderRemovalMounted.current);
      if (!folderRemovalMounted.current) return;
      setEditingFolder(null);
      onShowToast(t('managerFolderUpdatedToast'));
    } catch (error) {
      if (folderRemovalMounted.current) setLibraryMutationError({ cause: error });
    } finally {
      libraryMutationPending.current = false;
      if (folderRemovalMounted.current) setLibraryMutationBusy(false);
    }
  };

  // Alfred-Style Search Engine Handlers
  const handleToggleEngine = (engineId: string) => {
    const eng = searchEngines.find(e => e.id === engineId);
    if (!eng) return;
    const currentEnabled = eng.isEnabled !== false;
    if (currentEnabled && engineId === userSettings.defaultSearchEngineId) {
      onShowToast(t('managerEngineCannotDisableDefault'));
      return;
    }
    return runEngineMutation(async () => {
      await storage.mutate(() => storage.updateSearchEngine(engineId, { isEnabled: !currentEnabled }));
      onSearchEnginesChanged(storage.getSearchEngines());
      onShowToast(t(currentEnabled ? 'managerEngineDisabledToast' : 'managerEngineEnabledToast', { name: eng.name }));
    }, error => onShowToast(preferenceSaveError(error, userSettings.language)));
  };

  const handleSaveEngine = (e: React.FormEvent) => {
    e.preventDefault();
    if (!engineFormName.trim() || !engineFormKeyword.trim() || !engineFormUrl.trim()) return;
    if (!engineFormUrl.includes('{query}')) {
      setEngineSaveError({ kind: 'template-validation' });
      return;
    }
    setEngineSaveError(null);
    return runEngineMutation(async () => {
      await storage.mutate(() => {
      if (editingEngine) {
        storage.updateSearchEngine(editingEngine.id, {
          name: engineFormName.trim(),
          keyword: engineFormKeyword.trim().toLowerCase(),
          urlTemplate: engineFormUrl.trim(),
          isEnabled: engineFormEnabled,
        });
      } else {
        storage.createSearchEngine(
          engineFormName.trim(),
          engineFormKeyword.trim().toLowerCase(),
          engineFormUrl.trim(),
          engineFormEnabled
        );
      }
      });
      onSearchEnginesChanged(storage.getSearchEngines());
      onShowToast(t(editingEngine ? 'managerEngineUpdatedToast' : 'managerEngineAddedToast', {
        name: engineFormName.trim(),
      }));
      setIsAddEngineOpen(false);
      setEditingEngine(null);
    }, error => {
      setEngineSaveError({ kind: 'cause', cause: error });
    });
  };

  const handleDeleteEngine = (engineId: string, name: string) => {
    if (engineId === userSettings.defaultSearchEngineId) {
      onShowToast(t('managerEngineCannotDeleteDefault'));
      return;
    }
    setDeleteEngineError(null);
    setPendingDeleteEngine({ id: engineId, name });
  };

  const confirmEngineDeletion = () => {
    if (!pendingDeleteEngine || engineMutationPending.current) return;
    if (pendingDeleteEngine.id === userSettings.defaultSearchEngineId) {
      onShowToast(t('managerEngineCannotDeleteDefault'));
      return;
    }
    setDeleteEngineError(null);
    setDeleteEngineBusy(true);
    return runEngineMutation(async () => {
      try {
        await storage.mutate(() => storage.deleteSearchEngine(pendingDeleteEngine.id));
        onSearchEnginesChanged(storage.getSearchEngines());
        onShowToast(t('managerEngineDeletedToast', { name: pendingDeleteEngine.name }));
        setPendingDeleteEngine(null);
      } finally { setDeleteEngineBusy(false); }
    }, cause => {
      setDeleteEngineError({ cause });
      setDeleteEngineBusy(false);
    });
  };

  const handleTestSearch = (engine: SearchEngine, testQuery: string) => {
    const q = testQuery.trim() || t('managerSearchQueryFallback');
    const url = engine.urlTemplate.replace('{query}', encodeURIComponent(q));
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Keep both archive operations explicit; desktop folders are independent.
  const handleDeleteFolder = (folderId: string, folderName: string) => {
    const folder = folders.find(item => item.id === folderId);
    if (folder) { setRemovingFolder(folder); setFolderRemovalError(null); }
  };
  const removeLibraryFolder = async (mode: 'dissolve' | 'trash') => {
    if (!removingFolder || folderRemovalPending.current) return;
    folderRemovalPending.current = true;
    setFolderRemovalBusy(true);
    setFolderRemovalError(null);
    try {
      let nextFolders: Folder[] = [];
      await withCollectionMutation(() => commitAndRefresh(() => {
        if (mode === 'dissolve') storage.deleteFolder(removingFolder.id);
        else storage.trashFolder(removingFolder.id);
      }, () => {
        onLibraryChanged();
        nextFolders = storage.getFolders();
      }), () => folderRemovalMounted.current);
      if (!folderRemovalMounted.current) return;
      if (!nextFolders.some(folder => folder.id === selectedFolderId)) setSelectedFolderId('all');
      setSelectedBmIds([]);
      setRemovingFolder(null);
      onShowToast(t(mode === 'dissolve' ? 'folderDissolved' : 'folderMovedToTrash'));
    } catch (error) {
      if (folderRemovalMounted.current) setFolderRemovalError({ cause: error });
    } finally {
      folderRemovalPending.current = false;
      if (folderRemovalMounted.current) setFolderRemovalBusy(false);
    }
  };

  const handleCreateLibraryFolder = async (name: string, parentId?: string): Promise<Folder> => {
    try {
      const created = await commitAndRefresh(() => storage.createFolder(name, [], parentId), onLibraryChanged);
      if (parentId) setExpandedFolderIds(prev => new Set([...prev, parentId]));
      return created;
    } catch (error) {
      throw new Error(preferenceSaveError(error, userSettings.language, 'library'));
    }
  };

  const handleSaveBookmark = async (
    input: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'>,
    pinToDesktop: boolean,
  ) => {
    await commitAndRefresh(() => storage.saveManualBookmark(input, editingBookmark?.id), onLibraryChanged);
    setEditingBookmark(null);
    setIsAddBookmarkOpen(false);
    onShowToast(t(editingBookmark ? 'bookmarkUpdated' : pinToDesktop
      ? 'bookmarkAddedAndPinned' : 'bookmarkAdded'));
  };

  // Export handlers
  const handleExportHtml = () => {
    setHtmlExportError(false);
    let url: string | undefined;
    try {
      const html = storage.exportHtmlBookmarks();
      url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = t('managerHtmlBackupFilename', { date: new Date().toISOString().slice(0, 10) });
      a.click();
      onShowToast(t('managerHtmlExportedToast'));
    } catch {
      setHtmlExportError(true);
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  };
  const removingIds = removingFolder && folders.some(folder => folder.id === removingFolder.id)
    ? folderSubtree({ folders, bookmarks }, removingFolder.id) : new Set<string>();
  const removingBookmarkCount = bookmarks.filter(bookmark => removingIds.has(bookmark.folderId!)).length;

  return (
    <div className="management-content min-w-0 w-full animate-in fade-in duration-200">
      <Modal isOpen={removingFolder !== null} contained maxWidth="sm" showCloseButton={false}
        title={t('removeLibraryFolder')}
        onClose={() => { if (!folderRemovalPending.current) setRemovingFolder(null); }}>
        <div className="min-w-0 space-y-4" aria-busy={folderRemovalBusy}>
          <p className="break-words text-sm font-medium">{removingFolder?.name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('libraryFolderCounts', { folders: removingIds.size, bookmarks: removingBookmarkCount })}
          </p>
          <p className="text-sm leading-6">{t('removeLibraryFolderExplanation')}</p>
          {folderRemovalError && <p role="alert" className="break-words text-sm text-rose-700 dark:text-rose-300">{preferenceSaveError(folderRemovalError.cause, userSettings.language, 'library')}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={folderRemovalBusy} onClick={() => setRemovingFolder(null)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-white/20">
              {t('cancel')}</button>
            <button type="button" disabled={folderRemovalBusy} onClick={() => removeLibraryFolder('dissolve')}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-white/20">
              <FolderOpen size={15} />{t('dissolveKeepContents')}</button>
            <button type="button" disabled={folderRemovalBusy} onClick={() => removeLibraryFolder('trash')}
              className="inline-flex items-center gap-2 rounded-md bg-rose-700 px-3 py-2 text-sm text-white disabled:opacity-50">
              <Trash2 size={15} />{t('deleteFolderContents')}</button>
          </div>
        </div>
      </Modal>
      <Modal isOpen={pendingDeleteBookmarkIds.length > 0} contained maxWidth="sm"
        title={pendingDeleteBookmarkIds.length > 1
          ? t('deleteBookmarks', { count: pendingDeleteBookmarkIds.length }) : t('deleteBookmark')}
        onClose={() => { if (!libraryMutationPending.current) setPendingDeleteBookmarkIds([]); }}>
        <p className="text-sm">{t('deleteBookmarksWarning', { count: pendingDeleteBookmarkIds.length })}</p>
        {deleteBookmarkError && <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">{preferenceSaveError(deleteBookmarkError.cause, userSettings.language, 'library')}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={libraryMutationBusy} className="rounded-md px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => setPendingDeleteBookmarkIds([])}>{t('cancel')}</button>
          <button type="button" disabled={libraryMutationBusy} className="rounded-md bg-rose-700 px-3 py-2 text-sm text-white disabled:opacity-50"
            onClick={confirmBookmarkDeletion}>{t('moveToTrash')}</button>
        </div>
      </Modal>

      {pendingDeleteEngine && <Modal isOpen contained maxWidth="sm"
        title={t('managerEngineDeleteConfirm', { name: pendingDeleteEngine.name })}
        onClose={() => { if (!engineMutationPending.current) setPendingDeleteEngine(null); }}>
        <div aria-busy={deleteEngineBusy}>
          <p className="text-sm">{t('managerEngineDeleteWarning')}</p>
          {deleteEngineError && <p role="alert" className="mt-3 break-words text-sm text-rose-700 dark:text-rose-300">
            {preferenceSaveError(deleteEngineError.cause, userSettings.language)}
          </p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" disabled={deleteEngineBusy}
              className="rounded-md px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => setPendingDeleteEngine(null)}>{t('cancel')}</button>
            <button type="button" disabled={deleteEngineBusy || (deleteEngineError?.cause instanceof Error
              && deleteEngineError.cause.message === 'COMMIT_UNCERTAIN')}
              className="rounded-md bg-rose-700 px-3 py-2 text-sm text-white disabled:opacity-50"
              onClick={confirmEngineDeletion}>{t('managerEngineDeleteAction')}</button>
          </div>
        </div>
      </Modal>}

      {/* ======================================================== */}
      {/* TAB 1: CHROME-STYLE BOOKMARKS & FOLDER HIERARCHY MANAGER */}
      {/* ======================================================== */}
      {activeTab === 'bookmarks' && (
        <div className="flex flex-col md:flex-row gap-5 items-start">
          {/* Left Sidebar: Folder Tree Navigation */}
          <div className="w-full md:w-64 liquid-glass rounded-3xl p-4 border border-slate-300/80 dark:border-white/10 shadow-sm shrink-0 flex flex-col gap-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200/80 dark:border-white/10">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                <FolderIcon size={14} className="text-sky-500" />
                <span>{t('managerFolderDirectory')}</span>
              </span>
              <button
                type="button"
                onClick={() => setIsCreateFolderOpen(true)}
                className="p-1 rounded-lg text-sky-600 hover:bg-sky-500/10 transition-colors cursor-pointer"
                title={t('managerNewFolder')}
                aria-label={t('managerNewFolder')}
              >
                <FolderPlus size={15} />
              </button>
            </div>

            <div className="flex flex-col gap-1 text-xs">
              {/* All Bookmarks */}
              <button
                type="button"
                onClick={() => setSelectedFolderId('all')}
                className={`flex items-center justify-between px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                  selectedFolderId === 'all'
                    ? 'bg-sky-500 text-white font-bold shadow-xs'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <BookmarkCheck size={14} className={selectedFolderId === 'all' ? 'text-white' : 'text-sky-500'} />
                  <span className="truncate">{t('managerAllBookmarks')}</span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono ${selectedFolderId === 'all' ? 'bg-white/20' : 'bg-black/5 dark:bg-white/10 text-slate-500'}`}>
                  {bookmarks.length}
                </span>
              </button>

              {/* Unorganized Bookmarks (Root) */}
              <button
                type="button"
                onClick={() => setSelectedFolderId('unorganized')}
                className={`flex items-center justify-between px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                  selectedFolderId === 'unorganized'
                    ? 'bg-sky-500 text-white font-bold shadow-xs'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <FolderOpen size={14} className={selectedFolderId === 'unorganized' ? 'text-white' : 'text-amber-500'} />
                  <span className="truncate">{t('managerUnorganized')}</span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono ${selectedFolderId === 'unorganized' ? 'bg-white/20' : 'bg-black/5 dark:bg-white/10 text-slate-500'}`}>
                  {bookmarks.filter(b => !b.folderId).length}
                </span>
              </button>

              {/* Divider */}
              <div className="my-1 border-t border-slate-200/60 dark:border-white/5" />

              {/* Custom Hierarchical Folders */}
              <div className="max-h-80 md:max-h-[max(20rem,calc(100dvh-22rem))] overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                {folderTree.length === 0 ? (
                  <div className="py-4 text-center text-slate-400 text-xs">{t('managerNoFolders')}</div>
                ) : (
                  folderTree.map(({ folder: f, depth, hasChildren }) => {
                    const count = bookmarks.filter(b => b.folderId === f.id).length;
                    const isSelected = selectedFolderId === f.id;
                    const isExpanded = expandedFolderIds.has(f.id);

                    return (
                      <div
                        key={f.id}
                        data-library-folder={f.id}
                        tabIndex={-1}
                        aria-current={isSelected ? 'location' : undefined}
                        className={`group flex items-center justify-between py-1.5 pr-2 rounded-xl text-left transition-colors cursor-pointer select-none ${
                          isSelected
                            ? 'bg-sky-500 text-white font-bold shadow-xs'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10'
                        }`}
                        style={{ paddingLeft: `${depth * 14 + 8}px` }}
                        onClick={() => setSelectedFolderId(f.id)}
                      >
                        <div className="flex items-center gap-1.5 truncate min-w-0 flex-1">
                          {/* Triangle Expand/Collapse button if folder has children */}
                          {hasChildren ? (
                            <button
                              type="button"
                              onClick={e => toggleFolderExpand(f.id, e)}
                              className={`p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/20 transition-transform ${
                                isSelected ? 'text-white' : 'text-slate-400 hover:text-slate-600'
                              }`}
                              title={t(isExpanded ? 'managerCollapseFolder' : 'managerExpandFolder')}
                              aria-label={t(isExpanded ? 'managerCollapseFolder' : 'managerExpandFolder')}
                            >
                              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            </button>
                          ) : (
                            <span className="w-4 shrink-0" />
                          )}

                          <FolderIcon
                            size={14}
                            className={`shrink-0 ${isSelected ? 'text-white' : 'text-amber-500'}`}
                          />
                          <span className="truncate text-xs">{f.name}</span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          <span
                            className={`text-[10px] px-1.5 py-0.2 rounded-md font-mono ${
                              isSelected
                                ? 'bg-white/20 text-white'
                                : 'bg-black/5 dark:bg-white/10 text-slate-500'
                            }`}
                          >
                            {count}
                          </span>

                          {/* Quick Action Buttons on Hover */}
                          <div className="hidden group-hover:flex group-focus-within:flex max-sm:flex items-center gap-0.5 ml-0.5">
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                setNewFolderParentId(f.id);
                                setIsCreateFolderOpen(true);
                              }}
                              className={`p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/20 ${
                                isSelected ? 'text-white' : 'text-slate-400 hover:text-sky-500'
                              }`}
                              title={t('managerCreateChildFolder')}
                              aria-label={t('managerCreateChildFolder')}
                            >
                              <Plus size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                setEditingFolder(f);
                                setEditFolderName(f.name);
                                setEditFolderParentId(f.parentId || 'none');
                              }}
                              className={`p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/20 ${
                                isSelected ? 'text-white' : 'text-slate-400'
                              }`}
                              title={t('managerEditFolder')}
                              aria-label={t('managerEditFolder')}
                            >
                              <Edit2 size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                handleDeleteFolder(f.id, f.name);
                              }}
                              className={`p-0.5 rounded hover:bg-rose-500/20 ${
                                isSelected ? 'text-white' : 'text-rose-400'
                              }`}
                              title={t('managerRemoveLibraryFolder')}
                              aria-label={t('managerRemoveLibraryFolder')}
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Quick Add Folder Button */}
            <button
              type="button"
              onClick={() => {
                setNewFolderParentId(
                  selectedFolderId !== 'all' && selectedFolderId !== 'unorganized'
                    ? selectedFolderId
                    : 'none'
                );
                setIsCreateFolderOpen(true);
              }}
              className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-slate-300 dark:border-white/20 hover:border-sky-400 text-slate-600 dark:text-slate-300 hover:text-sky-500 text-xs font-semibold transition-all cursor-pointer"
            >
              <Plus size={13} />
              <span>{t('managerAddFolder')}</span>
            </button>
          </div>

          {/* Right Main Area: Bookmarks in Current Folder */}
          <div className="flex-1 w-full space-y-4 min-w-0">
            {/* Action Bar & Breadcrumbs */}
            <div className="liquid-glass rounded-2xl p-4 flex flex-col gap-3 text-xs border border-slate-300/80 dark:border-white/10 shadow-xs">
              {/* Row 1: Filter input & Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="search"
                    placeholder={t('managerBookmarkSearch')}
                    aria-label={t('managerBookmarkSearch')}
                    value={bookmarkSearch}
                    onChange={e => setBookmarkSearch(e.target.value)}
                    className="w-full pl-8 pr-8 py-1.5 rounded-xl bg-black/5 dark:bg-white/10 border border-slate-200/50 dark:border-white/10 focus:outline-none text-slate-800 dark:text-slate-100"
                  />
                  {bookmarkSearch && (
                    <button
                      type="button"
                      onClick={() => setBookmarkSearch('')}
                      title={t('managerClearSearch')}
                      aria-label={t('managerClearSearch')}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                {/* Add Bookmark into Current Folder Button */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddBookmarkOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold transition-colors shadow-2xs cursor-pointer"
                  >
                    <Plus size={14} />
                    <span>{t('managerAddBookmarkToFolder')}</span>
                  </button>
                </div>
              </div>

              <p className="text-slate-500 dark:text-slate-400 break-words">
                {bookmarkSearch.trim() || selectedFolderId === 'all' ? t('managerSearchScopeAll')
                  : selectedFolderId === 'unorganized' ? t('managerSearchScopeUnorganized')
                    : t('managerSearchScopeFolder', { name: folders.find(folder => folder.id === selectedFolderId)?.name ?? '' })}
              </p>

              {/* Row 2: Breadcrumbs Trail */}
              <div className="flex items-center gap-1.5 text-xs text-slate-500 flex-wrap pt-1 border-t border-slate-200/50 dark:border-white/5">
                {breadcrumbs.map((crumb, idx) => (
                  <React.Fragment key={crumb.id}>
                    {idx > 0 && <ChevronRight size={12} className="text-slate-400 shrink-0" />}
                    <button
                      type="button"
                      onClick={() => setSelectedFolderId(crumb.id)}
                      className={`hover:text-sky-600 transition-colors cursor-pointer truncate max-w-[160px] ${
                        idx === breadcrumbs.length - 1
                          ? 'font-bold text-slate-900 dark:text-slate-100'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {crumb.name}
                    </button>
                  </React.Fragment>
                ))}
                <span className="text-[11px] text-slate-400 ml-1">
                  {t('managerBookmarkCount', { count: filteredBookmarks.length })}
                </span>
              </div>

              {/* Row 3: Subfolders Badge Pills if any */}
              {currentSubfolders.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap text-xs pt-1">
                  <span className="text-slate-400 text-[11px] font-medium shrink-0">{t('managerSubfolders')}</span>
                  {currentSubfolders.map(sub => {
                    const subCount = bookmarks.filter(b => b.folderId === sub.id).length;
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => setSelectedFolderId(sub.id)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 transition-colors cursor-pointer"
                      >
                        <FolderIcon size={12} className="text-amber-500" />
                        <span className="font-medium">{sub.name}</span>
                        <span className="text-[10px] opacity-70 font-mono">({subCount})</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setNewFolderParentId(selectedFolderId);
                      setIsCreateFolderOpen(true);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-xl border border-dashed border-slate-300 dark:border-white/20 text-slate-500 hover:text-sky-500 text-[11px] transition-colors cursor-pointer"
                  >
                    <Plus size={11} />
                    <span>{t('managerCreateSubfolder')}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Batch Action Bar */}
            {selectedBmIds.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-sky-500/10 border border-sky-400/40 text-xs animate-in fade-in duration-150">
                <span className="font-bold text-sky-800 dark:text-sky-200">
                  {t('managerSelectedBookmarks', { count: selectedBmIds.length })}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBatchTargetFolderId(folders[0]?.id || 'unorganized');
                      setIsBatchMoveOpen(true);
                    }}
                    className="flex items-center gap-1 px-3 py-1 rounded-xl bg-white/80 dark:bg-white/10 text-slate-800 dark:text-slate-200 hover:bg-white transition-colors cursor-pointer font-medium"
                  >
                    <MoveRight size={12} />
                    <span>{t('managerMoveToFolder')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBatchPinToDesktop(true)}
                    className="flex items-center gap-1 px-3 py-1 rounded-xl bg-sky-500 text-white hover:bg-sky-600 transition-colors cursor-pointer font-medium"
                  >
                    <Pin size={12} />
                    <span>{t('managerPinToDesktop')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBatchPinToDesktop(false)}
                    className="flex items-center gap-1 px-3 py-1 rounded-xl bg-black/10 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-black/20 transition-colors cursor-pointer font-medium"
                  >
                    <PinOff size={12} />
                    <span>{t('managerRemoveFromDesktop')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleBatchDelete}
                    className="flex items-center gap-1 px-3 py-1 rounded-xl bg-rose-500 text-white hover:bg-rose-600 transition-colors cursor-pointer font-medium"
                  >
                    <Trash2 size={12} />
                    <span>{t('managerDeleteBookmarksAction')}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Bookmarks List Table */}
            <div className="liquid-glass rounded-3xl overflow-hidden shadow-sm border border-slate-300/80 dark:border-white/10 flex flex-col">
              <div className="grid grid-cols-12 px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider bg-black/[0.02] dark:bg-white/[0.02] border-b border-slate-100 dark:border-white/5">
                <div className="col-span-1">
                  <input
                    type="checkbox"
                    aria-label={t('managerSelectAllBookmarks')}
                    checked={selectedBmIds.length > 0 && selectedBmIds.length === paginatedBookmarks.length}
                    onChange={() => {
                      if (selectedBmIds.length === paginatedBookmarks.length) {
                        setSelectedBmIds([]);
                      } else {
                        setSelectedBmIds(paginatedBookmarks.map(b => b.id));
                      }
                    }}
                    className="rounded text-sky-500 cursor-pointer"
                  />
                </div>
                <div className="col-span-4">{t('managerWebsiteInfo')}</div>
                <div className="col-span-2">{t('managerBelongsToFolder')}</div>
                <div className="col-span-3">{t('managerShortcutStatus')}</div>
                <div className="col-span-2 text-right">{t('managerActions')}</div>
              </div>

              {paginatedBookmarks.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
                  <BookmarkCheck size={32} className="opacity-30 text-sky-500" />
                  <p className="font-semibold text-slate-600 dark:text-slate-300">{t(bookmarkSearch.trim() ? 'managerSearchNoResults' : 'managerEmptyFolderTitle')}</p>
                  {!bookmarkSearch.trim() && <p className="text-[11px] opacity-70">{t('managerEmptyFolderHint')}</p>}
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-white/5">
                  {paginatedBookmarks.map(bm => {
                    const isSelected = selectedBmIds.includes(bm.id);
                    const isDockPinned = (userSettings.dockBookmarkIds || []).includes(bm.id);
                    const parentFolder = folders.find(f => f.id === bm.folderId);

                    return (
                      <div
                        key={bm.id}
                        data-library-bookmark={bm.id} tabIndex={-1}
                        className="grid grid-cols-12 items-center px-5 py-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-xs select-none outline-none focus:bg-sky-500/10 focus:ring-2 focus:ring-inset focus:ring-sky-500/50"
                      >
                        {/* Checkbox */}
                        <div className="col-span-1">
                          <input
                            type="checkbox"
                            aria-label={t('managerSelectBookmark', { name: bm.title })}
                            checked={isSelected}
                            onChange={() => {
                              setSelectedBmIds(prev =>
                                prev.includes(bm.id)
                                  ? prev.filter(i => i !== bm.id)
                                  : [...prev, bm.id]
                              );
                            }}
                            className="rounded text-sky-500 cursor-pointer"
                          />
                        </div>

                        {/* Info: Favicon + Title + Notes */}
                        <div className="col-span-4 flex items-center gap-3 min-w-0 pr-2">
                          <div className="w-8 h-8 flex items-center justify-center shrink-0">
                            <FaviconImage
                              url={bm.url}
                              title={bm.title}
                              icon={bm.icon}
                              iconMode={bm.iconMode}
                              iconBg={bm.iconBg}
                              size="sm"
                            />
                          </div>
                          <div className="truncate min-w-0">
                            <span className="font-bold text-slate-900 dark:text-slate-100 block truncate text-xs">
                              {bm.title}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono block truncate">
                              {bm.domain}
                            </span>
                            {bm.notes && (
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 block truncate mt-0.5">
                                {bm.notes}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Folder Indicator */}
                        <div className="col-span-2 min-w-0 pr-2">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-black/5 dark:bg-white/10 text-slate-700 dark:text-slate-300 font-medium text-[11px] truncate max-w-full">
                            <FolderIcon size={11} className="text-amber-500 shrink-0" />
                            <span className="truncate">
                              {parentFolder ? parentFolder.name : t('managerUncategorized')}
                            </span>
                          </span>
                        </div>

                        {/* Desktop & Dock Shortcut Toggle Buttons */}
                        <div className="col-span-3 flex items-center gap-2 flex-wrap">
                          {/* Desktop Shortcut Pin */}
                          <button
                            type="button"
                            onClick={() => handleToggleDesktopShortcut(bm.id)}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold transition-all cursor-pointer ${
                              isDesktopPinned(bm)
                                ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-400/40 shadow-2xs'
                                : 'bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-400 hover:text-sky-600'
                            }`}
                            title={
                              isDesktopPinned(bm)
                                ? t('managerRemoveFromDesktopTitle')
                                : t('managerPinToDesktopTitle')
                            }
                            aria-label={isDesktopPinned(bm)
                              ? t('managerRemoveFromDesktopTitle')
                              : t('managerPinToDesktopTitle')}
                          >
                            {isDesktopPinned(bm) ? (
                              <Pin size={11} className="text-sky-500" />
                            ) : (
                              <PinOff size={11} />
                            )}
                            <span>{isDesktopPinned(bm)
                              ? t('managerDesktopPinned') : t('managerPinToDesktop')}</span>
                          </button>

                          {/* Dock Shortcut Pin */}
                          <button
                            type="button"
                            onClick={() => handleToggleDockPin(bm.id)}
                            className={`flex items-center gap-1 px-2 py-1 rounded-xl text-[11px] font-semibold transition-all cursor-pointer ${
                              isDockPinned
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-400/40 shadow-2xs'
                                : 'bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-400 hover:text-emerald-600'
                            }`}
                            title={isDockPinned ? t('managerTaskbarUnpinTitle') : t('managerTaskbarPinTitle')}
                            aria-label={isDockPinned ? t('managerTaskbarUnpinTitle') : t('managerTaskbarPinTitle')}
                          >
                            <Sparkles
                              size={11}
                              className={isDockPinned ? 'text-emerald-500' : 'text-slate-400'}
                            />
                            <span>{isDockPinned ? t('managerTaskbarPinned') : t('managerTaskbarAdd')}</span>
                          </button>
                        </div>

                        {/* Actions */}
                        <div className="col-span-2 flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingBookmark(bm)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-sky-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                            title={t('managerEditBookmark')}
                            aria-label={t('managerEditBookmark')}
                          >
                            <Edit2 size={13} />
                          </button>
                          <a
                            href={bm.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-sky-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                            title={t('managerOpenNewTab')}
                            aria-label={t('managerOpenNewTab')}
                          >
                            <ExternalLink size={13} />
                          </a>
                          <button
                            type="button"
                            onClick={() => handleDeleteBookmarkFromLibrary(bm.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title={t('managerDeleteBookmark')}
                            aria-label={t('managerDeleteBookmark')}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <Pagination total={filteredBookmarks.length} page={currentBookmarkPage} pageSize={bmPageSize}
                language={userSettings.language} onPageChange={setBmPage} onPageSizeChange={setBmPageSize} />
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 3: CUSTOM SEARCH ENGINES                             */}
      {/* ======================================================== */}
      {activeTab === 'engines' && (
        <div className="max-w-3xl space-y-5">
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1 flex items-center gap-2">
                  <Search size={18} className="text-sky-500" />
                  <span>{t('managerSearchEngineTitle')}</span>
                </h3>
                <p className="text-xs text-slate-500">
                  {t('managerSearchEngineDescription')}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" onClick={() => setIsPresetPickerOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-sky-500/40 px-3 py-2 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-500/10 dark:text-sky-300">
                <Library size={14} aria-hidden="true" />
                <span>{t('presetPickerOpen')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingEngine(null);
                  setEngineFormName('');
                  setEngineFormKeyword('');
                  setEngineFormUrl('');
                  setEngineFormEnabled(true);
                  setIsAddEngineOpen(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold transition-colors shadow-2xs cursor-pointer shrink-0"
              >
                <Plus size={14} aria-hidden="true" />
                <span>{t('managerAddSearchEngine')}</span>
              </button>
              </div>
            </div>

            {/* Shortcut Commands Tip Box */}
            <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-400/30 text-xs text-indigo-950 dark:text-indigo-200 space-y-2">
              <span className="font-bold flex items-center gap-1.5">
                <Sparkles size={14} className="text-indigo-500 shrink-0" />
                <span>{t('managerEngineHelpTitle')}</span>
              </span>
              <div className="text-[11px] leading-relaxed text-indigo-900/80 dark:text-indigo-300 space-y-1">
                <p>
                  1. <strong>{t('managerEngineHelpQuickSwitchLabel')}</strong>{' '}{t('managerEngineHelpQuickSwitchIntro')}{' '}
                  {['/g', '/bd', '/bing', '/gh'].map((command, index) => (
                    <React.Fragment key={command}>
                      {index > 0 && t('managerCommandSeparator')}
                      <code className="px-1.5 py-0.5 rounded bg-indigo-500/15 font-mono font-bold">{command}</code>
                    </React.Fragment>
                  ))}
                  {t('managerEngineHelpQuickSwitchTail')}
                </p>
                <p>
                  2. <strong>{t('managerEngineHelpDirectLabel')}</strong>{' '}{t('managerEngineHelpDirectIntro')}{' '}
                  <code className="px-1.5 py-0.5 rounded bg-indigo-500/15 font-mono font-bold">{t('managerEngineHelpDirectSyntax')}</code>
                  {' '}{t('managerEngineHelpDirectTail')}{' '}
                  <span className="font-mono font-bold text-sky-600 dark:text-sky-400">{t('managerEngineHelpDirectExample')}</span>
                  {' '}{t('managerEngineHelpExampleOr')}{' '}
                  <span className="font-mono font-bold text-sky-600 dark:text-sky-400">{t('managerEngineHelpDirectExampleBilibili')}</span>
                  {t('managerEngineHelpDirectEnd')}
                </p>
              </div>
            </div>

            {/* Engine List */}
            <SearchEngineOrderList engines={searchEngines} language={userSettings.language} onChanged={onSearchEnginesChanged}>
              {searchEngines.map(eng => {
                const isDefault = eng.id === userSettings.defaultSearchEngineId;
                const isEnabled = eng.isEnabled !== false;

                return (
                  <div
                    key={eng.id}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border transition-all ${
                      isEnabled
                        ? 'bg-black/5 dark:bg-white/5 border-slate-200/60 dark:border-white/10'
                        : 'bg-black/[0.02] dark:bg-white/[0.02] border-slate-200/30 dark:border-white/5 opacity-60'
                    }`}
                  >
                    {/* Left: Info with Favicon & Name */}
                    <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
                      {/* Engine Favicon Icon */}
                      <div className="w-10 h-10 flex items-center justify-center shrink-0">
                        <FaviconImage
                          url={eng.urlTemplate}
                          title={eng.name}
                          icon={eng.icon}
                          size="md"
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 dark:text-slate-100 text-xs">
                            {eng.name}
                          </span>

                          {/* Command Keyword Badge */}
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold border border-sky-400/30">
                            /{eng.keyword}
                          </span>

                          {/* Default Badge */}
                          {isDefault && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500 text-white font-medium shadow-2xs">
                              {t('managerDefaultEngineBadge')}
                            </span>
                          )}

                          {/* Status Badge */}
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              isEnabled
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : 'bg-slate-500/15 text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            {isEnabled ? t('managerEngineEnabled') : t('managerEngineDisabled')}
                          </span>
                        </div>

                        {/* URL Template */}
                        <div className="text-[11px] text-slate-400 font-mono truncate max-w-md block mt-1">
                          {eng.urlTemplate.split('{query}').map((part, i, arr) => (
                            <React.Fragment key={i}>
                              <span>{part}</span>
                              {i < arr.length - 1 && (
                                <span className="text-sky-500 font-bold bg-sky-500/15 px-1 py-0.2 rounded">
                                  {'{query}'}
                                </span>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex max-w-full flex-wrap items-center gap-2 shrink-0 self-end sm:self-center">
                      {/* Enable/Disable Toggle Switch Button */}
                      <button
                        type="button"
                        onClick={() => handleToggleEngine(eng.id)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                          isEnabled
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25'
                            : 'bg-slate-500/15 text-slate-600 dark:text-slate-400 hover:bg-slate-500/25'
                        }`}
                        title={isEnabled ? t('managerDisableEngineTitle') : t('managerEnableEngineTitle')}
                        aria-label={isEnabled ? t('managerDisableEngineTitle') : t('managerEnableEngineTitle')}
                      >
                        {isEnabled ? <ToggleRight size={16} className="text-emerald-500" /> : <ToggleLeft size={16} />}
                        <span>{isEnabled ? t('managerEngineUsable') : t('managerEngineDisabledShort')}</span>
                      </button>

                      {/* Test Search Button */}
                      <button
                        type="button"
                        onClick={() => {
                          setTestEngineModal(eng);
                          setTestEngineQuery('记个球');
                        }}
                        className="p-1.5 rounded-xl bg-black/5 dark:bg-white/10 hover:bg-black/10 text-slate-600 dark:text-slate-300 text-xs transition-colors cursor-pointer"
                        title={t('managerTestSearchTitle')}
                        aria-label={t('managerTestSearchTitle')}
                      >
                        <Play size={12} className="text-amber-500" />
                      </button>

                      {/* Set as Default Button */}
                      {!isDefault && isEnabled && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (await onUpdateSettings({ defaultSearchEngineId: eng.id }) === false) return;
                            onShowToast(t('managerEngineSetDefaultToast', { name: eng.name }));
                          }}
                          className="px-2.5 py-1 rounded-xl bg-black/5 dark:bg-white/10 hover:bg-sky-500 hover:text-white transition-colors cursor-pointer text-xs font-medium"
                        >
                          {t('managerSetDefaultEngine')}
                        </button>
                      )}

                      {/* Edit Button */}
                      <button
                        type="button"
                        onClick={() => {
                          setEditingEngine(eng);
                          setEngineFormName(eng.name);
                          setEngineFormKeyword(eng.keyword);
                          setEngineFormUrl(eng.urlTemplate);
                          setEngineFormEnabled(eng.isEnabled !== false);
                          setIsAddEngineOpen(true);
                        }}
                        className="p-1.5 rounded-xl text-slate-500 hover:text-sky-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                        title={t('managerEditSearchEngine')}
                        aria-label={t('managerEditSearchEngine')}
                      >
                        <Edit2 size={13} />
                      </button>

                      {/* Delete Button */}
                      {!isDefault && (
                        <button
                          type="button"
                          onClick={() => handleDeleteEngine(eng.id, eng.name)}
                          className="p-1.5 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                          title={t('managerDeleteSearchEngine')}
                          aria-label={t('managerDeleteSearchEngine')}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </SearchEngineOrderList>
          </div>
        </div>
      )}

      {activeTab === 'engines' && isPresetPickerOpen && <SearchEnginePresetPicker
        engines={searchEngines} language={userSettings.language}
        onChanged={onSearchEnginesChanged} onShowToast={onShowToast}
        onClose={() => setIsPresetPickerOpen(false)} />}

      {/* ======================================================== */}
      {/* TAB 4: IMPORT & EXPORT                                  */}
      {/* ======================================================== */}
      {activeTab === 'import-export' && (
        <AssetTransferPage onboarding={onboarding} language={userSettings.language}
          onExportHtml={handleExportHtml} htmlExportError={!!htmlExportError}
          onImported={onLibraryChanged} onViewBookmarks={() => {
            setActiveTab('bookmarks'); setSelectedFolderId('all'); setBookmarkSearch('');
            setSelectedBmIds([]); setBmPage(1);
          }} />
      )}

      {/* ======================================================== */}
      {/* TAB 6: APPEARANCE & WALLPAPER SETTINGS                  */}
      {/* ======================================================== */}
      {activeTab === 'appearance' && (
        <div className="max-w-3xl space-y-6">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">
              {t('managerAppearanceTitle')}
            </h3>
            <p className="text-xs text-slate-500">
              {t('managerAppearanceDescription')}
            </p>
          </div>

          {/* Glass Mode Picker */}
          <div>
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-3">
              {t('managerMaterialMode')}
            </h4>
            <div className="grid grid-cols-2 gap-3">
              {([
                { id: 'light-glass', label: 'managerLightGlass' },
                { id: 'dark-glass', label: 'managerDarkGlass' },
              ] as const).map(mode => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => onUpdateSettings({ appearanceMode: mode.id as AppearanceMode })}
                  aria-label={t('managerSelectAppearance', { name: t(mode.label) })}
                  className={`p-4 rounded-2xl text-left border transition-all cursor-pointer ${
                    (userSettings.appearanceMode === 'reduced-transparency' ? 'light-glass' : userSettings.appearanceMode) === mode.id
                      ? 'border-sky-500 bg-sky-500/10 shadow-xs'
                      : 'border-slate-200/50 dark:border-white/10 hover:border-slate-300'
                  }`}
                >
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 block mb-1">
                    {t(mode.label)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <WallpaperSettings settings={userSettings} onUpdate={onUpdateSettings} />

          {/* Dock Preferences Section */}
          <div className="pt-4 border-t border-slate-200/50 dark:border-white/10 space-y-4">
            <div>
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                {t('managerTaskbarPreferences')}
              </h4>
              <p className="text-[11px] text-slate-500">
                {t('managerTaskbarDescription')}
              </p>
            </div>

            <div className="space-y-3">
              {/* Toggle Show Dock */}
              <div className="flex items-center justify-between p-3.5 rounded-2xl bg-black/5 dark:bg-white/5 border border-slate-200/50 dark:border-white/10">
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    {t('managerShowTaskbar')}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {t('managerHideTaskbarDescription')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const current = userSettings.showDock !== false;
                    onUpdateSettings({ showDock: !current });
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    userSettings.showDock !== false ? 'bg-sky-500' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                  role="switch"
                  aria-label={t('managerShowTaskbar')}
                  aria-checked={userSettings.showDock !== false}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      userSettings.showDock !== false ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Dock Icon Size Slider (Visible if showDock !== false) */}
              {userSettings.showDock !== false && (
                <div className="p-3.5 rounded-2xl bg-black/5 dark:bg-white/5 border border-slate-200/50 dark:border-white/10 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-800 dark:text-slate-200">
                    <span>{t('managerTaskbarIconSize')}</span>
                    <span className="font-mono text-sky-500">{userSettings.dockIconSize || 48}px</span>
                  </div>
                  <input
                    type="range"
                    min="34"
                    max="74"
                    value={userSettings.dockIconSize || 48}
                    aria-label={t('managerTaskbarIconSize')}
                    onChange={e => onUpdateSettings({ dockIconSize: Number(e.target.value) })}
                    className="w-full accent-sky-500 cursor-pointer h-1.5 bg-slate-200 dark:bg-white/10 rounded-lg"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>{t('managerCompactSize')}</span>
                    <span>{t('managerStandardSize')}</span>
                    <span>{t('managerLargeSize')}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <IconCacheSettings language={userSettings.language} />

        </div>
      )}

      {/* ======================================================== */}
      {/* MODALS                                                   */}
      {/* ======================================================== */}

      {(editingBookmark || isAddBookmarkOpen) && (
        <BookmarkDialog
          isOpen
          onClose={() => {
            setEditingBookmark(null);
            setIsAddBookmarkOpen(false);
          }}
          bookmark={editingBookmark ?? undefined}
          folders={folders}
          existingBookmarks={bookmarks}
          initialFolderId={selectedFolderId !== 'all' && selectedFolderId !== 'unorganized'
            ? selectedFolderId : undefined}
          defaultPinToDesktop={false}
          language={userSettings.language}
          onSave={handleSaveBookmark}
          onCreateFolder={handleCreateLibraryFolder}
          onOpenExisting={bookmark => window.open(bookmark.url, '_blank', 'noopener,noreferrer')}
          onEditExisting={bookmark => {
            setIsAddBookmarkOpen(false);
            setEditingBookmark(bookmark);
          }}
        />
      )}

      {/* Create Folder Modal (supports nesting via parent folder selection) */}
      {isCreateFolderOpen && (
        <Modal
          isOpen={isCreateFolderOpen}
          onClose={() => { if (!libraryMutationPending.current) setIsCreateFolderOpen(false); }}
          maxWidth="sm"
          title={t('managerCreateFolderTitle')}
          contained
        >
          <form onSubmit={handleCreateFolder} className="space-y-4 pt-1 text-xs">
            <fieldset disabled={libraryMutationBusy} className="min-w-0 space-y-4">
            <div>
              <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-200">
                {t('managerFolderName')} <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                aria-label={t('managerFolderName')}
                placeholder={t('managerFolderNameExample')}
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/5 dark:bg-white/10 border border-slate-200/50 focus:outline-none"
                autoFocus
              />
            </div>

            <div>
              <FolderTreeSelect
                folders={folders}
                value={newFolderParentId === 'none' ? undefined : newFolderParentId}
                onChange={id => setNewFolderParentId(id ?? 'none')}
                label={t('managerParentFolder')}
                language={userSettings.language}
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                {t('managerParentFolderHint')}
              </span>
            </div>

            {libraryMutationError && <p role="alert" className="break-words text-xs text-rose-600 dark:text-rose-300">{preferenceSaveError(libraryMutationError.cause, userSettings.language, 'library')}</p>}
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200/40">
              <button
                type="button"
                onClick={() => setIsCreateFolderOpen(false)}
                className="px-3 py-1.5 text-slate-500 cursor-pointer"
              >
                {t('managerCancel')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold cursor-pointer"
              >
                {t('managerCreateFolder')}
              </button>
            </div>
            </fieldset>
          </form>
        </Modal>
      )}

      {/* Rename / Edit Folder Modal */}
      {editingFolder && (
        <Modal
          isOpen={Boolean(editingFolder)}
          onClose={() => { if (!libraryMutationPending.current) setEditingFolder(null); }}
          maxWidth="sm"
          title={t('managerEditFolderTitle')}
          contained
        >
          <form onSubmit={handleRenameFolder} className="space-y-4 pt-1 text-xs">
            <fieldset disabled={libraryMutationBusy} className="min-w-0 space-y-4">
            <div>
              <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-200">
                {t('managerFolderName')} <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                aria-label={t('managerFolderName')}
                value={editFolderName}
                onChange={e => setEditFolderName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/5 dark:bg-white/10 border border-slate-200/50 focus:outline-none"
                autoFocus
              />
            </div>

            <div>
              <FolderTreeSelect
                folders={folders}
                value={editFolderParentId === 'none' ? undefined : editFolderParentId}
                onChange={id => setEditFolderParentId(id ?? 'none')}
                label={t('managerParentFolder')}
                excludedIds={[editingFolder.id]}
                language={userSettings.language}
              />
            </div>

            {libraryMutationError && <p role="alert" className="break-words text-xs text-rose-600 dark:text-rose-300">{preferenceSaveError(libraryMutationError.cause, userSettings.language, 'library')}</p>}
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200/40">
              <button
                type="button"
                onClick={() => setEditingFolder(null)}
                className="px-3 py-1.5 text-slate-500 cursor-pointer"
              >
                {t('managerCancel')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold cursor-pointer"
              >
                {t('managerSaveFolder')}
              </button>
            </div>
            </fieldset>
          </form>
        </Modal>
      )}

      {/* Batch Move to Folder Modal */}
      {isBatchMoveOpen && (
        <Modal
          isOpen={isBatchMoveOpen}
          onClose={() => { if (!libraryMutationPending.current) setIsBatchMoveOpen(false); }}
          maxWidth="sm"
          title={t('managerMoveBookmarksTitle', { count: selectedBmIds.length })}
          contained
        >
          <fieldset disabled={libraryMutationBusy} className="space-y-4 pt-1 text-xs">
            <div>
              <FolderTreeSelect
                folders={folders}
                value={batchTargetFolderId === 'unorganized' ? undefined : batchTargetFolderId}
                onChange={id => setBatchTargetFolderId(id ?? 'unorganized')}
                label={t('managerTargetFolder')}
                language={userSettings.language}
                onCreateFolder={handleCreateLibraryFolder}
              />
            </div>
            {libraryMutationError && <p role="alert" className="break-words text-xs text-rose-600 dark:text-rose-300">{preferenceSaveError(libraryMutationError.cause, userSettings.language, 'library')}</p>}
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200/40">
              <button
                type="button"
                onClick={() => setIsBatchMoveOpen(false)}
                className="px-3 py-1.5 text-slate-500 cursor-pointer"
              >
                {t('managerCancel')}
              </button>
              <button
                type="button"
                onClick={handleExecuteBatchMoveFolder}
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold cursor-pointer"
              >
                {t('managerConfirmMove')}
              </button>
            </div>
          </fieldset>
        </Modal>
      )}

      {/* Add / Edit Search Engine Modal */}
      {isAddEngineOpen && (
        <Modal
          isOpen={isAddEngineOpen}
          onClose={() => {
            setIsAddEngineOpen(false);
            setEditingEngine(null);
          }}
          maxWidth="md"
          title={editingEngine
            ? t('managerEngineEditTitle', { name: editingEngine.name })
            : t('managerEngineAddTitle')}
        >
          <form onSubmit={handleSaveEngine} className="space-y-4 pt-1 text-xs">
            {engineSaveError && <p role="alert" className="break-words text-xs text-rose-600 dark:text-rose-300">{
              engineSaveError.kind === 'template-validation'
                ? t('managerEngineUrlRequired', { query: '{query}' })
                : preferenceSaveError(engineSaveError.cause, userSettings.language)
            }</p>}
            {/* Quick Fill Preset Buttons */}
            <div>
              <label className="block font-semibold mb-1.5 text-slate-700 dark:text-slate-200">
                {t('managerEnginePresets')}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {SEARCH_ENGINE_PRESETS.filter(preset => [
                  'se-google', 'se-baidu', 'se-bing', 'se-github', 'se-bilibili', 'se-zhihu', 'se-duckduckgo',
                ].includes(preset.id)).map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setEngineFormName(t(preset.nameKey));
                      setEngineFormKeyword(preset.keyword);
                      setEngineFormUrl(preset.urlTemplate);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-sky-500 hover:text-white text-slate-700 dark:text-slate-300 transition-colors text-[11px] font-medium cursor-pointer"
                    aria-label={t('managerSelectEngine', { name: t(preset.nameKey) })}
                  >
                    <span>{t(preset.nameKey)}</span>
                    <span className="opacity-60 font-mono">/{preset.keyword}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-200">
                {t('managerEngineName')} <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                aria-label={t('managerEngineName')}
                placeholder={t('managerEngineNameExample')}
                value={engineFormName}
                onChange={e => setEngineFormName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/5 dark:bg-white/10 border border-slate-200/50 focus:outline-none"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-200">
                  {t('managerEngineKeyword')} <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-400 font-mono font-bold">/</span>
                  <input
                    type="text"
                    required
                    aria-label={t('managerEngineKeyword')}
                    placeholder={t('managerEngineKeywordExample')}
                    value={engineFormKeyword.replace(/^\//, '')}
                    onChange={e => setEngineFormKeyword(e.target.value.toLowerCase().replace(/^\//, ''))}
                    className="w-full pl-6 pr-3 py-2 rounded-xl bg-black/5 dark:bg-white/10 border border-slate-200/50 font-mono text-xs focus:outline-none"
                  />
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  {t('managerEngineKeywordHintLead')}{' '}
                  <code className="text-sky-500 font-bold">/{engineFormKeyword || 'kw'}</code>
                  {' '}{t('managerEngineKeywordHintTail')}
                </span>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-200">
                  {t('managerEngineStatus')}
                </label>
                <button
                  type="button"
                  onClick={() => setEngineFormEnabled(prev => !prev)}
                  aria-label={t(engineFormEnabled ? 'managerEngineFormEnabled' : 'managerEngineFormDisabled')}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                    engineFormEnabled
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-slate-300 dark:border-white/10 bg-black/5 text-slate-500'
                  }`}
                >
                  <span>{engineFormEnabled ? t('managerEngineFormEnabled') : t('managerEngineFormDisabled')}</span>
                  {engineFormEnabled ? <ToggleRight size={18} className="text-emerald-500" /> : <ToggleLeft size={18} />}
                </button>
              </div>
            </div>

            {/* URL Template Input & Query Variable Notice */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-semibold text-slate-700 dark:text-slate-200">
                  {t('managerEngineUrlTemplate')} <span className="text-rose-500">{t('managerEngineQueryRequired', { query: '{query}' })}</span>
                </label>
              </div>
              <input
                type="text"
                required
                aria-label={t('managerEngineUrlTemplate')}
                placeholder={t('managerEngineUrlExample', { query: '{query}' })}
                value={engineFormUrl}
                onChange={e => setEngineFormUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/5 dark:bg-white/10 border border-slate-200/50 font-mono text-xs focus:outline-none"
              />

              {/* Notice Box about {query} */}
              <div className="mt-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed space-y-1 select-text cursor-text">
                <div className="font-bold flex items-center gap-1">
                  <span>{t('managerEngineQueryTipWithIcon', { query: '{query}' })}</span>
                </div>
                <p>
                  {t('managerEngineQueryExplanationLead')}{' '}
                  <code className="bg-amber-500/20 px-1 py-0.5 rounded font-mono font-bold text-amber-900 dark:text-amber-100">{'{query}'}</code>
                  {' '}{t('managerEngineQueryExplanationTail')}
                </p>
                <p className="text-[10px] opacity-80 font-mono">
                  {t('managerEngineUrlExampleLabel', { query: '{query}' })}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200/40">
              <button
                type="button"
                onClick={() => {
                  setIsAddEngineOpen(false);
                  setEditingEngine(null);
                }}
                className="px-3 py-1.5 text-slate-500 cursor-pointer"
              >
                {t('managerCancel')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold cursor-pointer"
              >
                {editingEngine ? t('managerSaveChanges') : t('managerCreateSearchEngine')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Test Search Engine Modal */}
      {testEngineModal && (
        <Modal
          isOpen={Boolean(testEngineModal)}
          onClose={() => setTestEngineModal(null)}
          maxWidth="sm"
          title={t('managerTestEngineTitle', { name: testEngineModal.name })}
        >
          <div className="space-y-4 pt-1 text-xs">
            <div>
              <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-200">
                {t('managerTestKeywords')}
              </label>
              <input
                type="text"
                aria-label={t('managerTestKeywords')}
                value={testEngineQuery}
                onChange={e => setTestEngineQuery(e.target.value)}
                placeholder={t('managerTestQueryPlaceholder')}
                className="w-full px-3 py-2 rounded-xl bg-black/5 dark:bg-white/10 border border-slate-200/50 focus:outline-none"
                autoFocus
              />
            </div>

            <div>
              <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-200">
                {t('managerPreviewFinalUrl')}
              </label>
              <div className="p-2.5 rounded-xl bg-black/5 dark:bg-white/5 font-mono text-[11px] text-sky-600 dark:text-sky-400 break-all border border-slate-200/60 dark:border-white/10">
                {testEngineModal.urlTemplate.replace(
                  '{query}',
                  encodeURIComponent(testEngineQuery.trim() || t('managerTestQueryFallback'))
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200/40">
              <button
                type="button"
                onClick={() => setTestEngineModal(null)}
                className="px-3 py-1.5 text-slate-500 cursor-pointer"
              >
                {t('managerClose')}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleTestSearch(testEngineModal, testEngineQuery);
                  setTestEngineModal(null);
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold cursor-pointer"
              >
                <ExternalLink size={13} />
                <span>{t('managerOpenTest')}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  );
};

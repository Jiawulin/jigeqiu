import React, { useState, useEffect } from 'react';
import { readUserLocale } from './services/user-locale';
import {
  Bookmark,
  Folder,
  Category,
  Tag,
  Collection,
  SearchEngine,
  PlatformSite,
  Submission,
  UserSettings,
  DesktopAppWindow,
} from './types';
import { storage } from './services/storage';
import { useHashRoute } from './hooks/useHashRoute';
import { WallpaperBackground } from './components/common/WallpaperBackground';
import { Toast, ToastMessage } from './components/common/Toast';
import { BottomDock } from './components/dock/BottomDock';
import { SpotlightSearch } from './components/desktop/SpotlightSearch';
import { DesktopView } from './components/desktop/DesktopView';
import { DesktopGuide } from './components/desktop/DesktopGuide';
import { appShortcut, EDITABLE_SELECTOR } from './components/desktop/app-shortcuts';
import { DesktopWindow } from './components/desktop/DesktopWindow';
import { FolderModal } from './components/desktop/FolderModal';
import { QuickAddModal } from './components/desktop/QuickAddModal';
import { BookmarkDialog } from './components/common/BookmarkDialog';
import { CalculatorTool } from './components/plugins/CalculatorTool';
import { JsonFormatterTool } from './components/plugins/JsonFormatterTool';
import { WordCounterTool } from './components/plugins/WordCounterTool';
import { UserCenterView } from './components/account/UserCenterView';
import { ManagementShell, type ManagementSection } from './components/account/ManagementShell';
import { TopNavigation } from './components/common/TopNavigation';
import { DesktopAttribution } from './components/common/DesktopAttribution';
import { DesktopFolderModal } from './components/desktop/DesktopFolderModal';
import type { Layout } from './domain/assets/model';
import type { AssetAction } from './domain/assets/commands';
import { bookmarkSaveError } from './services/bookmark-input';
import { preferenceSaveError } from './services/preference-save-error';
import { BookmarkTrashView } from './components/account/BookmarkTrashView';
import { LibraryChangeNotice } from './components/common/LibraryChangeNotice';
import { commitAndRefresh } from './services/library-mutation';
import { createTranslator, resolveLocale } from './i18n';
import { useOnboarding } from './components/onboarding/useOnboarding';
import { OnboardingPanel } from './components/onboarding/OnboardingPanel';
import { TaskHint } from './components/onboarding/TaskHint';
import type { OnboardingEntry, OnboardingTaskContext } from './components/onboarding/types';

// Original visual prototype, retained while features are connected in small slices.
const loadLaunchpad = () => import('./components/desktop/Launchpad').then(module => ({ default: module.Launchpad }));
const Launchpad = React.lazy(loadLaunchpad);

export default function PrototypeApp() {
  // Capture first-use eligibility before storage getters initialize defaults.
  const onboarding = useOnboarding();
  // Core Application State
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => storage.getBookmarks());
  const [folders, setFolders] = useState<Folder[]>(() => storage.getFolders());
  const [categories, setCategories] = useState<Category[]>(() => storage.getCategories());
  const [tags, setTags] = useState<Tag[]>(() => storage.getTags());
  const [collections, setCollections] = useState<Collection[]>(() => storage.getCollections());
  const [bookmarkTrash, setBookmarkTrash] = useState(() => storage.getBookmarkTrash());
  const [folderTrash, setFolderTrash] = useState(() => storage.getFolderTrash());
  const [searchEngines, setSearchEngines] = useState<SearchEngine[]>(() => storage.getSearchEngines());
  const [submissions, setSubmissions] = useState<Submission[]>(() => storage.getSubmissions());
  const [settings, setSettings] = useState<UserSettings>(() => storage.getUserSettings());
  const t = createTranslator(settings.language);
  useEffect(() => {
    document.documentElement.lang = resolveLocale(settings.language) === 'en' ? 'en' : 'zh-CN';
  }, [settings.language]);
  const [libraryChanged, setLibraryChanged] = useState(false);
  useEffect(() => {
    const check = () => {
      const language = readUserLocale();
      setSettings(current => current.language === language ? current : { ...current, language });
      try { setLibraryChanged(storage.hasLibraryChanges()); }
      catch { setLibraryChanged(true); }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === localStorage) check();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('application-storage-change', check);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    check();
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('application-storage-change', check);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  const [desktopLayout, setDesktopLayout] = useState<Layout | null>(() => {
    try { return storage.getDesktopLayout(); } catch { return null; }
  });
  const [activeDesktopFolderId, setActiveDesktopFolderId] = useState<string | null>(null);
  const [quickAddDesktopFolderId, setQuickAddDesktopFolderId] = useState<string | null>(null);

  const refreshLibrary = () => {
    const next = {
      bookmarks: storage.getBookmarks(), folders: storage.getFolders(), collections: storage.getCollections(),
      bookmarkTrash: storage.getBookmarkTrash(), folderTrash: storage.getFolderTrash(),
      settings: storage.getUserSettings(), desktopLayout: storage.getDesktopLayout(),
      searchEngines: storage.getSearchEngines(),
    };
    setBookmarks(next.bookmarks);
    setFolders(next.folders);
    setCollections(next.collections);
    setBookmarkTrash(next.bookmarkTrash);
    setFolderTrash(next.folderTrash);
    setSettings(next.settings);
    setDesktopLayout(next.desktopLayout);
    setSearchEngines(next.searchEngines);
  };
  const mutateLibrary = <T,>(commit: () => T): Promise<T> => commitAndRefresh(commit, refreshLibrary);
  const desktopAction = async (actions: Extract<AssetAction, { type: `desktop.${string}` }>[]) => {
    setDesktopLayout(await storage.mutate(() => storage.executeDesktop(actions)));
  };
  const setDesktopPins = async (ids: string[], pinned: boolean) => {
    setDesktopLayout(await storage.mutate(() => storage.setDesktopPins(ids, pinned)));
  };
  const desktopBookmarkIds = desktopLayout?.shortcuts.map(shortcut => shortcut.bookmarkId) ?? [];
  const activeDesktopFolder = desktopLayout?.folders.find(folder => folder.id === activeDesktopFolderId);

  // Navigation & Routing State
  const { route, navigate, closeLaunchpad } = useHashRoute(settings.language);
  const currentTab = route.page === 'management' ? 'account' : 'desktop';
  const [activeCollectionDetail, setActiveCollectionDetail] = useState<Collection | null>(null);
  const [lastManagementSection, setLastManagementSection] = useState<ManagementSection>('bookmarks');
  const accountInitialTab = route.page === 'management' ? route.section : lastManagementSection;
  useEffect(() => {
    if (route.page === 'management') setLastManagementSection(route.section);
  }, [route]);
  const navigateManagement = (section?: ManagementSection) => {
    navigate({ page: 'management', section: section ?? accountInitialTab });
    setActiveCollectionDetail(null);
  };

  // Active Modals & Floating Tool Windows
  const [activeFolderModal, setActiveFolderModal] = useState<Folder | null>(null);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickAddInitialUrl, setQuickAddInitialUrl] = useState<string | undefined>(undefined);
  const [quickAddFolderId, setQuickAddFolderId] = useState<string | undefined>(undefined);
  const isLaunchpadOpen = route.page === 'launchpad';
  useEffect(() => {
    if (route.page !== 'desktop') return;
    // Warm code and pinyin dependencies without mounting the drawer or building its index.
    const warm = () => { void loadLaunchpad().catch(() => {}); };
    if (typeof window.requestIdleCallback === 'function') {
      const job = window.requestIdleCallback(warm, { timeout: 1500 });
      return () => window.cancelIdleCallback(job);
    }
    const timer = window.setTimeout(warm, 200);
    return () => window.clearTimeout(timer);
  }, [route.page]);
  const [launchpadBrowse, setLaunchpadBrowse] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const previousRoutePage = React.useRef(route.page);
  useEffect(() => {
    const leavingLaunchpad = previousRoutePage.current === 'launchpad' && route.page !== 'launchpad';
    previousRoutePage.current = route.page;
    // Closing Launchpad may hand off directly to another temporary panel.
    if (leavingLaunchpad && route.page === 'desktop') return;
    setIsSearchOpen(false);
    setIsGuideOpen(false);
  }, [route]);
  const [libraryBookmarkToReveal, setLibraryBookmarkToReveal] = useState<string | null>(null);
  const [libraryFolderToReveal, setLibraryFolderToReveal] = useState<string | null>(null);
  const [bookmarkToEdit, setBookmarkToEdit] = useState<Bookmark | null>(null);
  const openBookmarkEditor = (bookmark: Bookmark) => {
    onboarding.cancelTask();
    setIsQuickAddOpen(false);
    closeLaunchpad();
    setBookmarkToEdit(bookmark);
  };
  const openLaunchpad = (browse = false) => {
    setIsSearchOpen(false);
    setToast(null);
    setLaunchpadBrowse(browse);
    navigate({ page: 'launchpad' });
  };

  // Built-in Tools Open State
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [isJsonFormatterOpen, setIsJsonFormatterOpen] = useState(false);
  const [isWordCounterOpen, setIsWordCounterOpen] = useState(false);

  // Desktop App Windows State (Multi-window Floating Web Apps)
  const [appWindows, setAppWindows] = useState<DesktopAppWindow[]>([]);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const [isDesktopRevealed, setIsDesktopRevealed] = useState(false);
  const highestZIndexRef = React.useRef<number>(100);
  const [desktopInteraction, setDesktopInteraction] = useState(false);
  const [dockInteraction, setDockInteraction] = useState(false);
  const [revealDesktopBookmarkId, setRevealDesktopBookmarkId] = useState<string>();
  const [backupReveal, setBackupReveal] = useState(false);
  useEffect(() => {
    if (!backupReveal || route.page !== 'management' || route.section !== 'import-export') return;
    let frame = 0;
    const locate = () => {
      const target = document.querySelector<HTMLElement>('[data-onboarding="json-export"]');
      if (!target || frame) return;
      frame = requestAnimationFrame(() => {
        if (!target.isConnected) { frame = 0; locate(); return; }
        target.scrollIntoView({ block: 'center' });
        target.focus({ preventScroll: true });
        setBackupReveal(false);
      });
    };
    const observer = new MutationObserver(locate);
    observer.observe(document.getElementById('root')!, { subtree: true, childList: true });
    locate();
    const timeout = setTimeout(() => setBackupReveal(false), 3000);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(timeout); };
  }, [backupReveal, route]);
  const onboardingBlocking = ['welcome', 'tour', 'taskPicker'].includes(onboarding.flow.phase);
  const overlaysOpen = isGuideOpen || isQuickAddOpen || !!bookmarkToEdit || !!activeFolderModal
    || !!activeDesktopFolder || isCalculatorOpen || isJsonFormatterOpen || isWordCounterOpen
    || appWindows.some(window => !window.isMinimized) || desktopInteraction || dockInteraction;
  const taskContext = React.useMemo<OnboardingTaskContext | undefined>(() => onboarding.flow.phase === 'task' && onboarding.flow.task
    ? { task: onboarding.flow.task, onExit: onboarding.exit, onEvent: onboarding.onEvent } : undefined,
  [onboarding.flow.phase, onboarding.flow.task, onboarding.exit, onboarding.onEvent]);
  useEffect(() => {
    if (route.page === 'desktop' && !libraryChanged && !overlaysOpen && !isSearchOpen && !onboardingBlocking) return onboarding.offerWelcome();
  }, [route.page, libraryChanged, overlaysOpen, isSearchOpen, onboardingBlocking, onboarding.offerWelcome]);
  useEffect(() => {
    if ((onboarding.flow.phase === 'tour' || onboarding.flow.phase === 'welcome' || onboarding.flow.phase === 'taskPicker')
      && route.page !== 'desktop') { onboarding.exit(); return; }
    if (onboarding.flow.phase !== 'task') return;
    const allowed = onboarding.flow.task === 'import'
      ? route.page === 'management' && route.section === 'import-export'
      : onboarding.flow.task === 'pin' ? route.page === 'launchpad' : route.page === 'desktop';
    if (!allowed) onboarding.exit();
  }, [route, onboarding.flow.phase, onboarding.flow.task, onboarding.exit]);
  const startOnboarding = (entry: OnboardingEntry) => {
    if (onboarding.flow.phase === 'task') return;
    setIsGuideOpen(false);
    setIsSearchOpen(false);
    setRevealDesktopBookmarkId(undefined);
    if (entry === 'import') navigateManagement('import-export');
    else if (entry === 'pin' && bookmarks.length) openLaunchpad();
    else {
      navigate({ page: 'desktop' });
      if (entry === 'add') {
        setQuickAddInitialUrl(undefined);
        setQuickAddFolderId(undefined);
        setQuickAddDesktopFolderId(null);
        setIsQuickAddOpen(true);
      }
    }
    onboarding.start(entry, bookmarks.length > 0);
  };
  const revealPinnedBookmark = (id: string) => {
    const shortcut = desktopLayout?.shortcuts.find(item => item.bookmarkId === id);
    if (!shortcut) return;
    navigate({ page: 'desktop' });
    setRevealDesktopBookmarkId(id);
    setActiveDesktopFolderId(desktopLayout?.folders.find(folder => folder.shortcutIds.includes(shortcut.id))?.id ?? null);
    onboarding.finish('pin', id);
  };

  // Keyboard shortcut: Escape restores windows if pushed away
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDesktopRevealed) {
        setIsDesktopRevealed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDesktopRevealed]);

  // Handle Desktop background click to reveal desktop (macOS Sonoma stage manager style)
  const handleDesktopBackgroundClick = (e: React.MouseEvent) => {
    if (onboardingBlocking) return;
    const target = e.target as HTMLElement;
    // If clicking inside a window, dock, modal, search input, toast, or action buttons, do not toggle
    if (
      target.closest(
        'button, a, input, textarea, select, [role="dialog"], .dock-container, .desktop-window, .desktop-item, .search-container, .folder-modal'
      )
    ) {
      return;
    }

    const hasVisibleWindows = appWindows.some(w => !w.isMinimized);
    if (hasVisibleWindows) {
      setIsDesktopRevealed(prev => !prev);
    }
  };

  // Open Bookmark in Desktop Window
  const handleOpenBookmarkInWindow = (bm: Bookmark) => {
    setIsDesktopRevealed(false);

    // If a window for this bookmark already exists, restore and focus it
    const existing = appWindows.find(w => w.bookmarkId === bm.id);
    if (existing) {
      highestZIndexRef.current += 1;
      setAppWindows(prev =>
        prev.map(w =>
          w.id === existing.id
            ? { ...w, isMinimized: false, zIndex: highestZIndexRef.current }
            : w
        )
      );
      setActiveWindowId(existing.id);
      return;
    }

    // Otherwise create new staggered window strictly bounded above bottom dock
    const DOCK_CLEARANCE = 86;
    highestZIndexRef.current += 1;
    const offset = (appWindows.length % 6) * 28;
    const defaultW = Math.min(window.innerWidth - 40, 860);
    const maxPossibleH = Math.max(260, window.innerHeight - DOCK_CLEARANCE - 60);
    const defaultH = Math.min(maxPossibleH, 560);
    const startX = Math.max(20, Math.min(window.innerWidth - defaultW - 20, 100 + offset));
    const startY = Math.max(20, Math.min(window.innerHeight - DOCK_CLEARANCE - defaultH, 40 + offset));

    const newWin: DesktopAppWindow = {
      id: `win-${bm.id}-${Date.now()}`,
      bookmarkId: bm.id,
      title: bm.title,
      url: bm.url,
      iconBg: bm.iconBg,
      x: startX,
      y: startY,
      width: defaultW,
      height: defaultH,
      isMinimized: false,
      isMaximized: false,
      zIndex: highestZIndexRef.current,
    };

    setAppWindows(prev => [...prev, newWin]);
    setActiveWindowId(newWin.id);
    void storage.mutate(() => storage.recordSiteVisit(bm.id)).catch(cause => {
      showToast(preferenceSaveError(cause, settings.language));
    });
  };

  const handleFocusWindow = (id: string) => {
    setIsDesktopRevealed(false);
    highestZIndexRef.current += 1;
    setAppWindows(prev =>
      prev.map(w =>
        w.id === id ? { ...w, isMinimized: false, zIndex: highestZIndexRef.current } : w
      )
    );
    setActiveWindowId(id);
  };

  const handleCloseWindow = (id: string) => {
    setAppWindows(prev => prev.filter(w => w.id !== id));
    if (activeWindowId === id) {
      setActiveWindowId(null);
    }
  };

  const handleMinimizeWindow = (id: string) => {
    setAppWindows(prev =>
      prev.map(w => (w.id === id ? { ...w, isMinimized: true } : w))
    );
    if (activeWindowId === id) {
      setActiveWindowId(null);
    }
  };

  const handleRestoreWindow = (id: string) => {
    highestZIndexRef.current += 1;
    setAppWindows(prev =>
      prev.map(w =>
        w.id === id ? { ...w, isMinimized: false, zIndex: highestZIndexRef.current } : w
      )
    );
    setActiveWindowId(id);
  };

  const handleMaximizeWindow = (id: string) => {
    setAppWindows(prev =>
      prev.map(w => (w.id === id ? { ...w, isMaximized: !w.isMaximized } : w))
    );
  };

  const handleUpdateWindowPosition = (id: string, x: number, y: number) => {
    setAppWindows(prev =>
      prev.map(w => (w.id === id ? { ...w, x, y } : w))
    );
  };

  const handleUpdateWindowSize = (id: string, width: number, height: number) => {
    setAppWindows(prev =>
      prev.map(w => (w.id === id ? { ...w, width, height } : w))
    );
  };

  const handleUpdateWindowUrl = (id: string, newUrl: string) => {
    setAppWindows(prev =>
      prev.map(w => (w.id === id ? { ...w, url: newUrl } : w))
    );
  };

  // Toast Notification State
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const action = appShortcut(e);
      if (!action || currentTab !== 'desktop' || onboardingBlocking) return;
      const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"],[role="menu"],[aria-modal="true"],.desktop-window')]
        .filter(element => element.getClientRects().length && !element.closest('[hidden],[aria-hidden="true"],[inert]'));
      const search = document.querySelector<HTMLElement>('[data-panel="search"]');
      const launchpad = document.querySelector<HTMLElement>('[data-panel="launchpad"]');
      if (dialogs.some(element => element !== search && element !== launchpad)
        || document.querySelector('[data-desktop-editing="true"]')) return;
      const target = e.target instanceof Element ? e.target : document.activeElement;
      if ((target?.closest(EDITABLE_SELECTOR) || document.activeElement?.closest(EDITABLE_SELECTOR))
        && !(search?.contains(target) || launchpad?.contains(target))) return;
      e.preventDefault();
      if (action === 'search') {
        closeLaunchpad();
        setIsSearchOpen(true);
        search?.querySelector<HTMLInputElement>('input')?.focus();
      } else if (action === 'launchpad') {
        openLaunchpad();
        launchpad?.querySelector<HTMLInputElement>('input')?.focus();
      } else if (!search) {
        closeLaunchpad();
        setQuickAddInitialUrl(undefined);
        setQuickAddFolderId(undefined);
        setIsQuickAddOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTab, route, onboardingBlocking]);

  const showToast = (message: string, actionText?: string, onAction?: () => void) => {
    setToast({
      id: String(Date.now()),
      message,
      actionText,
      onAction,
      duration: 3500,
    });
  };

  // Bookmark actions
  const handleOpenBookmark = async (bm: Bookmark) => {
    window.open(bm.url, '_blank', 'noopener,noreferrer');
    try {
      await storage.mutate(() => storage.recordSiteVisit(bm.id));
      setBookmarks(storage.getBookmarks());
    } catch {
      showToast('已尝试打开网址，但未能保存访问记录。请刷新后继续整理收藏。');
    }
  };

  const handleSaveQuickAdd = async (
    bookmarkData: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'>,
    pinToDesktop: boolean
  ) => {
    const newBm = await mutateLibrary(() => storage.saveManualBookmark({
      ...bookmarkData,
      pinnedToDesktop: pinToDesktop,
    }, undefined, pinToDesktop && quickAddDesktopFolderId ? { folderId: quickAddDesktopFolderId } : undefined));
    setQuickAddDesktopFolderId(null);
    onboarding.finish('add', newBm.id);

    showToast(`已成功添加「${newBm.title}」`, '撤销', async () => {
      try { await mutateLibrary(() => storage.deleteBookmark(newBm.id)); }
      catch (error) { showToast(preferenceSaveError(error, settings.language, 'library')); }
    });
  };

  // Folder actions
  const handleRenameFolder = async (folderId: string, newName: string) => {
    await mutateLibrary(() => storage.updateFolder(folderId, { name: newName }));
    const updated = storage.getFolders();
    setFolders(updated);
    if (activeFolderModal?.id === folderId) {
      setActiveFolderModal(updated.find(f => f.id === folderId) || null);
    }
  };

  const handleRemoveFromFolder = async (folderId: string, bookmarkId: string) => {
    await mutateLibrary(() => storage.moveBookmarks([bookmarkId]));
    const folder = storage.getFolders().find(item => item.id === folderId);
    if (folder) setActiveFolderModal(folder);
    showToast('已移至收藏库根目录，桌面快捷方式不变');
  };

  const handleDeleteFolder = async (folderId: string) => {
    await mutateLibrary(() => storage.deleteFolder(folderId));
    showToast('文件夹已解散，内部书签已保留');
  };

  const handleMoveToFolder = async (bmIds: string[], folderId: string) => {
    await mutateLibrary(() => storage.moveBookmarks(bmIds, folderId));
    const folder = storage.getFolders().find(item => item.id === folderId);
    if (folder) showToast(`已移动至文件夹「${folder.name}」`);
  };

  // Tool launches
  const handleOpenTool = (toolType: 'calculator' | 'json-formatter' | 'word-counter') => {
    if (toolType === 'calculator') setIsCalculatorOpen(true);
    if (toolType === 'json-formatter') setIsJsonFormatterOpen(true);
    if (toolType === 'word-counter') setIsWordCounterOpen(true);
  };

  // Collection actions
  const handleCloneCollection = async (col: Collection) => {
    const cloned = await storage.mutate(() => storage.cloneCollection(col));
    setCollections(storage.getCollections());
    showToast(`已成功复制「${cloned.title}」为我的专属副本`);
  };

  const handleTogglePinCollection = async (colId: string) => {
    const current = storage.getCollections();
    const col = current.find(c => c.id === colId);
    if (col) {
      col.isPinnedToDesktop = !col.isPinnedToDesktop;
      await storage.mutate(() => storage.saveCollections(current));
      setCollections([...current]);
      showToast(col.isPinnedToDesktop ? '已固定至桌面' : '已从桌面移除');
    }
  };

  const handleSavePlatformSiteToLibrary = async (site: PlatformSite) => {
    try {
      await storage.mutate(() => storage.saveManualBookmark({
        title: site.title,
        url: site.url,
        domain: site.domain,
        iconBg: site.iconBg,
        category: site.category,
        tags: site.tags,
        notes: site.recommendationReason,
        pinnedToDesktop: true,
        order: bookmarks.length + 1,
        collectionIds: site.relatedCollectionIds,
      }));
      refreshLibrary();
      showToast(`已将「${site.title}」存入收藏库并固定至桌面`);
    } catch (error) { showToast(bookmarkSaveError(error)); }
  };

  // Settings update
  const handleUpdateSettings = async (updates: Partial<UserSettings>): Promise<boolean> => {
    try {
      const next = await storage.mutate(() => storage.saveUserSettings(updates));
      setSettings(next);
      return true;
    } catch (cause) {
      showToast(preferenceSaveError(cause, settings.language,
        updates.dockBookmarkIds !== undefined ? 'library' : 'settings'));
      return false;
    }
  };

  // Toggle bookmark pinned in iPadOS Dock
  const handleToggleDockBookmark = async (bmId: string) => {
    const effectiveDockIds =
      settings.dockBookmarkIds !== undefined
        ? [...settings.dockBookmarkIds]
        : [];

    const isCurrentlyInDock = effectiveDockIds.includes(bmId);
    let updatedDockIds: string[];
    const bm = bookmarks.find(b => b.id === bmId);

    if (isCurrentlyInDock) {
      updatedDockIds = effectiveDockIds.filter(id => id !== bmId);
    } else {
      updatedDockIds = [...effectiveDockIds, bmId];
    }
    if (!await handleUpdateSettings({ dockBookmarkIds: updatedDockIds })) return false;
    showToast(isCurrentlyInDock
      ? settings.language === 'en' ? `Unpinned "${bm?.title || 'Bookmark'}" from Taskbar` : `已从任务栏取消固定「${bm?.title || '网址'}」`
      : settings.language === 'en' ? `Pinned "${bm?.title || 'Bookmark'}" to Taskbar` : `已将「${bm?.title || '网址'}」固定到任务栏`);
    return true;
  };

  // Delete bookmark / Cancel favorite completely
  const handleDeleteBookmark = async (bmId: string) => {
    const bm = bookmarks.find(b => b.id === bmId);
    if (!bm) return;

    await mutateLibrary(() => storage.deleteBookmark(bmId));
    showToast(settings.language === 'en' ? 'Bookmark moved to recycle bin' : `已将「${bm.title}」移至回收站`);
  };

  // Update bookmark metadata
  const handleUpdateBookmark = async (bmId: string, updates: Partial<Bookmark>) => {
    const previous = storage.getBookmarks().find(bookmark => bookmark.id === bmId);
    if (!previous) throw new Error('NOT_FOUND');
    await mutateLibrary(() => storage.saveManualBookmark({ ...previous, ...updates }, bmId));
    showToast('已更新收藏');
  };

  return (
    <WallpaperBackground preset={settings.wallpaperPreset} appearance={settings.appearanceMode} customWallpaperId={settings.customWallpaperId}>
      <TopNavigation management={currentTab !== 'desktop'} language={settings.language}
        dark={settings.appearanceMode === 'dark-glass'}
        onHome={() => { navigate({ page: 'desktop' }); setActiveCollectionDetail(null); }}
        onManagement={() => navigateManagement()}
        onLanguage={() => handleUpdateSettings({ language: resolveLocale(settings.language) === 'en' ? 'zh' : 'en' })}
        onTheme={() => handleUpdateSettings({ appearanceMode: settings.appearanceMode === 'dark-glass' ? 'light-glass' : 'dark-glass' })} />
      <LibraryChangeNotice visible={libraryChanged} language={settings.language} onReload={() => window.location.reload()} />

      {/* Main View Router */}
      <main
        data-onboarding-phase={onboarding.flow.phase}
        data-desktop-interaction={desktopInteraction}
        data-dock-interaction={dockInteraction}
        data-desktop-surface={currentTab === 'desktop' ? '' : undefined}
        onClick={handleDesktopBackgroundClick}
        className={`flex-1 flex flex-col ${currentTab === 'desktop' ? 'touch-none' : settings.showDock !== false ? 'pb-16 sm:pb-24' : 'pb-4 sm:pb-6'} cursor-default`}
      >
        {currentTab === 'desktop' && (
          <div className="flex-1 min-h-0 flex flex-col justify-start">
            {/* Central Spotlight Search Bar */}
            <div className="pt-2 sm:pt-6 pb-2 sm:pb-4">
              <SpotlightSearch
                language={settings.language}
                bookmarks={bookmarks}
                folders={folders}
                collections={[]}
                platformSites={[]}
                plugins={[]}
                searchEngines={searchEngines}
                currentEngineId={settings.defaultSearchEngineId}
                isOpen={isSearchOpen}
                tipsPaused={overlaysOpen || onboarding.flow.phase !== 'idle' || isLaunchpadOpen}
                canInvokeFromDesktop={!onboardingBlocking && !isGuideOpen && !isLaunchpadOpen && !isQuickAddOpen && !bookmarkToEdit
                  && !activeFolderModal && !isCalculatorOpen && !isJsonFormatterOpen && !isWordCounterOpen
                  && !appWindows.some(window => !window.isMinimized)}
                onOpenChange={open => {
                  if (open) closeLaunchpad();
                  setIsSearchOpen(open);
                }}
                onSelectEngine={engineId => handleUpdateSettings({ defaultSearchEngineId: engineId })}
                onSystemCommand={command => {
                  if (command === 'help') {
                    setIsSearchOpen(false);
                    closeLaunchpad();
                    setIsGuideOpen(true);
                    return;
                  }
                  if (command === 'start') {
                    openLaunchpad();
                    return;
                  }
                  if (command === 'dark' || command === 'light') {
                    handleUpdateSettings({ appearanceMode: command === 'dark' ? 'dark-glass' : 'light-glass' });
                    return;
                  }
                  if (command === 'add') {
                    setQuickAddInitialUrl(undefined);
                    setQuickAddFolderId(undefined);
                    setIsQuickAddOpen(true);
                    return;
                  }
                  if (command === 'all') {
                    setLibraryBookmarkToReveal(null);
                    setLibraryFolderToReveal(null);
                  }
                  navigateManagement(command === 'all' ? 'bookmarks' : command === 'search' ? 'engines'
                    : command === 'trash' ? 'trash' : 'appearance');
                }}
                onOpenBookmark={handleOpenBookmark}
                onOpenFolder={folder => {
                  setLibraryBookmarkToReveal(null);
                  setLibraryFolderToReveal(folder.id);
                  navigateManagement('bookmarks');
                }}
                onOpenCollection={() => {}}
                onOpenPlatformSite={site => handleSavePlatformSiteToLibrary(site)}
                onOpenTool={handleOpenTool}
                onQuickAdd={url => {
                  setQuickAddInitialUrl(url);
                  setIsQuickAddOpen(true);
                }}
                onOpenSearchEngineSettings={() => {
                  navigateManagement('engines');
                }}
              />
            </div>

            {/* Desktop Icons Array */}
            <DesktopView
              interactionBlocked={onboardingBlocking}
              onInteractionChange={setDesktopInteraction}
              revealBookmarkId={revealDesktopBookmarkId}
              bookmarks={bookmarks}
              folders={folders}
              plugins={[]}
              viewMode={settings.desktopViewMode}
              dockBookmarkIds={settings.dockBookmarkIds ?? []}
              onChangeViewMode={mode => handleUpdateSettings({ desktopViewMode: mode })}
              onOpenBookmark={handleOpenBookmark}
              onOpenTool={handleOpenTool}
              onQuickAdd={() => {
                setQuickAddInitialUrl(undefined);
                setQuickAddFolderId(undefined);
                setQuickAddDesktopFolderId(null);
                setIsQuickAddOpen(true);
              }}
              onUnpinFromDesktop={async bmId => {
                await setDesktopPins([bmId], false);
                showToast('已从桌面移除快捷方式，原收藏不变');
              }}
              onToggleDockBookmark={handleToggleDockBookmark}
              onDeleteBookmark={handleDeleteBookmark}
              onShowToast={showToast}
              onOpenLaunchpad={openLaunchpad}
              onOpenSearch={() => { closeLaunchpad(); setIsSearchOpen(true); }}
              onOpenLibrary={() => {
                navigateManagement('bookmarks');
              }}
              onLibraryChanged={refreshLibrary}
              onRevealBookmark={bookmark => {
                setLibraryBookmarkToReveal(bookmark.id);
                navigateManagement('bookmarks');
              }}
              desktopLayout={desktopLayout}
              onDesktopAction={desktopAction}
              onOpenDesktopFolder={setActiveDesktopFolderId}
              showDock={settings.showDock !== false}
              language={settings.language ?? 'zh'}
            />
          </div>
        )}

        {currentTab === 'account' && <ManagementShell section={accountInitialTab}
          showDock={settings.showDock !== false} dockIconSize={settings.dockIconSize}
          language={settings.language} onNavigate={section => navigateManagement(section)}>
        {accountInitialTab === 'trash' && <BookmarkTrashView entries={bookmarkTrash} folderEntries={folderTrash} folders={folders} language={settings.language}
          onRestoreFolder={async id => { await mutateLibrary(() => storage.restoreTrashedFolder(id)); }}
          onPurgeFolder={async id => { await mutateLibrary(() => storage.purgeTrashedFolder(id)); }}
          onRestore={async id => { await mutateLibrary(() => storage.restoreTrashedBookmark(id)); }}
          onPurge={async id => { await mutateLibrary(() => storage.purgeTrashedBookmark(id)); }} />}
        {accountInitialTab !== 'trash' && (
          <UserCenterView
            onboarding={taskContext?.task === 'import' ? taskContext : undefined}
            onLibraryChanged={refreshLibrary}
            initialTab={accountInitialTab}
            onSectionChange={section => navigateManagement(section)}
            initialBookmarkId={libraryBookmarkToReveal}
            onBookmarkRevealed={() => setLibraryBookmarkToReveal(null)}
            initialFolderId={libraryFolderToReveal}
            onFolderRevealed={() => setLibraryFolderToReveal(null)}
            bookmarks={bookmarks}
            folders={folders}
            searchEngines={searchEngines}
            userSettings={settings}
            desktopBookmarkIds={desktopBookmarkIds}
            onSetDesktopPins={setDesktopPins}
            onSearchEnginesChanged={setSearchEngines}
            onUpdateSettings={handleUpdateSettings}
            onShowToast={showToast}
          />
        )}
        </ManagementShell>}
      </main>
      {activeDesktopFolder && desktopLayout && <DesktopFolderModal
        revealBookmarkId={revealDesktopBookmarkId}
        onboardingHint={onboarding.flow.phase === 'result' && onboarding.flow.task === 'pin'
          ? <TaskHint language={settings.language} message="onboardingPinDone" onDismiss={onboarding.exit} /> : undefined}
        folder={activeDesktopFolder} layout={desktopLayout} bookmarks={bookmarks} folders={folders} language={settings.language}
        onShowToast={showToast}
        onClose={() => setActiveDesktopFolderId(null)}
        onOpenBookmark={handleOpenBookmark}
        dockBookmarkIds={settings.dockBookmarkIds ?? []}
        onEditBookmark={bookmark => { setActiveDesktopFolderId(null); openBookmarkEditor(bookmark); }}
        onToggleDock={handleToggleDockBookmark}
        onRevealBookmark={bookmark => {
          setActiveDesktopFolderId(null);
          setLibraryBookmarkToReveal(bookmark.id);
          navigateManagement('bookmarks');
        }}
        onRemoveShortcut={bookmarkId => setDesktopPins([bookmarkId], false)}
        onDeleteBookmark={handleDeleteBookmark}
        onRename={name => desktopAction([{ type: 'desktop.folder.rename', id: activeDesktopFolder.id, name }])}
        onMove={async (bookmarkId, folderId) => {
          const current = storage.getDesktopLayout()!;
          const shortcut = current.shortcuts.find(shortcut => shortcut.bookmarkId === bookmarkId);
          if (!shortcut) throw new Error('NOT_FOUND');
          const folder = folderId ? current.folders.find(folder => folder.id === folderId) : null;
          if (folderId && !folder) throw new Error('INVALID_REFERENCE');
          const remainingRoot = current.root.filter(ref => ref.kind !== 'shortcut' || ref.id !== shortcut.id);
          const sourcePosition = remainingRoot.findIndex(ref => ref.kind === 'desktop-folder' && ref.id === activeDesktopFolder.id);
          await desktopAction([{ type: 'desktop.move', ref: { kind: 'shortcut', id: shortcut.id }, to: folderId
            ? { kind: 'folder', folderId, index: folder!.shortcutIds.filter(id => id !== shortcut.id).length }
            : { kind: 'root', index: sourcePosition < 0 ? remainingRoot.length : sourcePosition + 1 } }]);
        }}
        onPin={async bookmarkId => {
          const current = storage.getDesktopLayout()!;
          const target = current.folders.find(folder => folder.id === activeDesktopFolder.id);
          if (!target) throw new Error('NOT_FOUND');
          const existing = current.shortcuts.find(shortcut => shortcut.bookmarkId === bookmarkId);
          if (existing) await desktopAction([{ type: 'desktop.move', ref: { kind: 'shortcut', id: existing.id }, to: {
            kind: 'folder', folderId: activeDesktopFolder.id,
            index: target.shortcutIds.filter(id => id !== existing.id).length,
          } }]);
          else await desktopAction([{ type: 'desktop.pin', bookmarkId, shortcutId: crypto.randomUUID(), to: {
            kind: 'folder', folderId: activeDesktopFolder.id, index: target.shortcutIds.length,
          } }]);
        }}
        onReorder={async ids => {
          if (ids.length !== activeDesktopFolder.shortcutIds.length || new Set(ids).size !== ids.length
            || ids.some(id => !activeDesktopFolder.shortcutIds.includes(id))) throw new Error('INVALID_INPUT');
          await desktopAction(ids.map((id, index) => ({ type: 'desktop.move', ref: { kind: 'shortcut', id }, to: {
            kind: 'folder', folderId: activeDesktopFolder.id, index,
          } })));
        }}
        onRemove={async mode => {
          await desktopAction([{ type: 'desktop.folder.remove', id: activeDesktopFolder.id, mode }]);
          setActiveDesktopFolderId(null);
        }}
        onQuickAdd={() => {
          setActiveDesktopFolderId(null);
          setQuickAddInitialUrl(undefined);
          setQuickAddFolderId(undefined);
          setQuickAddDesktopFolderId(activeDesktopFolder.id);
          setIsQuickAddOpen(true);
        }}
      />}

      {/* Folder Expanded Modal */}
      {activeFolderModal && (
        <FolderModal
          folder={activeFolderModal}
          allBookmarks={bookmarks}
          categories={categories}
          folders={folders}
          dockBookmarkIds={settings.dockBookmarkIds ?? []}
          isOpen={Boolean(activeFolderModal)}
          onClose={() => setActiveFolderModal(null)}
          onOpenBookmark={handleOpenBookmark}
          onOpenBookmarkInWindow={handleOpenBookmarkInWindow}
          onRenameFolder={handleRenameFolder}
          onRemoveFromFolder={handleRemoveFromFolder}
          onDeleteFolder={handleDeleteFolder}
          onToggleDockBookmark={handleToggleDockBookmark}
          onUpdateBookmark={handleUpdateBookmark}
          onCreateFolder={(name, parentId) => {
            return mutateLibrary(() => storage.createFolder(name, [], parentId));
          }}
          desktopBookmarkIds={desktopBookmarkIds}
          onTogglePinDesktop={async bmId => {
            const bookmark = bookmarks.find(item => item.id === bmId);
            if (bookmark) await setDesktopPins([bmId], desktopBookmarkIds.includes(bmId) === false);
          }}
          onManageBookmark={bookmark => {
            setActiveFolderModal(null);
            setLibraryBookmarkToReveal(bookmark.id);
            navigateManagement('bookmarks');
          }}
          onDeleteBookmark={handleDeleteBookmark}
          onMoveToFolder={handleMoveToFolder}
          onShowToast={showToast}
          onAddMoreBookmarks={fId => {
            setQuickAddFolderId(fId);
            setQuickAddInitialUrl(undefined);
            setIsQuickAddOpen(true);
          }}
        />
      )}

      {/* Quick Add Bookmark Modal (Cmd+N) */}
      {isQuickAddOpen && (
        <QuickAddModal
          onboarding={taskContext?.task === 'add' ? taskContext : undefined}
          defaultPinToDesktop={taskContext?.task === 'add' ? false : undefined}
          isOpen={isQuickAddOpen}
          onClose={() => {
            setIsQuickAddOpen(false); setQuickAddDesktopFolderId(null);
            if (taskContext?.task === 'add') onboarding.cancelTask();
          }}
          folders={folders}
          existingBookmarks={bookmarks}
          language={settings.language}
          initialUrl={quickAddInitialUrl}
          initialFolderId={quickAddFolderId}
          desktopFolderName={desktopLayout?.folders.find(folder => folder.id === quickAddDesktopFolderId)?.name}
          onSaveBookmark={handleSaveQuickAdd}
          onOpenExisting={bm => {
            onboarding.cancelTask();
            setIsQuickAddOpen(false);
            handleOpenBookmark(bm);
          }}
          onEditExisting={openBookmarkEditor}
          onCreateFolderInline={(name, parentId) => {
            return mutateLibrary(() => storage.createFolder(name, [], parentId));
          }}
        />
      )}
      {bookmarkToEdit && <BookmarkDialog isOpen bookmark={bookmarkToEdit}
        folders={folders} existingBookmarks={bookmarks} language={settings.language}
        onClose={() => setBookmarkToEdit(null)} onOpenExisting={handleOpenBookmark}
        onEditExisting={setBookmarkToEdit}
        onCreateFolder={(name, parentId) => {
          return mutateLibrary(() => storage.createFolder(name, [], parentId));
        }}
        onSave={async input => {
          await mutateLibrary(() => storage.saveManualBookmark(input, bookmarkToEdit.id));
          showToast('已更新收藏');
        }}
      />}

      {/* Built-in Floating Tools */}
      <CalculatorTool isOpen={isCalculatorOpen} onClose={() => setIsCalculatorOpen(false)} />
      <JsonFormatterTool isOpen={isJsonFormatterOpen} onClose={() => setIsJsonFormatterOpen(false)} />
      <WordCounterTool isOpen={isWordCounterOpen} onClose={() => setIsWordCounterOpen(false)} />

      {/* Toast Notification with Undo */}
      <Toast toast={toast} onClose={() => setToast(null)} />

      {currentTab === 'desktop' && <DesktopGuide language={settings.language}
        open={isGuideOpen} onOpenChange={setIsGuideOpen} onStartOnboarding={startOnboarding} />}
      <DesktopAttribution />

      {/* macOS Reveal Desktop Floating Restore Pill */}
      {isDesktopRevealed && appWindows.some(w => !w.isMinimized) && (
        <div
          onClick={() => setIsDesktopRevealed(false)}
          className="fixed top-14 left-1/2 -translate-x-1/2 z-[800] flex items-center gap-2 px-3.5 py-1.5 rounded-full liquid-glass bg-white/95 dark:bg-[#181d28]/95 border border-sky-400/50 shadow-2xl text-xs font-semibold text-sky-700 dark:text-sky-300 cursor-pointer animate-in fade-in slide-in-from-top-2 duration-200 select-none hover:scale-105 transition-transform"
          title="点击恢复所有窗口显示"
        >
          <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping" />
          <span>已暂时移开窗口显示桌面 · 点击空白处或此条恢复</span>
        </div>
      )}

      {/* Desktop App Windows (Multi-window Floating Web Apps) */}
      {appWindows.map(win => (
        <DesktopWindow
          key={win.id}
          windowData={win}
          isActive={activeWindowId === win.id}
          isPushedAway={isDesktopRevealed}
          onFocus={handleFocusWindow}
          onClose={handleCloseWindow}
          onMinimize={handleMinimizeWindow}
          onMaximize={handleMaximizeWindow}
          onUpdatePosition={handleUpdateWindowPosition}
          onUpdateSize={handleUpdateWindowSize}
          onUpdateUrl={handleUpdateWindowUrl}
        />
      ))}

      {/* Zone 6: Bottom Center macOS Dock (Pinned Quick-Launch Bookmarks & Direct Popup Plugins) */}
      {settings.showDock !== false && (
        <BottomDock
          onInteractionChange={setDockInteraction}
          showTools={false}
          bookmarks={bookmarks}
          folders={folders}
          dockBookmarkIds={settings.dockBookmarkIds ?? []}
          dockIconSize={settings.dockIconSize}
          onUpdateDockSettings={handleUpdateSettings}
          onToggleDockBookmark={handleToggleDockBookmark}
          activeTool={
            isCalculatorOpen
              ? 'calculator'
              : isJsonFormatterOpen
              ? 'json-formatter'
              : isWordCounterOpen
              ? 'word-counter'
              : null
          }
          openWindows={appWindows}
          activeWindowId={activeWindowId}
          onOpenBookmark={handleOpenBookmark}
          onEditBookmark={openBookmarkEditor}
          desktopBookmarkIds={desktopBookmarkIds}
          onTogglePinDesktop={async bmId => {
            const bookmark = bookmarks.find(item => item.id === bmId);
            if (bookmark) await setDesktopPins([bmId], desktopBookmarkIds.includes(bmId) === false);
          }}
          onManageBookmark={bookmark => {
            setLibraryBookmarkToReveal(bookmark.id);
            navigateManagement('bookmarks');
          }}
          onShowToast={showToast}
          onOpenBookmarkInWindow={handleOpenBookmarkInWindow}
          onFocusWindow={handleFocusWindow}
          onMinimizeWindow={handleMinimizeWindow}
          onRestoreWindow={handleRestoreWindow}
          onCloseWindow={handleCloseWindow}
          onOpenTool={handleOpenTool}
          isLaunchpadOpen={isLaunchpadOpen}
          onToggleLaunchpad={() => { if (isLaunchpadOpen) closeLaunchpad(); else openLaunchpad(); }}
          onQuickAdd={() => {
            setQuickAddInitialUrl(undefined);
            setQuickAddFolderId(undefined);
            setIsQuickAddOpen(true);
          }}
        />
      )}

      {/* macOS Launchpad (应用抽屉 / 启动台) */}
      {isLaunchpadOpen && <React.Suspense fallback={<div role="status" className="fixed inset-0 z-[1200] flex items-center justify-center bg-[var(--desktop-launchpad)] text-sm text-[var(--desktop-text)]">{t('launchpadLoading')}</div>}>
      <Launchpad
        onboarding={taskContext?.task === 'pin' ? taskContext : undefined}
        onRevealDesktop={revealPinnedBookmark}
        isOpen={isLaunchpadOpen}
        browseOnOpen={launchpadBrowse}
        onDeleteBookmark={handleDeleteBookmark}
        onShowToast={showToast}
        onClose={() => {
          closeLaunchpad();
          if (taskContext?.task === 'pin') onboarding.cancelTask();
        }}
        bookmarks={bookmarks}
        folders={folders}
        language={settings.language}
        dockBookmarkIds={settings.dockBookmarkIds ?? []}
        onOpenBookmark={handleOpenBookmark}
        onEditBookmark={openBookmarkEditor}
        onManageBookmark={bookmark => {
          setLibraryBookmarkToReveal(bookmark.id);
          navigateManagement('bookmarks');
        }}
        onTogglePinDesktop={async bmId => {
          const bm = bookmarks.find(b => b.id === bmId);
          if (bm) {
            const pinned = desktopBookmarkIds.includes(bmId);
            await setDesktopPins([bmId], !pinned);
            if (!pinned && taskContext?.task === 'pin') {
              navigate({ page: 'desktop' });
              setRevealDesktopBookmarkId(bmId);
              onboarding.finish('pin', bmId);
            }
            showToast(pinned ? '已从桌面移除快捷方式' : `已固定「${bm.title}」至桌面`);
          }
        }}
        desktopBookmarkIds={desktopBookmarkIds}
        onToggleDockBookmark={handleToggleDockBookmark}
      />
      </React.Suspense>}
      <OnboardingPanel controller={onboarding} language={settings.language} hasBookmarks={bookmarks.length > 0}
        hideResult={!!activeDesktopFolder}
        onStart={startOnboarding} onBackup={() => {
          onboarding.exit();
          navigateManagement('import-export');
          setBackupReveal(true);
        }} />
    </WallpaperBackground>
  );
}

import { actionTerm } from '../common/action-terms';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
  Check, ChevronLeft, ChevronRight, Copy, Edit, ExternalLink, EyeOff,
  Folder as FolderIcon, FolderOpen, FolderPlus, Grid, Library, MoreHorizontal,
  Pin, PinOff, Plus, RefreshCw, Search, Trash2, Wrench, X,
} from 'lucide-react';
import type { Bookmark, DesktopViewMode, Folder, Plugin } from '../../types';
import type { DesktopRef, Layout } from '../../domain/assets/model';
import type { AssetAction } from '../../domain/assets/commands';
import { FaviconImage } from '../common/FaviconImage';
import { preferenceSaveError } from '../../services/preference-save-error';
import { commitAndRefresh } from '../../services/library-mutation';
import { BookmarkDialog } from '../common/BookmarkDialog';
import { storage } from '../../services/storage';
import { refreshSiteIcon } from '../../services/site-icons';
import { calculateDesktopGrid, DESKTOP_MIN_CELL_SIZE, desktopDropIntent, desktopInsertionIndex, paginateDesktopItems, positionDesktopMenu } from './desktop-layout';
import { DesktopIconLabel } from './DesktopIconLabel';
import { MenuActionLabel } from '../common/MenuActionLabel';
import { bookmarkLibraryPath } from '../common/folder-tree';
import { createDesktopGesture, createWheelGesture, rubberBand, WHEEL_GESTURE_IDLE_MS } from './desktop-gestures';
import { LaunchpadMark } from '../common/LaunchpadMark';
import './desktop-touch.css';
import { desktopPageKeyStep } from './desktop-keyboard';
import { DesktopConfirmPopover, type DesktopConfirmation } from './DesktopConfirmPopover';
import { DesktopCreateFolderDialog } from './DesktopCreateFolderDialog';
import { FOLDER_DRAG_START, FOLDER_DRAG_CANCEL, finishFolderDrag, type FolderDragStart } from './desktop-drag-transfer';

type DesktopAction = Extract<AssetAction, { type: `desktop.${string}` }>;
type FolderDisplay = Pick<Folder, 'id' | 'name' | 'bookmarkIds'>;

interface DesktopViewProps {
  bookmarks: Bookmark[];
  folders: Folder[];
  plugins: Plugin[];
  viewMode: DesktopViewMode;
  dockBookmarkIds?: string[];
  onChangeViewMode: (mode: DesktopViewMode) => void;
  onOpenBookmark: (bookmark: Bookmark) => void;
  onOpenTool: (type: 'calculator' | 'json-formatter' | 'word-counter') => void;
  onQuickAdd: () => void;
  onUnpinFromDesktop: (id: string) => void;
  onToggleDockBookmark?: (id: string) => void;
  onDeleteBookmark?: (id: string) => void;
  onShowToast?: (message: string) => void;
  onOpenLaunchpad?: (browse?: boolean) => void;
  onOpenSearch?: () => void;
  onOpenLibrary?: () => void;
  onRevealBookmark?: (bookmark: Bookmark) => void;
  onLibraryChanged?: () => void;
  showDock?: boolean;
  language?: string;
  desktopLayout?: Layout | null;
  onDesktopAction?: (actions: DesktopAction[]) => void | Promise<void>;
  onOpenDesktopFolder?: (id: string) => void;
  onInteractionChange?: (active: boolean) => void;
  interactionBlocked?: boolean;
  revealBookmarkId?: string;
}

type DesktopItem =
  | { type: 'folder'; data: FolderDisplay }
  | { type: 'bookmark'; data: Bookmark }
  | { type: 'tool'; data: Plugin };
type MenuTarget = DesktopItem | { type: 'background' };
type DropTarget = { slot: number; mergeId: string | null };

const controlClass = 'inline-flex items-center justify-center gap-1.5 min-h-8 px-2.5 rounded-lg text-xs font-medium cursor-pointer hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-500';

export const DesktopView: React.FC<DesktopViewProps> = ({
  bookmarks, folders, plugins, viewMode, onChangeViewMode, dockBookmarkIds,
  onOpenBookmark, onOpenTool, onQuickAdd,
  onToggleDockBookmark, onDeleteBookmark,
  onShowToast, onOpenLaunchpad, onOpenSearch, onOpenLibrary, onRevealBookmark, onLibraryChanged,
  showDock = true, language = 'zh',
  desktopLayout, onDesktopAction, onOpenDesktopFolder, onInteractionChange, interactionBlocked, revealBookmarkId,
}) => {
  const en = language === 'en';
  const text = (zh: string, english: string) => en ? english : zh;
  const [isEditing, setIsEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 960, height: 348 });
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLElement | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 12, top: 12, maxHeight: 400 });
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [editError, setEditError] = useState('');
  const [editingFolder, setEditingFolder] = useState<FolderDisplay | null>(null);
  const [folderName, setFolderName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState<string[] | null>(null);
  const [operationError, setOperationError] = useState('');
  const [moveBookmark, setMoveBookmark] = useState<Bookmark | null>(null);
  const [moveFolderId, setMoveFolderId] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const draggedIdRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const mergeCandidate = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  const dragImageRef = useRef<HTMLDivElement>(null);
  const [activeEdge, setActiveEdge] = useState<'left' | 'right' | null>(null);
  const edgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edgeCooldown = useRef(0);
  const edgeTargetPage = useRef<number | null>(null);
  const gesture = useRef<ReturnType<typeof createDesktopGesture> | null>(null);
  const [touchFeedback, setTouchFeedback] = useState({ offsetY: 0, progress: 0, tracking: false, target: 'launchpad' });
  const [dragOffset, setDragOffset] = useState(0);
  const [pagingReady, setPagingReady] = useState<'previous' | 'next' | null>(null);
  const pagingFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelGesture = useRef(createWheelGesture());
  const wheelEnd = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wheeling, setWheeling] = useState(false);
  const externalDrag = useRef(false);
  const [confirmation, setConfirmation] = useState<DesktopConfirmation | null>(null);

  // Legacy category/list preferences render as icons without changing bookmark data.
  useEffect(() => {
    if (viewMode !== 'icon') onChangeViewMode('icon');
  }, [viewMode, onChangeViewMode]);

  const dockInset = useCallback(() => {
    const dock = showDock ? document.querySelector('[data-testid="bottom-dock"]') : null;
    return dock ? window.innerHeight - dock.getBoundingClientRect().top + 12 : showDock ? 100 : 16;
  }, [showDock]);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const next = { width: rect.width, height: Math.max(DESKTOP_MIN_CELL_SIZE, Math.floor(window.innerHeight - rect.top - dockInset() - 48)) };
      setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    const header = document.querySelector('header');
    if (header) observer.observe(header);
    const dock = document.querySelector('[data-testid="bottom-dock"]');
    if (dock) observer.observe(dock);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [dockInset]);

  const grid = calculateDesktopGrid(size.width, size.height);
  const effectiveDockIds = dockBookmarkIds ?? [];
  const items: DesktopItem[] = [
    ...(desktopLayout?.root ?? []).flatMap<DesktopItem>(ref => {
      if (!desktopLayout) return [];
      if (ref.kind === 'desktop-folder') {
        const folder = desktopLayout.folders.find(folder => folder.id === ref.id);
        return folder ? [{ type: 'folder', data: {
          id: folder.id, name: folder.name, bookmarkIds: folder.shortcutIds.flatMap(id => {
            const shortcut = desktopLayout.shortcuts.find(shortcut => shortcut.id === id);
            return shortcut ? [shortcut.bookmarkId] : [];
          }),
        } }] : [];
      }
      const shortcut = desktopLayout.shortcuts.find(shortcut => shortcut.id === ref.id);
      const bookmark = bookmarks.find(bookmark => bookmark.id === shortcut?.bookmarkId);
      return bookmark ? [{ type: 'bookmark', data: bookmark }] : [];
    }),
    ...plugins.filter(tool => tool.installed && tool.pinnedToDesktop && tool.isBuiltInTool)
      .map(data => ({ type: 'tool' as const, data })),
  ];
  const refForId = (id: string): DesktopRef | null => {
    const shortcut = desktopLayout?.shortcuts.find(shortcut => shortcut.bookmarkId === id);
    if (shortcut) return { kind: 'shortcut', id: shortcut.id };
    return desktopLayout?.folders.some(folder => folder.id === id) ? { kind: 'desktop-folder', id } : null;
  };
  const sameRef = (a: DesktopRef, b: DesktopRef) => a.kind === b.kind && a.id === b.id;
  const desktopError = (cause: unknown) => {
    if (cause instanceof Error && cause.message === 'DESKTOP_ACTION_UNAVAILABLE') {
      return text('桌面保存暂不可用，本次未修改桌面。请刷新后检查。',
        'Desktop saving is unavailable. The desktop was not changed. Refresh and check.');
    }
    return preferenceSaveError(cause, language, 'library');
  };
  const requireDesktopAction = () => {
    if (!desktopLayout || !onDesktopAction) throw new Error('DESKTOP_ACTION_UNAVAILABLE');
    return { layout: desktopLayout, apply: onDesktopAction };
  };
  const execute = async (actions: DesktopAction[]) => {
    try {
      await requireDesktopAction().apply(actions);
      setOperationError('');
    } catch (cause) {
      setOperationError(desktopError(cause));
      throw cause;
    }
  };
  const safely = async (action: () => void | Promise<void>) => {
    try { await action(); } catch (error) { setOperationError(desktopError(error)); }
  };
  const pages = paginateDesktopItems(items, grid.pageSize);
  const totalPages = pages.length;
  const pageIndex = Math.min(currentPage, totalPages - 1);
  useEffect(() => {
    const index = items.findIndex(item => item.type === 'bookmark' && item.data.id === revealBookmarkId);
    if (index >= 0) setCurrentPage(Math.floor(index / grid.pageSize));
  }, [revealBookmarkId, grid.pageSize, desktopLayout]);
  useEffect(() => {
    if (!revealBookmarkId) return;
    const target = viewportRef.current?.querySelector<HTMLElement>(`[data-desktop-id="${CSS.escape(revealBookmarkId)}"]`);
    if (target && !target.closest('[inert]')) target.focus({ preventScroll: true });
  }, [revealBookmarkId, pageIndex]);
  useEffect(() => {
    onInteractionChange?.(!!menu || !!editingBookmark || !!editingFolder || creatingGroup !== null || !!moveBookmark || isEditing);
  }, [menu, editingBookmark, editingFolder, creatingGroup, moveBookmark, isEditing, onInteractionChange]);
  useEffect(() => () => onInteractionChange?.(false), [onInteractionChange]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const step = desktopPageKeyStep(event, interactionBlocked || isEditing || !!draggedId || !!menu || !!gesture.current);
      if (!step || totalPages <= 1) return;
      const controls = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),'
        + '[role="textbox"],[role="combobox"],[role="slider"],[role="spinbutton"],'
        + '[role="listbox"],[role="tree"],[role="tablist"],iframe,video,audio';
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(controls) || document.activeElement?.closest(controls)) return;
      const overlay = [...document.querySelectorAll<HTMLElement>(
        '[role="dialog"],[role="alertdialog"],[aria-modal="true"],[role="menu"],.desktop-window',
      )].some(element => {
        if (element.closest('[hidden],[inert],[aria-hidden="true"]') || !element.getClientRects().length) return false;
        const style = getComputedStyle(element);
        return style.visibility !== 'hidden' && (!element.matches('.desktop-window') || style.pointerEvents !== 'none');
      });
      if (overlay) return;
      event.preventDefault();
      setCurrentPage(page => Math.max(0, Math.min(totalPages - 1, page + step)));
      if (wheelEnd.current) clearTimeout(wheelEnd.current);
      setWheeling(false);
      setDragOffset(0);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [totalPages, isEditing, draggedId, menu, interactionBlocked]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const surface = viewport.closest('[data-desktop-surface]') ?? viewport;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      if ((event.target as Element).closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"],.desktop-window')) return;
      if (event.cancelable) event.preventDefault();
      if (isEditing || draggedId || menu || gesture.current) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.width : 1;
      const result = wheelGesture.current.update(event.deltaX * unit, event.deltaY * unit, performance.now());
      if (wheelEnd.current) clearTimeout(wheelEnd.current);
      if (result.step) {
        const next = Math.max(0, Math.min(totalPages - 1, pageIndex + result.step));
        setWheeling(false);
        if (next !== pageIndex) {
          setDragOffset(0);
          setCurrentPage(next);
        } else {
          setDragOffset(rubberBand(-result.step * 100, size.width));
        }
      } else if (result.offset) {
        const edge = (pageIndex === 0 && result.offset > 0) || (pageIndex === totalPages - 1 && result.offset < 0);
        setWheeling(true);
        setDragOffset(edge ? rubberBand(result.offset, size.width) : result.offset * 0.85);
      }
      wheelEnd.current = setTimeout(() => {
        setWheeling(false);
        setDragOffset(0);
      }, WHEEL_GESTURE_IDLE_MS);
    };
    surface.addEventListener('wheel', wheel as EventListener, { passive: false });
    return () => surface.removeEventListener('wheel', wheel as EventListener);
  }, [isEditing, draggedId, menu, pageIndex, totalPages, size.width]);
  useEffect(() => () => { if (wheelEnd.current) clearTimeout(wheelEnd.current); }, []);
  useEffect(() => { setCurrentPage(page => Math.min(page, totalPages - 1)); }, [totalPages]);
  useEffect(() => {
    setSelectedIds(ids => ids.filter(id => desktopLayout?.shortcuts.some(shortcut => shortcut.bookmarkId === id)));
  }, [bookmarks, desktopLayout]);

  const closeMenu = useCallback(() => {
    setMenu(null);
    menuTriggerRef.current?.focus({ preventScroll: true });
  }, []);
  const openMenu = (event: React.MouseEvent, target: MenuTarget) => {
    event.preventDefault();
    event.stopPropagation();
    menuTriggerRef.current = event.currentTarget as HTMLElement;
    setMenu({ x: event.clientX, y: event.clientY, target });
  };
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const element = menuRef.current;
    setMenuPosition(positionDesktopMenu({
      x: menu.x, y: menu.y, width: element.offsetWidth, height: element.scrollHeight,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, bottomInset: dockInset(),
    }));
    element.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [menu, dockInset]);
  useEffect(() => {
    if (!menu) return;
    const pointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); }
    };
    const dismiss = () => setMenu(null);
    const scroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) dismiss();
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [menu, closeMenu]);

  const cancelMerge = useCallback(() => {
    if (mergeCandidate.current) clearTimeout(mergeCandidate.current.timer);
    mergeCandidate.current = null;
  }, []);
  const showDropTarget = useCallback((next: DropTarget | null) => {
    if (dropTargetRef.current?.slot === next?.slot && dropTargetRef.current?.mergeId === next?.mergeId) return;
    dropTargetRef.current = next;
    setDropTarget(next);
  }, []);
  const clearDrag = useCallback(() => {
    if (externalDrag.current) {
      externalDrag.current = false;
      finishFolderDrag(false);
    }
    cancelMerge();
    draggedIdRef.current = null;
    setDraggedId(null);
    setDragPoint(null);
    showDropTarget(null);
    setActiveEdge(null);
    if (edgeTimer.current) clearTimeout(edgeTimer.current);
    edgeTimer.current = null;
    edgeTargetPage.current = null;
  }, [cancelMerge, showDropTarget]);
  useEffect(() => {
    const begin = (event: Event) => {
      const detail = (event as CustomEvent<FolderDragStart>).detail;
      externalDrag.current = true;
      draggedIdRef.current = detail.bookmarkId;
      setDraggedId(detail.bookmarkId);
      setDragPoint({ x: detail.x, y: detail.y });
      gesture.current = null;
      setDragOffset(0);
      if (pagingFeedbackTimer.current) clearTimeout(pagingFeedbackTimer.current);
      setPagingReady(null);
    };
    const end = () => clearDrag();
    window.addEventListener(FOLDER_DRAG_START, begin);
    window.addEventListener(FOLDER_DRAG_CANCEL, end);
    document.addEventListener('dragend', end);
    return () => {
      window.removeEventListener(FOLDER_DRAG_START, begin);
      window.removeEventListener(FOLDER_DRAG_CANCEL, end);
      document.removeEventListener('dragend', end);
    };
  }, [clearDrag]);
  const completeDrag = () => {
    if (externalDrag.current) {
      externalDrag.current = false;
      finishFolderDrag(true);
    }
    clearDrag();
  };
  const failDrag = (cause: unknown) => {
    const message = desktopError(cause);
    if (externalDrag.current) {
      externalDrag.current = false;
      finishFolderDrag(false, message);
    } else setOperationError(message);
    clearDrag();
  };
  useEffect(() => () => {
    if (edgeTimer.current) clearTimeout(edgeTimer.current);
    cancelMerge();
  }, [cancelMerge]);
  useEffect(() => {
    if (!draggedId) return;
    const follow = (event: DragEvent) => {
      setDragPoint({ x: event.clientX, y: event.clientY });
      if (!(event.target as Element).closest('[data-testid="desktop-grid"]')) {
        cancelMerge();
        showDropTarget(null);
      }
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') clearDrag(); };
    document.addEventListener('dragover', follow, true);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', clearDrag);
    return () => {
      document.removeEventListener('dragover', follow, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', clearDrag);
    };
  }, [draggedId, cancelMerge, showDropTarget, clearDrag]);
  const createGroup = (ids: string[]) => {
    requireDesktopAction();
    setCreatingGroup([...ids]);
  };
  const saveGroup = async (name: string) => {
    if (!desktopLayout || creatingGroup === null) throw new Error('CONFLICT');
    const shortcutIds = creatingGroup.map(id => desktopLayout.shortcuts.find(shortcut => shortcut.bookmarkId === id)?.id).filter((id): id is string => !!id);
    const selected = new Set(shortcutIds);
    const first = desktopLayout.root.findIndex(ref => ref.kind === 'shortcut' && selected.has(ref.id));
    await execute([{ type: 'desktop.folder.create', id: crypto.randomUUID(), name, shortcutIds, index: Math.max(0, first) }]);
    setSelectedIds([]);
    setIsEditing(false);
  };
  const dropOnPage = async (index: number) => {
    const sourceId = draggedIdRef.current;
    if (!sourceId) return;
    try {
      const { layout } = requireDesktopAction();
      const ref = refForId(sourceId);
      if (!ref) return clearDrag();
      await execute([{ type: 'desktop.move', ref, to: {
        kind: 'root', index: Math.min(index * grid.pageSize, layout.root.length - (externalDrag.current ? 0 : 1)),
      } }]);
      completeDrag();
    } catch (error) { failDrag(error); }
  };
  const dragOverGrid = (event: React.DragEvent, index: number) => {
    if (!draggedIdRef.current || !desktopLayout) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const intent = desktopDropIntent({
      x: event.clientX - rect.left, y: event.clientY - rect.top,
      columns: grid.columns, cellSize: grid.cellSize, count: pages[index].length,
    });
    const slot = Math.min(desktopLayout.root.length, index * grid.pageSize + intent.slot);
    const item = intent.center === null ? null : pages[index][intent.center];
    const source = refForId(draggedIdRef.current);
    const candidate = item && item.type !== 'tool' && item.data.id !== draggedIdRef.current
      && source?.kind === 'shortcut' ? item.data.id : null;
    if (candidate && mergeCandidate.current?.id === candidate) {
      if (!dropTargetRef.current?.mergeId) showDropTarget({ slot, mergeId: null });
      return;
    }
    cancelMerge();
    showDropTarget({ slot, mergeId: null });
    if (candidate) {
      mergeCandidate.current = { id: candidate, timer: setTimeout(() => {
        showDropTarget({ slot, mergeId: candidate });
      }, 450) };
    }
  };
  const dropOnGrid = async (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = draggedIdRef.current;
    const destination = dropTargetRef.current;
    if (!sourceId || !destination) return clearDrag();
    try {
      const { layout } = requireDesktopAction();
      const source = refForId(sourceId);
      if (!source) return clearDrag();
      const item = destination.mergeId ? items.find(item => item.data.id === destination.mergeId) : null;
      const target = item ? refForId(item.data.id) : null;
      if (source.kind === 'shortcut' && item?.type === 'folder') {
        await execute([{ type: 'desktop.move', ref: source, to: { kind: 'folder', folderId: item.data.id, index: item.data.bookmarkIds.length } }]);
      } else if (source.kind === 'shortcut' && target?.kind === 'shortcut' && item?.type === 'bookmark') {
        const selected = new Set([source.id, target.id]);
        const targetIndex = layout.root.findIndex(ref => sameRef(ref, target));
        const index = layout.root.slice(0, targetIndex).filter(ref => !(ref.kind === 'shortcut' && selected.has(ref.id))).length;
        await execute([{ type: 'desktop.folder.create', id: crypto.randomUUID(), name: `${item.data.title}等`, shortcutIds: [target.id, source.id], index }]);
      } else {
        const sourceIndex = layout.root.findIndex(ref => sameRef(ref, source));
        const index = desktopInsertionIndex(sourceIndex, destination.slot, layout.root.length);
        if (index !== sourceIndex) await execute([{ type: 'desktop.move', ref: source, to: { kind: 'root', index } }]);
      }
      completeDrag();
    } catch (error) { failDrag(error); }
  };
  const leaveEdge = () => {
    if (edgeTimer.current) clearTimeout(edgeTimer.current);
    edgeTimer.current = null;
    edgeTargetPage.current = null;
    setActiveEdge(null);
  };
  const overEdge = (direction: 'left' | 'right') => {
    if (!draggedIdRef.current || edgeTimer.current || Date.now() < edgeCooldown.current) return;
    setActiveEdge(direction);
    edgeTargetPage.current = Math.max(0, Math.min(totalPages - 1, pageIndex + (direction === 'left' ? -1 : 1)));
    edgeTimer.current = setTimeout(() => {
      if (edgeTargetPage.current !== null) setCurrentPage(edgeTargetPage.current);
      edgeTimer.current = null;
      edgeCooldown.current = Date.now() + 700;
    }, 280);
  };
  const startGesture = (x: number, y: number, target: EventTarget, touch: boolean, now: number) => {
    const element = target instanceof Element ? target : null;
    if (interactionBlocked || isEditing || draggedId || menu || document.querySelector('[role="dialog"],[aria-modal="true"]')
      || !element || element.closest('button,a,input,select,textarea,[contenteditable="true"],[role="menu"],[role="dialog"],.desktop-window')
      || (element.closest('[role="button"]') && !(touch && element.closest('.desktop-item')))) return;
    if (wheelEnd.current) clearTimeout(wheelEnd.current);
    setWheeling(false);
    gesture.current = createDesktopGesture({ x, y, now, touch, width: size.width, height: window.innerHeight });
  };
  const resetTouchFeedback = () => {
    setTouchFeedback(previous => ({ ...previous, offsetY: 0, progress: 0, tracking: false }));
    if (pagingFeedbackTimer.current) clearTimeout(pagingFeedbackTimer.current);
    pagingFeedbackTimer.current = null;
    setPagingReady(null);
  };
  const updatePagingFeedback = (value: ReturnType<typeof createDesktopGesture>, now: number) => {
    if (pagingFeedbackTimer.current) clearTimeout(pagingFeedbackTimer.current);
    pagingFeedbackTimer.current = null;
    const action = value.touch ? null : value.finish(now);
    const ready = action === 'previous' && pageIndex > 0 ? action
      : action === 'next' && pageIndex < totalPages - 1 ? action : null;
    setPagingReady(ready);
    if (ready && Math.abs(value.dx) < 28) {
      // Short-flick readiness expires even if the pointer stops sending events.
      const scheduledAt = performance.now();
      pagingFeedbackTimer.current = setTimeout(() => {
        if (gesture.current === value) updatePagingFeedback(value, now + performance.now() - scheduledAt);
      }, 16);
    }
  };
  const moveGesture = (x: number, y: number, now: number) => {
    if (!gesture.current) return;
    const start = gesture.current;
    start.update(x, y, now);
    if (start.axis === 'y') setTouchFeedback({
      offsetY: start.offsetY, progress: start.progress, tracking: true,
      target: start.dy < 0 ? 'launchpad' : 'search',
    });
    else if (!start.touch) resetTouchFeedback();
    updatePagingFeedback(start, now);
    if (start.axis === 'x') {
      const atEdge = (pageIndex === 0 && start.dx > 0) || (pageIndex === totalPages - 1 && start.dx < 0);
      setDragOffset(atEdge ? rubberBand(start.dx, size.width)
        : Math.sign(start.dx) * Math.min(Math.abs(start.dx) * 0.85, size.width * 0.9));
    }
    else if (!start.touch) setDragOffset(0);
  };
  const endGesture = (x: number, y: number, now: number) => {
    const value = gesture.current;
    if (!value) return;
    const action = value.finish(now, { x, y });
    gesture.current = null;
    setDragOffset(0);
    resetTouchFeedback();
    if (action === 'launchpad') onOpenLaunchpad?.(value.touch);
    else if (action === 'search') {
      // Mount and focus during the release event, not a later timer.
      if (value.touch) flushSync(() => onOpenSearch?.());
      else onOpenSearch?.();
    } else if (action) setCurrentPage(page => Math.max(0, Math.min(totalPages - 1, page + (action === 'next' ? 1 : -1))));
  };
  const gestureHandlers = useRef({ start: startGesture, move: moveGesture, end: endGesture });
  gestureHandlers.current = { start: startGesture, move: moveGesture, end: endGesture };
  useEffect(() => {
    const surface = viewportRef.current?.closest<HTMLElement>('[data-desktop-surface]');
    if (!surface) return;
    let pointer: number | null = null;
    let suppressClick = false;
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      suppressClick = false;
      gestureHandlers.current.start(event.clientX, event.clientY, event.target!, event.pointerType === 'touch', event.timeStamp);
      if (gesture.current) {
        pointer = event.pointerId;
        // Keep taps and long presses on their original icon until a swipe has intent.
        if (event.pointerType !== 'touch') surface.setPointerCapture(pointer);
      }
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      gestureHandlers.current.move(event.clientX, event.clientY, event.timeStamp);
      if (gesture.current?.touch && gesture.current.axis) {
        suppressClick = true;
        event.preventDefault();
        if (!surface.hasPointerCapture(event.pointerId)) surface.setPointerCapture(event.pointerId);
      }
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      pointer = null;
      gestureHandlers.current.end(event.clientX, event.clientY, event.timeStamp);
      if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    };
    const cancel = () => {
      const captured = pointer;
      pointer = null;
      gesture.current = null;
      setDragOffset(0);
      resetTouchFeedback();
      if (captured !== null && surface.hasPointerCapture(captured)) surface.releasePointerCapture(captured);
    };
    const additionalPointer = (event: PointerEvent) => { if (!event.isPrimary) cancel(); };
    const lostCapture = (event: PointerEvent) => {
      if (event.target === surface && event.pointerId === pointer && !surface.hasPointerCapture(event.pointerId)) cancel();
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const visibility = () => { if (document.hidden) cancel(); };
    surface.addEventListener('pointerdown', down);
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', up);
    surface.addEventListener('pointercancel', cancel);
    surface.addEventListener('lostpointercapture', lostCapture);
    surface.addEventListener('contextmenu', cancel);
    surface.addEventListener('click', click, true);
    document.addEventListener('pointerdown', additionalPointer, true);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    return () => {
      surface.removeEventListener('pointerdown', down);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', up);
      surface.removeEventListener('pointercancel', cancel);
      surface.removeEventListener('lostpointercapture', lostCapture);
      surface.removeEventListener('contextmenu', cancel);
      surface.removeEventListener('click', click, true);
      document.removeEventListener('pointerdown', additionalPointer, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      if (pagingFeedbackTimer.current) clearTimeout(pagingFeedbackTimer.current);
      if (pointer !== null && surface.hasPointerCapture(pointer)) surface.releasePointerCapture(pointer);
    };
  }, []);
  const openItem = (item: DesktopItem) => {
    if (item.type === 'bookmark') {
      if (isEditing) setSelectedIds(ids => ids.includes(item.data.id) ? ids.filter(id => id !== item.data.id) : [...ids, item.data.id]);
      else onOpenBookmark(item.data);
    } else if (item.type === 'folder') {
      if (desktopLayout) onOpenDesktopFolder?.(item.data.id);
    }
    else if (item.data.toolType) onOpenTool(item.data.toolType);
  };
  const editBookmark = (bookmark: Bookmark) => {
    setEditingBookmark(bookmark);
    setEditError('');
  };
  const menuAction = (label: string, Icon: React.ComponentType<{ size?: number }>, action: () => void | Promise<void>, danger = false, detail?: string) => (
    <button role="menuitem" aria-label={label}
      className={`flex items-center gap-2.5 w-full min-h-9 px-2.5 py-1.5 rounded-md text-left text-xs cursor-pointer focus:outline-none focus:bg-sky-500/15 hover:bg-sky-500/15 ${danger ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'}`}
      onClick={async () => {
        closeMenu();
        try { await action(); } catch (error) { setOperationError(desktopError(error)); }
      }}>
      <span className="shrink-0"><Icon size={15} /></span><MenuActionLabel label={label} detail={detail} />
    </button>
  );
  const separator = <div role="separator" className="my-1 border-t border-black/10 dark:border-white/10" />;
  const menuBookmark = menu?.target.type === 'bookmark' ? menu.target.data : null;
  const menuFolder = menu?.target.type === 'folder' ? menu.target.data : null;
  const menuTool = menu?.target.type === 'tool' ? menu.target.data : null;
  const draggedBookmark = bookmarks.find(bookmark => bookmark.id === draggedId);
  const draggedItem = items.find(item => item.data.id === draggedId)
    ?? (draggedBookmark ? { type: 'bookmark' as const, data: draggedBookmark } : undefined);
  const sourceIndex = items.findIndex(item => item.data.id === draggedId);
  const insertionSlot = dropTarget && !dropTarget.mergeId && desktopLayout
    && desktopInsertionIndex(sourceIndex, dropTarget.slot, desktopLayout.root.length) !== sourceIndex
    ? dropTarget.slot : null;
  const renderIcon = (item: DesktopItem) => {
    if (item.type === 'bookmark') return <FaviconImage url={item.data.url} title={item.data.title} showTitle={false}
      icon={item.data.icon} iconMode={item.data.iconMode} iconBg={item.data.iconBg} size="lg" className="w-full h-full" />;
    if (item.type === 'tool') return <div className="w-full h-full rounded-2xl liquid-glass flex items-center justify-center text-emerald-600 dark:text-emerald-300"><Wrench size={26} /></div>;
    const children = item.data.bookmarkIds.map(id => bookmarks.find(bookmark => bookmark.id === id))
      .filter((bookmark): bookmark is Bookmark => !!bookmark).slice(0, 4);
    return <div className="desktop-folder-icon grid grid-cols-2 grid-rows-2 gap-1.5 w-full h-full p-2 rounded-2xl bg-[var(--desktop-panel)] border border-[var(--desktop-border)] shadow-sm">
      {children.map(bookmark => <FaviconImage key={bookmark.id} url={bookmark.url} title={bookmark.title} showTitle={false}
        icon={bookmark.icon} iconMode={bookmark.iconMode} size="sm" className="w-full h-full" />)}
      {children.length === 0 && <FolderIcon size={28} className="col-span-2 row-span-2 place-self-center text-slate-500" />}
    </div>;
  };

  return (
    <div data-desktop-editing={isEditing || undefined} className="desktop-stage relative w-full max-w-6xl mx-auto px-3 sm:px-8 py-2 select-none" style={{ letterSpacing: 0 }}>
      <div ref={dragImageRef} aria-hidden="true" className="fixed left-0 top-0 w-px h-px pointer-events-none" />
      {draggedItem && dragPoint && createPortal(
        <div data-testid="desktop-drag-preview" aria-hidden="true" className="desktop-drag-preview"
          style={{ left: Math.max(0, Math.min(innerWidth - 104, dragPoint.x - 52)), top: Math.max(0, Math.min(innerHeight - 104, dragPoint.y - 36)) }}>
          <div className="desktop-drag-preview-icon">{renderIcon(draggedItem)}</div>
          <DesktopIconLabel name={draggedItem.type === 'bookmark' ? draggedItem.data.title : draggedItem.data.name} disabled />
        </div>, document.body)}
      {operationError && <div role="alert" className="flex justify-between gap-2 text-xs text-rose-600 dark:text-rose-300 mb-3">
        {operationError}<button title={text('关闭提示', 'Dismiss')} onClick={() => setOperationError('')}><X size={14} /></button>
      </div>}
      {creatingGroup !== null && createPortal(<DesktopCreateFolderDialog language={language}
        shortcutCount={creatingGroup.length} onCreate={saveGroup} onClose={() => setCreatingGroup(null)} />, document.body)}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 min-h-9">
        <div className="desktop-wallpaper-heading flex items-center gap-2 text-xs">
          <Grid size={14} /><span className="font-semibold">{text('我的桌面', 'My desktop')}</span>
          <span className="tabular-nums opacity-65">{items.length}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 liquid-glass rounded-lg border border-white/40 p-0.5 text-[var(--desktop-text)]">
          {isEditing && selectedIds.length > 0 && <>
            <button className={controlClass} onClick={() => safely(() => createGroup(selectedIds))} title={text('成组为文件夹', 'Group in folder')}><FolderPlus size={14} /><span>{selectedIds.length}</span></button>
            <button className={`${controlClass} text-rose-600`} title={text('移除选中的桌面快捷方式', 'Remove selected shortcuts')} onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect();
              setConfirmation({
                x: rect.left, y: rect.bottom, title: actionTerm('removeDesktop', language),
                message: text(`移除 ${selectedIds.length} 个桌面快捷方式？原收藏和归档目录保持不变。`, `Remove ${selectedIds.length} desktop shortcuts? Library bookmarks are kept.`),
                label: text('确认移除快捷方式', 'Confirm shortcut removal'),
                action: async () => {
                  await execute(selectedIds.map(bookmarkId => ({ type: 'desktop.unpin', bookmarkId })));
                  setSelectedIds([]);
                },
              });
            }}><EyeOff size={14} /></button>
          </>}
          <button className={controlClass} onClick={onQuickAdd} title={actionTerm('add', language)}><Plus size={14} /></button>
          <button className={controlClass} title={text('新建桌面文件夹', 'New desktop folder')} onClick={() => safely(() => createGroup([]))}><FolderPlus size={14} /></button>
          <button className={controlClass} onClick={() => safely(() => {
            requireDesktopAction();
            setIsEditing(!isEditing); setSelectedIds([]);
          })}>
            {isEditing ? <Check size={14} /> : <Edit size={14} />}<span>{isEditing ? text('完成编辑', 'Done') : text('编辑桌面', 'Edit desktop')}</span>
          </button>
        </div>
      </div>
      <div ref={viewportRef} data-onboarding="desktop" data-testid="desktop-viewport" tabIndex={0} aria-label={text('桌面图标区域', 'Desktop icons')}
        className="relative overflow-hidden w-full touch-none overscroll-x-none outline-none" style={{ height: size.height }}
        onContextMenu={event => openMenu(event, { type: 'background' })}>
        <div className="desktop-gesture-track flex h-full items-start" style={{
          transform: `translate3d(calc(-${pageIndex * 100}% + ${dragOffset}px), ${window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : touchFeedback.offsetY}px, 0)`,
          opacity: 1 - touchFeedback.progress * 0.12,
          transition: gesture.current || wheeling ? 'none' : window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'none' : 'transform 220ms cubic-bezier(0.22,1,0.36,1), opacity 180ms ease-out',
        }}>
          {pages.map((pageItems, index) => (
            <div key={index} data-active={index === pageIndex} aria-hidden={index !== pageIndex} inert={index !== pageIndex}
              className="w-full h-full shrink-0">
              <div data-testid="desktop-grid" data-page-size={grid.pageSize} className="relative grid w-full h-full justify-items-center content-start"
                onDragOver={event => dragOverGrid(event, index)} onDrop={dropOnGrid}
                style={{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`, gridAutoRows: grid.cellSize }}>
                {pageItems.map((item, itemIndex) => {
                  const id = item.data.id;
                  const name = item.type === 'bookmark' ? item.data.title : item.data.name;
                  const selected = selectedIds.includes(id);
                  const merging = dropTarget?.mergeId === id;
                  const localSlot = insertionSlot === null ? -1 : insertionSlot - index * grid.pageSize;
                  const slotRow = Math.min(grid.rows - 1, Math.floor(localSlot / grid.columns));
                  const sameRow = Math.floor(itemIndex / grid.columns) === slotRow;
                  const shiftSize = localSlot % grid.columns === 0 ? 40 : 24;
                  const shift = localSlot >= 0 && localSlot <= pageItems.length && sameRow && id !== draggedId
                    ? itemIndex === localSlot ? shiftSize : itemIndex === localSlot - 1 ? -shiftSize : 0 : 0;
                  return (
                    <div key={id} className="group/item relative w-full min-w-0 flex justify-center">
                      <div role="button" tabIndex={0} data-desktop-id={id} aria-label={name}
                        data-onboarding-target={revealBookmarkId === id || undefined}
                        aria-pressed={isEditing && item.type === 'bookmark' ? selected : undefined}
                        draggable={item.type !== 'tool' && !isEditing && !!desktopLayout}
                        onDragStart={event => {
                          if (item.type === 'tool' || !desktopLayout) return;
                          gesture.current = null;
                          setDragOffset(0);
                          resetTouchFeedback();
                          event.dataTransfer.setData('text/plain', id);
                          event.dataTransfer.effectAllowed = 'move';
                          if (dragImageRef.current) event.dataTransfer.setDragImage(dragImageRef.current, 0, 0);
                          setDragPoint({ x: event.clientX, y: event.clientY });
                          draggedIdRef.current = id; setDraggedId(id);
                        }}
                        onDragEnd={clearDrag} onClick={() => openItem(item)}
                        data-drop-state={merging ? 'merge' : undefined}
                        style={{ transform: `translateX(${shift}px)` }}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openItem(item); }
                          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                            event.preventDefault();
                            const rect = event.currentTarget.getBoundingClientRect();
                            menuTriggerRef.current = event.currentTarget;
                            setMenu({ x: rect.left + rect.width / 2, y: rect.top + 40, target: item });
                          }
                        }}
                        onContextMenu={event => openMenu(event, item)}
                        className={`desktop-item group relative flex flex-col items-center w-full max-w-[96px] h-[96px] px-1 pt-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sky-500 cursor-pointer ${isEditing && item.type === 'bookmark' ? 'editing-wiggle' : ''} ${draggedId === id ? 'opacity-20' : ''} ${merging || selected ? 'bg-sky-400/20 ring-2 ring-sky-400' : ''}`}>
                        <div className="relative w-16 h-16 shrink-0 transition-transform group-hover:scale-105">
                          {renderIcon(item)}
                          {isEditing && item.type === 'bookmark' && <span className={`absolute -top-1 -left-1 w-5 h-5 rounded-full flex items-center justify-center border border-white/70 ${selected ? 'bg-sky-500 text-white' : 'bg-white/90'}`}>{selected && <Check size={12} />}</span>}
                        </div>
                        <DesktopIconLabel name={name} disabled={index !== pageIndex || !!menu || !!draggedId} />
                      </div>
                      <button title={text(`更多操作：${name}`, `More actions: ${name}`)} aria-label={text(`更多操作：${name}`, `More actions: ${name}`)}
                        className="absolute top-0 right-0 sm:right-1 p-1 rounded-md bg-white/80 dark:bg-black/40 text-slate-600 dark:text-slate-200 hover:bg-white dark:hover:bg-black/60 sm:opacity-0 sm:focus:opacity-100 sm:group-hover/item:opacity-100 cursor-pointer"
                        onClick={event => openMenu(event, item)}><MoreHorizontal size={14} /></button>
                    </div>
                  );
                })}
                {insertionSlot !== null && insertionSlot >= index * grid.pageSize
                  && insertionSlot <= index * grid.pageSize + pageItems.length && (
                  <div data-testid="desktop-drop-slot" role="img" aria-label={text('插入到这里', 'Insert here')}
                    className="desktop-drop-slot" style={{
                      left: Math.max(0, Math.min(size.width - 60,
                        (insertionSlot === (index + 1) * grid.pageSize ? grid.columns
                          : (insertionSlot - index * grid.pageSize) % grid.columns) * grid.cellSize - 30)),
                      top: Math.min(grid.rows - 1, Math.floor((insertionSlot - index * grid.pageSize) / grid.columns)) * grid.cellSize + 4,
                    }}><Plus size={20} /></div>
                )}
                {index === totalPages - 1 && pageItems.length < grid.pageSize && (
                  <button onClick={onQuickAdd} aria-label={actionTerm('add', language)} className="flex flex-col items-center w-full max-w-[96px] h-[96px] px-1 pt-1 cursor-pointer group">
                    <span className="w-16 h-16 rounded-2xl border border-dashed border-slate-500/60 dark:border-white/40 bg-white/20 flex items-center justify-center text-slate-600 dark:text-slate-300 group-hover:bg-white/40 transition-colors"><Plus size={24} /></span>
                    <DesktopIconLabel name={actionTerm('add', language)} disabled={index !== pageIndex} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div aria-hidden="true" data-testid="desktop-gesture-preview" data-target={touchFeedback.target}
          data-tracking={touchFeedback.tracking} className="desktop-gesture-preview"
          style={{ opacity: touchFeedback.progress, transform: `translateY(${(1 - touchFeedback.progress) * (touchFeedback.target === 'search' ? -16 : 16)}px)` }}>
          <div className="desktop-gesture-hint liquid-glass">
            {touchFeedback.target === 'search' ? <Search size={24} /> : <LaunchpadMark size={32} />}
          </div>
        </div>
        {draggedId && (['left', 'right'] as const).map(direction => {
          const available = direction === 'left' ? pageIndex > 0 : pageIndex < totalPages - 1;
          return available && <div key={direction}
            className={`absolute top-0 bottom-0 w-12 z-20 flex items-center justify-center border-dashed border-sky-400 ${direction === 'left' ? 'left-0 border-l-2' : 'right-0 border-r-2'} ${activeEdge === direction ? 'bg-sky-400/25' : 'bg-sky-400/10'}`}
            onDragOver={event => { event.preventDefault(); overEdge(direction); }} onDragLeave={leaveEdge}
            onDrop={event => {
              event.preventDefault();
              const destination = edgeTargetPage.current ?? Math.max(0, Math.min(totalPages - 1, pageIndex + (direction === 'left' ? -1 : 1)));
              leaveEdge();
              setCurrentPage(destination);
              dropOnPage(destination);
            }}>
            {direction === 'left' ? <ChevronLeft /> : <ChevronRight />}
          </div>;
        })}
      </div>
      {totalPages > 1 && <nav aria-label={text('桌面分页', 'Desktop pages')} className="desktop-pagination desktop-wallpaper-heading h-10 flex items-center justify-center gap-2">
        <button title={text('上一页', 'Previous page')} disabled={pageIndex === 0} data-page-direction="previous" data-gesture-ready={pagingReady === 'previous'}
          className={`${controlClass} !px-1 disabled:opacity-30 ${pagingReady === 'previous' ? '!bg-white/25 !text-white ring-1 ring-white/60' : ''}`}
          onClick={() => setCurrentPage(page => Math.max(0, page - 1))}><ChevronLeft size={16} /></button>
        <div className="max-w-[60%] overflow-x-auto flex gap-1 items-center">
          {pages.map((_, index) => <button key={index} aria-label={`第 ${index + 1} 屏`} aria-current={index === pageIndex ? 'page' : undefined} title={`${index + 1} / ${totalPages}`}
            className="w-6 h-8 shrink-0 flex items-center justify-center cursor-pointer" onClick={() => setCurrentPage(index)}
            onDragOver={event => { event.preventDefault(); if (draggedId) setCurrentPage(index); }}
            onDrop={event => { event.preventDefault(); dropOnPage(index); }}>
            <span className={`rounded-full h-1.5 bg-current transition-all ${index === pageIndex ? 'w-4' : 'w-1.5 opacity-40'}`} />
          </button>)}
        </div>
        <button title={text('下一页', 'Next page')} disabled={pageIndex === totalPages - 1} data-page-direction="next" data-gesture-ready={pagingReady === 'next'}
          className={`${controlClass} !px-1 disabled:opacity-30 ${pagingReady === 'next' ? '!bg-white/25 !text-white ring-1 ring-white/60' : ''}`}
          onClick={() => setCurrentPage(page => Math.min(totalPages - 1, page + 1))}><ChevronRight size={16} /></button>
        <span className="text-[11px] tabular-nums">{pageIndex + 1} / {totalPages}</span>
      </nav>}
      {menu && <div ref={menuRef} role="menu" aria-label="桌面菜单" style={menuPosition}
        className="fixed z-[900] w-56 max-w-[calc(100vw-24px)] rounded-lg p-1 liquid-glass bg-white/95 dark:bg-[#181d28]/95 backdrop-blur-2xl border border-white/60 dark:border-white/15 shadow-xl overflow-y-auto"
        onClick={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}
        onKeyDown={event => {
          if (event.key === 'Tab') { closeMenu(); return; }
          const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next]?.focus();
          }
        }}>
        {menuBookmark && <>
          <div className="px-2.5 py-2 text-xs font-semibold truncate text-slate-500 dark:text-slate-400" title={menuBookmark.title}>{menuBookmark.title}</div>
          {menuAction(text('在新标签页打开', 'Open in new tab'), ExternalLink, () => onOpenBookmark(menuBookmark))}
          {menuAction(text('编辑收藏', 'Edit bookmark'), Edit, () => editBookmark(menuBookmark))}
          {menuAction(text('复制网址', 'Copy URL'), Copy, async () => {
            try { await navigator.clipboard.writeText(menuBookmark.url); onShowToast?.(text('已复制链接', 'Link copied')); }
            catch { onShowToast?.(text('复制失败，请在收藏管理中复制网址', 'Copy failed. Copy the URL in bookmark management.')); }
          }, false, menuBookmark.url)}
          {separator}
          {onToggleDockBookmark && menuAction(effectiveDockIds.includes(menuBookmark.id) ? actionTerm('unpinDock', language) : actionTerm('pinDock', language), effectiveDockIds.includes(menuBookmark.id) ? PinOff : Pin, () => onToggleDockBookmark(menuBookmark.id))}
          {menuAction(actionTerm('moveDesktop', language), FolderPlus, () => {
            const { layout } = requireDesktopAction();
            setMoveBookmark(menuBookmark);
            setMoveFolderId(layout.folders[0]?.id ?? '');
            setEditError('');
          })}
          {menuAction(text('新建分组并移入…', 'Group in a new folder…'), FolderPlus, () => createGroup([menuBookmark.id]))}
          {separator}
          {menuBookmark.iconMode !== 'text' && menuAction(text('刷新网站图标', 'Refresh website icon'), RefreshCw, async () => {
            try {
              await refreshSiteIcon(menuBookmark);
              onShowToast?.(text('网站图标已刷新', 'Website icon refreshed'));
            } catch {
              onShowToast?.(text('未能获取新图标，保留原图标', 'Could not fetch a new icon. Previous icon kept.'));
            }
          })}
          {separator}
          {menuAction(actionTerm('reveal', language), Library, () => {
            if (onRevealBookmark) onRevealBookmark(menuBookmark);
            else onOpenLibrary?.();
          }, false, bookmarkLibraryPath(folders, menuBookmark.folderId, language === 'en'))}
          {separator}
          {menuAction(actionTerm('removeDesktop', language), EyeOff, () => setConfirmation({
            x: menuPosition.left, y: menuPosition.top, title: actionTerm('removeDesktop', language),
            message: text(`移除「${menuBookmark.title}」的快捷方式？原收藏和归档目录保持不变。`, 'Remove this shortcut? The library bookmark is kept.'),
            label: text('确认移除快捷方式', 'Confirm shortcut removal'),
            action: () => execute([{ type: 'desktop.unpin', bookmarkId: menuBookmark.id }]),
          }))}
          {onDeleteBookmark && menuAction(actionTerm('deleteBookmark', language), Trash2, () => {
            setConfirmation({
              x: menuPosition.left, y: menuPosition.top, title: text('删除收藏', 'Delete bookmark'),
              message: text(`将「${menuBookmark.title}」移至回收站并移除快捷方式？可在管理中心恢复收藏。`, 'Move the bookmark to the recycle bin and remove shortcuts? Restore it from Management.'),
              label: text('确认删除收藏', 'Confirm bookmark deletion'), action: () => onDeleteBookmark(menuBookmark.id),
            });
          }, true)}
        </>}
        {menuFolder && <>
          <div className="px-2.5 py-2 text-xs font-semibold truncate text-slate-500 dark:text-slate-400">{menuFolder.name}</div>
          {menuAction(text('展开文件夹', 'Open folder'), FolderOpen, () => {
            if (desktopLayout) onOpenDesktopFolder?.(menuFolder.id);
          })}
          {menuAction(text('重命名文件夹', 'Rename folder'), Edit, () => {
            requireDesktopAction();
            setEditingFolder(menuFolder); setFolderName(menuFolder.name); setEditError('');
          })}
          {separator}
          {menuAction(actionTerm('dissolveDesktop', language), FolderOpen, () => {
            setConfirmation({
              x: menuPosition.left, y: menuPosition.top, title: text('确认移除桌面文件夹', 'Confirm desktop folder removal'),
              message: text(`解散「${menuFolder.name}」并将 ${menuFolder.bookmarkIds.length} 个快捷方式移回桌面？原收藏和归档目录保持不变。`, `Dissolve "${menuFolder.name}" and return ${menuFolder.bookmarkIds.length} shortcuts to the desktop? Library bookmarks are kept.`),
              label: text('确认解散', 'Confirm dissolve'),
              action: () => execute([{ type: 'desktop.folder.remove', id: menuFolder.id, mode: 'dissolve' }]),
            });
          })}
          {menuAction(actionTerm('removeFolder', language), Trash2, () => {
            setConfirmation({
              x: menuPosition.left, y: menuPosition.top, title: text('确认移除桌面文件夹', 'Confirm desktop folder removal'),
              message: text(`移除「${menuFolder.name}」及其中 ${menuFolder.bookmarkIds.length} 个桌面快捷方式？原收藏和归档目录保持不变。`, `Remove "${menuFolder.name}" and ${menuFolder.bookmarkIds.length} shortcuts? Library bookmarks are kept.`),
              label: text('确认移除快捷方式', 'Confirm shortcut removal'),
              action: () => execute([{ type: 'desktop.folder.remove', id: menuFolder.id, mode: 'remove-shortcuts' }]),
            });
          }, true)}
        </>}
        {menuTool && menuAction(text('打开工具', 'Open tool'), Wrench, () => { if (menuTool.toolType) onOpenTool(menuTool.toolType); })}
        {menu.target.type === 'background' && <>
          {menuAction(actionTerm('add', language), Plus, onQuickAdd)}
          {menuAction(text('全部收藏', 'All bookmarks'), Library, () => onOpenLibrary?.())}
          {menuAction(text('新建桌面文件夹', 'New desktop folder'), FolderPlus, () => createGroup([]))}
          {separator}
          {menuAction(text('编辑桌面', 'Edit desktop'), Edit, () => {
            requireDesktopAction(); setIsEditing(true);
          })}
          {menuAction(text('打开启动台', 'Open launchpad'), Grid, () => onOpenLaunchpad?.())}
          {menuAction(text('搜索', 'Search'), Search, () => onOpenSearch?.())}
        </>}
      </div>}
      {confirmation && <DesktopConfirmPopover confirmation={confirmation} language={language} onClose={() => setConfirmation(null)} />}
      {moveBookmark && desktopLayout && <div className="desktop-dialog-backdrop fixed inset-0 z-[1300] flex items-center justify-center p-4"
        onClick={() => setMoveBookmark(null)} onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); setMoveBookmark(null); }
        }}>
        <form role="dialog" aria-modal="true" aria-label={text('移动桌面快捷方式', 'Move desktop shortcut')}
          className="desktop-dialog-surface w-full max-w-sm p-5 rounded-lg liquid-glass"
          onClick={event => event.stopPropagation()} onSubmit={async event => {
            event.preventDefault();
            try {
              const shortcut = desktopLayout.shortcuts.find(shortcut => shortcut.bookmarkId === moveBookmark.id);
              const folder = desktopLayout.folders.find(folder => folder.id === moveFolderId);
              if (!shortcut || !folder) throw new Error('INVALID_REFERENCE');
              await execute([{ type: 'desktop.move', ref: { kind: 'shortcut', id: shortcut.id }, to: {
                kind: 'folder', folderId: folder.id, index: folder.shortcutIds.filter(id => id !== shortcut.id).length,
              } }]);
              setMoveBookmark(null);
            } catch (error) { setEditError(desktopError(error)); }
          }}>
          <h2 className="text-sm font-semibold mb-4">{text('移动桌面快捷方式', 'Move desktop shortcut')}</h2>
          <label className="text-xs block">{text('目标桌面文件夹', 'Desktop folder')}
            <select autoFocus aria-label="目标桌面文件夹" value={moveFolderId} onChange={event => setMoveFolderId(event.target.value)}
              className="mt-2 w-full border border-slate-300 rounded-md p-2 bg-white dark:bg-slate-800">
              {desktopLayout.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
          </label>
          {!desktopLayout.folders.length && <p className="text-xs mt-3">{text('暂无桌面文件夹', 'No desktop folders')}</p>}
          {editError && <p role="alert" className="text-xs text-rose-600 mt-3">{editError}</p>}
          <div className="flex gap-2 justify-end mt-4">
            <button type="button" className={controlClass} onClick={() => setMoveBookmark(null)}>{text('取消', 'Cancel')}</button>
            <button type="submit" disabled={!moveFolderId} className={`${controlClass} bg-sky-600 text-white disabled:opacity-40`}>{text('移动', 'Move')}</button>
          </div>
        </form>
      </div>}
      {editingBookmark && <BookmarkDialog isOpen bookmark={editingBookmark}
        folders={folders} existingBookmarks={bookmarks} language={language}
        onClose={() => setEditingBookmark(null)}
        onSave={async input => {
          await commitAndRefresh(() => storage.saveManualBookmark(input, editingBookmark.id), onLibraryChanged);
          onShowToast?.(text('已更新收藏', 'Bookmark updated'));
        }}
        onCreateFolder={(name, parentId) => {
          return commitAndRefresh(() => storage.createFolder(name, [], parentId), onLibraryChanged);
        }}
        onOpenExisting={onOpenBookmark}
        onEditExisting={setEditingBookmark}
      />}
      {editingFolder && (
        <div className="desktop-dialog-backdrop fixed inset-0 z-[1300] flex items-center justify-center p-4"
          onClick={() => { setEditingBookmark(null); setEditingFolder(null); }}
          onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setEditingBookmark(null); setEditingFolder(null); } }}>
          <form role="dialog" aria-modal="true" aria-label={text('重命名文件夹', 'Rename folder')}
            className="desktop-dialog-surface w-full max-w-sm max-h-[90dvh] overflow-y-auto rounded-lg liquid-glass p-5"
            onClick={event => event.stopPropagation()} onSubmit={async event => {
              event.preventDefault();
              try {
                if (folderName.trim()) await execute([{ type: 'desktop.folder.rename', id: editingFolder.id, name: folderName.trim() }]);
                setEditingBookmark(null); setEditingFolder(null);
              } catch (error) { setEditError(desktopError(error)); }
            }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">{text('重命名文件夹', 'Rename folder')}</h2>
              <button type="button" title={text('关闭', 'Close')} className={controlClass} onClick={() => { setEditingBookmark(null); setEditingFolder(null); }}><X size={16} /></button>
            </div>
            <label className="block text-xs">{text('文件夹名称', 'Folder name')}<input autoFocus required aria-label="文件夹名称" value={folderName} onChange={event => setFolderName(event.target.value)} className="mt-1 w-full border rounded-md px-3 py-2 bg-white/50 dark:bg-white/5" /></label>
            {editError && <p role="alert" className="text-xs text-rose-600 mt-3">{editError}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className={controlClass} onClick={() => { setEditingBookmark(null); setEditingFolder(null); }}>{text('取消', 'Cancel')}</button>
              <button type="submit" className={`${controlClass} bg-sky-600 text-white hover:!bg-sky-700`}>{text('保存更改', 'Save changes')}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

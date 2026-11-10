import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { actionTerm } from '../common/action-terms';
import {
  Plus,
  Calculator,
  Code2,
  FileText,
  ExternalLink,
  Copy,
  Edit,
  Library,
  Pin,
  RefreshCw,
  AppWindow,
  X,
  Minus,
  Maximize2,
  Sliders,
  RotateCcw,
  PinOff,
  EyeOff,
} from 'lucide-react';
import { Bookmark, DesktopAppWindow, Folder } from '../../types';
import { MenuActionLabel } from '../common/MenuActionLabel';
import { bookmarkLibraryPath } from '../common/folder-tree';
import { FaviconImage } from '../common/FaviconImage';
import { LaunchpadMark } from '../common/LaunchpadMark';
import { storage } from '../../services/storage';
import { preferenceSaveError } from '../../services/preference-save-error';
import { refreshSiteIcon } from '../../services/site-icons';
import { positionDesktopMenu } from '../desktop/desktop-layout';

export type ActiveNavTab = 'desktop' | 'explore' | 'collections' | 'plugins' | 'account';

interface BottomDockProps {
  onInteractionChange?: (active: boolean) => void;
  bookmarks: Bookmark[];
  folders?: Folder[];
  showTools?: boolean;
  dockBookmarkIds?: string[];
  desktopBookmarkIds?: string[];
  activeTool?: 'calculator' | 'json-formatter' | 'word-counter' | null;
  // Desktop Windows Integration
  openWindows?: DesktopAppWindow[];
  activeWindowId?: string | null;
  onOpenBookmark: (bookmark: Bookmark) => void;
  onOpenBookmarkInWindow?: (bookmark: Bookmark) => void;
  onFocusWindow?: (windowId: string) => void;
  onMinimizeWindow?: (windowId: string) => void;
  onRestoreWindow?: (windowId: string) => void;
  onCloseWindow?: (windowId: string) => void;
  onOpenTool: (toolType: 'calculator' | 'json-formatter' | 'word-counter') => void;
  onQuickAdd: () => void;
  // Launchpad App Drawer
  isLaunchpadOpen?: boolean;
  onToggleLaunchpad?: () => void;
  // Customizable macOS Dock settings & callbacks
  dockIconSize?: number;
  onUpdateDockSettings?: (updates: {
    dockIconSize?: number;
    showDock?: boolean;
    dockBookmarkIds?: string[];
  }) => boolean | void | Promise<boolean | void>;
  onToggleDockBookmark?: (bookmarkId: string) => void;
  onTogglePinDesktop?: (bookmarkId: string) => void;
  onEditBookmark?: (bm: Bookmark) => void;
  onManageBookmark?: (bookmark: Bookmark) => void;
  onShowToast?: (message: string) => void;
}

interface DockContextMenuState {
  x: number;
  y: number;
  windowId?: string;
  bookmark?: Bookmark;
  title: string;
  isWindowOpen: boolean;
  isMinimized?: boolean;
}

interface DockSettingsMenuState {
  x: number;
  y: number;
}

export const BottomDock: React.FC<BottomDockProps> = ({
  onInteractionChange,
  bookmarks,
  folders = [],
  showTools = true,
  dockBookmarkIds,
  desktopBookmarkIds,
  activeTool,
  openWindows = [],
  activeWindowId = null,
  onOpenBookmark,
  onFocusWindow,
  onMinimizeWindow,
  onRestoreWindow,
  onCloseWindow,
  onOpenTool,
  onQuickAdd,
  isLaunchpadOpen = false,
  onToggleLaunchpad,
  dockIconSize = 48,
  onUpdateDockSettings,
  onToggleDockBookmark,
  onTogglePinDesktop,
  onEditBookmark,
  onManageBookmark,
  onShowToast,
}) => {
  const languageRef = useRef<string | undefined>(undefined);
  try { languageRef.current = storage.getUserSettings().language; } catch { /* Keep feedback readable when storage is blocked. */ }
  const language = languageRef.current;
  // --- DOCK SIZE & RESIZE STATE ---
  const [iconSize, setIconSize] = useState<number>(dockIconSize);
  const committedSizeRef = useRef(dockIconSize);

  // Sync with incoming prop if changed externally
  useEffect(() => {
    setIconSize(dockIconSize);
    committedSizeRef.current = dockIconSize;
  }, [dockIconSize]);

  // Drag to resize dock height
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const resizeStartYRef = useRef<number>(0);
  const resizeStartSizeRef = useRef<number>(iconSize);
  const currentSizeRef = useRef<number>(iconSize);
  currentSizeRef.current = iconSize;

  // --- ICON BOUNCE ANIMATION STATE ---
  const [bouncingId, setBouncingId] = useState<string | null>(null);
  const triggerBounce = (id: string) => {
    setBouncingId(id);
    setTimeout(() => {
      setBouncingId(prev => (prev === id ? null : prev));
    }, 820);
  };

  // --- DRAG & DROP REORDER STATE ON DOCK ---
  const [draggedDockBmId, setDraggedDockBmId] = useState<string | null>(null);
  const [dragOverDockBmId, setDragOverDockBmId] = useState<string | null>(null);

  // --- CONTEXT MENUS ---
  const [contextMenu, setContextMenu] = useState<DockContextMenuState | null>(null);
  const [dockSettingsMenu, setDockSettingsMenu] = useState<DockSettingsMenuState | null>(null);
  useEffect(() => { onInteractionChange?.(!!contextMenu || !!dockSettingsMenu || isResizing); },
    [contextMenu, dockSettingsMenu, isResizing, onInteractionChange]);
  useEffect(() => () => onInteractionChange?.(false), [onInteractionChange]);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const dockSettingsMenuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 12, top: 12, maxHeight: 400 });
  const [error, setError] = useState('');
  const reportError = (message: string) => {
    setError(message);
    onShowToast?.(message);
  };
  const saveDockSettings = async (updates: Parameters<NonNullable<BottomDockProps['onUpdateDockSettings']>>[0]): Promise<boolean> => {
    try {
      // A supplied parent owns persistence and failure feedback; never write twice.
      if (onUpdateDockSettings) {
        if (await onUpdateDockSettings(updates) === false) return false;
      } else {
        await storage.mutate(() => storage.saveUserSettings(updates));
      }
      setError('');
      return true;
    } catch (cause) {
      reportError(preferenceSaveError(cause, language,
        updates.dockBookmarkIds !== undefined ? 'library' : 'settings'));
      return false;
    }
  };
  const saveIconSize = async (size: number): Promise<boolean> => {
    const saved = await saveDockSettings({ dockIconSize: size });
    if (saved) committedSizeRef.current = size;
    currentSizeRef.current = committedSizeRef.current;
    setIconSize(committedSizeRef.current);
    return saved;
  };
  useLayoutEffect(() => {
    const element = contextMenuRef.current;
    if (!contextMenu || !element) return;
    setMenuPosition(positionDesktopMenu({
      x: contextMenu.x, y: contextMenu.y,
      width: element.offsetWidth, height: element.scrollHeight,
      viewportWidth: innerWidth, viewportHeight: innerHeight, bottomInset: 12,
    }));
  }, [contextMenu]);
  const menuAction = (label: string, Icon: React.ComponentType<{ size?: number }>, action: () => void | Promise<void>, detail?: string) => (
    <button type="button" role="menuitem" aria-label={label}
      onClick={async () => {
        setContextMenu(null);
        try { await action(); }
        catch (cause) { reportError(preferenceSaveError(cause, language, 'library')); }
      }}
      className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-slate-800 dark:text-slate-200 hover:bg-sky-500/15 focus-visible:bg-sky-500/15 transition-colors cursor-pointer"
    ><span className="shrink-0"><Icon size={14} /></span><MenuActionLabel label={label} detail={detail} /></button>
  );

  // Close context menus on click outside or escape
  useEffect(() => {
    const handleClose = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenu(null);
      }
      if (
        dockSettingsMenuRef.current &&
        !dockSettingsMenuRef.current.contains(e.target as Node)
      ) {
        setDockSettingsMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setDockSettingsMenu(null);
      }
    };
    window.addEventListener('pointerdown', handleClose);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointerdown', handleClose);
      window.removeEventListener('keydown', handleKey);
    };
  }, []);

  // An explicit empty list is a user choice; only old unset data needs a fallback.
  const dockBookmarks = useMemo(() => {
    if (dockBookmarkIds !== undefined) {
      const matched = dockBookmarkIds
        .map(id => bookmarks.find(b => b.id === id))
        .filter((b): b is Bookmark => Boolean(b));
      return matched;
    }
    // Fallback to top 4 pinned bookmarks
    return bookmarks.filter(b => b.pinnedToDesktop).slice(0, 4);
  }, [bookmarks, dockBookmarkIds]);

  // Unpinned running windows (dynamic running app icons)
  const unpinnedWindows = useMemo(() => {
    return openWindows.filter(
      win => !dockBookmarks.some(bm => bm.id === win.bookmarkId)
    );
  }, [openWindows, dockBookmarks]);

  const builtInTools = [
    {
      id: 'calculator',
      name: '极简计算器',
      desc: '即开即用汇率与科学计算',
      icon: <Calculator size={Math.max(15, Math.round(iconSize * 0.38))} className="text-amber-500" />,
      action: () => onOpenTool('calculator'),
    },
    {
      id: 'json-formatter',
      name: 'JSON 校验格式化',
      desc: '语法树校验与结构整理',
      icon: <Code2 size={Math.max(15, Math.round(iconSize * 0.38))} className="text-sky-500" />,
      action: () => onOpenTool('json-formatter'),
    },
    {
      id: 'word-counter',
      name: '字数与阅读时长统计',
      desc: '中英文排版与字数分析',
      icon: <FileText size={Math.max(15, Math.round(iconSize * 0.38))} className="text-emerald-500" />,
      action: () => onOpenTool('word-counter'),
    },
  ];

  // --- DRAG TO RESIZE HANDLERS ---
  const handleStartResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeStartYRef.current = e.clientY;
    resizeStartSizeRef.current = iconSize;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = resizeStartYRef.current - moveEvent.clientY; // drag up = larger
      const newSize = Math.max(34, Math.min(74, Math.round(resizeStartSizeRef.current + deltaY * 0.75)));
      setIconSize(newSize);
    };

    const handleMouseUp = async () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      const finalSize = currentSizeRef.current;
      await saveIconSize(finalSize);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleResetSize = () => {
    return saveIconSize(48);
  };

  // --- ITEM CLICK HANDLERS ---
  const handleBookmarkClick = (bm: Bookmark) => {
    triggerBounce(bm.id);
    const win = openWindows.find(w => w.bookmarkId === bm.id);
    if (win) {
      if (win.isMinimized) {
        onRestoreWindow?.(win.id);
      } else if (activeWindowId === win.id) {
        onMinimizeWindow?.(win.id);
      } else {
        onFocusWindow?.(win.id);
      }
    } else {
      onOpenBookmark(bm);
    }
  };

  const handleBookmarkContextMenu = (e: React.MouseEvent, bm: Bookmark) => {
    e.preventDefault();
    e.stopPropagation();
    setError('');
    const win = openWindows.find(w => w.bookmarkId === bm.id);
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({
      x: Math.max(10, Math.min(window.innerWidth - 220, rect.left - 40)),
      y: rect.top,
      windowId: win?.id,
      bookmark: bm,
      title: bm.title,
      isWindowOpen: Boolean(win),
      isMinimized: win?.isMinimized,
    });
  };

  const handleRunningWindowClick = (win: DesktopAppWindow) => {
    triggerBounce(win.id);
    if (win.isMinimized) {
      onRestoreWindow?.(win.id);
    } else if (activeWindowId === win.id) {
      onMinimizeWindow?.(win.id);
    } else {
      onFocusWindow?.(win.id);
    }
  };

  const handleRunningWindowContextMenu = (e: React.MouseEvent, win: DesktopAppWindow) => {
    e.preventDefault();
    e.stopPropagation();
    setError('');
    const rect = e.currentTarget.getBoundingClientRect();
    const bm = bookmarks.find(b => b.id === win.bookmarkId);
    setContextMenu({
      x: Math.max(10, Math.min(window.innerWidth - 220, rect.left - 40)),
      y: rect.top,
      windowId: win.id,
      bookmark: bm,
      title: win.title,
      isWindowOpen: true,
      isMinimized: win.isMinimized,
    });
  };

  const handleDockBackgroundContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDockSettingsMenu({
      x: Math.max(10, Math.min(window.innerWidth - 230, e.clientX - 100)),
      y: Math.max(10, e.clientY - 210),
    });
  };

  // --- DOCK BOOKMARK DRAG REORDER ---
  const handleDockDragStart = (e: React.DragEvent, bmId: string) => {
    e.dataTransfer.setData('text/plain', bmId);
    setDraggedDockBmId(bmId);
  };

  const handleDockDragOver = (e: React.DragEvent, targetBmId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedDockBmId && draggedDockBmId !== targetBmId) {
      setDragOverDockBmId(targetBmId);
    }
  };

  const handleDockDrop = (e: React.DragEvent, targetBmId: string) => {
    e.preventDefault();
    if (!draggedDockBmId || draggedDockBmId === targetBmId) {
      setDraggedDockBmId(null);
      setDragOverDockBmId(null);
      return;
    }
    const currentIds = dockBookmarks.map(b => b.id);
    const fromIndex = currentIds.indexOf(draggedDockBmId);
    const toIndex = currentIds.indexOf(targetBmId);
    if (fromIndex !== -1 && toIndex !== -1) {
      const nextIds = [...currentIds];
      nextIds.splice(fromIndex, 1);
      nextIds.splice(toIndex, 0, draggedDockBmId);
      saveDockSettings({ dockBookmarkIds: nextIds });
    }
    setDraggedDockBmId(null);
    setDragOverDockBmId(null);
  };

  // Determine favicon size string based on iconSize
  const faviconSizeProp = iconSize <= 40 ? 'xs' : iconSize <= 56 ? 'sm' : 'md';
  const innerIconPixel = Math.max(22, Math.round(iconSize * 0.72));

  return (
    <>
      {error && <p role="alert" className="fixed bottom-24 left-1/2 z-[1300] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs text-rose-700 shadow-lg dark:bg-zinc-900 dark:text-rose-300">{error}</p>}
      {/* Main macOS Dock Shell */}
      <aside
        data-testid="bottom-dock"
        aria-label={language === 'en' ? 'Taskbar' : '任务栏'}
        onContextMenu={handleDockBackgroundContextMenu}
        className="fixed bottom-2 sm:bottom-3 left-1/2 -translate-x-1/2 z-[1000] dock-container px-1 sm:px-2 max-w-[calc(100vw-1rem)] pointer-events-none select-none"
      >
        <div className="relative pointer-events-auto liquid-glass-dock px-2 sm:px-3.5 py-1.5 sm:py-2 rounded-2xl sm:rounded-3xl flex items-center gap-1 sm:gap-2">
          {/* Top-Edge Resize Grip Handle */}
          <div
            onMouseDown={handleStartResize}
            onDoubleClick={handleResetSize}
            title="上下拖动调整大小 · 双击恢复默认"
            className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-16 h-3 flex items-center justify-center cursor-ns-resize group z-30 select-none py-1"
          >
            <div className="w-8 h-1 rounded-full bg-slate-400/40 dark:bg-white/20 group-hover:bg-sky-500 group-hover:w-10 transition-all shadow-xs" />
          </div>

          {/* Section 1: Launchpad & Pinned Website Bookmarks */}
          <div className="flex items-center gap-1 sm:gap-1.5">
            {/* Fixed Launchpad (启动台) App Drawer Icon */}
            <div
              style={{ width: iconSize, height: iconSize }}
              className="relative flex items-center justify-center select-none shrink-0"
            >
              <button
                data-onboarding="launchpad"
                onClick={() => {
                  triggerBounce('launchpad');
                  onToggleLaunchpad?.();
                }}
                style={{ width: iconSize, height: iconSize }}
                className={`group relative flex flex-col items-center justify-center rounded-xl sm:rounded-2xl select-none cursor-pointer hover:-translate-y-1 hover:scale-105 active:scale-95 transition-all duration-200 ${
                  isLaunchpadOpen
                    ? 'bg-sky-500/20 ring-2 ring-sky-500/50 shadow-md'
                    : 'hover:bg-black/5 dark:hover:bg-white/10'
                } ${bouncingId === 'launchpad' ? 'animate-dock-bounce' : ''}`}
                title="启动台 · 所有应用与收藏 (桌面上滑亦可展开)"
              >
                {/* Tooltip on hover */}
                <div className="absolute -top-11 px-2.5 py-1 text-[11px] font-semibold rounded-xl liquid-glass text-slate-800 dark:text-slate-100 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl border border-slate-300/80 dark:border-white/15 whitespace-nowrap z-50">
                  <span>启动台 · 应用抽屉</span>
                  {isLaunchpadOpen && <span className="ml-1 text-[10px] text-sky-500 font-mono">(已打开)</span>}
                </div>

                {/* Launchpad Icon Emblem */}
                <div
                  style={{ width: innerIconPixel, height: innerIconPixel }}
                  className="flex shrink-0 items-center justify-center"
                >
                  <LaunchpadMark size={Math.round(innerIconPixel * 0.82)} />
                </div>

                {/* Running dot if open */}
                <div
                  className={`w-1 h-1 rounded-full mt-0.5 transition-all ${
                    isLaunchpadOpen ? 'bg-sky-500 ring-2 ring-sky-400/50 scale-125' : 'bg-transparent'
                  }`}
                />
              </button>
            </div>

            {dockBookmarks.map(bm => {
              const win = openWindows.find(w => w.bookmarkId === bm.id);
              const isOpen = Boolean(win);
              const isActive = isOpen && activeWindowId === win?.id && !win?.isMinimized;
              const isBouncing = bouncingId === bm.id;
              const isDragOver = dragOverDockBmId === bm.id;

              return (
                <div
                  key={bm.id}
                  draggable
                  onDragStart={e => handleDockDragStart(e, bm.id)}
                  onDragOver={e => handleDockDragOver(e, bm.id)}
                  onDragEnd={() => {
                    setDraggedDockBmId(null);
                    setDragOverDockBmId(null);
                  }}
                  onDrop={e => handleDockDrop(e, bm.id)}
                  style={{ width: iconSize, height: iconSize }}
                  className={`relative flex items-center justify-center select-none ${
                    isDragOver ? 'ring-2 ring-sky-400 rounded-2xl' : ''
                  }`}
                >
                  <button
                    onClick={() => handleBookmarkClick(bm)}
                    onContextMenu={e => handleBookmarkContextMenu(e, bm)}
                    style={{ width: iconSize, height: iconSize }}
                    className={`group relative flex flex-col items-center justify-center rounded-xl sm:rounded-2xl select-none cursor-pointer hover:-translate-y-1 hover:scale-105 active:scale-95 transition-all duration-200 ${
                      isActive ? 'bg-sky-500/15 ring-2 ring-sky-500/40 shadow-xs' : 'hover:bg-black/5 dark:hover:bg-white/10'
                    } ${isBouncing ? 'animate-dock-bounce' : ''}`}
                    title={`${bm.title} (${bm.domain})${isOpen ? ' · 运行中' : ''}`}
                  >
                    {/* Tooltip on hover */}
                    <div className="absolute -top-11 px-2.5 py-1 text-[11px] font-semibold rounded-xl liquid-glass text-slate-800 dark:text-slate-100 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl border border-slate-300/80 dark:border-white/15 whitespace-nowrap z-50">
                      <span className="truncate max-w-[150px] inline-block align-bottom">{bm.title}</span>
                      {isOpen && (
                        <span className="ml-1 text-[10px] text-sky-500">
                          ({win?.isMinimized ? '已最小化' : '运行中'})
                        </span>
                      )}
                    </div>

                    {/* Favicon Container */}
                    <div
                      style={{ width: innerIconPixel, height: innerIconPixel }}
                      className="flex items-center justify-center transition-all"
                    >
                      <FaviconImage
                        url={bm.url}
                        title={bm.title}
                        icon={bm.icon}
                        iconMode={bm.iconMode}
                        iconBg={bm.iconBg}
                        size={faviconSizeProp}
                        className="w-full h-full"
                      />
                    </div>

                    {/* macOS Running Dot */}
                    <div
                      className={`w-1 h-1 rounded-full mt-0.5 transition-all ${
                        isOpen
                          ? win?.isMinimized
                            ? 'bg-amber-400 ring-2 ring-amber-400/40'
                            : 'bg-sky-500 ring-2 ring-sky-400/50 scale-125'
                          : 'bg-transparent'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Section 2: Dynamic Running Windows (Unpinned) */}
          {unpinnedWindows.length > 0 && (
            <>
              <div
                onMouseDown={handleStartResize}
                onDoubleClick={handleResetSize}
                title="拖动调整大小 · 双击恢复默认"
                className="w-px h-5 sm:h-6 bg-slate-300/70 dark:bg-white/15 mx-0.5 shrink-0 cursor-ns-resize"
              />
              <div className="flex items-center gap-1 sm:gap-1.5">
                {unpinnedWindows.map(win => {
                  const isActive = activeWindowId === win.id && !win.isMinimized;
                  const isBouncing = bouncingId === win.id;

                  return (
                    <div
                      key={win.id}
                      style={{ width: iconSize, height: iconSize }}
                      className="relative flex items-center justify-center select-none"
                    >
                      <button
                        onClick={() => handleRunningWindowClick(win)}
                        onContextMenu={e => handleRunningWindowContextMenu(e, win)}
                        style={{ width: iconSize, height: iconSize }}
                        className={`group relative flex flex-col items-center justify-center rounded-xl sm:rounded-2xl select-none cursor-pointer hover:-translate-y-1 hover:scale-105 active:scale-95 transition-all duration-200 ${
                          isActive ? 'bg-sky-500/15 ring-2 ring-sky-500/40 shadow-xs' : 'bg-black/5 dark:bg-white/5'
                        } ${isBouncing ? 'animate-dock-bounce' : ''}`}
                        title={`${win.title} · 桌面窗口`}
                      >
                        {/* Tooltip */}
                        <div className="absolute -top-11 px-2.5 py-1 text-[11px] font-semibold rounded-xl liquid-glass text-slate-800 dark:text-slate-100 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl border border-slate-300/80 dark:border-white/15 whitespace-nowrap z-50">
                          <span className="truncate max-w-[150px] inline-block align-bottom">{win.title}</span>
                          <span className="ml-1 text-[10px] text-sky-500 font-mono">
                            ({win.isMinimized ? '已最小化' : '活动窗口'})
                          </span>
                        </div>

                        <div
                          style={{ width: innerIconPixel, height: innerIconPixel }}
                          className="flex items-center justify-center"
                        >
                          <FaviconImage
                            url={win.url}
                            title={win.title}
                            iconBg={win.iconBg}
                            size={faviconSizeProp}
                            className="w-full h-full"
                          />
                        </div>

                        {/* Active running dot */}
                        <div
                          className={`w-1 h-1 rounded-full mt-0.5 transition-all ${
                            win.isMinimized
                              ? 'bg-amber-400 ring-2 ring-amber-400/40'
                              : 'bg-sky-500 ring-2 ring-sky-400/50 scale-125'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* macOS Dock Vertical Divider with Resize Trigger */}
          <div
            onMouseDown={handleStartResize}
            onDoubleClick={handleResetSize}
            title="上下拖动调整大小 · 双击恢复默认"
            className="group relative flex items-center justify-center w-2.5 sm:w-3 h-7 sm:h-8 cursor-ns-resize shrink-0 self-center mx-0.5"
          >
            <div className="w-[1.5px] h-full bg-slate-300/80 dark:bg-white/20 group-hover:bg-sky-500 group-hover:w-[2px] transition-all rounded-full" />
            <div className="absolute w-1 h-1.5 rounded-full bg-slate-400/70 dark:bg-white/50 group-hover:bg-sky-400 transition-colors" />
          </div>

          {/* Section 3: Built-in Tools & Quick Actions */}
          <div className="flex items-center gap-1 sm:gap-1.5">
            {(showTools ? builtInTools : []).map(tool => {
              const isOpen = activeTool === tool.id;
              const isBouncing = bouncingId === tool.id;

              return (
                <div
                  key={tool.id}
                  style={{ width: iconSize, height: iconSize }}
                  className="relative flex items-center justify-center select-none"
                >
                  <button
                    onClick={() => {
                      triggerBounce(tool.id);
                      tool.action();
                    }}
                    style={{ width: iconSize, height: iconSize }}
                    className={`group relative flex flex-col items-center justify-center rounded-xl sm:rounded-2xl select-none cursor-pointer hover:-translate-y-1 hover:scale-105 active:scale-95 transition-all duration-200 ${
                      isOpen
                        ? 'bg-sky-500/15 ring-2 ring-sky-500/40 shadow-xs'
                        : 'hover:bg-black/5 dark:hover:bg-white/10'
                    } ${isBouncing ? 'animate-dock-bounce' : ''}`}
                    title={tool.name}
                  >
                    {/* Tooltip */}
                    <div className="absolute -top-11 px-2.5 py-1 text-[11px] font-semibold rounded-xl liquid-glass text-slate-800 dark:text-slate-100 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl border border-slate-300/80 dark:border-white/15 whitespace-nowrap z-50">
                      <span>{tool.name} · 极简小工具</span>
                    </div>

                    <div
                      style={{ width: innerIconPixel, height: innerIconPixel }}
                      className="rounded-xl bg-white/80 dark:bg-black/30 border border-slate-200/80 dark:border-white/10 flex items-center justify-center shadow-xs"
                    >
                      {tool.icon}
                    </div>

                    {/* Status Dot */}
                    <div
                      className={`w-1 h-1 rounded-full mt-0.5 transition-colors ${
                        isOpen ? 'bg-sky-500' : 'bg-transparent'
                      }`}
                    />
                  </button>
                </div>
              );
            })}

            {/* Quick Add Bookmark Action */}
            <div
              style={{ width: iconSize, height: iconSize }}
              className="relative flex items-center justify-center select-none"
            >
              <button
                onClick={() => {
                  triggerBounce('quick-add');
                  onQuickAdd();
                }}
                style={{ width: iconSize, height: iconSize }}
                className={`group relative flex flex-col items-center justify-center rounded-xl sm:rounded-2xl select-none hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer hover:-translate-y-1 hover:scale-105 active:scale-95 transition-all duration-200 ${
                  bouncingId === 'quick-add' ? 'animate-dock-bounce' : ''
                }`}
                title={actionTerm('add', language)}
              >
                <div className="absolute -top-11 px-2.5 py-1 text-[11px] font-semibold rounded-xl liquid-glass text-slate-800 dark:text-slate-100 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl border border-slate-300/80 dark:border-white/15 whitespace-nowrap z-50">
                  <span>{actionTerm('add', language)}</span>
                </div>

                <div
                  style={{ width: innerIconPixel, height: innerIconPixel }}
                  className="rounded-xl bg-sky-500 hover:bg-sky-600 text-white flex items-center justify-center shadow-md transition-colors"
                >
                  <Plus size={Math.max(15, Math.round(iconSize * 0.38))} />
                </div>
                <div className="w-1 h-1 rounded-full mt-0.5 bg-transparent" />
              </button>
            </div>
          </div>
        </div>

        {/* Live Resizing HUD Badge */}
        {isResizing && (
          <div className="absolute -top-11 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full liquid-glass bg-white/95 dark:bg-slate-900/90 text-sky-600 dark:text-sky-400 border border-sky-400/50 shadow-2xl text-xs font-bold animate-in fade-in zoom-in-95 pointer-events-none select-none">
            {language === 'en' ? 'Taskbar height' : '任务栏高度'}: {iconSize}px
          </div>
        )}
      </aside>

      {/* Dock Right-Click Context Menu for Bookmarks / Windows */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label="收藏操作"
          style={menuPosition}
          className="fixed z-[1200] w-52 max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg p-1.5 liquid-glass bg-white/95 dark:bg-[#181d28]/95 backdrop-blur-2xl border border-slate-300/90 dark:border-white/15 shadow-2xl text-xs select-none animate-in fade-in zoom-in-95 duration-100 ring-1 ring-black/5 dark:ring-white/10"
          onClick={e => e.stopPropagation()}
        >
          {/* Header Preview */}
          <div className="px-2.5 py-1.5 mb-1 rounded-xl bg-slate-100/70 dark:bg-white/5 border border-slate-200/60 dark:border-white/5 font-semibold text-slate-800 dark:text-slate-200 truncate">
            {contextMenu.title}
          </div>

          <div className="flex flex-col gap-0.5">
            {contextMenu.bookmark && (() => {
              const bm = contextMenu.bookmark;
              const onDesktop = desktopBookmarkIds ? desktopBookmarkIds.includes(bm.id) : bm.pinnedToDesktop;
              const inDock = dockBookmarks.some(bookmark => bookmark.id === bm.id);
              return <>
                {menuAction('在新标签页打开', ExternalLink, () => onOpenBookmark(bm))}
                {onEditBookmark && menuAction('编辑收藏', Edit, () => onEditBookmark(bm))}
                {menuAction('复制网址', Copy, async () => {
                  try {
                    await navigator.clipboard.writeText(bm.url);
                    onShowToast?.('已复制网址到剪贴板');
                  } catch { reportError('复制失败，请在收藏管理中复制网址'); }
                }, bm.url)}
                {(onTogglePinDesktop || onToggleDockBookmark) && <div role="separator" className="my-1 border-t border-slate-200/80 dark:border-white/10" />}
                {onTogglePinDesktop && menuAction(actionTerm(onDesktop ? 'removeDesktop' : 'pinDesktop', language),
                  onDesktop ? PinOff : Pin, () => onTogglePinDesktop(bm.id))}
                {onToggleDockBookmark && menuAction(actionTerm(inDock ? 'unpinDock' : 'pinDock', language),
                  inDock ? PinOff : Pin, () => onToggleDockBookmark(bm.id))}
                {(bm.iconMode !== 'text' || onManageBookmark) && <div role="separator" className="my-1 border-t border-slate-200/80 dark:border-white/10" />}
                {bm.iconMode !== 'text' && menuAction('刷新网站图标', RefreshCw, async () => {
                  try { await refreshSiteIcon(bm); }
                  catch { reportError('未能获取新图标，保留原图标'); }
                })}
                {onManageBookmark && menuAction(actionTerm('reveal', language), Library, () => onManageBookmark(bm), bookmarkLibraryPath(folders, bm.folderId))}
                {contextMenu.isWindowOpen && <div role="separator" className="my-1 border-t border-slate-200/80 dark:border-white/10" />}
              </>;
            })()}
            {/* Window is open actions */}
            {contextMenu.isWindowOpen && contextMenu.windowId && (
              <>
                <button
                  onClick={() => {
                    onFocusWindow?.(contextMenu.windowId!);
                    setContextMenu(null);
                  }}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-xl text-slate-800 dark:text-slate-200 hover:bg-sky-500 hover:text-white transition-colors cursor-pointer"
                >
                  <AppWindow size={14} className="text-sky-500" />
                  <span>置顶显示窗口</span>
                </button>

                {contextMenu.isMinimized ? (
                  <button
                    onClick={() => {
                      onRestoreWindow?.(contextMenu.windowId!);
                      setContextMenu(null);
                    }}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-xl text-slate-800 dark:text-slate-200 hover:bg-sky-500 hover:text-white transition-colors cursor-pointer"
                  >
                    <Maximize2 size={14} className="text-emerald-500" />
                    <span>恢复窗口</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      onMinimizeWindow?.(contextMenu.windowId!);
                      setContextMenu(null);
                    }}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-xl text-slate-800 dark:text-slate-200 hover:bg-sky-500 hover:text-white transition-colors cursor-pointer"
                  >
                    <Minus size={14} className="text-amber-500" />
                    <span>最小化窗口</span>
                  </button>
                )}
              </>
            )}

            {/* Close Desktop Window */}
            {contextMenu.isWindowOpen && contextMenu.windowId && (
              <>
                <div className="my-1 border-t border-slate-200/80 dark:border-white/10" />
                <button
                  onClick={() => {
                    onCloseWindow?.(contextMenu.windowId!);
                    setContextMenu(null);
                  }}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer font-medium"
                >
                  <X size={14} className="text-rose-500" />
                  <span>关闭桌面窗口</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Dock Background Context Menu */}
      {dockSettingsMenu && (
        <div
          ref={dockSettingsMenuRef}
          style={{
            top: Math.max(10, dockSettingsMenu.y),
            left: dockSettingsMenu.x,
          }}
          className="fixed z-[1200] w-56 rounded-2xl p-2 liquid-glass bg-white/95 dark:bg-[#181d28]/95 backdrop-blur-2xl border border-slate-300/90 dark:border-white/15 shadow-2xl text-xs select-none animate-in fade-in zoom-in-95 duration-100 ring-1 ring-black/5 dark:ring-white/10"
          onClick={e => e.stopPropagation()}
        >
          <div className="px-2.5 py-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between border-b border-slate-200/60 dark:border-white/10 mb-1.5">
            <span>{language === 'en' ? 'Taskbar settings' : '任务栏设置'}</span>
            <span className="text-[10px] text-sky-500 font-mono">{iconSize}px</span>
          </div>

          <div className="flex flex-col gap-1">
            {/* Dock Size Slider */}
            <div className="px-2.5 py-1.5 rounded-xl bg-black/5 dark:bg-white/5 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Sliders size={13} className="text-sky-500" />
                  <span>大小调整</span>
                </span>
                <span className="font-mono text-slate-500">{iconSize}px</span>
              </div>
              <input
                type="range"
                min="34"
                max="74"
                value={iconSize}
                onChange={async e => {
                  const val = Number(e.target.value);
                  await saveIconSize(val);
                }}
                className="w-full accent-sky-500 cursor-pointer h-1.5 bg-slate-200 dark:bg-white/10 rounded-lg"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>小 (34px)</span>
                <span>标准 (48px)</span>
                <span>大 (74px)</span>
              </div>
            </div>

            {/* Hide Dock Option */}
            <button
              onClick={async () => {
                if (await saveDockSettings({ showDock: false })) setDockSettingsMenu(null);
              }}
              className="flex items-center gap-2 w-full px-2.5 py-2 rounded-xl text-slate-800 dark:text-slate-200 hover:bg-sky-500 hover:text-white transition-colors cursor-pointer"
            >
              <EyeOff size={14} className="text-slate-500" />
              <span>{language === 'en' ? 'Hide Taskbar' : '隐藏任务栏'}</span>
            </button>

            {/* Reset Size */}
            <div className="pt-1 mt-1 border-t border-slate-200/60 dark:border-white/10">
              <button
                onClick={async () => {
                  if (await handleResetSize()) setDockSettingsMenu(null);
                }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-xl text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                <RotateCcw size={13} />
                <span>恢复默认大小 (48px)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

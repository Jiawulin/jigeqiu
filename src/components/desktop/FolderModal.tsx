import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder,
  Bookmark,
  Category,
} from '../../types';
import { FaviconImage } from '../common/FaviconImage';
import { Modal } from '../common/Modal';
import { BookmarkDialog } from '../common/BookmarkDialog';
import { refreshSiteIcon } from '../../services/site-icons';
import { preferenceSaveError } from '../../services/preference-save-error';
import {
  Edit3,
  ExternalLink,
  MinusCircle,
  Share2,
  Trash2,
  Check,
  Plus,
  AppWindow,
  Pin,
  PinOff,
  FolderOpen,
  FolderTree,
  FolderPlus,
  Folder as FolderIcon,
  Edit,
  Copy,
  Library,
  RefreshCw,
  ChevronRight,
} from 'lucide-react';

interface FolderModalProps {
  folder: Folder | null;
  allBookmarks: Bookmark[];
  categories?: Category[];
  folders?: Folder[];
  dockBookmarkIds?: string[];
  desktopBookmarkIds?: string[];
  isOpen: boolean;
  onClose: () => void;
  onOpenBookmark: (bookmark: Bookmark) => void;
  onOpenBookmarkInWindow?: (bookmark: Bookmark) => void;
  onRenameFolder: (folderId: string, newName: string) => void | Promise<void>;
  onRemoveFromFolder: (folderId: string, bookmarkId: string) => void | Promise<void>;
  onDeleteFolder: (folderId: string) => void | Promise<void>;
  onSaveFolderAsCollection?: (folder: Folder) => void;
  onAddMoreBookmarks: (folderId: string) => void;
  onToggleDockBookmark?: (bookmarkId: string) => boolean | void | Promise<boolean | void>;
  onUpdateBookmark?: (bookmarkId: string, updates: Partial<Bookmark>) => void | Promise<void>;
  onDeleteBookmark?: (bookmarkId: string) => void | Promise<void>;
  onMoveToFolder?: (bookmarkIds: string[], folderId: string) => void | Promise<void>;
  onShowToast?: (message: string) => void;
  onCreateFolder?: (name: string, parentId?: string) => Folder | Promise<Folder>;
  onManageBookmark?: (bookmark: Bookmark) => void;
  onTogglePinDesktop?: (bookmarkId: string) => void | Promise<void>;
}

export const FolderModal: React.FC<FolderModalProps> = ({
  folder,
  allBookmarks,
  categories = [],
  folders = [],
  dockBookmarkIds = [],
  desktopBookmarkIds,
  isOpen,
  onClose,
  onOpenBookmark,
  onOpenBookmarkInWindow,
  onRenameFolder,
  onRemoveFromFolder,
  onDeleteFolder,
  onSaveFolderAsCollection,
  onAddMoreBookmarks,
  onToggleDockBookmark,
  onUpdateBookmark,
  onDeleteBookmark,
  onMoveToFolder,
  onShowToast,
  onCreateFolder,
  onManageBookmark,
  onTogglePinDesktop,
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');

  // Right-click context menu state for bookmarks inside the folder
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    bookmark: Bookmark;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Quick edit bookmark inside folder
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const reportError = (message: string) => {
    setError(message);
    onShowToast?.(message);
  };
  const runMutation = async (action: () => boolean | void | Promise<boolean | void>) => {
    if (saving.current) return;
    saving.current = true;
    setError('');
    try { await action(); }
    catch (cause) { reportError(preferenceSaveError(cause, undefined, 'library')); }
    finally { saving.current = false; }
  };

  // Listeners to dismiss context menu
  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  if (!folder) return null;

  const folderBookmarks = folder.bookmarkIds
    .map(id => allBookmarks.find(b => b.id === id))
    .filter((b): b is Bookmark => Boolean(b));

  const handleStartEdit = () => {
    setNameValue(folder.name);
    setIsEditingName(true);
  };

  const handleSaveName = () => runMutation(async () => {
    if (nameValue.trim() && nameValue.trim() !== folder.name) {
      await onRenameFolder(folder.id, nameValue.trim());
    }
    setIsEditingName(false);
  });

  const handleOpenContextMenu = (e: React.MouseEvent, bm: Bookmark) => {
    e.preventDefault();
    e.stopPropagation();
    setError('');

    const menuWidth = 220;
    const menuHeight = 320;
    const padding = 12;

    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth - padding) {
      x = window.innerWidth - menuWidth - padding;
    }
    if (y + menuHeight > window.innerHeight - padding) {
      y = window.innerHeight - menuHeight - padding;
    }

    setContextMenu({
      x: Math.max(padding, x),
      y: Math.max(padding, y),
      bookmark: bm,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (editingBookmark || saving.current) return;
        if (contextMenu) setContextMenu(null);
        else onClose();
      }}
      maxWidth="2xl"
      title={
        <div className="flex items-center gap-2">
          {isEditingName ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={nameValue}
                onChange={e => setNameValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') setIsEditingName(false);
                }}
                autoFocus
                className="px-2.5 py-1 text-base font-semibold rounded-lg bg-black/5 dark:bg-white/10 border border-sky-400 focus:outline-none"
              />
              <button
                onClick={handleSaveName}
                className="p-1 rounded-md text-sky-500 hover:bg-sky-50 transition-colors cursor-pointer"
                title="保存"
              >
                <Check size={18} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group cursor-pointer" onClick={handleStartEdit}>
              <span className="text-lg font-semibold">{folder.name}</span>
              <Edit3
                size={14}
                className="text-slate-400 opacity-60 group-hover:opacity-100 transition-opacity"
              />
            </div>
          )}
          <span className="text-xs text-slate-400 font-normal">
            ({folderBookmarks.length} 个网址 · 支持右键菜单)
          </span>
        </div>
      }
    >
      {error && <p role="alert" className="mb-2 text-xs text-rose-600 dark:text-rose-300">{error}</p>}
      {/* Grid of Bookmarks inside Folder */}
      <div className="py-2">
        {folderBookmarks.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">
            该文件夹暂无网址，请从桌面拖入或点击下方添加
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4 sm:gap-6 py-2">
            {folderBookmarks.map(bm => (
              <div
                key={bm.id}
                className="group relative flex flex-col items-center p-3 rounded-2xl hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-200 cursor-pointer select-none"
                onClick={() => {
                  onOpenBookmark(bm);
                  onClose();
                }}
                onContextMenu={e => handleOpenContextMenu(e, bm)}
                title={`${bm.title}\n左键在外部新标签打开 · 右键唤起完整操作菜单`}
              >
                {/* Open in Desktop Window Button */}
                {onOpenBookmarkInWindow && (
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      onOpenBookmarkInWindow(bm);
                      onClose();
                    }}
                    className="absolute top-1 left-1 p-1 rounded-full text-slate-400 hover:text-sky-500 opacity-0 group-hover:opacity-100 transition-all z-10 bg-white/80 dark:bg-slate-800/80 shadow-xs cursor-pointer"
                    title="在桌面窗口打开"
                  >
                    <AppWindow size={14} />
                  </button>
                )}

                {/* Remove button */}
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    void runMutation(() => onRemoveFromFolder(folder.id, bm.id));
                  }}
                  className="absolute top-1 right-1 p-1 rounded-full text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all z-10 bg-white/80 dark:bg-slate-800/80 shadow-xs cursor-pointer"
                  title="移出文件夹"
                >
                  <MinusCircle size={15} />
                </button>

                {/* Bookmark Icon */}
                <div className="w-14 h-14 flex items-center justify-center transition-transform group-hover:scale-105 duration-200 mb-2">
                  <FaviconImage url={bm.url} title={bm.title} icon={bm.icon} iconMode={bm.iconMode} iconBg={bm.iconBg} size="lg" className="w-full h-full" />
                </div>

                {/* Bookmark Title */}
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200 text-center line-clamp-2 max-w-full px-1 break-words">
                  {bm.title}
                </span>
              </div>
            ))}

            {/* Quick Add into Folder */}
            <button
              onClick={() => onAddMoreBookmarks(folder.id)}
              className="flex flex-col items-center justify-center p-3 rounded-2xl border-2 border-dashed border-slate-300 dark:border-white/15 hover:border-sky-400 hover:bg-sky-50/20 transition-all duration-200 group text-slate-400 hover:text-sky-500 cursor-pointer"
            >
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-black/5 dark:bg-white/5 mb-2 group-hover:scale-105 transition-transform">
                <Plus size={22} />
              </div>
              <span className="text-xs font-medium">添加网址</span>
            </button>
          </div>
        )}
      </div>

      {/* Floating Right-Click Context Menu inside Folder Modal */}
      {contextMenu && (() => {
        const bm = contextMenu.bookmark;
        const isInDock = dockBookmarkIds.includes(bm.id);
        const isOnDesktop = desktopBookmarkIds ? desktopBookmarkIds.includes(bm.id) : bm.pinnedToDesktop;

        return createPortal(
          <div
            ref={contextMenuRef}
            style={{
              top: contextMenu.y,
              left: contextMenu.x,
            }}
            className="fixed z-[9999] w-60 rounded-2xl p-1.5 liquid-glass bg-white/95 dark:bg-[#181d28]/95 backdrop-blur-2xl border border-slate-300/90 dark:border-white/15 shadow-2xl text-xs select-none animate-in fade-in zoom-in-95 duration-100 ring-1 ring-black/5 dark:ring-white/10"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-col gap-0.5">
              {/* Header Preview */}
              <div className="flex items-center gap-2.5 px-2.5 py-2 mb-1 rounded-xl bg-slate-100/70 dark:bg-white/5 border border-slate-200/60 dark:border-white/5">
                <div className="flex w-7 h-7 items-center justify-center shrink-0">
                  <FaviconImage
                    url={bm.url}
                    title={bm.title}
                    icon={bm.icon}
                    iconMode={bm.iconMode}
                    iconBg={bm.iconBg}
                    size="sm"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-slate-900 dark:text-slate-100 truncate text-[11px]">
                    {bm.title}
                  </div>
                  <div className="font-mono text-[9px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {bm.domain}
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium">
                      📁 {folder.name}
                    </span>
                    {isInDock && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-sky-500/15 text-sky-700 dark:text-sky-300 font-medium">
                        任务栏
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Action 2: Open in New Tab */}
              <button
                onClick={() => {
                  setContextMenu(null);
                  onOpenBookmark(bm);
                  onClose();
                }}
                className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-xl text-slate-800 dark:text-slate-200 hover:bg-sky-500 hover:text-white transition-colors cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <ExternalLink size={14} className="text-slate-500 group-hover:text-white" />
                  <span>在新标签页打开</span>
                </div>
                <span className="text-[10px] opacity-60 font-mono">↵</span>
              </button>

              {onUpdateBookmark && <button
                onClick={() => {
                  setContextMenu(null);
                  setEditingBookmark(bm);
                }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-xl text-slate-800 dark:text-slate-200 hover:bg-sky-500 hover:text-white transition-colors cursor-pointer group"
              >
                <Edit size={14} className="text-slate-500 group-hover:text-white" />
                <span>编辑收藏</span>
              </button>}
              <button
                onClick={async () => {
                  setContextMenu(null);
                  try {
                    await navigator.clipboard.writeText(bm.url);
                    onShowToast?.('已复制网址到剪贴板');
                  } catch {
                    reportError('复制失败，请在收藏管理中复制网址');
                  }
                }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-xl text-slate-800 dark:text-slate-200 hover:bg-sky-500 hover:text-white transition-colors cursor-pointer group"
              >
                <Copy size={14} className="text-slate-500 group-hover:text-white" />
                <span>复制网址</span>
              </button>
              <div role="separator" className="my-1 border-t border-slate-200/80 dark:border-white/10" />

              {onTogglePinDesktop && <button
                onClick={() => {
                  setContextMenu(null);
                  void runMutation(() => onTogglePinDesktop(bm.id));
                }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-xl text-slate-800 dark:text-slate-200 hover:bg-sky-500 hover:text-white transition-colors cursor-pointer"
              >
                {isOnDesktop ? <PinOff size={14} /> : <Pin size={14} />}
                <span>{isOnDesktop ? '从桌面移除' : '固定到桌面'}</span>
              </button>}
              {/* Action 3: Dock Toggle */}
              {onToggleDockBookmark && (
                <button
                  onClick={() => {
                    setContextMenu(null);
                    void runMutation(() => onToggleDockBookmark(bm.id));
                  }}
                  className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-xl text-slate-800 dark:text-slate-200 hover:bg-sky-500 hover:text-white transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-2">
                    {isInDock ? (
                      <PinOff size={14} className="text-amber-500 group-hover:text-white" />
                    ) : (
                      <Pin size={14} className="text-sky-500 group-hover:text-white" />
                    )}
                    <span>{isInDock ? '从任务栏取消固定' : '固定到任务栏'}</span>
                  </div>
                  {isInDock && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300 group-hover:bg-white/20 group-hover:text-white font-medium">
                      已固定
                    </span>
                  )}
                </button>
              )}

              <div className="my-1 border-t border-slate-200/80 dark:border-white/10" />

              {/* Action 4: Remove from Folder to Desktop */}
              <button
                onClick={() => {
                  setContextMenu(null);
                  void runMutation(async () => {
                    await onRemoveFromFolder(folder.id, bm.id);
                    onShowToast?.(`已将「${bm.title}」移出文件夹并恢复为独立桌面快捷方式`);
                  });
                }}
                className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-xl text-slate-800 dark:text-slate-200 hover:bg-sky-500 hover:text-white transition-colors cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <FolderOpen size={14} className="text-amber-500 group-hover:text-white" />
                  <span>移出文件夹 (恢复桌面快捷方式)</span>
                </div>
                <span className="text-[9px] text-slate-400 group-hover:text-white/80">快捷方式</span>
              </button>

              {/* Action 5: Change Category (更改所属分类) */}
              {categories.length > 0 && (
                <div className="relative group/category">
                  <div className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-xl text-slate-800 dark:text-slate-200 hover:bg-sky-500 hover:text-white transition-colors cursor-pointer group">
                    <div className="flex items-center gap-2">
                      <FolderTree size={14} className="text-indigo-500 group-hover:text-white" />
                      <span>更改所属分类</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] opacity-70">
                        {categories.find(c => c.id === bm.category)?.name || '未分类'}
                      </span>
                      <ChevronRight size={12} className="opacity-60" />
                    </div>
                  </div>

                  {/* Submenu */}
                  <div className="hidden group-hover/category:flex flex-col gap-0.5 absolute left-full top-0 ml-1 w-48 p-1.5 rounded-2xl liquid-glass bg-white/95 dark:bg-[#181d28]/95 backdrop-blur-2xl border border-slate-300/90 dark:border-white/15 shadow-2xl z-50 max-h-60 overflow-y-auto">
                    {categories.map(c => {
                      const isCurrent = bm.category === c.id;
                      return (
                        <button
                          key={c.id}
                          onClick={() => {
                            setContextMenu(null);
                            void runMutation(async () => {
                              await onUpdateBookmark?.(bm.id, { category: c.id });
                              onShowToast?.(`已将「${bm.title}」移动至分类「${c.name}」`);
                            });
                          }}
                          className={`flex items-center justify-between w-full px-2 py-1.5 rounded-xl text-left truncate text-xs cursor-pointer transition-colors ${
                            isCurrent
                              ? 'bg-sky-500/15 text-sky-600 dark:text-sky-300 font-bold'
                              : 'text-slate-800 dark:text-slate-200 hover:bg-sky-500 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs"
                              style={{ backgroundColor: c.color || '#0ea5e9' }}
                            />
                            <span className="truncate">{c.name}</span>
                          </div>
                          {isCurrent && <Check size={12} className="shrink-0 text-sky-500" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Action 6: Move to Another Folder */}
              {folders.filter(f => f.id !== folder.id).length > 0 && onMoveToFolder && (
                <div className="relative group/folder">
                  <div className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-xl text-slate-800 dark:text-slate-200 hover:bg-sky-500 hover:text-white transition-colors cursor-pointer group">
                    <div className="flex items-center gap-2">
                      <FolderPlus size={14} className="text-amber-500 group-hover:text-white" />
                      <span>移动至其他文件夹</span>
                    </div>
                    <ChevronRight size={12} className="opacity-60" />
                  </div>

                  {/* Submenu */}
                  <div className="hidden group-hover/folder:flex flex-col gap-0.5 absolute left-full top-0 ml-1 w-44 p-1.5 rounded-2xl liquid-glass bg-white/95 dark:bg-[#181d28]/95 backdrop-blur-2xl border border-slate-300/90 dark:border-white/15 shadow-2xl z-50">
                    {folders
                      .filter(f => f.id !== folder.id)
                      .map(f => (
                        <button
                          key={f.id}
                          onClick={() => {
                            setContextMenu(null);
                            void runMutation(async () => {
                              await onMoveToFolder([bm.id], f.id);
                              onShowToast?.(`已将「${bm.title}」移动至文件夹「${f.name}」`);
                            });
                          }}
                          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-xl text-slate-800 dark:text-slate-200 hover:bg-sky-500 hover:text-white text-left truncate text-xs cursor-pointer"
                        >
                          <FolderIcon size={12} className="text-amber-500 shrink-0" />
                          <span className="truncate">{f.name}</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {(bm.iconMode !== 'text' || onManageBookmark) && <div role="separator" className="my-1 border-t border-slate-200/80 dark:border-white/10" />}
              {bm.iconMode !== 'text' && <button
                onClick={async () => {
                  setContextMenu(null);
                  try { await refreshSiteIcon(bm); }
                  catch { reportError('未能获取新图标，保留原图标'); }
                }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-xl text-slate-800 dark:text-slate-200 hover:bg-sky-500 hover:text-white transition-colors cursor-pointer"
              ><RefreshCw size={14} /><span>刷新网站图标</span></button>}
              {onManageBookmark && <button
                onClick={() => {
                  setContextMenu(null);
                  onManageBookmark(bm);
                  onClose();
                }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-xl text-slate-800 dark:text-slate-200 hover:bg-sky-500 hover:text-white transition-colors cursor-pointer"
              ><Library size={14} /><span>在全部收藏中定位</span></button>}

              <div className="my-1 border-t border-slate-200/80 dark:border-white/10" />

              {/* Delete the library bookmark, not just its shortcut. */}
              {onDeleteBookmark && (
                <button
                  onClick={() => {
                    setContextMenu(null);
                    if (confirm(`将收藏「${bm.title}」移至回收站并移除快捷方式？可在管理中心恢复收藏。`)) {
                      void runMutation(() => onDeleteBookmark(bm.id));
                    }
                  }}
                  className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer font-medium"
                >
                  <div className="flex items-center gap-2">
                    <Trash2 size={14} className="text-rose-500" />
                    <span>删除收藏…</span>
                  </div>
                  <span className="text-[9px] text-rose-500/80">永久删除</span>
                </button>
              )}
            </div>
          </div>,
          document.body
        );
      })()}

      {/* Edit Bookmark Modal inside Folder */}
      {editingBookmark && onUpdateBookmark && <BookmarkDialog
        isOpen={isOpen}
        onClose={() => setEditingBookmark(null)}
        bookmark={editingBookmark}
        folders={folders}
        existingBookmarks={allBookmarks}
        onCreateFolder={onCreateFolder}
        onOpenExisting={onOpenBookmark}
        onEditExisting={setEditingBookmark}
        onSave={input => onUpdateBookmark(editingBookmark.id, { ...editingBookmark, ...input })}
      />}

      {/* Footer Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-5 mt-4 border-t border-slate-200/50 dark:border-white/10 text-xs">
        <div className="flex items-center gap-2">
          {onSaveFolderAsCollection && <button
            onClick={() => onSaveFolderAsCollection(folder)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 font-medium transition-colors cursor-pointer"
          >
            <Share2 size={13} />
            <span>保存为网址单</span>
          </button>}
        </div>

        <button
          onClick={() => {
            if (confirm(`确定解散文件夹「${folder.name}」吗？内部网址将保留在收藏中。`)) {
              void runMutation(async () => {
                await onDeleteFolder(folder.id);
                onClose();
              });
            }
          }}
          className="flex items-center gap-1 text-slate-400 hover:text-rose-500 transition-colors p-1 cursor-pointer"
        >
          <Trash2 size={13} />
          <span>解散文件夹</span>
        </button>
      </div>
    </Modal>
  );
};

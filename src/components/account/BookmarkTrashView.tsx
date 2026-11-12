import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, Loader2, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { Bookmark, Folder } from '../../types';
import type { FolderTrashEntry } from '../../services/folder-trash';
import { preferenceSaveError } from '../../services/preference-save-error';
import { withCollectionMutation } from '../../services/collection-mutation';
import { Modal } from '../common/Modal';
import { createTranslator } from '../../i18n';
import { Pagination } from '../common/Pagination';

export interface BookmarkTrashViewProps {
  entries: Array<{ id: string; deletedAt: number; bookmark: Bookmark; folderIndex: number }>;
  folders: Folder[];
  language?: string;
  onRestore(id: string): void | Promise<void>;
  onPurge(id: string): void | Promise<void>;
  folderEntries?: FolderTrashEntry[];
  onRestoreFolder?(id: string): void | Promise<void>;
  onPurgeFolder?(id: string): void | Promise<void>;
}

type TrashKind = 'bookmark' | 'folder';
function trashErrorCode(cause: unknown): string {
  return typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
    ? cause.code : cause instanceof Error ? cause.message : '';
}
function isKnownSaveError(cause: unknown): boolean {
  const code = trashErrorCode(cause);
  return ['COMMIT_UNCERTAIN', 'CONFLICT', 'LOCK_UNAVAILABLE', 'QUOTA_EXCEEDED',
    'SecurityError', 'STORAGE_UNAVAILABLE', 'INVALID_REFERENCE'].includes(code)
    || (cause instanceof Error && ['QuotaExceededError', 'SecurityError'].includes(cause.name));
}
const iconButton = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50';
const dialogButton = 'inline-flex min-h-9 min-w-0 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50';

export function BookmarkTrashView({
  entries, folders, language, onRestore, onPurge, folderEntries = [], onRestoreFolder, onPurgeFolder,
}: BookmarkTrashViewProps) {
  const t = createTranslator(language);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [purgeTarget, setPurgeTarget] = useState<{ id: string; kind: TrashKind } | null>(null);
  const [pending, setPending] = useState<{ id: string; kind: TrashKind; action: 'restore' | 'purge' } | null>(null);
  const [error, setError] = useState<{ kind: TrashKind; action: 'restore' | 'purge'; cause: unknown } | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const target = purgeTarget?.kind === 'bookmark' ? entries.find(entry => entry.id === purgeTarget.id) : undefined;
  const folderTarget = purgeTarget?.kind === 'folder' ? folderEntries.find(entry => entry.id === purgeTarget.id) : undefined;
  const hasTarget = Boolean(target || folderTarget);
  const folderName = (entry: FolderTrashEntry) =>
    entry.folders.find(({ folder }) => folder.id === entry.rootId)?.folder.name || t('unnamedFolder');
  const folderCounts = (entry: FolderTrashEntry) => t('trashFolderCounts', {
    folders: t(entry.folders.length === 1 ? 'countFolderOne' : 'countFolderMany', { count: entry.folders.length }),
    bookmarks: t(entry.bookmarks.length === 1 ? 'countBookmarkOne' : 'countBookmarkMany', { count: entry.bookmarks.length }),
  });
  const needle = query.trim().toLocaleLowerCase();
  const visible = entries.filter(({ bookmark }) => [
    bookmark.title, bookmark.url, bookmark.notes ?? '',
    ...(bookmark.keywords ?? []), ...(bookmark.tags ?? []),
  ].some(value => value.toLocaleLowerCase().includes(needle)));
  const visibleFolders = folderEntries.filter(entry => [
    ...entry.folders.map(({ folder }) => folder.name),
    ...entry.bookmarks.flatMap(({ bookmark }) => [
      bookmark.title, bookmark.url, ...(bookmark.keywords ?? []),
    ]),
  ].some(value => value.toLocaleLowerCase().includes(needle)));
  const count = entries.length + folderEntries.length;
  // Keep the existing bookmark-then-folder order across one shared page boundary.
  const filtered = [
    ...visible.map(entry => ({ kind: 'bookmark' as const, entry })),
    ...visibleFolders.map(entry => ({ kind: 'folder' as const, entry })),
  ];
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(currentPage); }, [currentPage]);
  const errorMessage = !error ? '' : error.action === 'restore' && trashErrorCode(error.cause) === 'DUPLICATE'
    ? t(error.kind === 'folder' ? 'restoreFolderDuplicate' : 'restoreBookmarkDuplicate') : isKnownSaveError(error.cause)
    ? preferenceSaveError(error.cause, language, 'library') : error.kind === 'folder'
    ? t(error.action === 'restore' ? 'restoreFolderError' : 'purgeFolderError')
    : t(error.action === 'restore' ? 'restoreBookmarkError' : 'purgeBookmarkError');

  function closeConfirmation() {
    if (running.current) return;
    setPurgeTarget(null);
    setError(null);
  }

  async function run(id: string, action: 'restore' | 'purge', kind: TrashKind = 'bookmark') {
    const records = kind === 'folder' ? folderEntries : entries;
    const callback = kind === 'folder'
      ? action === 'restore' ? onRestoreFolder : onPurgeFolder
      : action === 'restore' ? onRestore : onPurge;
    if (running.current || !callback || !records.some(entry => entry.id === id)) return;
    running.current = true;
    setPending({ id, action, kind });
    setError(null);
    try {
      await withCollectionMutation(() => callback(id), () => mounted.current);
      if (mounted.current && action === 'purge') setPurgeTarget(null);
    } catch (cause) {
      if (mounted.current) setError({ action, kind, cause });
    } finally {
      running.current = false;
      if (mounted.current) setPending(null);
    }
  }

  return <section aria-label={t('trashTitle')} className="min-w-0 w-full text-slate-900 dark:text-slate-100">
    <header className="mb-4 flex min-w-0 items-center gap-2">
      <Trash2 size={18} className="shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
      <h2 className="min-w-0 break-words text-base font-semibold">{t('trashTitle')}</h2>
      <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{count}</span>
    </header>
    <div className="relative mb-3 min-w-0">
      <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-slate-500 dark:text-slate-400" />
      <input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }}
        aria-label={t('trashSearch')} placeholder={t('trashSearch')}
        className="h-10 min-w-0 w-full rounded-md border border-slate-300/80 bg-white/70 pr-3 pl-9 text-sm text-slate-900 outline-none focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-white/20 dark:bg-black/20 dark:text-slate-100" />
    </div>
    {errorMessage && !hasTarget && <p role="alert" className="mb-3 break-words text-sm text-rose-700 dark:text-rose-300">{errorMessage}</p>}
    {visible.length === 0 && visibleFolders.length === 0 ? <div role="status" className="flex min-w-0 flex-col items-center gap-2 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
      <Trash2 size={24} aria-hidden="true" />
      <p className="max-w-full break-words">{t(count === 0 ? 'trashEmpty' : folderEntries.length > 0
        ? 'trashNoItems' : 'trashNoResults')}</p>
    </div> : <ul aria-busy={pending !== null} className="min-w-0 divide-y divide-slate-200/80 dark:divide-white/10">
      {pageItems.flatMap(item => item.kind === 'bookmark' ? [item.entry] : []).map(entry => {
        const { bookmark } = entry;
        const originalFolder = folders.find(folder => folder.id === bookmark.folderId);
        const deletedAt = new Date(entry.deletedAt);
        const validDate = Number.isFinite(deletedAt.getTime());
        return <li key={`bookmark:${entry.id}`} className="flex min-w-0 items-start gap-2 py-3">
          <div className="min-w-0 flex-1">
            <p title={bookmark.title} className="truncate text-sm font-medium">{bookmark.title || bookmark.url}</p>
            <p title={bookmark.url} className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{bookmark.url}</p>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span title={t('originalFolder')} className="flex min-w-0 max-w-full items-center gap-1">
                <FolderOpen size={13} aria-hidden="true" className="shrink-0" />
                <span className="truncate">{t('originalFolder')}: {originalFolder?.name || t('trashRoot')}</span>
              </span>
              <span className="min-w-0 max-w-full break-words">
                {t('deletedAt')}: <time dateTime={validDate ? deletedAt.toISOString() : undefined}>
                  {validDate ? deletedAt.toLocaleString(t('trashDateLocale'), {
                    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  }) : '-'}
                </time>
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button type="button" aria-label={t('restoreBookmark')} title={t('restoreBookmark')} disabled={pending !== null}
              onClick={() => run(entry.id, 'restore')}
              className={`${iconButton} text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-400/10`}>
              {pending?.kind === 'bookmark' && pending.id === entry.id && pending.action === 'restore'
                ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={16} aria-hidden="true" />}
            </button>
            <button type="button" aria-label={t('purgeBookmark')} title={t('purgeBookmark')} disabled={pending !== null}
              onClick={() => { if (!running.current) { setError(null); setPurgeTarget({ id: entry.id, kind: 'bookmark' }); } }}
              className={`${iconButton} text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-400/10`}>
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        </li>;
      })}
      {pageItems.flatMap(item => item.kind === 'folder' ? [item.entry] : []).map(entry => {
        const root = entry.folders.find(({ folder }) => folder.id === entry.rootId)?.folder;
        const parent = folders.find(folder => folder.id === root?.parentId);
        const deletedAt = new Date(entry.deletedAt);
        const validDate = Number.isFinite(deletedAt.getTime());
        return <li key={`folder:${entry.id}`} className="flex min-w-0 items-start gap-2 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <FolderOpen size={15} aria-hidden="true" className="shrink-0 text-sky-700 dark:text-sky-300" />
              <p title={folderName(entry)} className="min-w-0 truncate text-sm font-medium">{folderName(entry)}</p>
            </div>
            <p className="mt-0.5 break-words text-xs text-slate-500 dark:text-slate-400">{folderCounts(entry)}</p>
            <p title={`${t('originalParent')}: ${parent?.name || t('trashRoot')}`}
              className="mt-1.5 truncate text-xs text-slate-500 dark:text-slate-400">
              {t('originalParent')}: {parent?.name || t('trashRoot')}
            </p>
            <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
              {t('deletedAt')}: <time dateTime={validDate ? deletedAt.toISOString() : undefined}>
                {validDate ? deletedAt.toLocaleString(t('trashDateLocale'), {
                  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                }) : '-'}
              </time>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button type="button" aria-label={t('restoreFolder')} title={t('restoreFolder')}
              disabled={pending !== null || !onRestoreFolder} onClick={() => run(entry.id, 'restore', 'folder')}
              className={`${iconButton} text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-400/10`}>
              {pending?.kind === 'folder' && pending.id === entry.id && pending.action === 'restore'
                ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={16} aria-hidden="true" />}
            </button>
            <button type="button" aria-label={t('purgeFolder')} title={t('purgeFolder')}
              disabled={pending !== null || !onPurgeFolder}
              onClick={() => { if (!running.current && onPurgeFolder) { setError(null); setPurgeTarget({ id: entry.id, kind: 'folder' }); } }}
              className={`${iconButton} text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-400/10`}>
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        </li>;
      })}
    </ul>}
    <Pagination total={filtered.length} page={currentPage} pageSize={pageSize} language={language}
      summary={t('trashFilteredCount', { count: filtered.length })}
      disabled={pending !== null} onPageChange={setPage}
      onPageSizeChange={size => { setPageSize(size); setPage(1); }} />
    <Modal isOpen={hasTarget} onClose={closeConfirmation} title={t(purgeTarget?.kind === 'folder' ? 'purgeFolderTitle' : 'purgeBookmarkTitle')}
      contained maxWidth="sm" showCloseButton={false}>
      <div aria-busy={pending !== null} className="min-w-0">
        <p className="break-words text-sm">{t(purgeTarget?.kind === 'folder' ? 'purgeFolderWarning' : 'purgeBookmarkWarning')}</p>
        <p className="mt-3 break-all text-sm font-medium">{folderTarget
          ? folderName(folderTarget) : target?.bookmark.title || target?.bookmark.url}</p>
        <p className="mt-1 break-all text-xs text-slate-500 dark:text-slate-400">{folderTarget
          ? folderCounts(folderTarget) : target?.bookmark.url}</p>
        {errorMessage && <p role="alert" className="mt-3 break-words text-sm text-rose-700 dark:text-rose-300">{errorMessage}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" aria-label={t('cancel')} disabled={pending !== null} onClick={closeConfirmation}
            className={`${dialogButton} border-slate-300 text-slate-700 hover:bg-black/5 dark:border-white/20 dark:text-slate-200 dark:hover:bg-white/10`}>
            {t('cancel')}
          </button>
          <button type="button" aria-label={t(purgeTarget?.kind === 'folder' ? 'purgeFolderConfirm' : 'purgeBookmarkConfirm')}
            disabled={pending !== null || !hasTarget || (purgeTarget?.kind === 'folder' && !onPurgeFolder)}
            onClick={() => hasTarget && purgeTarget ? run(purgeTarget.id, 'purge', purgeTarget.kind) : undefined}
            className={`${dialogButton} border-rose-700 bg-rose-700 text-white hover:bg-rose-800 dark:border-rose-600 dark:bg-rose-600 dark:hover:bg-rose-700`}>
            {pending?.action === 'purge' ? <Loader2 size={16} className="shrink-0 animate-spin" aria-hidden="true" />
              : <Trash2 size={16} className="shrink-0" aria-hidden="true" />}
            <span className="break-words">{t('purgeConfirm')}</span>
          </button>
        </div>
      </div>
    </Modal>
  </section>;
}

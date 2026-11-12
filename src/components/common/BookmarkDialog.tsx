import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, Edit, ExternalLink, Link, Pin } from 'lucide-react';
import type { Bookmark, Folder } from '../../types';
import { normalizeBookmarkUrl } from '../../services/bookmark-input';
import { bookmarkFormInput, defaultBookmarkTitle, findDuplicateBookmark } from '../../services/bookmark-form';
import { fetchBookmarkTitle } from '../../services/bookmark-title';
import { withCollectionMutation } from '../../services/collection-mutation';
import { preferenceSaveError } from '../../services/preference-save-error';
import { Modal } from './Modal';
import { SiteIconPicker, type SiteIconChoice } from './SiteIconPicker';
import { FolderTreeSelect } from './FolderTreeSelect';
import { BookmarkKeywordsInput } from './BookmarkKeywordsInput';
import { createTranslator } from '../../i18n';
import { TaskHint } from '../onboarding/TaskHint';
import type { OnboardingTaskContext } from '../onboarding/types';

export interface BookmarkDialogProps {
  isOpen: boolean;
  onClose: () => void;
  bookmark?: Bookmark;
  folders: Folder[];
  existingBookmarks: Bookmark[];
  initialUrl?: string;
  initialTitle?: string;
  initialFolderId?: string;
  defaultPinToDesktop?: boolean;
  desktopFolderName?: string;
  language?: string;
  onboarding?: OnboardingTaskContext;
  onSave: (input: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'>, pinToDesktop: boolean) => void | Promise<void>;
  onCreateFolder?: (name: string, parentId?: string) => Folder | Promise<Folder>;
  onOpenExisting?: (bookmark: Bookmark) => void;
  onEditExisting?: (bookmark: Bookmark) => void;
}

const inputClass = 'w-full min-w-0 rounded-lg border border-slate-200 bg-black/[0.025] px-3 py-2.5 text-sm outline-none transition-colors focus:border-sky-500 dark:border-white/15 dark:bg-white/5';

type DialogError = {
  key: 'enterWebsiteName' | 'bookmarkConflict' | 'bookmarkLockUnavailable' | 'draftDownloadFailed'
    | 'bookmarkDuplicate' | 'bookmarkInvalidIcon' | 'bookmarkSaveFallback';
} | { cause: unknown };

export function BookmarkDialog(props: BookmarkDialogProps) {
  if (!props.isOpen) return null;
  return <BookmarkDialogSession key={props.bookmark?.id ?? 'new'} {...props} />;
}

function BookmarkDialogSession({
  onClose, bookmark, folders, existingBookmarks, initialUrl = '', initialTitle, initialFolderId,
  defaultPinToDesktop = false, desktopFolderName, language, onboarding,
  onSave, onCreateFolder, onOpenExisting, onEditExisting,
}: BookmarkDialogProps) {
  const t = createTranslator(language);
  const [url, setUrl] = useState(bookmark?.url ?? initialUrl);
  const [title, setTitle] = useState(bookmark?.title ?? (initialTitle?.trim() || defaultBookmarkTitle(initialUrl)));
  const titleEdited = useRef(Boolean(bookmark || initialTitle?.trim()));
  const [folderId, setFolderId] = useState(bookmark ? bookmark.folderId : initialFolderId);
  const [keywords, setKeywords] = useState(bookmark?.keywords ?? []);
  const [icon, setIcon] = useState<SiteIconChoice>({
    icon: bookmark?.icon,
    iconMode: bookmark?.iconMode ?? (bookmark?.icon ? 'custom' : 'auto'),
  });
  const [pinToDesktop, setPinToDesktop] = useState(defaultPinToDesktop);
  const [failure, setFailure] = useState<DialogError | null>(null);
  const error = failure ? 'key' in failure ? t(failure.key) : preferenceSaveError(failure.cause, language, 'library') : '';
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const titleRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const downloads = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const [url, timer] of downloads.current) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      downloads.current.clear();
    };
  }, []);
  useEffect(() => {
    if (bookmark || titleEdited.current) return;
    const controller = new AbortController();
    titleRequest.current = controller;
    const timer = setTimeout(() => {
      void fetchBookmarkTitle(url, controller.signal).then(suggestion => {
        if (suggestion && !controller.signal.aborted && mounted.current &&
            !titleEdited.current && !pending.current) setTitle(suggestion);
      });
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [url, bookmark]);
  const duplicate = findDuplicateBookmark(existingBookmarks, url, bookmark?.id);
  let validUrl = false;
  try { normalizeBookmarkUrl(url); validUrl = true; } catch { /* Keep URL guidance until validation succeeds. */ }
  const close = () => { if (!pending.current) onClose(); };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current || !mounted.current) return;
    pending.current = true;
    titleRequest.current?.abort();
    setBusy(true);
    setFailure(null);
    setConflict(false);
    try {
      normalizeBookmarkUrl(url);
      if (!title.trim()) { setFailure({ key: 'enterWebsiteName' }); return; }
      const input = bookmarkFormInput({ title, url, folderId, keywords, ...icon }, {
        bookmark, pinToDesktop, order: existingBookmarks.length + 1,
      });
      await withCollectionMutation(async () => {
        await onSave(input, bookmark ? bookmark.pinnedToDesktop : pinToDesktop);
      }, () => mounted.current);
      if (mounted.current) onClose();
    } catch (cause) {
      if (!mounted.current) return;
      const code = cause instanceof Error ? cause.message
        : typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : '';
      if (code === 'CONFLICT') {
        setConflict(true);
        setFailure({ key: 'bookmarkConflict' });
      } else if (code === 'LOCK_UNAVAILABLE') {
        setFailure({ key: 'bookmarkLockUnavailable' });
      } else if (code === 'COMMIT_UNCERTAIN' || code === 'INVALID_REFERENCE'
        || cause instanceof DOMException) {
        setFailure({ cause });
      } else {
        setFailure({ key: cause instanceof Error && cause.message === 'DUPLICATE' ? 'bookmarkDuplicate'
          : cause instanceof Error && cause.message === 'INVALID_ICON' ? 'bookmarkInvalidIcon' : 'bookmarkSaveFallback' });
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  function downloadDraft() {
    let objectUrl: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      const payload = {
        format: 'jigeqiu-bookmark-draft', schemaVersion: 1,
        draft: {
          id: bookmark?.id ?? null, title, url, folderId: folderId ?? null,
          keywords, icon: icon.icon ?? null, iconMode: icon.iconMode,
          pinnedToDesktop: bookmark ? bookmark.pinnedToDesktop : pinToDesktop,
        },
      };
      objectUrl = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = 'jigeqiu-bookmark-draft.json';
      document.body.appendChild(anchor);
      anchor.click();
      // Keep the URL alive until the browser has consumed the download.
      const savedUrl = objectUrl;
      downloads.current.set(savedUrl, setTimeout(() => {
        if (downloads.current.delete(savedUrl)) URL.revokeObjectURL(savedUrl);
      }, 1000));
    } catch {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setFailure({ key: 'draftDownloadFailed' });
    } finally {
      anchor?.remove();
    }
  }

  return <Modal isOpen onClose={close} maxWidth="lg" contained showCloseButton={!busy}
    closeLabel={`${t('extensionCaptureClose')} (Esc)`}
    title={t(bookmark ? 'editBookmark' : 'addBookmark')}>
    <form data-bookmark-form onSubmit={submit} aria-busy={busy} className="min-w-0 text-slate-800 dark:text-slate-100">
      {onboarding?.task === 'add' && <TaskHint language={language}
        message={validUrl ? 'onboardingAddDetails' : 'onboardingAddUrl'} onDismiss={onboarding.onExit} />}
      <fieldset disabled={busy} inert={busy || undefined} className="min-w-0 space-y-4 border-0 p-0">
      <div>
        <label htmlFor="bookmark-url" className="mb-1.5 block text-xs font-semibold">{t('websiteUrl')} <span className="text-rose-500">*</span></label>
        <div className="relative">
          <Link size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
          <input id="bookmark-url" data-onboarding="add-url" aria-label={t('websiteUrl')} autoFocus required type="text" inputMode="url" autoComplete="url"
            value={url} placeholder={t('websiteUrlExample')} className={`${inputClass} pl-9`}
            onChange={event => {
              const next = event.target.value;
              titleRequest.current?.abort();
              setUrl(next); setIcon({ iconMode: 'auto' });
              if (!titleEdited.current) setTitle(defaultBookmarkTitle(next));
            }} />
        </div>
      </div>
      {duplicate && <div role="status" className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
        <p className="flex items-start gap-2"><AlertTriangle size={15} className="shrink-0" />
          <span>{t('alreadySavedAs', { title: duplicate.title })}</span>
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {onOpenExisting && <button type="button" className="flex items-center gap-1 rounded px-2 py-1 hover:bg-amber-200/50"
            onClick={() => onOpenExisting(duplicate)}><ExternalLink size={13} />{t('openExisting')}</button>}
          {onEditExisting && <button type="button" className="flex items-center gap-1 rounded px-2 py-1 hover:bg-amber-200/50"
            onClick={() => onEditExisting(duplicate)}><Edit size={13} />{t('editExisting')}</button>}
        </div>
      </div>}
      <div>
        <label htmlFor="bookmark-title" className="mb-1.5 block text-xs font-semibold">{t('websiteName')} <span className="text-rose-500">*</span></label>
        <input id="bookmark-title" data-onboarding="add-title" aria-label={t('websiteName')} required value={title} placeholder={t('websiteNameExample')} className={inputClass}
          onChange={event => { titleEdited.current = true; titleRequest.current?.abort(); setTitle(event.target.value); }} />
      </div>
      <SiteIconPicker url={url} title={title} value={icon} language={language} onChange={value => { if (!pending.current) setIcon(value); }} />
      <FolderTreeSelect folders={folders} value={folderId} onChange={setFolderId}
        language={language} onCreateFolder={onCreateFolder} />
      <BookmarkKeywordsInput value={keywords} onChange={setKeywords} language={language} />
      {!bookmark && <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-black/[0.025] px-3 py-2.5 text-xs dark:bg-white/5">
        <input type="checkbox" checked={pinToDesktop} onChange={event => setPinToDesktop(event.target.checked)} className="accent-sky-600" />
        <Pin size={14} className="shrink-0 text-slate-400" />
        <span className="break-words">{desktopFolderName
          ? t('alsoPinToFolder', { name: desktopFolderName })
          : t('alsoPinToDesktop')}</span>
      </label>}
      {error && <p role="alert" className="break-words text-xs text-rose-600 dark:text-rose-300">{error}</p>}
      {conflict && <div className="min-w-0 space-y-2">
        <p className="break-words text-xs text-slate-600 dark:text-slate-300">{t('draftExplanation')}</p>
        <button type="button" onClick={downloadDraft}
          className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-white/20">
          <Download size={15} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{t('downloadDraft')}</span>
        </button>
      </div>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200/70 pt-4 dark:border-white/10">
        <button type="button" disabled={busy} onClick={close} className="rounded-lg px-4 py-2 text-xs hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10">{t('cancel')}</button>
        <button type="submit" data-onboarding="add-save" disabled={busy} className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          {t(bookmark ? 'saveChanges' : 'addBookmark')}
        </button>
      </div>
      </fieldset>
    </form>
  </Modal>;
}

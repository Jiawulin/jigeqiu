import React, { useEffect, useRef, useState } from 'react';
import { Check, Download, FileUp, X } from 'lucide-react';
import { storage } from '../../services/storage';
import type { JsonAssetPreview } from '../../services/import-export/prototype-json';
import { describeAssetError } from '../../services/import-export/ui-errors';
import { ASSET_LIMITS } from '../../domain/assets/validation';
import { createTranslator } from '../../i18n';

interface Props {
  onImported(): void;
  language?: string;
}

export function JsonAssetTransfer({ onImported, language = 'zh' }: Props) {
  const t = createTranslator(language);
  const [preview, setPreview] = useState<JsonAssetPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const [keepCopies, setKeepCopies] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exported, setExported] = useState(false);
  const [ready, setReady] = useState(false);
  const [noticeLimit, setNoticeLimit] = useState(20);
  const request = useRef(0);
  const source = useRef('');
  const saving = useRef(false);
  const settledPreview = useRef<JsonAssetPreview | null>(null);
  useEffect(() => () => { request.current++; }, []);

  const errorCode = (cause: unknown) => {
    return cause instanceof DOMException && cause.name === 'QuotaExceededError'
      ? 'QUOTA_EXCEEDED' : cause instanceof Error ? cause.message : 'STORAGE_UNAVAILABLE';
  };

  function cancel() {
    if (saving.current) return;
    request.current++;
    source.current = '';
    setPreview(null);
    setFileName('');
    setKeepCopies(false);
    setReady(false);
    setBusy(false);
    setError('');
  }

  function prepare(text: string, copies: boolean) {
    const next = storage.previewJsonAssetImport(text, copies);
    setPreview(next);
    setNoticeLimit(20);
    setReady(true);
  }

  async function choose(file?: File) {
    if (!file || saving.current) return;
    const ticket = ++request.current;
    source.current = '';
    setBusy(true);
    setReady(false);
    setError('');
    setExported(false);
    setFileName(file.name);
    setKeepCopies(false);
    try {
      if (file.size > ASSET_LIMITS.bytes) throw new Error('IMPORT_TOO_LARGE');
      const text = await file.text();
      if (ticket !== request.current) return;
      if (new TextEncoder().encode(text).byteLength > ASSET_LIMITS.bytes) throw new Error('IMPORT_TOO_LARGE');
      source.current = text;
      prepare(text, false);
    } catch (cause) {
      if (ticket === request.current) setError(errorCode(cause));
    } finally {
      if (ticket === request.current) setBusy(false);
    }
  }

  function changeCopies(copies: boolean) {
    if (saving.current || busy) return;
    setKeepCopies(copies);
    setReady(false);
    setError('');
    if (!source.current) return;
    try {
      prepare(source.current, copies);
    } catch (cause) {
      setError(errorCode(cause));
    }
  }

  async function confirm() {
    if (!preview || !ready || busy || saving.current || settledPreview.current === preview) return;
    const ticket = request.current;
    let committed = false;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      if (!navigator.locks?.request) throw new Error('LOCK_UNAVAILABLE');
      await navigator.locks.request('jigeqiu:prototype:library-import', async () => {
        // A queued lock must not write after this section has unmounted.
        if (ticket !== request.current) return;
        await storage.mutate(() => {
          if (ticket !== request.current) throw new Error('CANCELLED');
          storage.commitJsonAssetImport(preview);
        });
        committed = true;
        settledPreview.current = preview;
      });
      if (ticket !== request.current || !committed) return;
      source.current = '';
      setPreview(null);
      setReady(false);
      setFileName('');
      setKeepCopies(false);
      onImported();
    } catch (cause) {
      if (ticket === request.current) {
        const code = committed ? 'COMMIT_UNCERTAIN' : errorCode(cause);
        if (code === 'COMMIT_UNCERTAIN') settledPreview.current = preview;
        setError(code);
      }
    } finally {
      saving.current = false;
      if (ticket === request.current) setBusy(false);
    }
  }

  function exportAssets() {
    if (busy) return;
    setError('');
    setExported(false);
    let url: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      const json = storage.exportJsonBackup();
      url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
      anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `jigeqiu-assets-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      setExported(true);
    } catch (cause) {
      setError(errorCode(cause));
    } finally {
      anchor?.remove();
      if (url) URL.revokeObjectURL(url);
    }
  }

  const noticeSummary = (notice: JsonAssetPreview['notices'][number]) => {
    switch (notice.code) {
      case 'IGNORED_NON_ASSET_FIELD': {
        const names: Record<string, string> = {
          settings: t('transferFieldSettings'), searchEngines: t('transferFieldEngines'),
          history: t('transferFieldHistory'), recentSearches: t('transferFieldSearches'),
          recentUsed: t('transferFieldUsed'), layout: t('transferFieldLayout'),
          dock: t('transferFieldDock'), categories: t('transferFieldCategories'),
          tags: t('transferFieldTags'), plugins: t('transferFieldPlugins'),
        };
        const field = typeof notice.details.field === 'string' ? notice.details.field : '';
        const label = names[field] || field || t('transferFieldNonAsset');
        return t('transferNoticeIgnored', { label });
      }
      case 'IMPORT_BOOKMARK_SKIPPED': {
        const differences = notice.details.differences;
        const fields: [string, string][] = [
          ['title', t('transferFieldTitle')], ['notes', t('transferFieldNotes')],
          ['keywords', t('transferFieldKeywords')], ['icon', t('transferFieldIcon')],
          ['url', t('transferFieldUrl')],
        ];
        const changed = fields.filter(([key]) => Array.isArray(differences) && differences.some(value =>
          value !== null && typeof value === 'object' && !Array.isArray(value) && value[key] === true));
        if (changed.length) {
          const labels = changed.map(([, label]) => label).join(t('transferFieldSeparator'));
          return t('transferNoticeDifferent', { labels });
        }
        const identical = Array.isArray(differences) && differences.length > 0 && differences.every(value =>
          value !== null && typeof value === 'object' && !Array.isArray(value)
          && fields.every(([key]) => value[key] === false));
        return identical
          ? t('transferNoticeIdentical')
          : t('transferNoticeDuplicate');
      }
      case 'MISSING_BOOKMARK_LINK':
      case 'IMPORT_BOOKMARK_LINK_DETACHED': return t('transferNoticeDetached');
      default: return t('transferNoticeOther');
    }
  };
  const noticeIds = (notice: JsonAssetPreview['notices'][number]) => [
    ['sourceId', t('transferIdSource')], ['targetId', t('transferIdTarget')],
    ['collectionId', t('transferIdCollection')], ['sectionId', t('transferIdSection')],
    ['itemId', t('transferIdItem')], ['bookmarkId', t('transferIdBookmark')],
  ].flatMap(([key, label]) => typeof notice.details[key] === 'string'
    ? [t('transferNoticeId', { label, id: notice.details[key] as string })] : []).join(' · ');
  const buttonClass = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-slate-300 dark:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed';

  return <section aria-label={t('jsonTransferTitle')} className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-base font-bold">{t('jsonTransferTitle')}</h3>
      <button type="button" data-onboarding="json-export" disabled={busy} onClick={exportAssets} className={buttonClass}>
        <Download size={14} /><span>{t('jsonTransferExport')}</span>
      </button>
    </div>
    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
      {t('jsonTransferDescription')}
    </p>
    <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
      {t('jsonTransferPrivacy')}
    </p>
    <label className="relative flex items-center justify-center gap-3 p-5 rounded-lg border border-dashed border-teal-600/50 focus-within:ring-2 focus-within:ring-teal-600">
      <FileUp size={22} className="shrink-0 text-teal-700 dark:text-teal-300" />
      <span className="text-xs font-semibold min-w-0 break-all">{fileName || t('jsonTransferChoose')}</span>
      <input type="file" accept=".json,application/json" aria-label={t('jsonTransferFile')}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" disabled={busy}
        onChange={async event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          await choose(file);
        }} />
    </label>
    <label className="flex items-start gap-2 text-xs leading-relaxed">
      <input type="checkbox" checked={keepCopies} disabled={busy}
        aria-label={t('jsonTransferCopiesLabel')}
        onChange={event => changeCopies(event.target.checked)} className="mt-0.5 accent-teal-700" />
      <span>{t('jsonTransferCopies')}</span>
    </label>
    {busy && <p role="status" className="text-xs">{t(saving.current ? 'transferSaving' : 'transferReading')}</p>}
    {preview && <div className="space-y-3">
      <dl aria-label={t('jsonTransferPreview')} className="flex flex-wrap gap-x-5 gap-y-2 text-xs" role="status">
        {([
          [t('jsonTransferBookmarks'), preview.counts.bookmarks],
          [t('jsonTransferFolders'), preview.counts.folders],
          [t('jsonTransferCollections'), preview.counts.collections],
          [t('jsonTransferSkipped'), preview.counts.skipped],
        ] as const).map(([label, count]) => <div key={label} className="flex items-center gap-2">
          <dt>{label}</dt><dd className="font-semibold tabular-nums">{count}</dd>
        </div>)}
      </dl>
      {preview.notices.length > 0 && <div className="space-y-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('jsonTransferNoticeCount', {
          shown: Math.min(noticeLimit, preview.notices.length), total: preview.notices.length,
        })}</p>
        <ul aria-label={t('jsonTransferNotices')} className="divide-y divide-slate-200 dark:divide-white/10 text-xs">
          {preview.notices.slice(0, noticeLimit).map((notice, index) => <li key={index} className="py-2 space-y-1">
            <p className="leading-relaxed break-words">{noticeSummary(notice)}</p>
            {noticeIds(notice) && <p className="break-all text-[11px] text-slate-500 dark:text-slate-400">{noticeIds(notice)}</p>}
            <details className="text-slate-500 dark:text-slate-400">
              <summary className="cursor-pointer w-fit">{t('jsonTransferDetails')}</summary>
              <p className="break-all mt-2">{notice.code}</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">{JSON.stringify(notice.details, null, 2)}</pre>
            </details>
          </li>)}
        </ul>
        {noticeLimit < preview.notices.length && <button type="button" onClick={() => setNoticeLimit(limit => limit + 20)}
          className={buttonClass}>{t('jsonTransferMore')}</button>}
      </div>}
    </div>}
    {exported && <p role="status" className="text-xs text-teal-700 dark:text-teal-300">{t('jsonTransferExported')}</p>}
    {error && <p role="alert" className="text-xs leading-relaxed text-rose-700 dark:text-rose-300">{describeAssetError(error, language, 'json')}</p>}
    {(busy || preview || error || fileName) && <div className="flex flex-wrap justify-end gap-2">
      <button type="button" disabled={saving.current} onClick={cancel} className={buttonClass}>
        <X size={14} /><span>{t('transferCancel')}</span>
      </button>
      <button type="button" disabled={busy || !ready || !preview || settledPreview.current === preview ||
        preview.counts.bookmarks + preview.counts.folders + preview.counts.collections === 0}
        onClick={confirm} className={`${buttonClass} bg-teal-700 text-white`}>
        <Check size={14} /><span>{t('transferConfirm')}</span>
      </button>
    </div>}
  </section>;
}

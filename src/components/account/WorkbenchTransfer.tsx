import { useEffect, useRef, useState } from 'react';
import { Check, Download, FileUp, X } from 'lucide-react';
import { storage } from '../../services/storage';
import type { WorkbenchInventory, WorkbenchOptions, WorkbenchPreview } from '../../services/import-export/workbench';
import { ASSET_LIMITS } from '../../domain/assets/validation';
import { createTranslator } from '../../i18n';
import { describeAssetError, describeWorkbenchLocalError } from '../../services/import-export/ui-errors';

export const transferButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium dark:border-white/20 disabled:cursor-not-allowed disabled:opacity-50';
export function downloadTransfer(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  try {
    anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click();
  } finally { anchor.remove(); URL.revokeObjectURL(url); }
}
interface Props {
  language?: string; onRestored(): void; onActivity(dirty: boolean, busy: boolean): void;
  onSwitchBookmarks(): void;
}
export function WorkbenchTransfer({ language, onRestored, onActivity, onSwitchBookmarks }: Props) {
  const t = createTranslator(language);
  const [preview, setPreview] = useState<WorkbenchPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [exported, setExported] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [inventory, setInventory] = useState<WorkbenchInventory | null>(null);
  const [inventoryError, setInventoryError] = useState('');
  const [exportError, setExportError] = useState('');
  const source = useRef('');
  const generation = useRef(0);
  const saving = useRef(false);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    try { setInventory(storage.getWorkbenchInventory()); setInventoryError(''); }
    catch (cause) { setInventory(null); setInventoryError(cause instanceof Error ? cause.message : 'CORRUPT_DATA'); }
  }, [completed]);
  useEffect(() => { onActivity(!!fileName, busy); }, [fileName, busy, onActivity]);
  function clear() {
    if (saving.current) return;
    generation.current++; source.current = '';
    setPreview(null); setFileName(''); setAccepted(false); setError(''); setBusy(false); setBlocked(false);
  }
  async function choose(file?: File) {
    if (!file || saving.current) return;
    const ticket = ++generation.current;
    source.current = ''; setPreview(null); setAccepted(false); setCompleted(false); setError('');
    setFileName(file.name); setBusy(true); setBlocked(false);
    try {
      if (file.size > ASSET_LIMITS.bytes) throw new Error('IMPORT_TOO_LARGE');
      const text = await file.text();
      if (ticket !== generation.current) return;
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && 'format' in parsed && parsed.format === 'jigeqiu-assets') {
        setError('BOOKMARK_FILE'); return;
      }
      const next = storage.previewWorkbenchRestore(text);
      source.current = text; setPreview(next);
    } catch (cause) {
      if (ticket === generation.current) setError(cause instanceof Error ? cause.message : 'IMPORT_INVALID');
    } finally { if (ticket === generation.current) setBusy(false); }
  }
  function change(key: keyof WorkbenchOptions, checked: boolean) {
    if (!preview || saving.current) return;
    setAccepted(false); setError('');
    try { setPreview(storage.previewWorkbenchRestore(source.current, { ...preview.options, [key]: checked })); }
    catch (cause) { setPreview(null); setError(cause instanceof Error ? cause.message : 'IMPORT_INVALID'); }
  }
  function exportBackup() {
    setExportError(''); setExported(false);
    try {
      downloadTransfer(storage.exportWorkbenchBackup(), `jigeqiu-workbench-${new Date().toISOString().slice(0, 10)}.json`);
      setExported(true);
    } catch (cause) { setExportError(cause instanceof Error ? cause.message : 'CORRUPT_DATA'); }
  }
  async function restore() {
    if (!preview || !accepted || saving.current || blocked) return;
    const ticket = generation.current;
    saving.current = true; setBusy(true); setError('');
    onActivity(true, true);
    let committed = false;
    try {
      await storage.restoreWorkbench(preview, () => generation.current === ticket);
      committed = true;
      if (ticket !== generation.current) return;
      setPreview(null); setFileName(''); source.current = ''; setAccepted(false);
      setExportError('');
      onRestored(); setCompleted(true);
    } catch (cause) {
      if (ticket !== generation.current) return;
      const code = committed ? 'COMMIT_UNCERTAIN'
        : cause instanceof DOMException && cause.name === 'QuotaExceededError' ? 'QUOTA_EXCEEDED'
        : cause instanceof Error ? cause.message : 'STORAGE_UNAVAILABLE';
      setError(code);
      if (['COMMIT_UNCERTAIN', 'RESTORE_RECOVERY_REQUIRED'].includes(code)) setBlocked(true);
      if (code === 'CONFLICT' || code === 'PREVIEW_STALE') setPreview(null);
    } finally { saving.current = false; if (ticket === generation.current) setBusy(false); }
  }
  const rows = preview ? [
    [t('jsonTransferBookmarks'), preview.current.bookmarks, preview.next.assets.bookmarks.length],
    [t('workbenchBookmarkFolders'), preview.current.folders, preview.next.assets.folders.length],
    [t('workbenchDesktop'), preview.current.desktop, preview.next.layout.shortcuts.length],
    [t('workbenchDesktopFolders'), preview.current.desktopFolders, preview.next.layout.folders.length],
    [t('workbenchTaskbar'), preview.current.taskbar, preview.next.taskbar.length],
    [t('workbenchSearch'), preview.current.search, preview.next.search.engines.length],
  ] as const : [];
  const errorText = error === 'BOOKMARK_FILE' ? t('workbenchWrongFile')
    : error === 'TRASH_ID_CONFLICT' ? t('workbenchTrashConflict')
    : ['RESTORE_RECOVERY_REQUIRED', 'COMMIT_UNCERTAIN'].includes(error) ? t('workbenchFailed')
    : error.startsWith('BACKUP_') ? describeWorkbenchLocalError(error, language)
    : ['IMPORT_INVALID', 'UNSUPPORTED_VERSION', 'CORRUPT_DATA'].includes(error) || error.startsWith('SEARCH_') ? t('workbenchInvalid')
    : describeAssetError(error, language, 'json');
  return <section aria-label={t('workbenchTitle')} className="min-w-0 space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <h3 className="text-base font-semibold">{t('workbenchTitle')}</h3>
        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">{t('workbenchDescription')}</p>
      </div>
      <button type="button" className={transferButton} disabled={busy || blocked} onClick={exportBackup}><Download size={15} />{t('workbenchExport')}</button>
    </div>
    {inventory && <dl aria-label={t('workbenchInventory')} className="grid grid-cols-2 gap-x-5 gap-y-3 text-xs sm:grid-cols-3">
      {[
        [t('jsonTransferBookmarks'), inventory.bookmarks],
        [t('workbenchBookmarkFolders'), inventory.folders],
        [t('workbenchDesktop'), inventory.desktop],
        [t('workbenchDesktopFolders'), inventory.desktopFolders],
        [t('workbenchTaskbar'), inventory.taskbar],
        [t('workbenchSearch'), inventory.search],
      ].map(([label, count]) => <div key={label} className="flex items-center justify-between gap-2 border-b border-slate-200 py-2 dark:border-white/10">
        <dt className="text-slate-600 dark:text-slate-400">{label}</dt><dd className="tabular-nums font-semibold">{count}</dd>
      </div>)}
    </dl>}
    {(exportError || inventoryError) && <p role={exportError ? 'alert' : 'status'}
      className={`break-words text-xs leading-relaxed ${exportError ? 'text-rose-700 dark:text-rose-300' : 'text-amber-800 dark:text-amber-200'}`}>
      {describeWorkbenchLocalError(exportError || inventoryError, language)}
    </p>}
    <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">{t('workbenchExclusions')}</p>
    {exported && <p role="status" className="text-xs text-teal-700 dark:text-teal-300">{t('workbenchExported')}</p>}
    <div className="space-y-4 border-t border-slate-200 pt-5 dark:border-white/10">
      <h3 className="text-base font-semibold">{t('workbenchRestore')}</h3>
      <label className="relative flex min-h-20 items-center justify-center gap-3 rounded-md border border-dashed border-teal-600/50 p-4 focus-within:ring-2 focus-within:ring-teal-600">
        <FileUp size={22} className="shrink-0" /><span className="min-w-0 break-all text-xs">{fileName || t('workbenchChoose')}</span>
        <input type="file" accept=".json,application/json" aria-label={t('workbenchChoose')} disabled={busy || blocked}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''; void choose(file);
          }} />
      </label>
      {busy && <p role="status" className="text-xs">{t(saving.current ? 'transferSaving' : 'transferReading')}</p>}
      {preview && <>
        <p role="status" className="text-xs font-medium text-teal-700 dark:text-teal-300">{t('workbenchFileDetected')}</p>
        <p className="text-xs text-slate-600 dark:text-slate-400">{t('workbenchVersion', { version: '1',
          date: new Date(preview.exportedAt).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN') })}</p>
        <fieldset disabled={busy || blocked} className="space-y-3 text-xs">
          <legend className="mb-3 font-semibold">{t('workbenchAssetsRequired')}</legend>
          {(['desktop', 'taskbar', 'search'] as const).map(key => <label key={key} className="flex items-start gap-2">
            <input type="checkbox" checked={preview.options[key]} disabled={!preview.available[key]} onChange={e => change(key, e.target.checked)} />
            <span>{t(key === 'desktop' ? 'workbenchDesktop' : key === 'taskbar' ? 'workbenchTaskbar' : 'workbenchSearch')}
              {!preview.available[key] && <span className="block text-slate-500">{t('workbenchMissing')}</span>}</span>
          </label>)}
        </fieldset>
        <dl aria-label={t('workbenchPreview')} className="divide-y divide-slate-200 text-xs dark:divide-white/10">
          {rows.map(([label, before, after]) => <div key={label} className="flex items-center justify-between gap-3 py-2">
            <dt>{label}</dt><dd className="whitespace-nowrap tabular-nums">{before} → {after}</dd>
          </div>)}
        </dl>
        {(['desktop', 'taskbar'] as const).map(key => preview.removed[key].length > 0 && <details key={key} className="text-xs">
          <summary className="cursor-pointer">{t('workbenchRemoved', { count: preview.removed[key].length })} · {t(key === 'desktop' ? 'workbenchDesktop' : 'workbenchTaskbar')}</summary>
          <ul className="max-h-40 overflow-auto py-2">{preview.removed[key].map(entry =>
            <li className="break-all py-1" key={entry.id}>{entry.title} ({entry.id})</li>)}</ul>
        </details>)}
        <div className="space-y-3 border-l-2 border-amber-500 pl-3 text-xs">
          <p className="leading-relaxed">{t('workbenchReplaceWarning')}</p>
          <button type="button" className={transferButton} disabled={busy} onClick={exportBackup}><Download size={14} />{t('workbenchExportCurrent')}</button>
          <label className="flex items-start gap-2 leading-relaxed">
            <input type="checkbox" checked={accepted} disabled={busy || blocked} onChange={e => setAccepted(e.target.checked)} />
            <span>{t('workbenchAccept')}</span>
          </label>
        </div>
      </>}
      {error && <p role="alert" className="break-words text-xs leading-relaxed text-rose-700 dark:text-rose-300">{errorText}</p>}
      {error === 'BOOKMARK_FILE' && <button type="button" className={transferButton} onClick={onSwitchBookmarks}>{t('workbenchGoBookmarks')}</button>}
      {completed && <p role="status" className="text-xs text-teal-700 dark:text-teal-300">{t('workbenchRestored')}</p>}
      {fileName && <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={transferButton} disabled={saving.current} onClick={clear}><X size={14} />{t('transferCancel')}</button>
        <button type="button" className={`${transferButton} bg-teal-700 text-white`} disabled={!preview || !accepted || busy || blocked} onClick={() => void restore()}>
          <Check size={14} />{t('workbenchRestoreConfirm')}
        </button>
      </div>}
    </div>
  </section>;
}

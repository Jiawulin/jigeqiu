import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Check, Upload } from 'lucide-react';
import { createTranslator } from '../../i18n';
import type { OnboardingTaskContext } from '../onboarding/types';
import { PrototypeChromeImport } from './PrototypeChromeImport';
import { JsonAssetTransfer } from './JsonAssetTransfer';
import { WorkbenchTransfer, transferButton } from './WorkbenchTransfer';
import { BookmarkExport } from './BookmarkExport';
import { TransferFormatHelp } from './TransferFormatHelp';

interface Props {
  language?: string; onboarding?: OnboardingTaskContext; onImported(): void; onViewBookmarks(): void;
  onExportHtml(): void; htmlExportError: boolean;
}
type Tab = 'bookmarks' | 'workbench';
type ImportFormat = 'html' | 'json';
type PendingSwitch = { kind: 'tab'; target: Tab } | { kind: 'format'; target: ImportFormat };
export function AssetTransferPage({ language, onboarding, onImported, onViewBookmarks, onExportHtml, htmlExportError }: Props) {
  const t = createTranslator(language);
  const [tab, setTab] = useState<Tab>('bookmarks');
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [importFormat, setImportFormat] = useState<ImportFormat>('html');
  const [activity, setActivity] = useState({ html: { dirty: false, busy: false }, json: { dirty: false, busy: false }, backup: { dirty: false, busy: false } });
  const [success, setSuccess] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const formatInputs = useRef<Partial<Record<ImportFormat, HTMLInputElement | null>>>({});
  const formatName = useId();
  const reportHtml = useCallback((dirty: boolean, busy: boolean) => setActivity(a => ({ ...a, html: { dirty, busy } })), []);
  const reportJson = useCallback((dirty: boolean, busy: boolean) => setActivity(a => ({ ...a, json: { dirty, busy } })), []);
  const reportBackup = useCallback((dirty: boolean, busy: boolean) => setActivity(a => ({ ...a, backup: { dirty, busy } })), []);
  const active = tab === 'bookmarks' ? [activity.html, activity.json] : [activity.backup];
  const busy = active.some(a => a.busy);
  const switchTab = (target: Tab) => {
    if (busy || tab === target) return;
    if (active.some(a => a.dirty)) { setPendingSwitch({ kind: 'tab', target }); return; }
    setTab(target); setSuccess(false);
    setActivity({ html: { dirty: false, busy: false }, json: { dirty: false, busy: false }, backup: { dirty: false, busy: false } });
  };
  const switchFormat = (target: ImportFormat) => {
    if (busy || target === importFormat) return;
    if (active.some(a => a.dirty)) { setPendingSwitch({ kind: 'format', target }); return; }
    setImportFormat(target);
    setActivity(a => ({ ...a, html: { dirty: false, busy: false }, json: { dirty: false, busy: false } }));
  };
  useEffect(() => {
    if (pendingSwitch) dialog.current?.showModal();
    else dialog.current?.close();
  }, [pendingSwitch]);
  const imported = () => { onImported(); setSuccess(true); };
  return <div className="max-w-4xl space-y-6">
    <div role="tablist" aria-label={t('transferTabsLabel')} className="grid grid-cols-2 border-b border-slate-200 dark:border-white/10">
      {(['bookmarks', 'workbench'] as const).map((item, index) => <button type="button" key={item} ref={el => { tabButtons.current[index] = el; }}
        id={`transfer-tab-${item}`} role="tab" aria-selected={tab === item} aria-controls={`transfer-panel-${item}`}
        tabIndex={tab === item ? 0 : -1} disabled={busy}
        className={`min-h-12 border-b-2 px-2 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 ${tab === item
          ? 'border-teal-700 text-teal-800 dark:border-teal-400 dark:text-teal-300' : 'border-transparent text-slate-500 dark:text-slate-400'}`}
        onClick={() => switchTab(item)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
          switchTab(next === 0 ? 'bookmarks' : 'workbench'); tabButtons.current[next]?.focus();
        }}>{t(item === 'bookmarks' ? 'transferBookmarksTab' : 'transferWorkbenchTab')}</button>)}
    </div>
    <div key={tab} id={`transfer-panel-${tab}`} role="tabpanel" aria-labelledby={`transfer-tab-${tab}`} className="min-w-0 space-y-6">
      {tab === 'bookmarks' ? <>
        <section aria-label={t('transferImportTitle')} className="min-w-0 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-base font-semibold"><Upload size={18} className="text-teal-600 dark:text-teal-400" />{t('transferImportTitle')}</h3>
            <TransferFormatHelp kind="import" language={language} />
          </div>
          <fieldset disabled={busy} className="min-w-0">
            <legend className="text-xs font-medium">{t('transferImportFormat')}</legend>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
              {(['html', 'json'] as const).map(format => <label key={format}
                className={`flex min-h-11 min-w-0 items-center gap-2 text-sm ${busy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                <span className="relative flex h-4 w-4 shrink-0">
                  <input type="radio" name={formatName} value={format} checked={importFormat === format}
                    ref={element => { formatInputs.current[format] = element; }}
                    onChange={() => switchFormat(format)}
                    className="peer m-0 h-4 w-4 appearance-none rounded-[3px] border border-slate-400 bg-white/60 checked:border-teal-700 checked:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 dark:border-white/40 dark:bg-zinc-900 dark:checked:border-teal-500 dark:checked:bg-teal-600" />
                  <Check aria-hidden="true" size={16} strokeWidth={3} className="pointer-events-none absolute inset-0 text-white opacity-0 peer-checked:opacity-100" />
                </span>
                <span>{t(format === 'html' ? 'transferFormatHtml' : 'transferFormatJson')}</span>
              </label>)}
            </div>
          </fieldset>
          {importFormat === 'html'
            ? <PrototypeChromeImport language={language} onboarding={onboarding} onImported={imported} onActivity={reportHtml} embedded />
            : <JsonAssetTransfer language={language} onImported={imported} onActivity={reportJson} onSwitchBackup={() => switchTab('workbench')} importOnly />}
        </section>
        <BookmarkExport language={language} disabled={busy} onExportHtml={onExportHtml} htmlExportError={htmlExportError} />
      </> : <WorkbenchTransfer language={language} onRestored={imported} onActivity={reportBackup} onSwitchBookmarks={() => switchTab('bookmarks')} />}
      {success && <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-white/10">
        {tab === 'bookmarks' && <p role="status" className="text-xs text-teal-700 dark:text-teal-300">{t('transferBookmarksSuccess')}</p>}
        <button type="button" className={transferButton} onClick={onViewBookmarks}>{t('transferViewBookmarks')}<ArrowRight size={14} /></button>
      </div>}
    </div>
    <dialog ref={dialog} aria-labelledby="transfer-discard-title" onCancel={event => { event.preventDefault(); setPendingSwitch(null); }}
      className="w-[calc(100%-2rem)] max-w-md rounded-lg border border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-black/40 dark:border-white/20 dark:bg-zinc-900 dark:text-slate-100">
      <h3 id="transfer-discard-title" className="text-base font-semibold">{t('transferDiscardTitle')}</h3>
      <p className="mt-2 text-xs leading-relaxed">{t('transferDiscardHint')}</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" autoFocus className={transferButton} onClick={() => setPendingSwitch(null)}>{t('transferCancel')}</button>
        <button type="button" className={transferButton} onClick={() => {
          if (!pendingSwitch) return;
          const { kind, target } = pendingSwitch;
          if (kind === 'tab') setTab(target);
          else setImportFormat(target);
          setPendingSwitch(null); setSuccess(false);
          setActivity({ html: { dirty: false, busy: false }, json: { dirty: false, busy: false }, backup: { dirty: false, busy: false } });
          requestAnimationFrame(() => {
            if (kind === 'tab') tabButtons.current[target === 'bookmarks' ? 0 : 1]?.focus();
            else formatInputs.current[target]?.focus();
          });
        }}>{t('transferDiscard')}</button>
      </div>
    </dialog>
  </div>;
}

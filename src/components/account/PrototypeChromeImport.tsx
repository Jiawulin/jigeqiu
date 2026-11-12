import { useEffect, useRef, useState } from 'react';
import { Check, FileUp, Upload, X } from 'lucide-react';
import { storage } from '../../services/storage';
import { prepareChromeLibraryImport } from '../../services/import-export/prototype-import';
import type { ChromeLibraryPreview } from '../../services/import-export/prototype-import';
import { describeAssetError } from '../../services/import-export/ui-errors';
import { ASSET_LIMITS } from '../../domain/assets/validation';
import { createTranslator } from '../../i18n';
import { TaskHint } from '../onboarding/TaskHint';
import type { OnboardingTaskContext } from '../onboarding/types';

interface Props {
  onImported(): void; language?: string; onboarding?: OnboardingTaskContext;
  onActivity?(dirty: boolean, busy: boolean): void;
  embedded?: boolean;
}

export function PrototypeChromeImport({ onImported, language, onboarding, onActivity, embedded = false }: Props) {
  const t = createTranslator(language);
  const [preview, setPreview] = useState<ChromeLibraryPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const request = useRef(0);
  const saving = useRef(false);
  const settledPreview = useRef<ChromeLibraryPreview | null>(null);
  useEffect(() => { onActivity?.(!!fileName, busy); }, [fileName, busy, onActivity]);
  useEffect(() => () => { request.current++; }, []);
  const cancel = () => {
    if (saving.current) return;
    request.current++;
    setPreview(null);
    setFileName('');
    setError('');
    setBusy(false);
    if (onboarding?.task === 'import') onboarding.onEvent({ type: 'import-stage', stage: 'cancel' });
  };
  async function choose(file?: File) {
    if (!file || saving.current) return;
    const ticket = ++request.current;
    setBusy(true);
    setPreview(null);
    setError('');
    setFileName(file.name);
    if (onboarding?.task === 'import') onboarding.onEvent({ type: 'import-stage', stage: 'reading' });
    try {
      if (file.size > ASSET_LIMITS.bytes) { setError('IMPORT_TOO_LARGE'); return; }
      const text = await file.text();
      if (ticket !== request.current) return;
      const result = prepareChromeLibraryImport(text, storage.readLibrary(), () => crypto.randomUUID(), Date.now());
      if (result.ok) {
        setPreview(result.value);
        if (onboarding?.task === 'import') onboarding.onEvent({ type: 'import-stage', stage: 'preview' });
      }
      else setError(result.error.code);
    } catch {
      if (ticket === request.current) setError('CHROME_READ_FAILED');
    } finally {
      if (ticket === request.current) setBusy(false);
    }
  }
  async function confirm() {
    if (!preview || saving.current || settledPreview.current === preview) return;
    const ticket = request.current;
    let committed = false;
    saving.current = true;
    onActivity?.(true, true);
    setBusy(true);
    setError('');
    try {
      if (!navigator.locks?.request) { setError('LOCK_UNAVAILABLE'); return; }
      await navigator.locks.request('jigeqiu:prototype:library-import', async () => {
        if (ticket !== request.current) return;
        await storage.mutate(() => {
          if (ticket !== request.current) throw new Error('CANCELLED');
          storage.commitImportedLibrary(preview.base, preview.library);
        });
        committed = true;
        settledPreview.current = preview;
      });
      if (ticket !== request.current || !committed) return;
      // Refresh the existing app state only after both bookmarks and folders are persisted.
      setPreview(null);
      setFileName('');
      onImported();
      if (onboarding?.task === 'import') onboarding.onEvent({ type: 'import-success' });
    } catch (cause) {
      if (ticket !== request.current) return;
      const reason = cause instanceof Error ? cause.message : '';
      const quota = cause instanceof DOMException && cause.name === 'QuotaExceededError';
      if (committed || reason === 'COMMIT_UNCERTAIN') settledPreview.current = preview;
      setError(committed ? 'COMMIT_UNCERTAIN' : quota ? 'QUOTA_EXCEEDED'
        : reason === 'CONFLICT' ? 'CONFLICT'
        : reason === 'COMMIT_UNCERTAIN' ? 'COMMIT_UNCERTAIN'
        : 'CHROME_SAVE_FAILED');
    } finally {
      saving.current = false;
      if (ticket === request.current) setBusy(false);
    }
  }
  return <section data-onboarding="html-import" aria-label={t('chromeImportLabel')} className="min-w-0 space-y-4">
    {!embedded && <><h3 className="text-base font-bold flex items-center gap-2">
      <Upload size={18} className="text-teal-600" />{t('chromeImportTitle')}
    </h3>
    <p className="text-xs text-slate-600 leading-relaxed">
      {t('chromeImportDescription')}
    </p></>}
    {onboarding?.task === 'import' && <TaskHint language={language}
      message={preview ? 'onboardingImportPreview' : 'onboardingImportFile'} onDismiss={onboarding.onExit} />}
    <label className="relative flex flex-col items-center justify-center gap-3 p-6 rounded-lg border border-dashed border-teal-600/40 bg-white/40 dark:bg-white/5 focus-within:ring-2 focus-within:ring-teal-600">
      <FileUp size={26} className="text-teal-600" />
      <span className="text-xs font-semibold max-w-full break-all">{fileName || t(embedded ? 'transferChooseHtml' : 'chromeImportChoose')}</span>
      <input data-onboarding="import-file" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" type="file"
        accept=".html,.htm,text/html" aria-label={t(embedded ? 'transferHtmlFile' : 'chromeImportFile')} disabled={busy}
        onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; await choose(file); }} />
    </label>
    {busy && <p role="status" className="text-xs">{t(saving.current ? 'transferSaving' : 'transferReading')}</p>}
    {preview && <div role="status" className="text-xs flex flex-wrap gap-3">
      <strong className="text-teal-700 dark:text-teal-300">{t('chromeImportBookmarks', { count: preview.counts.bookmarks })}</strong>
      <span>{t('chromeImportFolders', { count: preview.counts.folders })}</span>
      <span>{t('chromeImportSkipped', { count: preview.counts.skipped })}</span>
      {preview.counts.invalid > 0 && <span>{t('chromeImportInvalid', { count: preview.counts.invalid })}</span>}
    </div>}
    {error && <p role="alert" className="text-xs leading-relaxed text-rose-700 dark:text-rose-300">{error === 'CHROME_READ_FAILED'
      ? t('chromeImportReadFailed') : error === 'CHROME_SAVE_FAILED' ? t('chromeImportSaveFailed') : describeAssetError(error, language)}</p>}
    {(preview || error) && <div className="flex justify-end gap-2">
      <button type="button" disabled={busy} onClick={cancel} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-slate-300 dark:border-white/20 disabled:opacity-50"><X size={14} />{t('transferCancel')}</button>
      <button type="button" data-onboarding="import-confirm" disabled={busy || !preview || settledPreview.current === preview || preview.counts.bookmarks + preview.counts.folders === 0}
        onClick={() => void confirm()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-teal-700 text-white disabled:opacity-50">
        <Check size={14} />{t('transferConfirm')}
      </button>
    </div>}
  </section>;
}

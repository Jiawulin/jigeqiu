import { useId, useState } from 'react';
import { Check, Download } from 'lucide-react';
import { createTranslator } from '../../i18n';
import { storage } from '../../services/storage';
import { describeAssetError } from '../../services/import-export/ui-errors';
import { downloadTransfer, transferButton } from './WorkbenchTransfer';
import { TransferFormatHelp } from './TransferFormatHelp';

export function BookmarkExport({ language, disabled, onExportHtml, htmlExportError }: {
  language?: string; disabled: boolean; onExportHtml(): void; htmlExportError: boolean;
}) {
  const t = createTranslator(language);
  const formatName = useId();
  const [format, setFormat] = useState('html');
  const [error, setError] = useState('');
  const [exported, setExported] = useState(false);
  const exportBookmarks = () => {
    if (disabled) return;
    setError(''); setExported(false);
    if (format === 'html') { onExportHtml(); return; }
    try {
      downloadTransfer(storage.exportJsonBackup(), `jigeqiu-assets-${new Date().toISOString().slice(0, 10)}.json`);
      setExported(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'STORAGE_UNAVAILABLE'); }
  };
  return <section aria-label={t('transferExportTitle')} className="min-w-0 space-y-4 border-t border-slate-200 pt-6 dark:border-white/10">
    <div className="flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-base font-semibold"><Download size={18} className="text-teal-600 dark:text-teal-400" />{t('transferExportTitle')}</h3>
      <TransferFormatHelp kind="export" language={language} />
    </div>
    <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <fieldset disabled={disabled} className="min-w-0">
        <legend className="text-xs font-medium">{t('transferExportFormat')}</legend>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
          {(['html', 'json'] as const).map(option => <label key={option}
            className={`flex min-h-11 min-w-0 items-center gap-2 text-sm ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
            <span className="relative flex h-4 w-4 shrink-0">
              <input type="radio" name={formatName} value={option} checked={format === option}
                data-onboarding={option === 'json' ? 'json-export' : undefined}
                onChange={() => { setFormat(option); setError(''); setExported(false); }}
                className="peer m-0 h-4 w-4 appearance-none rounded-[3px] border border-slate-400 bg-white/60 checked:border-teal-700 checked:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 dark:border-white/40 dark:bg-zinc-900 dark:checked:border-teal-500 dark:checked:bg-teal-600" />
              <Check aria-hidden="true" size={16} strokeWidth={3} className="pointer-events-none absolute inset-0 text-white opacity-0 peer-checked:opacity-100" />
            </span>
            <span>{t(option === 'html' ? 'transferFormatHtml' : 'transferFormatJson')}</span>
          </label>)}
        </div>
      </fieldset>
      <button type="button" disabled={disabled}
        onClick={exportBookmarks} className={`${transferButton} min-h-11 bg-teal-700 text-white`}>
        <Download size={15} />{t('transferExportTitle')}
      </button>
    </div>
    {format === 'json' && <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-200">{t('jsonTransferPrivacy')}</p>}
    {exported && <p role="status" className="text-xs text-teal-700 dark:text-teal-300">{t('jsonTransferExported')}</p>}
    {format === 'html' && htmlExportError && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{t('managerHtmlExportFailed')}</p>}
    {error && <p role="alert" className="text-xs leading-relaxed text-rose-700 dark:text-rose-300">{describeAssetError(error, language, 'json')}</p>}
  </section>;
}

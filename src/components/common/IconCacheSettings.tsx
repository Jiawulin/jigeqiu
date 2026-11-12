import React, { useState } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { createTranslator } from '../../i18n';
import { clearSiteIconCache } from '../../services/site-icons';

export function IconCacheSettings({ language = 'zh' }: { language?: string }) {
  const t = createTranslator(language);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<'iconSettingsCleared' | 'iconSettingsClearFailed' | ''>('');
  const [failed, setFailed] = useState(false);
  return <section aria-label={t('iconSettingsTitle')}
    className="space-y-3 border-t border-slate-200/50 pt-4 dark:border-white/10">
    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">{t('iconSettingsTitle')}</h4>
    <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
      {t('iconSettingsLocalCache')}
    </p>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        setMessage('');
        setFailed(false);
        try {
          await clearSiteIconCache();
          setMessage('iconSettingsCleared');
        } catch {
          setFailed(true);
          setMessage('iconSettingsClearFailed');
        } finally { setBusy(false); }
      }} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-slate-300 px-2.5 text-xs text-slate-700 hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:text-slate-200 dark:hover:bg-white/5">
        {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}
        {t('iconSettingsClear')}
      </button>
      {message && <p role={failed ? 'alert' : 'status'} className={`text-xs ${failed ? 'text-rose-600 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300'}`}>{t(message)}</p>}
    </div>
  </section>;
}

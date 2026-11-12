import { useEffect, useState, type ReactNode } from 'react';
import { applicationStorage, recoverApplicationRestore } from '../../services/application-storage';
import { RESTORE_JOURNAL } from '../../services/restore-journal';
import { downloadRawLocalBackup } from '../../services/local-backup';
import { createTranslator } from '../../i18n';
import { readUserLocale } from '../../services/user-locale';

export function WorkbenchRecoveryBoundary({ children }: { children: ReactNode }) {
  const t = createTranslator(readUserLocale());
  const [state, setState] = useState<'ready' | 'recovering' | 'failed'>(() => {
    try { return applicationStorage().getItem(RESTORE_JOURNAL) === null ? 'ready' : 'recovering'; }
    catch { return 'failed'; }
  });
  const [downloadFailed, setDownloadFailed] = useState(false);
  useEffect(() => {
    if (state !== 'recovering') return;
    let active = true;
    const recover = async () => {
      if (!navigator.locks?.request) throw new Error('LOCK_UNAVAILABLE');
      await navigator.locks.request('jigeqiu:prototype:library-import', () =>
        navigator.locks.request('jigeqiu:prototype:search-engines', () => {
          if (active) return recoverApplicationRestore();
        }));
      if (active) setState('ready');
    };
    void recover().catch(() => { if (active) setState('failed'); });
    return () => { active = false; };
  }, [state]);
  if (state === 'ready') return children;
  return <main className="mx-auto max-w-xl space-y-4 p-6">
    <h1 className="text-lg font-semibold">{t(state === 'failed' ? 'workbenchRecoveryFailed' : 'workbenchRecovering')}</h1>
    {state === 'failed' && <>
      <p role="alert">{t('workbenchRecoveryHelp')}</p>
      <button type="button" className="rounded-md border px-3 py-2" onClick={() => {
        try { downloadRawLocalBackup('jigeqiu-recovery-data.json'); setDownloadFailed(false); }
        catch { setDownloadFailed(true); }
      }}>{t('workbenchExportRecovery')}</button>
      {downloadFailed && <p role="alert">{t('localDataBackupError')}</p>}
    </>}
  </main>;
}

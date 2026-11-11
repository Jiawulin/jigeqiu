import { Component, type ReactNode } from 'react';
import { Download, RotateCw } from 'lucide-react';
import { downloadRawLocalBackup } from '../../services/local-backup';
import { createTranslator } from '../../i18n';
import { readUserLocale } from '../../services/user-locale';

export class LocalDataBoundary extends Component<{ children: ReactNode }, { failed: boolean; backupFailed: boolean }> {
  state = { failed: false, backupFailed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const t = createTranslator(readUserLocale());
    return <main className="flex min-h-dvh items-center justify-center bg-zinc-100 p-5 text-zinc-900">
      <section className="w-full max-w-lg space-y-4">
        <h1 className="text-xl font-semibold">{t('extensionBrand')}</h1>
        <p role="alert" className="text-sm font-medium">{t('localDataUnavailable')}</p>
        <p className="text-sm leading-relaxed text-zinc-600">{t('localDataBackupFirst')}</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-sky-700 px-3 text-sm text-white"
            onClick={() => {
              try {
                downloadRawLocalBackup('jigeqiu-local-data-backup.json');
                this.setState({ backupFailed: false });
              } catch { this.setState({ backupFailed: true }); }
            }}><Download size={16} />{t('localDataBackup')}</button>
          <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm"
            onClick={() => window.location.reload()}><RotateCw size={16} />{t('localDataRetry')}</button>
        </div>
        {this.state.backupFailed && <p role="alert" className="text-sm text-rose-700">{t('localDataBackupError')}</p>}
      </section>
    </main>;
  }
}

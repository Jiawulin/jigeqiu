import { ArrowLeft, Check, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { PRIVACY_VERSION } from './content';
import { PrivacyContent, PrivacyDialog } from './PrivacyDialog';
import './privacy.css';
import { createTranslator } from '../../src/i18n';

export function PrivacyPage({
  initial = false,
  onContinue,
  language,
}: {
  initial?: boolean;
  onContinue?: () => void | Promise<void>;
  language?: string;
}) {
  const t = createTranslator(language);
  const [declined, setDeclined] = useState(false);
  const [error, setError] = useState(false);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <main className="extension-privacy-page">
      <header>
        <img src="brand/logo-a2-equator.png" width="48" height="48" alt="" />
        <div>
          <h1>{t('extensionBrand')}</h1>
          <p>{t('extensionSubtitle')}</p>
        </div>
      </header>
      <h2>{t(initial ? 'extensionPrivacyInitial' : 'extensionPrivacy')}</h2>
      <p className="privacy-version">{t('extensionPrivacyVersion', { version: PRIVACY_VERSION })}</p>
      {initial ? (
        <>
          <ul className="privacy-summary">
            <li>{t('extensionSummaryLocal')}</li>
            <li>
              {t('extensionSummaryPermissions')}
            </li>
            <li>
              {t('extensionSummaryRemote')}
            </li>
            <li>
              {t('extensionSummaryIcons')}
            </li>
          </ul>
          <p>
            {t('extensionPrivacyConsent')}
          </p>
          <button type="button" onClick={() => setDetails(true)}>
            {t('extensionPrivacyFull')}
          </button>
          {declined ? (
            <div className="privacy-declined">
              <p role="status">
                {t('extensionPrivacyDeclined')}
              </p>
              <button type="button" onClick={() => setDeclined(false)}>
                <ArrowLeft size={16} />
                {t('extensionPrivacyBack')}
              </button>
            </div>
          ) : (
            <div className="privacy-actions">
              <button type="button" onClick={() => setDeclined(true)}>
                {t('extensionPrivacyDecline')}
              </button>
              <button
                type="button"
                className="privacy-primary"
                disabled={busy}
                onClick={async () => {
                  if (busy) return;
                  setBusy(true);
                  setError(false);
                  try {
                    await onContinue?.();
                  } catch {
                    setError(true);
                  } finally { setBusy(false); }
                }}
              >
                <Check size={16} />
                {t('extensionPrivacyContinue')}
              </button>
            </div>
          )}
          {error && <p role="alert">{t('extensionPrivacySaveError')}</p>}
        </>
      ) : (
        <>
          <PrivacyContent language={language} />
          <a className="privacy-return" href={`./index.html${location.hash}`}>
            <ArrowLeft size={16} />
            {t('extensionReturn')}
          </a>
        </>
      )}
      <footer>
        <ShieldCheck size={16} />
        {t('extensionPrivacyOffline')}
      </footer>
      {details && <PrivacyDialog language={language} onClose={() => setDetails(false)} />}
    </main>
  );
}

import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { PrivacyPage } from './privacy/PrivacyPage';
import { PrivacyDialog } from './privacy/PrivacyDialog';
import { PRIVACY_KEY, PRIVACY_VERSION } from './privacy/content';
import './styles.css';
import { createExtensionStorage } from './storage/local';
import { applicationStorage, configureApplicationStorage, mutateStorage } from '../src/services/application-storage';
import { readUserLocale } from '../src/services/user-locale';
import { createTranslator } from '../src/i18n';

const App = lazy(() => import('../src/App'));

function acknowledged() {
  try {
    return applicationStorage().getItem(PRIVACY_KEY) === PRIVACY_VERSION;
  } catch {
    return false;
  }
}

function ExtensionApp() {
  const [language, setLanguage] = useState(() => readUserLocale());
  const t = createTranslator(language);
  const [ready, setReady] = useState(acknowledged);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  }, [language]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.storageArea === localStorage) check();
    };
    window.addEventListener('storage', changed);
    const check = () => {
      setReady(acknowledged());
      setLanguage(readUserLocale());
    };
    window.addEventListener('application-storage-change', check);
    return () => {
      window.removeEventListener('storage', changed);
      window.removeEventListener('application-storage-change', check);
    };
  }, []);
  if (new URLSearchParams(location.search).has('privacy'))
    return <PrivacyPage language={language} />;
  if (!ready)
    return (
      <PrivacyPage
        initial
        language={language}
        onContinue={async () => {
          await mutateStorage(() => applicationStorage().setItem(PRIVACY_KEY, PRIVACY_VERSION));
          if (!acknowledged())
            throw new Error('Privacy acknowledgment was not saved');
          setReady(true);
        }}
      />
    );
  return (
    <>
      <Suspense fallback={<p role="status">{t('extensionOpening')}</p>}>
        <App />
      </Suspense>
      <button
        type="button"
        className="extension-privacy-launcher"
        onClick={() => setPrivacyOpen(true)}
        aria-label={t('extensionPrivacy')}
        title={t('extensionPrivacy')}
      >
        <ShieldCheck size={19} />
      </button>
      {privacyOpen && <PrivacyDialog language={language} onClose={() => setPrivacyOpen(false)} />}
    </>
  );
}

const root = createRoot(document.getElementById('root')!);

async function start() {
  const language = readUserLocale();
  const t = createTranslator(language);
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  root.render(<p role="status">{t('extensionReading')}</p>);
  try {
    const chrome = (globalThis as typeof globalThis & {
      chrome: { storage: { local: Parameters<typeof createExtensionStorage>[0]['area'];
        onChanged: Parameters<typeof createExtensionStorage>[0]['changes'] } };
    }).chrome;
    const driver = createExtensionStorage({
      area: chrome.storage.local, changes: chrome.storage.onChanged,
      locks: navigator.locks, legacy: () => localStorage,
    });
    await driver.initialize();
    configureApplicationStorage(driver);
    root.render(<ExtensionApp />);
  } catch (cause) {
    console.error('Extension storage initialization failed', cause);
    root.render(<main className="extension-privacy-page">
      <h1>{t('extensionStorageErrorTitle')}</h1>
      <p role="alert">{t('extensionStorageError')}</p>
      <button type="button" onClick={() => location.reload()}>{t('extensionReload')}</button>
    </main>);
  }
}
void start();

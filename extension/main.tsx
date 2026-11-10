import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { PrivacyPage } from './privacy/PrivacyPage';
import { PrivacyDialog } from './privacy/PrivacyDialog';
import { PRIVACY_KEY, PRIVACY_VERSION } from './privacy/content';
import './styles.css';
import { createExtensionStorage } from './storage/local';
import { applicationStorage, configureApplicationStorage, mutateStorage } from '../src/services/application-storage';

const App = lazy(() => import('../src/App'));

function acknowledged() {
  try {
    return applicationStorage().getItem(PRIVACY_KEY) === PRIVACY_VERSION;
  } catch {
    return false;
  }
}

function ExtensionApp() {
  const [ready, setReady] = useState(acknowledged);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === PRIVACY_KEY || event.key === null)
        setReady(acknowledged());
    };
    window.addEventListener('storage', changed);
    const check = () => setReady(acknowledged());
    window.addEventListener('application-storage-change', check);
    return () => {
      window.removeEventListener('storage', changed);
      window.removeEventListener('application-storage-change', check);
    };
  }, []);
  if (new URLSearchParams(location.search).has('privacy'))
    return <PrivacyPage />;
  if (!ready)
    return (
      <PrivacyPage
        initial
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
      <Suspense fallback={<p role="status">正在打开工作台…</p>}>
        <App />
      </Suspense>
      <button
        type="button"
        className="extension-privacy-launcher"
        onClick={() => setPrivacyOpen(true)}
        aria-label="隐私说明"
        title="隐私说明"
      >
        <ShieldCheck size={19} />
      </button>
      {privacyOpen && <PrivacyDialog onClose={() => setPrivacyOpen(false)} />}
    </>
  );
}

const root = createRoot(document.getElementById('root')!);

async function start() {
  root.render(<p role="status">正在读取本地数据…</p>);
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
      <h1>无法读取或迁移本地数据</h1>
      <p role="alert">原有数据未删除。请勿卸载扩展，检查存储权限及可用空间后重试。</p>
      <button type="button" onClick={() => location.reload()}>重新加载</button>
    </main>);
  }
}
void start();

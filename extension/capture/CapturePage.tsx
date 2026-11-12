import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { BookmarkDialog } from '../../src/components/common/BookmarkDialog';
import { LocalDataBoundary } from '../../src/components/common/LocalDataBoundary';
import { StorageManager } from '../../src/services/storage';
import { withCollectionMutation } from '../../src/services/collection-mutation';
import { createTranslator } from '../../src/i18n';
import type { Bookmark } from '../../src/types';
import { captureChrome } from './chrome';
import { captureKey, parseCapture, type CaptureDraft } from './controller';

export default function CapturePage({ id, language }: { id: string; language: string }) {
  const [request, setRequest] = useState<CaptureDraft>();
  const [failed, setFailed] = useState(false);
  const t = createTranslator(language);
  useEffect(() => {
    let current = true;
    void (async () => {
      const key = captureKey(id);
      const values = await captureChrome().storage.session.get(key);
      const draft = parseCapture(values[key]);
      if (draft.error) throw new Error('UNSUPPORTED');
      if (current) setRequest(draft);
    })().catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [id]);
  if (failed) return <main className="extension-privacy-page">
    <h1>{t('extensionCaptureMenu')}</h1>
    <p role="alert">{t('extensionCaptureInvalid')}</p>
    <button type="button" onClick={() => window.close()}><X size={16} />{t('extensionCaptureClose')}</button>
  </main>;
  if (!request) return <p role="status">{t('extensionReading')}</p>;
  return <LocalDataBoundary><CaptureEditor request={request} language={language} /></LocalDataBoundary>;
}

function CaptureEditor({ request, language }: { request: CaptureDraft; language: string }) {
  const [manager] = useState(() => new StorageManager());
  const [snapshot, setSnapshot] = useState(() => {
    const bookmarks = manager.getBookmarks();
    const folders = manager.getFolders();
    manager.getDesktopLayout();
    return { bookmarks, folders };
  });
  const [editing, setEditing] = useState<Bookmark>();
  const mounted = useRef(true);
  useEffect(() => {
    const settings = manager.getUserSettings();
    const dark = settings.appearanceMode === 'dark-glass';
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('dark-glass', dark);
    document.documentElement.classList.toggle('reduced-transparency', settings.appearanceMode === 'reduced-transparency');
    mounted.current = true;
    return () => { mounted.current = false; };
  }, [manager]);
  return <BookmarkDialog isOpen language={language} bookmark={editing}
    folders={snapshot.folders} existingBookmarks={snapshot.bookmarks}
    initialUrl={request.url} initialTitle={request.title}
    defaultPinToDesktop={false}
    onClose={() => window.close()}
    onOpenExisting={bookmark => {
      window.open(bookmark.url, '_blank', 'noopener,noreferrer');
      window.close();
    }}
    onEditExisting={setEditing}
    onSave={async (input, pin) => {
      await manager.mutate(() => {
        if (!mounted.current) throw new Error('CANCELLED');
        return manager.saveManualBookmark({ ...input, pinnedToDesktop: pin }, editing?.id);
      });
    }}
    onCreateFolder={async (name, parentId) => await withCollectionMutation(async () => {
      const folder = await manager.mutate(() => {
        if (!mounted.current) throw new Error('CANCELLED');
        return manager.createFolder(name, [], parentId);
      });
      if (mounted.current) setSnapshot({
        bookmarks: manager.getBookmarks(), folders: manager.getFolders(),
      });
      return folder;
    }, () => mounted.current)}
  />;
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, Folder, Home, Library, Search, Upload } from 'lucide-react';
import { createBrowserSnapshotStore } from './services/persistence/browser-store';
import type { ReadState } from './services/persistence/snapshot-store';
import type { LibraryRef, Result } from './domain/assets/model';
import { ChromeImportDialog } from './components/account/ChromeImportDialog';
import { describeAssetError } from './services/import-export/ui-errors';
import { WallpaperBackground } from './components/common/WallpaperBackground';
import './workspace.css';

// Isolated integration workspace; never replace the existing desktop with it.
export default function ImportWorkspace() {
  const [store] = useState(() => createBrowserSnapshotStore());
  const [read, setRead] = useState<Result<ReadState> | null>(null);
  const [view, setView] = useState<'desktop' | 'library'>('desktop');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [message, setMessage] = useState('');
  const reload = useCallback(async () => { setRead(await store.read()); }, [store]);
  useEffect(() => {
    void reload();
    return store.subscribe(() => { void reload(); });
  }, [store, reload]);
  const snapshot = read?.ok && read.value.kind === 'ready' ? read.value.envelope.snapshot : null;
  const library = snapshot?.library;
  const blocked = !read || !read.ok || read.value.kind === 'legacy' || store.capability().mode === 'read-only';
  const readError = read && !read.ok ? describeAssetError(read.error.code)
    : read?.ok && read.value.kind === 'legacy' ? describeAssetError('LEGACY_REQUIRES_PREVIEW')
    : read && store.capability().mode === 'read-only' ? describeAssetError('LOCK_UNAVAILABLE') : '';
  const bookmarksById = useMemo(() => new Map(library?.bookmarks.map(item => [item.id, item])), [library]);
  const foldersById = useMemo(() => new Map(library?.folders.map(item => [item.id, item])), [library]);
  const allRefs = useMemo(() => {
    const result: LibraryRef[] = [];
    const walk = (refs: LibraryRef[]) => refs.forEach(ref => {
      if (ref.kind === 'bookmark') result.push(ref);
      else walk(foldersById.get(ref.id)?.children ?? []);
    });
    walk(library?.root ?? []);
    return result;
  }, [library, foldersById]);
  const currentFolder = folderId ? foldersById.get(folderId) : undefined;
  const needle = query.trim().toLocaleLowerCase();
  const refs = needle ? allRefs.filter(ref => {
    const item = bookmarksById.get(ref.id);
    return item && [item.title, item.url, item.notes, ...item.keywords].some(text => text.toLocaleLowerCase().includes(needle));
  }) : currentFolder?.children ?? allRefs;
  const goLibrary = () => { setView('library'); setFolderId(null); setQuery(''); };
  const renderFolders = (items: LibraryRef[], depth = 0): React.ReactNode => items
    .filter(ref => ref.kind === 'folder')
    .map(ref => {
      const folder = foldersById.get(ref.id)!;
      return <div key={folder.id}>
        <button className={`ws-folder ${folderId === folder.id ? 'is-selected' : ''}`}
          style={{ paddingLeft: 12 + depth * 14 }} title={folder.name}
          onClick={() => { setFolderId(folder.id); setQuery(''); }}>
          <Folder size={17} /><span>{folder.name}</span>
        </button>
        {renderFolders(folder.children, depth + 1)}
      </div>;
    });
  return (
    <WallpaperBackground preset="snow-mountain" appearance="light-glass">
      <div className="ws">
        <header className="ws-header">
          <button className="ws-brand" onClick={() => setView('desktop')} aria-label="记个球首页">
            <img src={`${import.meta.env?.BASE_URL ?? '/'}brand/logo-a2-equator.png`} alt="" aria-hidden="true" width={40} height={40} />
          </button>
          <span className="ws-local">本机收藏</span>
          <button className="ws-button" disabled={blocked} onClick={() => setImportOpen(true)}>
            <Upload size={16} /><span>导入 Chrome 书签</span>
          </button>
        </header>
        <div className="ws-search">
          <Search size={21} />
          <input type="search" aria-label="搜索收藏" placeholder="搜索你的收藏"
            value={query} onChange={event => { setQuery(event.target.value); setView('library'); }} />
        </div>
        {readError && <div className="ws-alert" role="alert">
          {readError}
          {read?.ok && read.value.kind === 'legacy' && <span> 可先使用新的浏览器配置文件体验本版；不要清空当前浏览器数据。</span>}
        </div>}
        {message && <div className="ws-status" role="status">{message}</div>}
        <main className="ws-main">
          {view === 'desktop' ? (
            <section className="ws-empty">
              <div className="ws-empty-icon"><Bookmark size={36} strokeWidth={1.4} /></div>
              <h1>我的桌面</h1>
              <p>{library?.bookmarks.length ? `已保存 ${library.bookmarks.length} 个网址` : '从你的浏览器收藏开始'}</p>
              {library?.bookmarks.length
                ? <button className="ws-button ws-primary" onClick={goLibrary}><Library size={17} />打开全部收藏</button>
                : <button className="ws-button ws-primary" disabled={blocked} onClick={() => setImportOpen(true)}>
                  <Upload size={17} />导入 Chrome 书签
                </button>}
            </section>
          ) : (
            <section className="ws-library" aria-label="收藏库">
              <aside className="ws-sidebar" aria-label="收藏文件夹">
                <button className={`ws-folder ${!folderId ? 'is-selected' : ''}`} onClick={goLibrary}>
                  <Library size={17} /><span>全部收藏</span><small>{library?.bookmarks.length ?? 0}</small>
                </button>
                {renderFolders(library?.root ?? [])}
              </aside>
              <div className="ws-content">
                <div className="ws-content-heading">
                  <h1>{needle ? '搜索结果' : currentFolder?.name ?? '全部收藏'}</h1>
                  <span>{refs.length} 项</span>
                </div>
                {!refs.length && <div className="ws-list-empty">{needle ? '没有找到匹配的网址' : '暂无收藏'}</div>}
                <div className="ws-items">
                  {refs.map(ref => {
                    if (ref.kind === 'folder') {
                      const folder = foldersById.get(ref.id)!;
                      return <button key={folder.id} className="ws-item" onClick={() => setFolderId(folder.id)}>
                        <span className="ws-item-icon ws-icon-folder"><Folder size={24} /></span>
                        <span className="ws-item-title">{folder.name}</span><span className="ws-item-detail">{folder.children.length} 项</span>
                      </button>;
                    }
                    const bookmark = bookmarksById.get(ref.id)!;
                    return <a key={bookmark.id} className="ws-item" href={bookmark.url} target="_blank" rel="noopener noreferrer">
                      <span className="ws-item-icon" data-tone={bookmark.title.length % 4}>{bookmark.title.slice(0, 1).toUpperCase()}</span>
                      <span className="ws-item-title">{bookmark.title}</span>
                      <span className="ws-item-detail">{new URL(bookmark.url).hostname}</span>
                    </a>;
                  })}
                </div>
              </div>
            </section>
          )}
        </main>
        <nav className="ws-dock" aria-label="工作区">
          <button aria-label="桌面" title="桌面" aria-current={view === 'desktop' ? 'page' : undefined} onClick={() => { setView('desktop'); setQuery(''); }}><Home size={24} /></button>
          <button aria-label="全部收藏" title="全部收藏" aria-current={view === 'library' ? 'page' : undefined} onClick={goLibrary}><Library size={24} /></button>
        </nav>
        {importOpen && <ChromeImportDialog store={store} onClose={() => setImportOpen(false)}
          onImported={async count => {
            await reload();
            goLibrary();
            setMessage(`已保存 ${count} 个网址到本机收藏`);
            setImportOpen(false);
          }} />}
      </div>
    </WallpaperBackground>
  );
}

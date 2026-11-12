import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, RefreshCw, Trash2 } from 'lucide-react';
import type { UserSettings } from '../../types';
import { createTranslator } from '../../i18n';
import {
  BUILTIN_WALLPAPERS, listWallpapers, mutateWallpaper, notifyWallpaperChange, readWallpaper,
  removeWallpaper, saveWallpaper, subscribeWallpaperChange, visibleWallpaper, type WallpaperEntry,
} from '../../services/custom-wallpaper';
import { storage } from '../../services/storage';
import { Modal } from './Modal';

interface Props {
  settings: UserSettings;
  onUpdate(settings: Partial<UserSettings>, signal?: AbortSignal): boolean | void | Promise<boolean | void>;
}
type ErrorKey = 'wallpaperFailed' | 'wallpaperApplyFailed' | 'wallpaperSwitchFailed' | 'wallpaperDeleteFailed';

function Thumbnail({ entry }: { entry: WallpaperEntry }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    void (entry.thumbnail ? Promise.resolve(entry.thumbnail) : readWallpaper(entry.id)).then(blob => {
      if (!blob || cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { /* Keep the filename available when a preview cannot be read. */ });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [entry.id, entry.thumbnail]);
  return <div className="aspect-[3/2] w-full overflow-hidden rounded bg-black/5 dark:bg-white/5">
    {url && <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />}
  </div>;
}

export function WallpaperSettings({ settings, onUpdate }: Props) {
  const t = createTranslator(settings.language);
  const [entries, setEntries] = useState<WallpaperEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [listFailed, setListFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey>();
  const [deleting, setDeleting] = useState<WallpaperEntry>();
  const [deleteActive, setDeleteActive] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const loadRevision = useRef(0);
  const active = settings.wallpaperPreset === 'custom';
  const selectedPreset = active ? 'custom' : visibleWallpaper(settings.wallpaperPreset);
  const load = useCallback(async () => {
    const revision = ++loadRevision.current;
    try {
      const next = await listWallpapers();
      if (!lifetime.current?.signal.aborted && revision === loadRevision.current) {
        setEntries(next);
        setListFailed(false);
      }
    } catch {
      if (!lifetime.current?.signal.aborted && revision === loadRevision.current) setListFailed(true);
    } finally {
      if (!lifetime.current?.signal.aborted && revision === loadRevision.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void load();
    const unsubscribe = subscribeWallpaperChange(() => { void load(); });
    return () => { controller.abort(); loadRevision.current++; unsubscribe(); };
  }, [load]);

  async function run(action: (signal: AbortSignal) => Promise<void>, failure: ErrorKey) {
    const signal = lifetime.current?.signal;
    if (saving.current || !signal || signal.aborted) return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    try { await mutateWallpaper(() => action(signal), signal); }
    catch {
      if (!signal.aborted) setError(failure);
    } finally {
      saving.current = false;
      if (!signal.aborted) { setBusy(false); await load(); }
    }
  }
  async function apply(updates: Partial<UserSettings>, signal: AbortSignal) {
    signal.throwIfAborted();
    if (await onUpdate(updates, signal) === false) throw new Error('WALLPAPER_APPLY');
    notifyWallpaperChange();
  }
  function choose(file?: File) {
    if (!file) return;
    void run(async signal => {
      const id = await saveWallpaper(file, signal);
      if (signal.aborted) return;
      try { await apply({ wallpaperPreset: 'custom', customWallpaperId: id }, signal); }
      catch { if (!signal.aborted) setError('wallpaperApplyFailed'); }
    }, 'wallpaperFailed');
  }
  function select(updates: Partial<UserSettings>) {
    void run(async signal => {
      if (updates.customWallpaperId && !await readWallpaper(updates.customWallpaperId)) {
        throw new Error('WALLPAPER_MISSING');
      }
      await apply(updates, signal);
    }, 'wallpaperSwitchFailed');
  }
  function confirmDelete() {
    if (!deleting) return;
    const id = deleting.id;
    void run(async signal => {
      // Read under the wallpaper lock: another tab may have selected this image.
      const latest = storage.getUserSettings();
      if (latest.wallpaperPreset === 'custom' && latest.customWallpaperId === id && !deleteActive) {
        setDeleteActive(true);
        return;
      }
      if (latest.customWallpaperId === id) {
        await apply({
          customWallpaperId: undefined,
          ...(latest.wallpaperPreset === 'custom' ? { wallpaperPreset: 'snow-mountain' as const } : {}),
        }, signal);
      }
      signal.throwIfAborted();
      await removeWallpaper(id);
      if (!signal.aborted) {
        setDeleting(undefined);
        requestAnimationFrame(() => input.current?.focus());
      }
    }, 'wallpaperDeleteFailed');
  }
  const name = (entry: WallpaperEntry) => entry.name || t('wallpaperLegacyName');
  const border = (selected: boolean) => selected
    ? 'border-sky-500 ring-2 ring-sky-500/20' : 'border-slate-200/60 dark:border-white/15';
  return <div>
    <h4 className="mb-3 text-xs font-bold text-slate-800 dark:text-slate-200">{t('managerDesktopBackground')}</h4>
    <h5 className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">{t('wallpaperBuiltins')}</h5>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {BUILTIN_WALLPAPERS.map(wp => <button key={wp.id} type="button" disabled={busy}
        onClick={() => select({ wallpaperPreset: wp.id })}
        aria-pressed={selectedPreset === wp.id}
        aria-label={t('managerSelectWallpaper', { name: t(wp.label) })}
        className={`relative min-w-0 rounded-lg border p-2 text-left disabled:opacity-50 ${border(selectedPreset === wp.id)}`}>
        <div data-wallpaper={wp.id} className="wallpaper-preview mb-2 aspect-[3/2] w-full rounded" />
        <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">{t(wp.label)}</span>
        {selectedPreset === wp.id && <Check aria-hidden size={18} className="absolute right-3 top-3 rounded bg-sky-600 text-white" />}
      </button>)}
    </div>
    <div className="mb-2 mt-5 flex flex-wrap items-center justify-between gap-2">
      <h5 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
        {t('wallpaperMyImages')}{!listFailed && !loading && <span className="ml-2 text-slate-500">{entries.length}</span>}
      </h5>
      <button type="button" disabled={busy || loading || listFailed} onClick={() => input.current?.click()}
        className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-500/10 disabled:opacity-50 dark:text-sky-300">
        <ImagePlus size={16} />{t(busy ? 'wallpaperSaving' : 'wallpaperAdd')}
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || loading || listFailed}
        aria-label={t('wallpaperChoose')} className="sr-only"
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; choose(file); }} />
    </div>
    {loading && <p role="status" className="text-xs text-slate-600 dark:text-slate-400">{t('wallpaperLoading')}</p>}
    {listFailed && <div className="flex items-center gap-2">
      <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{t('wallpaperListFailed')}</p>
      <button type="button" disabled={busy} onClick={() => { setLoading(true); void load(); }}
        className="flex items-center gap-1 text-xs text-sky-700 dark:text-sky-300"><RefreshCw size={14} />{t('wallpaperRetry')}</button>
    </div>}
    {!listFailed && !loading && entries.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">{t('wallpaperEmpty')}</p>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-busy={busy || loading}>
      {!listFailed && entries.map(entry => {
        const selected = active && settings.customWallpaperId === entry.id;
        return <div key={entry.id} data-custom-wallpaper-item={entry.id} className={`relative min-w-0 rounded-lg border ${border(selected)}`}>
          <button type="button" disabled={busy} aria-pressed={selected}
            aria-label={t('wallpaperSelectImage', { name: name(entry) })}
            onClick={() => select({ wallpaperPreset: 'custom', customWallpaperId: entry.id })}
            className="block w-full min-w-0 rounded-lg p-2 pb-10 text-left disabled:opacity-50">
            <Thumbnail entry={entry} />
            <span data-wallpaper-name title={name(entry)} className="mt-2 block truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{name(entry)}</span>
            {selected && <Check aria-hidden size={18} className="absolute right-3 top-3 rounded bg-sky-600 text-white" />}
          </button>
          <button type="button" disabled={busy} title={t('wallpaperDeleteImage', { name: name(entry) })}
            aria-label={t('wallpaperDeleteImage', { name: name(entry) })}
            onClick={() => { setError(undefined); setDeleteActive(selected); setDeleting(entry); }}
            className="absolute bottom-1 right-1 flex h-8 w-8 items-center justify-center rounded text-rose-600 hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-400"><Trash2 size={16} /></button>
        </div>;
      })}
    </div>
    <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{t('wallpaperFileHint')}</p>
    {error && !deleting && <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-400">{t(error)}</p>}
    {deleting && <Modal isOpen contained maxWidth="sm" showCloseButton={false}
      title={t('wallpaperDeleteTitle')} onClose={() => { if (!busy) { setDeleting(undefined); setError(undefined); } }}>
      <p className="break-words text-sm">{t('wallpaperDeletePrompt', { name: name(deleting) })}</p>
      {deleteActive && <p className="mt-2 text-sm">{t('wallpaperDeleteFallback')}</p>}
      {error && <p role="alert" className="mt-3 text-xs text-rose-600 dark:text-rose-400">{t(error)}</p>}
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" disabled={busy} onClick={() => { setDeleting(undefined); setError(undefined); }}
          className="rounded px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10">{t('wallpaperCancel')}</button>
        <button type="button" disabled={busy} onClick={confirmDelete}
          className="flex items-center gap-1 rounded bg-rose-600 px-3 py-2 text-sm text-white disabled:opacity-50"><Trash2 size={14} />{t('wallpaperDeleteConfirm')}</button>
      </div>
    </Modal>}
  </div>;
}

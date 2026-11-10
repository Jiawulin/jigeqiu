import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import type { UserSettings } from '../../types';
import { createTranslator } from '../../i18n';
import { removeWallpaper, saveWallpaper, visibleWallpaper } from '../../services/custom-wallpaper';

interface Props {
  settings: UserSettings;
  onUpdate(settings: Partial<UserSettings>): boolean | void | Promise<boolean | void>;
}

export function WallpaperSettings({ settings, onUpdate }: Props) {
  const t = createTranslator(settings.language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const active = settings.wallpaperPreset === 'custom';
  const selectedPreset = active ? 'custom' : visibleWallpaper(settings.wallpaperPreset);
  async function choose(file?: File) {
    if (!file || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(false);
    let id: string | undefined;
    try {
      id = await saveWallpaper(file);
      if (!mounted.current) { await removeWallpaper(id); return; }
      if (await onUpdate({ wallpaperPreset: 'custom', customWallpaperId: id }) === false) {
        await removeWallpaper(id);
        setError(true);
        return;
      }
      if (settings.customWallpaperId) void removeWallpaper(settings.customWallpaperId).catch(() => {});
    } catch {
      if (id) void removeWallpaper(id).catch(() => {});
      if (mounted.current) setError(true);
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function clear() {
    if (await onUpdate({ wallpaperPreset: active ? 'cyan-lake' : settings.wallpaperPreset, customWallpaperId: undefined }) === false) {
      setError(true);
      return;
    }
    setError(false);
    if (settings.customWallpaperId) void removeWallpaper(settings.customWallpaperId).catch(() => {});
  }
  return <div>
    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-3">{t('managerDesktopBackground')}</h4>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {([
        { id: 'cyan-lake', label: 'managerWallpaperLake' },
        { id: 'snow-mountain', label: 'managerWallpaperSnow' },
      ] as const).map(wp => <button key={wp.id} type="button" disabled={busy}
        onClick={() => onUpdate({ wallpaperPreset: wp.id })}
        aria-pressed={selectedPreset === wp.id}
        aria-label={t('managerSelectWallpaper', { name: t(wp.label) })}
        className={`flex flex-col items-center p-2 rounded-lg border ${selectedPreset === wp.id ? 'border-sky-500 ring-2 ring-sky-500/20' : 'border-slate-200/40 dark:border-white/10'}`}>
        <div data-wallpaper={wp.id} className="wallpaper-preview w-full h-16 rounded-lg mb-2" />
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{t(wp.label)}</span>
      </button>)}
      <label className={`relative flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border p-2 text-slate-700 dark:text-slate-200 ${active ? 'border-sky-500 ring-2 ring-sky-500/20' : 'border-slate-200/40 dark:border-white/10'} ${busy ? 'opacity-50' : ''}`}>
        <ImagePlus size={24} />
        <span className="text-xs font-semibold">{t(busy ? 'wallpaperSaving' : 'wallpaperChoose')}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
          aria-label={t('wallpaperChoose')} className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void choose(file); }} />
      </label>
    </div>
    <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{t('wallpaperFileHint')}</p>
    {settings.customWallpaperId && <div className="mt-2 flex flex-wrap gap-3">
      {!active && <button type="button" disabled={busy} className="text-xs text-slate-700 dark:text-slate-200 underline"
        onClick={() => onUpdate({ wallpaperPreset: 'custom' })}>{t('wallpaperUseSaved')}</button>}
      <button type="button" disabled={busy} onClick={clear} className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400">
        <Trash2 size={14} />{t('wallpaperRemove')}
      </button>
    </div>}
    {error && <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-400">{t('wallpaperFailed')}</p>}
  </div>;
}

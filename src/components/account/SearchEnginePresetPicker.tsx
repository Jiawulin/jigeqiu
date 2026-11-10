import React, { useEffect, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { SEARCH_ENGINE_PRESETS, SEARCH_ENGINE_PRESET_CATEGORIES } from '../../data/search-engine-presets';
import { createTranslator, type MessageKey } from '../../i18n';
import { searchEnginePresetStatus } from '../../services/search-engine-presets';
import { storage } from '../../services/storage';
import { preferenceSaveError } from '../../services/preference-save-error';
import { withSearchEngineMutation } from '../../services/search-engine-mutation';
import type { SearchEngine } from '../../types';
import { FaviconImage } from '../common/FaviconImage';
import { Modal } from '../common/Modal';

const categoryNames = {
  general: 'presetCategoryGeneral', knowledge: 'presetCategoryKnowledge', media: 'presetCategoryMedia',
  shopping: 'presetCategoryShopping', development: 'presetCategoryDevelopment', news: 'presetCategoryNews',
  cars: 'presetCategoryCars',
} as const satisfies Record<typeof SEARCH_ENGINE_PRESET_CATEGORIES[number], MessageKey>;

export function SearchEnginePresetPicker({ engines, language, onChanged, onShowToast, onClose }: {
  engines: SearchEngine[];
  language?: string;
  onChanged: (engines: SearchEngine[]) => void;
  onShowToast: (message: string) => void;
  onClose: () => void;
}) {
  const t = createTranslator(language);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<{ cause: unknown } | { message: 'presetNothingAdded' | 'presetRefreshFailed' } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const choices = SEARCH_ENGINE_PRESETS.map(preset => ({
    ...preset, status: searchEnginePresetStatus(preset, engines),
  }));
  const normalizedQuery = query.trim().toLowerCase();
  const visible = choices.filter(preset => (category === 'all' || category === preset.category)
    && [createTranslator('zh')(preset.nameKey), createTranslator('en')(preset.nameKey),
      preset.keyword, new URL(preset.urlTemplate).hostname].some(value => value.toLowerCase().includes(normalizedQuery)));
  const selectedAvailable = choices.filter(preset => preset.status === 'available' && selected.includes(preset.id));
  const add = async () => {
    if (pending.current || uncertain || !selectedAvailable.length) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    let result: ReturnType<typeof storage.addSearchEnginePresets>;
    try {
      result = await withSearchEngineMutation(
        () => storage.mutate(() => storage.addSearchEnginePresets(selectedAvailable.map(preset => preset.id), language)),
        () => mounted.current,
      );
    } catch (cause) {
      pending.current = false;
      if (!mounted.current) return;
      setError({ cause });
      setUncertain(cause instanceof Error && cause.message === 'COMMIT_UNCERTAIN');
      setBusy(false);
      return;
    }
    if (!mounted.current) return;
    setBusy(false);
    // Persisted results must not be presented as an unsaved, retryable batch if refresh fails.
    try { onChanged(result.engines); }
    catch {
      setError({ message: 'presetRefreshFailed' });
      setUncertain(true);
      return;
    }
    if (result.addedCount === 0) {
      setError({ message: 'presetNothingAdded' });
      pending.current = false;
      return;
    }
    onShowToast(t('presetAddedToast', { count: result.addedCount }));
    onClose();
  };
  return <Modal isOpen onClose={onClose} title={t('presetPickerTitle')} maxWidth="2xl" contained>
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-3 text-slate-500" />
          <input type="search" aria-label={t('presetSearch')} value={query}
            onChange={event => setQuery(event.target.value)}
            className="h-10 w-full min-w-0 rounded-lg border border-slate-300/70 bg-white/50 pl-9 pr-3 text-sm outline-none focus:border-sky-500 dark:border-white/15 dark:bg-white/5" />
        </div>
        <select aria-label={t('presetCategory')} value={category} onChange={event => setCategory(event.target.value)}
          className="h-10 min-w-0 rounded-lg border border-slate-300/70 bg-white/70 px-2 text-xs dark:border-white/15 dark:bg-zinc-900">
          <option value="all">{t('presetAllCategories')}</option>
          {SEARCH_ENGINE_PRESET_CATEGORIES.map(key => <option key={key} value={key}>{t(categoryNames[key])}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <button type="button" disabled={busy || uncertain || !visible.some(preset => preset.status === 'available')}
          onClick={() => setSelected(current => [...new Set([...current,
            ...visible.filter(preset => preset.status === 'available').map(preset => preset.id)])])}
          className="text-sky-700 hover:underline disabled:opacity-40 dark:text-sky-300">{t('presetSelectVisible')}</button>
        <button type="button" disabled={busy || uncertain || !selected.length} onClick={() => setSelected([])}
          className="text-slate-600 hover:underline disabled:opacity-40 dark:text-slate-300">{t('presetClear')}</button>
      </div>
      <div className="max-h-[min(48dvh,28rem)] overflow-y-auto overscroll-contain pr-1">
        {SEARCH_ENGINE_PRESET_CATEGORIES.map(key => {
          const group = visible.filter(preset => preset.category === key);
          return group.length > 0 && <section key={key} className="mb-4">
            <h3 className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300">{t(categoryNames[key])}</h3>
            <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              {group.map(preset => <label key={preset.id} data-search-preset={preset.id}
                className={`flex min-h-16 min-w-0 items-start gap-2 border-b border-slate-300/40 py-2.5 dark:border-white/10 ${preset.status !== 'available' ? 'opacity-60' : 'cursor-pointer'}`}>
                <input type="checkbox" aria-label={t(preset.nameKey)}
                  checked={preset.status === 'available' && selected.includes(preset.id)}
                  disabled={preset.status !== 'available' || busy || uncertain}
                  onChange={event => setSelected(current => event.target.checked
                    ? [...current, preset.id] : current.filter(id => id !== preset.id))}
                  className="mt-2 h-4 w-4 shrink-0 accent-sky-600" />
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center">
                  <FaviconImage url={preset.urlTemplate} title={t(preset.nameKey)} size="sm" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-xs font-medium leading-5">{t(preset.nameKey)}</span>
                  <code className="block break-all text-[11px] text-slate-500 dark:text-slate-400">/{preset.keyword}</code>
                  {preset.status !== 'available' && <span className="block text-[11px] leading-4">
                    {t(preset.status === 'added' ? 'presetAdded' : 'presetConflict')}
                  </span>}
                  {preset.restricted && <span className="block text-[10px] leading-4 text-slate-500 dark:text-slate-400">
                    {t('presetRestricted')}
                  </span>}
                </span>
              </label>)}
            </div>
          </section>;
        })}
        {visible.length === 0 && <p className="py-8 text-center text-xs text-slate-500">{t('presetNoResults')}</p>}
      </div>
      {error && <p role="alert" className="break-words text-xs text-rose-700 dark:text-rose-300">
        {'message' in error ? t(error.message)
          : error.cause instanceof Error && error.cause.message === 'CORRUPT_DATA' ? t('presetCorrupt')
            : preferenceSaveError(error.cause, language)}
      </p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-300/50 pt-3 dark:border-white/10">
        <button type="button" onClick={onClose}
          className="rounded-lg px-3 py-2 text-xs hover:bg-black/5 dark:hover:bg-white/10">{t('managerCancel')}</button>
        <button type="button" onClick={() => { void add(); }} disabled={busy || uncertain || selectedAvailable.length === 0}
          className="flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40">
          <Plus size={14} className="shrink-0" />
          <span className="break-words">{t('presetAddSelected', { count: selectedAvailable.length })}</span>
        </button>
      </div>
    </div>
  </Modal>;
}

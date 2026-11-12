import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Image as ImageIcon, Link, LoaderCircle, Type } from 'lucide-react';
import type { SiteIconMode } from '../../types';
import { normalizeBookmarkIcon, normalizeBookmarkUrl } from '../../services/bookmark-input';
import { rankSiteIconCandidates, type SiteIconCandidate } from '../../services/site-icon-discovery';
import { discoverValidatedSiteIcons, validateSiteIconSource } from '../../services/site-icons';
import { FaviconImage } from './FaviconImage';
import { createTranslator } from '../../i18n';

export interface SiteIconChoice { icon?: string; iconMode: SiteIconMode }
interface Props {
  url: string;
  title: string;
  value: SiteIconChoice;
  onChange: (value: SiteIconChoice) => void;
  language?: string;
}

export function SiteIconPicker({ url, title, value, onChange, language = 'zh' }: Props) {
  const t = createTranslator(language);
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'online' | 'link'>('online');
  const [result, setResult] = useState<{ url: string; items: SiteIconCandidate[]; loading: boolean }>({
    url: '', items: [], loading: false,
  });
  const [draft, setDraft] = useState('');
  const [verified, setVerified] = useState('');
  const [linkError, setLinkError] = useState<'siteIconUnusableImage' | 'siteIconLoadFailed' | ''>('');
  const [previewURL, setPreviewURL] = useState('');
  const choice = useRef(value);
  const change = useRef(onChange);
  choice.current = value;
  change.current = onChange;
  let pageURL = '';
  try {
    const normalized = normalizeBookmarkUrl(url);
    const host = new URL(normalized).hostname;
    if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[') ||
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(host)) {
      pageURL = normalized;
    }
  } catch { /* Empty/invalid input makes no request. */ }
  const active = value.iconMode !== 'text' && (value.iconMode === 'auto' || (expanded && tab === 'online'));

  useEffect(() => {
    setDraft('');
    setVerified('');
    setLinkError('');
  }, [pageURL]);

  useEffect(() => {
    setPreviewURL('');
    if (!pageURL) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setPreviewURL(pageURL);
      if (!active) return;
      setResult({ url: pageURL, items: [], loading: true });
      const found = new Map<string, SiteIconCandidate>();
      const publish = () => {
        const items = rankSiteIconCandidates([...found.values()]);
        setResult({ url: pageURL, items, loading: true });
        const recommended = items.find(item => item.kind !== 'logo');
        if (recommended && choice.current.iconMode === 'auto') {
          change.current({ iconMode: 'auto', icon: recommended.url });
        }
      };
      void discoverValidatedSiteIcons(pageURL, {
        signal: controller.signal,
        onCandidate(candidate) {
          if (controller.signal.aborted) return;
          found.set(candidate.url, candidate);
          publish();
        },
      }).then(() => {
        if (controller.signal.aborted) return;
        publish();
        setResult(previous => ({ ...previous, loading: false }));
      }).catch(() => {
        if (!controller.signal.aborted) setResult(previous => ({ ...previous, loading: false }));
      });
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [pageURL, active]);

  let imageURL = '';
  try { imageURL = normalizeBookmarkIcon(draft.trim(), 'custom').icon ?? ''; } catch { /* Invalid draft remains editable. */ }
  useEffect(() => {
    setVerified('');
    if (!imageURL || !expanded || tab !== 'link') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void validateSiteIconSource(imageURL, controller.signal).then(() => {
        if (!controller.signal.aborted) setVerified(imageURL);
      }).catch(() => {
        if (!controller.signal.aborted) setLinkError('siteIconUnusableImage');
      });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [imageURL, expanded, tab]);
  const items = result.url === pageURL ? result.items : [];
  const loading = active && result.url === pageURL && result.loading;
  const selected = 'border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300';
  const neutral = 'border-slate-300/60 dark:border-white/15 hover:border-sky-400 text-slate-700 dark:text-slate-200';
  const buttonClass = 'relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-lg border p-2 text-xs focus-visible:outline-2 focus-visible:outline-sky-500';
  return <fieldset className="min-w-0" aria-label={t('siteIcon')}>
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(open => !open)}
      className="flex w-full items-center gap-3 rounded-lg border border-slate-200/70 bg-black/[0.025] p-2.5 text-left dark:border-white/10 dark:bg-white/5">
      <FaviconImage url={previewURL === pageURL ? previewURL : ''} title={title || t('siteIconPreview')} icon={value.icon} iconMode={value.iconMode} size="md" />
      <span className="min-w-0 flex-1 text-xs font-medium">{t('siteIcon')}
        <span className="mt-1 block font-normal text-slate-500 dark:text-slate-400">
          {value.iconMode === 'text' ? t('siteIconText') : value.iconMode === 'custom' ? t('siteIconSelectedImage') : t('siteIconAutomatic')}
        </span>
      </span>
      <ChevronDown size={16} className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
    {expanded && <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" aria-pressed={value.iconMode === 'auto'} onClick={() =>
          onChange({ iconMode: 'auto', icon: items.find(item => item.kind !== 'logo')?.url })}
          className={`${buttonClass} ${value.iconMode === 'auto' ? selected : neutral}`}>
          <ImageIcon size={18} /><span>{t('siteIconAutomatic')}</span>
          {value.iconMode === 'auto' && <Check size={12} className="absolute right-1 top-1" />}
        </button>
        <button type="button" aria-pressed={value.iconMode === 'text'} onClick={() => onChange({ iconMode: 'text' })}
          className={`${buttonClass} ${value.iconMode === 'text' ? selected : neutral}`}>
          <Type size={18} /><span>{t('siteIconText')}</span>
          {value.iconMode === 'text' && <Check size={12} className="absolute right-1 top-1" />}
        </button>
      </div>
      <div role="tablist" aria-label={t('siteIconImageSource')} className="flex border-b border-slate-200 dark:border-white/10">
        {([['online', 'siteIconOnline', ImageIcon], ['link', 'siteIconImageLink', Link]] as const).map(([id, label, Icon]) =>
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 border-b-2 text-xs ${tab === id
              ? 'border-sky-500 text-sky-700 dark:text-sky-300' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>
            <Icon size={14} />{t(label)}
          </button>)}
      </div>
      {tab === 'online' ? <div role="tabpanel" aria-label={t('siteIconOnline')} className="space-y-2">
        {items.length > 0 && <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((candidate, index) => {
            const chosen = value.iconMode === 'custom' && value.icon === candidate.url;
            const source = t(candidate.kind === 'logo' ? 'siteIconPageLogo' : candidate.kind === 'manifest' ? 'siteIconApp' : 'siteIconWebsiteSource');
            return <button key={candidate.url} type="button" aria-pressed={chosen}
              aria-label={t('siteIconChoose', { source, width: candidate.width, height: candidate.height })}
              title={candidate.url} onClick={() => onChange({ iconMode: 'custom', icon: candidate.url })}
              className={`${buttonClass} ${chosen ? selected : neutral}`}>
              <img src={candidate.url} alt="" referrerPolicy="no-referrer"
                className="h-10 w-10 object-contain" style={{ background: 'transparent', borderRadius: 0 }} />
              <span className="text-[10px] tabular-nums">{t('siteIconDimensions', { width: candidate.width, height: candidate.height })}</span>
              <span className="max-w-full truncate text-[10px] text-slate-500 dark:text-slate-400">
                {index === 0 && candidate.kind !== 'logo' ? t('siteIconRecommended') : source}
              </span>
              {chosen && <Check size={12} className="absolute right-1 top-1" />}
            </button>;
          })}
        </div>}
        <p role="status" className="flex min-h-5 items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          {loading && <LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" />}
          {!pageURL ? t('siteIconEnterWebsite') : value.iconMode === 'text' ? t('siteIconUsingText') : loading ? t('siteIconSearching') : !items.length ? t('siteIconNoImages') : t('siteIconFound', { count: items.length })}
        </p>
      </div> : <div role="tabpanel" aria-label={t('siteIconImageLink')} className="space-y-2">
        <input type="text" inputMode="url" aria-label={t('siteIconImageUrlLabel')} value={draft}
          onChange={event => { setDraft(event.target.value); setVerified(''); setLinkError(''); }}
          placeholder={t('siteIconImageUrlExample')}
          className="w-full min-w-0 rounded-lg border border-slate-200/70 bg-black/5 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/10" />
        <div className="flex min-h-12 items-center gap-3">
          {imageURL && <img key={imageURL} src={imageURL} alt="" referrerPolicy="no-referrer"
            className="h-10 w-10 shrink-0 object-contain"
            onError={() => { setVerified(''); setLinkError('siteIconLoadFailed'); }} />}
          <button type="button" disabled={!imageURL || verified !== imageURL}
            onClick={() => onChange({ iconMode: 'custom', icon: imageURL })}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs text-white disabled:opacity-40">
            <Check size={14} />{t('siteIconUseImage')}
          </button>
        </div>
        {(linkError || (draft && !imageURL)) && <p role="status" className="text-xs text-rose-600 dark:text-rose-300">
          {linkError ? t(linkError) : t('siteIconInvalidLink')}
        </p>}
      </div>}
    </div>}
  </fieldset>;
}

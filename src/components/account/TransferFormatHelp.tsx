import { useEffect, useId, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { createTranslator } from '../../i18n';

export function TransferFormatHelp({ language, kind }: { language?: string; kind: 'import' | 'export' }) {
  const t = createTranslator(language);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return <div ref={root} className="relative shrink-0"
    onMouseEnter={() => setOpen(true)}
    onMouseLeave={() => { if (!root.current?.contains(document.activeElement)) setOpen(false); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); } }}>
    <button type="button" aria-label={t(kind === 'import' ? 'transferImportHelpLabel' : 'transferExportHelpLabel')}
      aria-expanded={open} aria-describedby={open ? id : undefined}
      className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-teal-600 dark:text-slate-400 dark:hover:bg-white/10"
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)}>
      <CircleHelp size={18} />
    </button>
    {open && <div id={id} role="tooltip"
      className={`absolute right-0 z-30 ${kind === 'export' ? 'bottom-full mb-1' : 'top-full mt-1'} w-72 max-w-[calc(100vw-3rem)] space-y-3 rounded-md border border-slate-200 bg-white p-3 text-left text-xs leading-relaxed text-slate-700 shadow-lg dark:border-white/20 dark:bg-zinc-900 dark:text-slate-200`}>
      <p><strong className="font-semibold">HTML</strong><span className="mt-1 block">{t(kind === 'import' ? 'transferImportHtmlHelp' : 'transferExportHtmlHelp')}</span></p>
      <p><strong className="font-semibold">JSON</strong><span className="mt-1 block">{t(kind === 'import' ? 'transferImportJsonHelp' : 'transferExportJsonHelp')}</span></p>
      <p className="border-t border-slate-200 pt-2 dark:border-white/10">{t('transferWorkbenchHelp')}</p>
    </div>}
  </div>;
}

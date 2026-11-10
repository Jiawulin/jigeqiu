import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, GripVertical, MoreHorizontal } from 'lucide-react';
import type { SearchEngine } from '../../types';
import { createTranslator } from '../../i18n';
import { preferenceSaveError } from '../../services/preference-save-error';
import { withSearchEngineMutation } from '../../services/search-engine-mutation';
import { storage } from '../../services/storage';

type Drag = {
  id: string; pointerId: number; x: number; y: number; startX: number; startY: number;
  left: number; top: number; width: number;
  active: boolean; moved: boolean; before: string | null; ids: string[];
};

export function SearchEngineOrderList({ engines, language, onChanged, children }: {
  engines: SearchEngine[];
  language?: string;
  onChanged: (engines: SearchEngine[]) => void;
  children: React.ReactNode;
}) {
  const t = createTranslator(language);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef(0);
  const mounted = useRef(true);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [visual, setVisual] = useState<{
    id: string; before: string | null; left: number; top: number; width: number;
  } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const menuPanel = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<unknown>(null);
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState('');
  const restoreFocus = useRef<HTMLButtonElement | null>(null);
  const ids = engines.map(engine => engine.id);
  const orderKey = JSON.stringify(ids);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    cancelAnimationFrame(frame.current);
    timer.current = null;
    drag.current = null;
    setVisual(null);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      cancelAnimationFrame(frame.current);
      drag.current = null;
    };
  }, []);
  useEffect(() => { stop(); setMenu(null); }, [orderKey]);
  useEffect(() => {
    if (!busy && restoreFocus.current?.isConnected) {
      restoreFocus.current.focus({ preventScroll: true });
      restoreFocus.current = null;
    }
  }, [busy]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (drag.current || menu)) {
        event.preventDefault();
        stop();
        setMenu(null);
        menuTrigger.current?.focus({ preventScroll: true });
      }
    };
    const blur = () => stop();
    window.addEventListener('keydown', cancel);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', cancel); window.removeEventListener('blur', blur); };
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    menuPanel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('[data-engine-order-menu]')) setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    const dismiss = () => setMenu(null);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [menu]);

  const save = async (next: string[], expected: string[]) => {
    if (pending.current || blocked || JSON.stringify(next) === JSON.stringify(expected)) return;
    pending.current = true;
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement) {
      if (menuPanel.current?.contains(active)) restoreFocus.current = menuTrigger.current;
      else if (root.current?.contains(active)) restoreFocus.current = active;
    }
    setBusy(true);
    setError(null);
    setMenu(null);
    try {
      const result = await withSearchEngineMutation(
        () => storage.mutate(() => storage.reorderSearchEngines(next, expected)), () => mounted.current,
      );
      if (!mounted.current) return;
      try { onChanged(result); }
      catch { throw new Error('ORDER_REFRESH_FAILED'); }
      setNotice(t('engineOrderSaved'));
    } catch (cause) {
      if (!mounted.current) return;
      setError(cause);
      if (cause instanceof Error && ['COMMIT_UNCERTAIN', 'ORDER_REFRESH_FAILED', 'CONFLICT'].includes(cause.message)) {
        setBlocked(true);
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const position = () => {
    const current = drag.current;
    if (!current?.active || !root.current) return;
    const rows = Array.from(root.current.querySelectorAll<HTMLElement>('[data-engine-order-row]'));
    const others = rows.filter(row => row.dataset.engineOrderRow !== current.id);
    current.before = others.find(row => {
      const box = row.getBoundingClientRect();
      return current.y < box.top + box.height / 2;
    })?.dataset.engineOrderRow ?? null;
    setVisual({
      id: current.id, before: current.before, width: current.width,
      left: Math.max(8, Math.min(innerWidth - current.width - 8, current.left + current.x - current.startX)),
      top: current.top + current.y - current.startY,
    });
  };
  const autoScroll = () => {
    const current = drag.current;
    if (!current?.active || !root.current) return;
    let scrollable: HTMLElement | null = root.current.parentElement;
    while (scrollable && !(scrollable.scrollHeight > scrollable.clientHeight
      && /(auto|scroll)/.test(getComputedStyle(scrollable).overflowY))) scrollable = scrollable.parentElement;
    const box = scrollable?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
    const top = Math.max(0, box.top);
    const bottom = Math.min(innerHeight, box.bottom);
    const amount = current.y < top + 64 ? -Math.min(14, (top + 64 - current.y) / 4)
      : current.y > bottom - 64 ? Math.min(14, (current.y - bottom + 64) / 4) : 0;
    if (amount && current.moved) {
      if (scrollable) scrollable.scrollTop += amount;
      else window.scrollBy(0, amount);
      position();
    }
    frame.current = requestAnimationFrame(autoScroll);
  };
  const start = (event: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (busy || blocked || (event.pointerType === 'mouse' && event.button !== 0)) return;
    stop();
    setMenu(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    const box = event.currentTarget.closest('[data-engine-order-row]')!.getBoundingClientRect();
    drag.current = {
      id, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY, left: box.left, top: box.top, width: box.width,
      active: event.pointerType === 'mouse', moved: false, before: null, ids: [...ids],
    };
    const activate = () => {
      if (!drag.current) return;
      drag.current.active = true;
      position();
      frame.current = requestAnimationFrame(autoScroll);
    };
    if (event.pointerType === 'mouse') activate();
    else timer.current = setTimeout(activate, 250);
  };
  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
    if (!current.active && distance > 8) { stop(); return; }
    current.y = event.clientY;
    current.x = event.clientX;
    if (current.active && distance > 5) { current.moved = true; position(); }
  };
  const finish = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const next = current.ids.filter(id => id !== current.id);
    next.splice(current.before === null ? next.length : next.indexOf(current.before), 0, current.id);
    const shouldSave = current.active && current.moved;
    stop();
    if (shouldSave) void save(next, current.ids);
  };
  const step = (index: number, delta: number) => {
    const next = [...ids];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    void save(next, ids);
  };
  const rows = React.Children.toArray(children);
  const menuIndex = engines.findIndex(engine => engine.id === menu);
  const previewIndex = engines.findIndex(engine => engine.id === visual?.id);
  const toggleMenu = (event: React.MouseEvent<HTMLButtonElement>, id: string) => {
    if (menu === id) { setMenu(null); return; }
    const box = event.currentTarget.getBoundingClientRect();
    menuTrigger.current = event.currentTarget;
    setMenuPosition({
      left: Math.max(8, Math.min(innerWidth - 184, box.right - 176)),
      top: box.bottom + 108 < innerHeight ? box.bottom + 6 : Math.max(8, box.top - 108),
    });
    setMenu(id);
  };
  return <div ref={root} aria-busy={busy}>
    <div className="space-y-3">
      {engines.map((engine, index) => <div key={engine.id} data-engine-order-row={engine.id}
        className="engine-order-row relative flex min-w-0 items-start gap-1 rounded-lg"
        data-engine-source={visual?.id === engine.id || undefined}>
        {visual && visual.before === engine.id && <div data-engine-insertion className="engine-order-drop-slot" aria-hidden="true" />}
        <button type="button" title={t('engineOrderDrag', { name: engine.name })}
          aria-label={t('engineOrderDrag', { name: engine.name })} disabled={busy || blocked || engines.length < 2}
          onPointerDown={event => start(event, engine.id)} onPointerMove={move} onPointerUp={finish}
          onPointerCancel={stop} onLostPointerCapture={stop}
          onKeyDown={event => {
            if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
              event.preventDefault();
              if (event.key === 'ArrowUp' && index > 0) step(index, -1);
              if (event.key === 'ArrowDown' && index < engines.length - 1) step(index, 1);
            }
          }}
          className="flex h-11 w-11 shrink-0 touch-none select-none items-center justify-center rounded-lg text-slate-500 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-sky-500 active:cursor-grabbing disabled:opacity-30 dark:hover:bg-white/10"
          style={{ cursor: busy ? 'wait' : 'grab' }}>
          <GripVertical size={18} aria-hidden="true" />
        </button>
        <div className="engine-order-content min-w-0 flex-1" style={{
          transform: visual?.before === engine.id ? 'translateY(28px)' : undefined,
        }}>{rows[index]}</div>
        <div className="relative shrink-0" data-engine-order-menu>
          <button type="button" aria-label={t('engineOrderMenu', { name: engine.name })}
            title={t('engineOrderMenu', { name: engine.name })} aria-expanded={menu === engine.id}
            aria-controls={`engine-order-${engine.id}`} disabled={busy || blocked}
            onClick={event => toggleMenu(event, engine.id)}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-black/5 dark:hover:bg-white/10">
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        </div>
      </div>)}
    </div>
    {visual && visual.before === null && <div className="relative" aria-hidden="true">
      <div data-engine-insertion className="engine-order-drop-slot engine-order-drop-slot-end" />
    </div>}
    {visual && previewIndex >= 0 && createPortal(<div data-engine-drag-preview aria-hidden="true" inert
      className="engine-order-drag-preview" style={{ left: visual.left, top: visual.top, width: visual.width }}>
      <GripVertical size={18} className="mt-3 shrink-0 text-slate-500" />
      <div className="min-w-0 flex-1">{rows[previewIndex]}</div>
    </div>, document.body)}
    {menu && menuIndex >= 0 && createPortal(<div ref={menuPanel} data-engine-sort-panel data-engine-order-menu
      id={`engine-order-${menu}`} className="engine-order-menu" style={menuPosition}
      onKeyDown={event => {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
          const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}>
      <button type="button" disabled={menuIndex === 0} onClick={() => step(menuIndex, -1)}>
        <ArrowUp size={16} />{t('engineOrderUp')}
      </button>
      <button type="button" disabled={menuIndex === engines.length - 1} onClick={() => step(menuIndex, 1)}>
        <ArrowDown size={16} />{t('engineOrderDown')}
      </button>
    </div>, document.body)}
    {error !== null && <p role="alert" className="mt-3 break-words text-xs text-rose-700 dark:text-rose-300">
      {error instanceof Error && error.message === 'ORDER_REFRESH_FAILED' ? t('presetRefreshFailed')
        : error instanceof Error && error.message === 'CORRUPT_DATA' ? t('presetCorrupt')
          : preferenceSaveError(error, language)}
    </p>}
    <span role="status" className="sr-only">{notice}</span>
  </div>;
}

import { useEffect, useRef } from 'react';
import { hasApplicationStorageDriver } from '../services/application-storage';

export function useExtensionLibrarySync({
  blocked, changed, synchronize,
}: { blocked: boolean; changed(): boolean; synchronize(): void }) {
  const latest = useRef({ blocked, changed, synchronize });
  latest.current = { blocked, changed, synchronize };
  const retry = useRef<() => void>(() => {});
  useEffect(() => {
    if (!hasApplicationStorageDriver()) return;
    let pointer = false;
    let syncing = false;
    let scheduled = false;
    let disposed = false;
    const attempt = () => {
      const current = latest.current;
      if (disposed || syncing || pointer || current.blocked) return;
      // Search and launchpad are read-only views; editors and menus retain their baselines.
      if (document.querySelector(
        '[role="dialog"]:not([data-panel="search"]):not([data-panel="launchpad"]), dialog[open], [role="alertdialog"], [role="menu"], [aria-busy="true"], [data-testid="desktop-drag-preview"]',
      )) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.matches('input:not([type="search"]), textarea, [contenteditable="true"]')
        && !focused.closest('[data-panel="search"], [data-panel="launchpad"]')) return;
      try {
        if (!current.changed()) return;
        syncing = true;
        current.synchronize();
      } catch {
        // Keep the existing notice and baselines on invalid or unavailable storage.
      } finally { syncing = false; }
    };
    const schedule = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      queueMicrotask(() => { scheduled = false; attempt(); });
    };
    retry.current = schedule;
    const down = () => { pointer = true; };
    const up = () => { pointer = false; schedule(); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['aria-busy', 'open'] });
    window.addEventListener('application-storage-change', schedule);
    window.addEventListener('application-library-settled', schedule);
    window.addEventListener('focus', schedule);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('dragend', up, true);
    document.addEventListener('focusout', schedule);
    document.addEventListener('visibilitychange', schedule);
    schedule();
    return () => {
      disposed = true;
      observer.disconnect();
      retry.current = () => {};
      window.removeEventListener('application-storage-change', schedule);
      window.removeEventListener('application-library-settled', schedule);
      window.removeEventListener('focus', schedule);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('dragend', up, true);
      document.removeEventListener('focusout', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, []);
  useEffect(() => { retry.current(); }, [blocked]);
}

import { actionTerm } from '../common/action-terms';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Copy, Edit, ExternalLink, EyeOff, Library, MoreHorizontal, Pin, PinOff, RefreshCw, Search, Trash2, X } from 'lucide-react';
import type { Bookmark, Folder } from '../../types';
import { FaviconImage } from '../common/FaviconImage';
import { LaunchpadMark } from '../common/LaunchpadMark';
import { bookmarkSaveError } from '../../services/bookmark-input';
import { refreshSiteIcon } from '../../services/site-icons';
import { positionDesktopMenu } from './desktop-layout';
import { buildLaunchpadIndex, searchLaunchpad, type LaunchpadEntry } from './launchpad-index';
import { DesktopIconLabel } from './DesktopIconLabel';
import { MenuActionLabel } from '../common/MenuActionLabel';
import { bookmarkLibraryPath } from '../common/folder-tree';
import { DesktopConfirmPopover, type DesktopConfirmation } from './DesktopConfirmPopover';
import { createTranslator } from '../../i18n';
import { TaskHint } from '../onboarding/TaskHint';
import type { OnboardingTaskContext } from '../onboarding/types';
import './launchpad.css';
import { useLaunchpadGestures } from './use-launchpad-gestures';

export interface LaunchpadProps {
  isOpen: boolean;
  browseOnOpen?: boolean;
  onClose(): void;
  bookmarks: Bookmark[];
  folders: Folder[];
  desktopBookmarkIds?: string[];
  dockBookmarkIds?: string[];
  language?: string;
  onboarding?: OnboardingTaskContext;
  onRevealDesktop?(bookmarkId: string): void;
  onOpenBookmark(bookmark: Bookmark): void;
  onTogglePinDesktop?(bookmarkId: string): void;
  onToggleDockBookmark?(bookmarkId: string): void;
  onManageBookmark?(bookmark: Bookmark): void;
  onEditBookmark?: (bm: Bookmark) => void;
  onDeleteBookmark?(bookmarkId: string): void | Promise<void>;
  onShowToast?(message: string): void;
}

const alphabet = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];
const gridClass = 'launchpad-grid grid grid-cols-3 justify-items-center gap-x-2 gap-y-6 sm:grid-cols-4 sm:gap-x-5 sm:gap-y-8 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7';

export function Launchpad({ isOpen, browseOnOpen = false, onClose, bookmarks, folders, desktopBookmarkIds,
  dockBookmarkIds = [], language, onboarding, onRevealDesktop, onOpenBookmark, onTogglePinDesktop, onToggleDockBookmark, onManageBookmark, onEditBookmark, onDeleteBookmark, onShowToast,
}: LaunchpadProps) {
  const t = createTranslator(language);
  const teachingPin = onboarding?.task === 'pin';
  const en = language === 'en';
  const text = (zh: string, english: string) => en ? english : zh;
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeLetter, setActiveLetter] = useState('');
  const [menu, setMenu] = useState<{ entry: LaunchpadEntry; x: number; y: number } | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 12, top: 12, maxHeight: 400 });
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<DesktopConfirmation | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const menuScrollTop = useRef(0);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const composing = useRef(false);
  const pointerSelection = useRef(false);
  const index = useMemo(() => buildLaunchpadIndex(bookmarks, folders), [bookmarks, folders]);
  const results = useMemo(() => searchLaunchpad(index, query), [index, query]);
  const letterTargets = useMemo(() => {
    const targets = new Map<string, LaunchpadEntry>();
    for (const entry of index) {
      if (!targets.has(entry.initialLetter)) targets.set(entry.initialLetter, entry);
    }
    return targets;
  }, [index]);
  const resultIds = useMemo(() => new Set(results.map(entry => entry.bookmark.id)), [results]);
  const effectiveSelection = selectedId && resultIds.has(selectedId) ? selectedId
    : query.trim() ? results[0]?.bookmark.id ?? null : null;
  const firstId = results[0]?.bookmark.id ?? null;
  const hasQuery = Boolean(query.trim());
  const menuBookmarkId = menu?.entry.bookmark.id ?? null;
  const letterPreview = useLaunchpadGestures(root, scroll, isOpen && !confirmation, query, (letter, finished) => {
    const entry = letterTargets.get(letter);
    const element = entry && buttons.current.get(entry.bookmark.id);
    const container = scroll.current;
    if (!element || !container) return false;
    pointerSelection.current = true;
    setSelectedId(entry.bookmark.id);
    setActiveLetter(letter);
    if (finished) {
      element.focus({ preventScroll: true });
      return true;
    }
    const offset = element.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop = Math.max(0, container.scrollTop + offset - 20);
    return true;
  }, !!menu);
  const reportedPin = useRef<{
    query: string; firstId: string | null; hasQuery: boolean; menuBookmarkId: string | null;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    const overlay = root.current;
    setQuery('');
    setSelectedId(null);
    setActiveLetter(index[0]?.initialLetter ?? '');
    setMenu(null);
    setError('');
    setConfirmation(null);
    composing.current = false;
    (browseOnOpen ? root.current : search.current)?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected
        && (!document.activeElement || document.activeElement === document.body || overlay?.contains(document.activeElement))) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [isOpen]);
  useEffect(() => {
    if (!isOpen || !teachingPin || !onboarding) {
      reportedPin.current = null;
      return;
    }
    const previous = reportedPin.current;
    // Callback identity may change when the controller consumes an event.
    reportedPin.current = { query, firstId, hasQuery, menuBookmarkId };
    if (!previous || previous.query !== query || previous.firstId !== firstId || previous.hasQuery !== hasQuery) {
      onboarding.onEvent({ type: 'pin-query', firstId, hasQuery });
    }
    if (!previous || previous.menuBookmarkId !== menuBookmarkId) {
      onboarding.onEvent({ type: 'pin-menu', bookmarkId: menuBookmarkId });
    }
  }, [isOpen, teachingPin, onboarding, query, firstId, hasQuery, menuBookmarkId]);
  useEffect(() => {
    if (isOpen && !menu && effectiveSelection && !pointerSelection.current) buttons.current.get(effectiveSelection)?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, effectiveSelection]);

  const focusEntry = (id: string) => {
    pointerSelection.current = false;
    setSelectedId(id);
    buttons.current.get(id)?.focus({ preventScroll: true });
    buttons.current.get(id)?.scrollIntoView({ block: 'nearest' });
  };
  const dismissMenu = (toSearch = false) => {
    if (toSearch) search.current?.focus({ preventScroll: true });
    else if (menu && resultIds.has(menu.entry.bookmark.id)) focusEntry(menu.entry.bookmark.id);
    setMenu(null);
  };
  useLayoutEffect(() => {
    if (!menu || !menuElement.current) return;
    menuScrollTop.current = scroll.current?.scrollTop ?? 0;
    const element = menuElement.current;
    setMenuPosition(positionDesktopMenu({
      x: menu.x, y: menu.y, width: element.offsetWidth, height: element.scrollHeight,
      viewportWidth: innerWidth, viewportHeight: innerHeight, bottomInset: 12,
    }));
    element.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: Event) => {
      if (!menuElement.current?.contains(event.target as Node)) dismissMenu(true);
    };
    const resize = () => dismissMenu(true);
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', resize);
    };
  }, [menu]);

  const open = (entry: LaunchpadEntry) => {
    try { onOpenBookmark(entry.bookmark); onClose(); }
    catch (cause) { setError(bookmarkSaveError(cause)); }
  };
  const showMenu = (event: React.MouseEvent, entry: LaunchpadEntry) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(entry.bookmark.id);
    setError('');
    setMenu({ entry, x: event.clientX, y: event.clientY });
  };
  const changeQuery = (value: string) => {
    pointerSelection.current = false;
    setQuery(value);
    setSelectedId(null);
    setMenu(null);
    setError('');
    scroll.current?.scrollTo({ top: 0 });
  };

  // Rendered row centers keep keyboard movement aligned at every breakpoint.
  const verticalNeighbor = (id: string, down: boolean) => {
    const current = buttons.current.get(id)?.getBoundingClientRect();
    if (!current) return;
    const x = current.left + current.width / 2;
    const candidates = results.flatMap(entry => {
      const rect = buttons.current.get(entry.bookmark.id)?.getBoundingClientRect();
      const dy = rect ? rect.top - current.top : 0;
      return rect && (down ? dy > 1 : dy < -1)
        ? [{ id: entry.bookmark.id, dy: Math.abs(dy), dx: Math.abs(rect.left + rect.width / 2 - x) }] : [];
    }).sort((a, b) => Math.abs(a.dy - b.dy) > 1 ? a.dy - b.dy : a.dx - b.dx);
    if (candidates[0]) focusEntry(candidates[0].id);
    else if (!down) search.current?.focus();
  };
  const handleKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (confirmation) return;
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
      if (['Enter', ' '].includes(event.key) && (event.target as HTMLElement).closest('button')) event.preventDefault();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (menu) {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        dismissMenu();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const actions = Array.from(menuElement.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
        const at = actions.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? actions.length - 1
          : (at + (event.key === 'ArrowDown' ? 1 : -1) + actions.length) % actions.length;
        actions[next]?.focus();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      const stops = [
        ...Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[data-onboarding="pin-hint"] button') ?? []),
        search.current, ...results.map(entry => buttons.current.get(entry.bookmark.id)), closeButton.current,
        ...Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[data-launchpad-letter]') ?? []),
      ].filter((element): element is HTMLInputElement | HTMLButtonElement => !!element && !element.disabled);
      const at = stops.indexOf(document.activeElement as HTMLInputElement | HTMLButtonElement);
      const next = (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
      event.preventDefault();
      stops[next]?.focus({ preventScroll: true });
      stops[next]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    const target = event.target as HTMLElement;
    if (target === search.current) {
      if (event.key === 'ArrowDown' && results.length) {
        event.preventDefault();
        focusEntry(effectiveSelection ?? results[0].bookmark.id);
      } else if (event.key === 'Enter' && query.trim() && results[0]) {
        event.preventDefault();
        open(results.find(entry => entry.bookmark.id === effectiveSelection) ?? results[0]);
      }
      return;
    }
    const id = target.dataset.launchpadBookmark;
    if (!id) return;
    const at = results.findIndex(entry => entry.bookmark.id === id);
    if (at < 0) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') verticalNeighbor(id, event.key === 'ArrowDown');
      else {
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? results.length - 1
          : Math.max(0, Math.min(results.length - 1, at + (event.key === 'ArrowRight' ? 1 : -1)));
        focusEntry(results[next].bookmark.id);
      }
    }
  };
  const jumpToLetter = (letter: string) => {
    const entry = letterTargets.get(letter);
    if (!entry) return;
    focusEntry(entry.bookmark.id);
    setActiveLetter(letter);
  };
  const menuAction = (label: string, Icon: React.ComponentType<{ size?: number }>, action: () => void | Promise<void>, detail?: string, destructive = false) => (
    <button type="button" role="menuitem" aria-label={label} className={`flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs cursor-pointer focus:outline-none ${destructive
      ? 'text-rose-700 dark:text-rose-300 hover:bg-rose-500/15 focus:bg-rose-500/15'
      : 'text-slate-800 dark:text-slate-100 hover:bg-sky-500/15 focus:bg-sky-500/15'}`}
      onClick={async () => {
        dismissMenu();
        try { await action(); } catch (cause) { setError(bookmarkSaveError(cause)); }
      }}><span className="shrink-0"><Icon size={15} /></span><MenuActionLabel label={label} detail={detail} /></button>
  );
  const separator = <div role="separator" className="my-1 border-t border-black/10 dark:border-white/10" />;
  const menuOnDesktop = !!menu && (desktopBookmarkIds
    ?? bookmarks.filter(bookmark => bookmark.pinnedToDesktop).map(bookmark => bookmark.id)).includes(menu.entry.bookmark.id);
  const renderEntry = (entry: LaunchpadEntry) => {
    const { bookmark } = entry;
    return <div key={bookmark.id} className="group relative flex w-full max-w-[108px] min-w-0 justify-center">
      <button type="button" ref={element => { if (element) buttons.current.set(bookmark.id, element); else buttons.current.delete(bookmark.id); }}
        data-launchpad-bookmark={bookmark.id} data-selected={effectiveSelection === bookmark.id}
        data-launchpad-initial={entry.initialLetter}
        aria-label={bookmark.title}
        onFocus={() => { setSelectedId(bookmark.id); setActiveLetter(entry.initialLetter); }} onClick={() => open(entry)}
        onContextMenu={event => showMenu(event, entry)}
        onKeyDown={event => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ entry, x: rect.left + 30, y: rect.top + 30 });
          }
        }}
        className="launchpad-icon flex h-[104px] w-full max-w-[100px] min-w-0 flex-col items-center rounded-lg px-1 py-2 outline-none">
        <FaviconImage url={bookmark.url} title={bookmark.title} icon={bookmark.icon} iconMode={bookmark.iconMode} iconBg={bookmark.iconBg}
          size="lg" showTitle={false} className="!h-16 !w-16 shrink-0" />
        <DesktopIconLabel name={bookmark.title} disabled={!!menu || !isOpen} />
      </button>
      <button type="button" tabIndex={-1} title={text(`更多操作：${bookmark.title}`, `More actions: ${bookmark.title}`)}
        data-onboarding={teachingPin && hasQuery && bookmark.id === firstId ? 'pin-more' : undefined}
        style={teachingPin && hasQuery && bookmark.id === firstId ? { opacity: 1, outline: '2px solid #0284c7' } : undefined}
        aria-label={text(`更多操作：${bookmark.title}`, `More actions: ${bookmark.title}`)} onClick={event => showMenu(event, entry)}
        className="launchpad-more absolute right-0 top-1 rounded-md p-1 sm:opacity-0 sm:focus:opacity-100 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"><MoreHorizontal size={14} /></button>
    </div>;
  };

  if (!isOpen) return null;
  return <div ref={root} tabIndex={-1} data-panel="launchpad" role="dialog" aria-modal="true" aria-label={text('启动台', 'Launchpad')}
    onKeyDown={event => { pointerSelection.current = false; handleKeys(event); }} style={{ letterSpacing: 0 }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className="launchpad-shell fixed inset-0 z-[1200] flex flex-col overflow-hidden pb-4 pt-5 outline-none">
    <header className="launchpad-header mx-auto mb-3 grid w-full max-w-6xl shrink-0 grid-cols-[1fr_auto] items-center gap-3 px-4 pr-10 sm:grid-cols-[auto_1fr_auto] sm:px-12 sm:pr-14">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center"><LaunchpadMark size={27} /></span>
        <div className="min-w-0"><h2 className="launchpad-title text-sm font-semibold">{text('启动台', 'Launchpad')}</h2>
          <p className="launchpad-muted text-[11px]">{index.length} {text('个收藏', 'bookmarks')}</p></div>
      </div>
      <div className="relative col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:mx-4">
        <Search size={16} className="launchpad-muted pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input ref={search} data-onboarding="pin-search" type="search" aria-label={text('搜索收藏', 'Search bookmarks')} value={query}
          placeholder={text('搜索收藏、关键词或拼音...', 'Search bookmarks, keywords or pinyin...')}
          onChange={event => changeQuery(event.target.value)}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          className="launchpad-search h-11 w-full min-w-0 rounded-lg border pl-10 pr-3 text-sm outline-none" />
      </div>
      <button type="button" ref={closeButton} onClick={onClose} aria-label={text('关闭启动台', 'Close launchpad')}
        title="关闭启动台 (Esc 或点击空白处)"
        className="launchpad-close col-start-2 row-start-1 flex h-9 w-9 items-center justify-center justify-self-end rounded-lg outline-none sm:col-start-3"><X size={18} /></button>
    </header>
    {teachingPin && <div data-onboarding="pin-hint" className="mx-auto mb-3 w-full max-w-6xl shrink-0 px-4 sm:px-12">
      <TaskHint language={language} message={menu ? 'onboardingPinAction' : hasQuery && firstId ? 'onboardingPinChoose' : 'onboardingPinSearch'}
        onDismiss={onboarding.onExit} />
    </div>}
    {error && <p role="alert" className="mx-auto mb-2 w-full max-w-6xl px-5 text-xs text-rose-700 dark:text-rose-300">{error}</p>}
    <div ref={scroll} data-testid="launchpad-scroll"
      onScroll={() => {
        if (menu && scroll.current && Math.abs(scroll.current.scrollTop - menuScrollTop.current) > 0.5) dismissMenu(true);
        if (query.trim() || !scroll.current) return;
        const top = scroll.current.getBoundingClientRect().top;
        const current = results.find(entry => {
          const rect = buttons.current.get(entry.bookmark.id)?.getBoundingClientRect();
          return rect && rect.bottom > top + 20;
        });
        if (current) setActiveLetter(current.initialLetter);
      }}
      onClick={event => {
        const target = event.target as HTMLElement;
        if (target === event.currentTarget || target.dataset.backdrop === 'true') onClose();
      }}
      className="launchpad-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-12 pr-10 sm:px-12 sm:pr-14">
      <div data-backdrop="true" className="mx-auto w-full max-w-6xl py-5">
        {results.length === 0 ? <p role="status" className="launchpad-muted py-20 text-center text-sm">
          {query.trim() ? text('没有匹配的收藏', 'No matching bookmarks') : text('暂无收藏', 'No bookmarks yet')}
        </p> : <section aria-label={query.trim() ? text('搜索结果', 'Search results') : text('全部收藏', 'All bookmarks')}>
          {query.trim() && <p role="status" className="launchpad-muted mb-4 text-xs">{results.length} {text('个结果', 'results')}</p>}
          <div data-backdrop="true" className={gridClass}>{results.map(renderEntry)}</div>
        </section>}
      </div>
    </div>
    {!query.trim() && letterTargets.size > 0 && <nav data-launchpad-alphabet aria-label={text('字母索引', 'Alphabet index')}
      className="absolute bottom-5 right-1 top-32 flex w-7 flex-col items-center justify-center gap-0.5 sm:right-3 sm:top-24">
      {alphabet.map(letter => {
        const populated = letterTargets.has(letter);
        return <button key={letter} type="button" data-launchpad-letter={letter} disabled={!populated}
          aria-label={text(`跳转到 ${letter}`, `Jump to ${letter}`)} aria-current={activeLetter === letter ? 'location' : undefined}
          onClick={() => jumpToLetter(letter)}
          className="launchpad-letter flex min-h-0 w-6 max-h-5 flex-1 items-center justify-center rounded text-[10px] font-medium outline-none">{letter}</button>;
      })}
    </nav>}
    {letterPreview && <div data-testid="launchpad-letter-preview" aria-hidden="true"
      className="launchpad-letter-preview" style={{ top: letterPreview.top }}>{letterPreview.letter}</div>}
    {menu && <div ref={menuElement} role="menu" aria-label={text('收藏操作', 'Bookmark actions')} style={menuPosition}
      onClick={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}
      className="fixed z-[1400] w-56 max-w-[calc(100vw-24px)] rounded-lg p-1 liquid-glass bg-white/95 dark:bg-[#181d28]/95 backdrop-blur-2xl border border-white/60 dark:border-white/15 shadow-xl overflow-y-auto">
      <p className="truncate px-2.5 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400" title={menu.entry.bookmark.title}>{menu.entry.bookmark.title}</p>
      {menuAction(text('在新标签页打开', 'Open in new tab'), ExternalLink, () => open(menu.entry))}
      {onEditBookmark && menuAction(text('编辑收藏', 'Edit bookmark'), Edit, () => {
        onEditBookmark(menu.entry.bookmark); onClose();
      })}
      {menuAction(text('复制网址', 'Copy URL'), Copy, async () => {
        try { await navigator.clipboard.writeText(menu.entry.bookmark.url); onShowToast?.(text('已复制链接', 'Link copied')); }
        catch { onShowToast?.(text('复制失败，请在收藏管理中复制网址', 'Copy failed. Copy the URL in bookmark management.')); }
      }, menu.entry.bookmark.url)}
      {(onTogglePinDesktop || onToggleDockBookmark) && separator}
      {onToggleDockBookmark && menuAction(dockBookmarkIds.includes(menu.entry.bookmark.id)
        ? actionTerm('unpinDock', language) : actionTerm('pinDock', language),
      dockBookmarkIds.includes(menu.entry.bookmark.id) ? PinOff : Pin, () => onToggleDockBookmark(menu.entry.bookmark.id))}
      {teachingPin && menuOnDesktop ? menuAction(t('onboardingViewShortcut'), Pin, () => {
        onRevealDesktop?.(menu.entry.bookmark.id);
      }) : onTogglePinDesktop && menuAction(
        menuOnDesktop ? actionTerm('removeDesktop', language) : actionTerm('pinDesktop', language),
        menuOnDesktop ? EyeOff : Pin,
        () => {
          if (!menuOnDesktop) return onTogglePinDesktop(menu.entry.bookmark.id);
          const bookmark = menu.entry.bookmark;
          setConfirmation({
            x: menuPosition.left, y: menuPosition.top, title: actionTerm('removeDesktop', language),
            message: text(`移除「${bookmark.title}」的快捷方式？原收藏和归档目录保持不变。`, 'Remove this shortcut? The library bookmark is kept.'),
            label: text('确认移除快捷方式', 'Confirm shortcut removal'),
            action: () => onTogglePinDesktop(bookmark.id),
          });
        })}
      {separator}
      {menu.entry.bookmark.iconMode !== 'text' && menuAction(text('刷新网站图标', 'Refresh website icon'), RefreshCw, async () => {
        try { await refreshSiteIcon(menu.entry.bookmark); onShowToast?.(text('网站图标已刷新', 'Website icon refreshed')); }
        catch { onShowToast?.(text('未能获取新图标，保留原图标', 'Could not fetch a new icon. Previous icon kept.')); }
      })}
      {onManageBookmark && separator}
      {onManageBookmark && menuAction(actionTerm('reveal', language), Library, () => {
        onManageBookmark(menu.entry.bookmark); onClose();
      }, bookmarkLibraryPath(folders, menu.entry.bookmark.folderId, en))}
      {onDeleteBookmark && separator}
      {onDeleteBookmark && menuAction(actionTerm('deleteBookmark', language), Trash2, () => {
        const bookmark = menu.entry.bookmark;
        setConfirmation({
          x: menuPosition.left, y: menuPosition.top, title: text('删除收藏', 'Delete bookmark'),
          message: text(`将「${bookmark.title}」移至回收站并移除桌面和任务栏快捷方式？可在管理中心恢复收藏。`,
            'Move this bookmark to the recycle bin and remove desktop and Taskbar shortcuts? Restore it from Management.'),
          label: text('确认删除收藏', 'Confirm bookmark deletion'),
          action: async () => {
            await onDeleteBookmark(bookmark.id);
            setSelectedId(null);
            search.current?.focus({ preventScroll: true });
          },
        });
      }, undefined, true)}
    </div>}
    {confirmation && <DesktopConfirmPopover confirmation={confirmation} language={language} onClose={() => setConfirmation(null)} />}
  </div>;
}

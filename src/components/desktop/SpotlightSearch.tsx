import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Folder as FolderIcon,
  Layers,
  Wrench,
  Plus,
  ExternalLink,
  ChevronDown,
  Settings,
  Grid2X2,
  Trash2,
  Moon,
  Sun,
  CircleHelp,
} from 'lucide-react';
import { SearchEngineGrid } from './SearchEngineGrid';
import { isDesktopSearchKey, matchSpotlightCommands, type SystemCommandId } from './spotlight-commands';
import { appShortcut } from './app-shortcuts';
import { normalizeSpotlightText, parseSpotlightUrlQuery, rankSpotlightBookmarks, type SpotlightUrlMatch } from './spotlight-ranking';
import './spotlight-search.css';
import {
  Bookmark,
  Folder,
  Collection,
  PlatformSite,
  Plugin,
  SearchEngine,
} from '../../types';
import { FaviconImage } from '../common/FaviconImage';
import { indexFolderPaths } from '../common/folder-tree';
import { storage } from '../../services/storage';
import { createTranslator, resolveLocale } from '../../i18n';
import { useRotatingTips } from '../../hooks/useRotatingTips';

const systemCommandIcons = {
  all: Layers, setting: Settings, add: Plus, search: Search, start: Grid2X2,
  trash: Trash2, theme: Settings, dark: Moon, light: Sun, help: CircleHelp,
} satisfies Record<SystemCommandId, typeof Settings>;

interface SpotlightSearchProps {
  tipsPaused?: boolean;
  language?: string;
  bookmarks: Bookmark[];
  folders: Folder[];
  collections: Collection[];
  platformSites: PlatformSite[];
  plugins: Plugin[];
  searchEngines: SearchEngine[];
  currentEngineId: string;
  onSelectEngine: (engineId: string) => void;
  onOpenBookmark: (bookmark: Bookmark) => void;
  onOpenFolder: (folder: Folder) => void;
  onOpenCollection: (collection: Collection) => void;
  onOpenPlatformSite: (site: PlatformSite) => void;
  onOpenTool: (toolType: 'calculator' | 'json-formatter' | 'word-counter') => void;
  onQuickAdd: (url?: string) => void;
  onOpenSearchEngineSettings?: () => void;
  onSystemCommand?: (command: SystemCommandId) => void;
  canInvokeFromDesktop?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export type SpotlightItem =
  | {
      id: string;
      kind: 'system-command';
      command: SystemCommandId;
      title: string;
      subtitle: string;
      badge: string;
      badgeColor: 'sky';
      shortcut: string;
    }
  | {
      id: string;
      kind: 'direct-url';
      title: string;
      subtitle: string;
      badge: '直达网址';
      badgeColor: 'sky';
      shortcut: '↵ 前往';
      url: string;
    }
  | {
      id: string;
      kind: 'bookmark-url';
      title: string;
      subtitle: string;
      badge: '快速收藏';
      badgeColor: 'emerald';
      shortcut: string;
      url: string;
    }
  | {
      id: string;
      kind: 'switch-engine';
      title: string;
      subtitle: string;
      badge: '搜索引擎';
      badgeColor: 'sky';
      shortcut: '↵ 选择' | '↵ 搜索';
      engine: SearchEngine;
      restQuery?: string;
    }
  | {
      id: string;
      kind: 'search-engine';
      title: string;
      subtitle: string;
      badge: '搜索引擎' | '快捷指令';
      badgeColor: 'indigo' | 'sky';
      shortcut: '↵ 搜索';
      query: string;
      engine?: SearchEngine;
    }
  | {
      id: string;
      kind: 'bookmark';
      path: string;
      title: string;
      subtitle: string;
      badge: '我的收藏' | '猜你想要';
      badgeColor: 'sky' | 'amber';
      shortcut: '↵ 打开';
      data: Bookmark;
      automaticSelection?: boolean;
      urlMatch?: SpotlightUrlMatch;
    }
  | {
      id: string;
      kind: 'folder';
      path: string;
      title: string;
      subtitle: string;
      badge: '收藏库文件夹';
      badgeColor: 'amber';
      shortcut: '↵ 打开';
      data: Folder;
    }
  | {
      id: string;
      kind: 'collection';
      title: string;
      subtitle: string;
      badge: '网址单';
      badgeColor: 'purple';
      shortcut: '↵ 查看';
      data: Collection;
    }
  | {
      id: string;
      kind: 'tool';
      title: string;
      subtitle: string;
      badge: '实用插件';
      badgeColor: 'emerald';
      shortcut: '↵ 运行';
      data: Plugin;
    }
  | {
      id: string;
      kind: 'platformSite';
      title: string;
      subtitle: string;
      badge: '平台推荐';
      badgeColor: 'blue';
      shortcut: '↵ 收藏';
      data: PlatformSite;
    };

// Helper: Check if string is a valid URL or domain
function isLikelyUrl(text: string): boolean {
  return Boolean(parseSpotlightUrlQuery(text));
}

function normalizeUrl(text: string): string {
  const t = text.trim();
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

export const SpotlightSearch: React.FC<SpotlightSearchProps> = ({
  language,
  bookmarks,
  folders,
  collections,
  platformSites,
  plugins,
  searchEngines,
  currentEngineId,
  onSelectEngine,
  onOpenBookmark,
  onOpenFolder,
  onOpenCollection,
  onOpenPlatformSite,
  onOpenTool,
  onQuickAdd,
  onOpenSearchEngineSettings,
  onSystemCommand,
  canInvokeFromDesktop = false,
  tipsPaused = false,
  isOpen: controlledIsOpen,
  onOpenChange,
}) => {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const t = createTranslator(language);
  const isControlled = typeof controlledIsOpen === 'boolean';
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen;

  const setIsOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const nextVal = typeof next === 'function' ? next(isOpen) : next;
    if (!isControlled) {
      setInternalIsOpen(nextVal);
    }
    onOpenChange?.(nextVal);
  };

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [resultSelected, setResultSelected] = useState(false);
  const [showEngineDropdown, setShowEngineDropdown] = useState(false);
  const [tipHovered, setTipHovered] = useState(false);
  const [tipFocused, setTipFocused] = useState(false);
  const entranceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tipsPaused || isOpen) return;
    // Overlay focus/pointer ownership can suppress React enter/leave events.
    setTipFocused(entranceRef.current?.contains(document.activeElement) ?? false);
    setTipHovered(entranceRef.current?.matches(':hover') ?? false);
  }, [tipsPaused, isOpen]);
  const rotatingTip = useRotatingTips({
    locale: resolveLocale(language), paused: tipsPaused || isOpen || tipHovered || tipFocused,
  });
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [switchNotice, setSwitchNotice] = useState<string | null>(null);
  const [sessionEngine, setSessionEngine] = useState<SearchEngine | null>(null);

  useEffect(() => {
    if (switchNotice) {
      const timer = setTimeout(() => setSwitchNotice(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [switchNotice]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const engineDropdownRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const compositionRef = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);

  const availableEngines = useMemo(
    () => searchEngines.filter(e => e.isEnabled !== false),
    [searchEngines]
  );
  const folderPaths = useMemo(() => indexFolderPaths(folders), [folders]);
  const folderCounts = useMemo(() => {
    const counts = new Map<string, { bookmarks: number; children: number }>();
    for (const id of folderPaths.keys()) counts.set(id, { bookmarks: 0, children: 0 });
    for (const bookmark of bookmarks) {
      const count = bookmark.folderId ? counts.get(bookmark.folderId) : undefined;
      if (count) count.bookmarks++;
    }
    for (const path of folderPaths.values()) {
      const parent = path.at(-2);
      if (parent) counts.get(parent.id)!.children++;
    }
    return counts;
  }, [folderPaths, bookmarks]);
  const libraryPath = (folderId?: string) => {
    const path = folderId ? folderPaths.get(folderId) : undefined;
    return `全部收藏 / ${path?.map(folder => folder.name).join(' / ') || (folderId ? '原文件夹不存在' : '未整理')}`;
  };

  const defaultEngine = useMemo(() => {
    return (
      availableEngines.find(e => e.id === currentEngineId) ||
      availableEngines[0] ||
      searchEngines[0] || {
        id: 'se-google',
        name: 'Google',
        keyword: 'g',
        urlTemplate: 'https://www.google.com/search?q={query}',
        isEnabled: true,
      }
    );
  }, [availableEngines, currentEngineId, searchEngines]);
  const currentEngine = availableEngines.find(engine => engine.id === sessionEngine?.id) ?? defaultEngine;

  useEffect(() => {
    setRecentSearches(storage.getRecentSearches());
  }, [isOpen]);

  // Desktop command invocation and local dismissal; panel shortcuts live in PrototypeApp.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || compositionRef.current) return;
      const target = e.target instanceof Element ? e.target : null;
      const editing = target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
      if (!isOpen && canInvokeFromDesktop && !editing && !e.defaultPrevented
        && !document.querySelector('[data-desktop-editing="true"]')
        && !document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"]')
        && isDesktopSearchKey(e)) {
        e.preventDefault();
        setQuery('/');
        setIsOpen(true);
        return;
      }
      if (e.key === 'Escape' && isOpen && !e.isComposing && !compositionRef.current) {
        e.preventDefault();
        if (showEngineDropdown) {
          setShowEngineDropdown(false);
          inputRef.current?.focus();
        } else setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showEngineDropdown, canInvokeFromDesktop]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      inputRef.current?.focus({ preventScroll: true });
      setSelectedIndex(0);
      setResultSelected(false);
      return () => {
        if (openerRef.current?.isConnected) openerRef.current.focus();
      };
    } else {
      setQuery('');
      setSessionEngine(null);
      setShowEngineDropdown(false);
    }
  }, [isOpen]);

  // Compute results with rich action items & badges
  const results = useMemo((): SpotlightItem[] => {
    const rawQuery = query.trim();
    const q = normalizeSpotlightText(rawQuery);
    const items: SpotlightItem[] = [];

    if (rawQuery.startsWith('/')) {
      const t = createTranslator(language);
      const matches = matchSpotlightCommands(query, availableEngines);
      const commandItems: SpotlightItem[] = matches.filter(match => match.kind !== 'system' || onSystemCommand).map(match =>
        match.kind === 'system' ? {
          id: `command-${match.command.id}`, kind: 'system-command', command: match.command.id,
          title: t(match.command.title), subtitle: `/${match.command.id} · ${t('commandSystemBadge')} · ${t(match.command.description)}`,
          badge: t('commandSystemBadge'), badgeColor: 'sky',
          shortcut: t(match.command.id === 'dark' || match.command.id === 'light' ? 'commandApplyAction' : 'commandOpenAction'),
        } : {
          id: `switch-engine-${match.engine.id}`, kind: 'switch-engine',
          title: match.query ? `使用 ${match.engine.name} 搜索 “${match.query}”` : `使用 ${match.engine.name}`,
          subtitle: `/${match.engine.keyword} · 搜索引擎 · ${match.query ? '仅本次搜索，不修改默认引擎' : '继续输入搜索内容'}`,
          badge: '搜索引擎', badgeColor: 'sky', shortcut: match.query ? '↵ 搜索' : '↵ 选择',
          engine: match.engine, restQuery: match.query || undefined,
        });
      // Unmatched slash-prefixed paths can still find bookmarks, without auto-opening them.
      if (matches.length || rawQuery === '/') return commandItems;
    }

    // 2. Keyword prefix match: e.g. "gh react", "bili 教程", "wk 物理"
    const spaceIdx = rawQuery.indexOf(' ');
    let directEngine: SearchEngine | undefined;
    let directQuery = '';
    if (spaceIdx > 0 && !rawQuery.startsWith('/')) {
      const prefix = rawQuery.substring(0, spaceIdx).toLowerCase();
      const rest = rawQuery.substring(spaceIdx + 1).trim();
      directEngine = availableEngines.find(e => e.keyword.toLowerCase() === prefix);
      if (directEngine && rest) {
        directQuery = rest;
      }
    }

    if (directEngine && directQuery) {
      items.push({
        id: `direct-engine-${directEngine.id}`,
        kind: 'search-engine',
        title: `使用 ${directEngine.name} 搜索 “${directQuery}”`,
        subtitle: `快捷指令调用 [${directEngine.keyword}] · ${directEngine.urlTemplate.replace('{query}', directQuery)}`,
        badge: '快捷指令',
        badgeColor: 'indigo',
        shortcut: '↵ 搜索',
        query: directQuery,
        engine: directEngine,
      });
    }

    const isUrl = isLikelyUrl(rawQuery);
    const formattedUrl = isUrl ? normalizeUrl(rawQuery) : '';

    // If user input is a URL, add Option 2: 直接打开
    if (isUrl) {
      items.push({
        id: 'action-direct-url',
        kind: 'direct-url',
        title: `直接打开 “${rawQuery}”`,
        subtitle: `在新标签页直接访问 ${formattedUrl}`,
        badge: '直达网址',
        badgeColor: 'sky',
        shortcut: '↵ 前往',
        url: formattedUrl,
      });

      // Add Option 3: 收藏网址
      items.push({
        id: 'action-bookmark-url',
        kind: 'bookmark-url',
        title: `收藏 “${rawQuery}”`,
        subtitle: `保存 ${formattedUrl} 到我的书签库`,
        badge: '快速收藏',
        badgeColor: 'emerald',
        shortcut: /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘⇧Enter' : 'Ctrl+Shift+Enter',
        url: formattedUrl,
      });
    }

    // When query is empty: show smart suggestions / recent bookmarks / plugins
    if (!q) {
      const recentIds = storage.getRecentUsed();
      recentIds.forEach(id => {
        const bm = bookmarks.find(b => b.id === id);
        if (bm) {
          items.push({
            id: `recent-${bm.id}`,
            kind: 'bookmark',
            path: libraryPath(bm.folderId),
            title: bm.title,
            subtitle: bm.domain,
            badge: '猜你想要',
            badgeColor: 'amber',
            shortcut: '↵ 打开',
            data: bm,
          });
        }
      });

      // Also suggest top built-in tools
      plugins.filter(p => p.isBuiltInTool).forEach(tool => {
        items.push({
          id: `tool-${tool.id}`,
          kind: 'tool',
          title: tool.name,
          subtitle: tool.description,
          badge: '实用插件',
          badgeColor: 'emerald',
          shortcut: '↵ 运行',
          data: tool,
        });
      });

      return items;
    }

    // 1. Matched Bookmarks
    const recentIds = new Set(storage.getRecentUsed());
    const rankedBookmarks = rankSpotlightBookmarks(bookmarks, query, bm => libraryPath(bm.folderId));
    rankedBookmarks.matches.forEach(({ bookmark: bm, urlMatch }) => {
      const path = libraryPath(bm.folderId);
      const isRecent = recentIds.has(bm.id);
      items.push({
        id: `bm-${bm.id}`,
        kind: 'bookmark',
        path,
        title: bm.title,
        subtitle: bm.domain,
        badge: isRecent ? '猜你想要' : '我的收藏',
        badgeColor: isRecent ? 'amber' : 'sky',
        shortcut: '↵ 打开',
        data: bm,
        automaticSelection: isUrl && bm.id === rankedBookmarks.automaticId,
        urlMatch,
      });
    });

    // 2. Matched Folders
    folders.forEach(f => {
      const path = libraryPath(f.id);
      if (path.toLowerCase().includes(q)) {
        items.push({
          id: `folder-${f.id}`,
          kind: 'folder',
          path,
          title: f.name,
          subtitle: `${folderCounts.get(f.id)?.bookmarks ?? 0} 个网址 · ${folderCounts.get(f.id)?.children ?? 0} 个子文件夹`,
          badge: '收藏库文件夹',
          badgeColor: 'amber',
          shortcut: '↵ 打开',
          data: f,
        });
      }
    });

    // 3. Matched Collections
    collections.forEach(col => {
      if (col.title.toLowerCase().includes(q) || col.description.toLowerCase().includes(q)) {
        items.push({
          id: `col-${col.id}`,
          kind: 'collection',
          title: col.title,
          subtitle: col.description || `包含 ${col.items.length} 个精选网址`,
          badge: '网址单',
          badgeColor: 'purple',
          shortcut: '↵ 查看',
          data: col,
        });
      }
    });

    // 4. Matched Plugins / Tools
    plugins.forEach(p => {
      if (p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)) {
        items.push({
          id: `plugin-${p.id}`,
          kind: 'tool',
          title: p.name,
          subtitle: p.description,
          badge: '实用插件',
          badgeColor: 'emerald',
          shortcut: '↵ 运行',
          data: p,
        });
      }
    });

    // 5. Curated Platform Sites (not already in bookmarks)
    const existingUrls = new Set(bookmarks.map(b => b.url.toLowerCase()));
    platformSites.forEach(ps => {
      if (existingUrls.has(ps.url.toLowerCase())) return;
      if (
        ps.title.toLowerCase().includes(q) ||
        ps.domain.toLowerCase().includes(q) ||
        ps.tagline.toLowerCase().includes(q) ||
        ps.description.toLowerCase().includes(q)
      ) {
        items.push({
          id: `ps-${ps.id}`,
          kind: 'platformSite',
          title: ps.title,
          subtitle: ps.tagline || ps.domain,
          badge: '平台推荐',
          badgeColor: 'blue',
          shortcut: '↵ 收藏',
          data: ps,
        });
      }
    });

    // Keep external search first unless a bookmark has a unique high-confidence lead.
    const hasSwitchOnly = items.some(it => it.kind === 'switch-engine' && !it.restQuery);
    if (!directQuery && !hasSwitchOnly && rawQuery) {
      const t = createTranslator(language);
      const searchItem: SpotlightItem = {
        id: 'action-search-engine',
        kind: 'search-engine',
        title: t('spotlightEngineTitle', { engine: currentEngine.name, query: rawQuery }),
        subtitle: t('spotlightEngineDescription', { engine: currentEngine.name }),
        badge: '搜索引擎',
        badgeColor: 'indigo',
        shortcut: '↵ 搜索',
        query: rawQuery,
        engine: currentEngine,
      };
      if (isUrl) {
        items.push(searchItem);
        return [
          ...items.filter(item => item.kind === 'bookmark' && item.urlMatch === 'exact'),
          ...items.filter(item => item.kind === 'direct-url'),
          ...items.filter(item => item.kind === 'bookmark' && item.urlMatch !== 'exact'),
          ...items.filter(item => item.kind !== 'bookmark' && item.kind !== 'direct-url'
            && item.kind !== 'search-engine' && item.kind !== 'bookmark-url'),
          searchItem,
          ...items.filter(item => item.kind === 'bookmark-url'),
        ];
      } else {
        const winnerIndex = items.findIndex(item => item.kind === 'bookmark' && item.data.id === rankedBookmarks.automaticId);
        if (winnerIndex >= 0) {
          const [winner] = items.splice(winnerIndex, 1);
          items.unshift(winner, searchItem);
        } else items.unshift(searchItem);
      }
    }

    return items;
  }, [query, bookmarks, folders, collections, plugins, platformSites, currentEngine, availableEngines, onSystemCommand, folderCounts, language]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
    setResultSelected(false);
  }, [query, currentEngine.id]);
  useEffect(() => {
    if (resultSelected && !showEngineDropdown) {
      const item = results[selectedIndex];
      if (item) document.getElementById(`spotlight-result-${item.id}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, resultSelected, showEngineDropdown]);

  const selectEngine = (engine: SearchEngine) => {
    setSessionEngine(null);
    onSelectEngine(engine.id);
    setShowEngineDropdown(false);
    setResultSelected(false);
    setSwitchNotice(`已切换为 ${engine.name}`);
    inputRef.current?.focus();
  };

  // Execute selected item
  const handleExecuteItem = (item: SpotlightItem) => {
    // Command engines are temporary; only the engine picker updates the default.
    if (item.kind === 'switch-engine') {
      if (item.restQuery) {
        if (query.trim()) {
          void storage.mutate(() => storage.addRecentSearch(query.trim())).catch(() => {});
        }
        setIsOpen(false);
        handleExternalSearch(item.restQuery, item.engine);
      } else {
        setSessionEngine(item.engine);
        setQuery('');
        setResultSelected(false);
        setSwitchNotice(`本次使用 ${item.engine.name}`);
        inputRef.current?.focus();
      }
      return;
    }

    if (query.trim()) {
      void storage.mutate(() => storage.addRecentSearch(query.trim())).catch(() => {});
    }
    setIsOpen(false);

    switch (item.kind) {
      case 'system-command':
        onSystemCommand?.(item.command);
        break;
      case 'direct-url':
        window.open(item.url, '_blank', 'noopener,noreferrer');
        break;
      case 'bookmark-url':
        onQuickAdd(item.url);
        break;
      case 'search-engine':
        handleExternalSearch(item.query, item.engine);
        break;
      case 'bookmark':
        onOpenBookmark(item.data);
        break;
      case 'folder':
        onOpenFolder(item.data);
        break;
      case 'collection':
        onOpenCollection(item.data);
        break;
      case 'platformSite':
        onOpenPlatformSite(item.data);
        break;
      case 'tool':
        if (item.data.toolType) {
          onOpenTool(item.data.toolType);
        } else {
          window.open(item.data.githubUrl, '_blank', 'noopener,noreferrer');
        }
        break;
    }
  };

  const handleExternalSearch = (searchQuery?: string, engine?: SearchEngine) => {
    const q = (searchQuery || query).trim();
    if (!q) return;
    void storage.mutate(() => storage.addRecentSearch(q)).catch(() => {});
    const targetEngine = engine || currentEngine;
    const searchUrl = targetEngine.urlTemplate.replace('{query}', encodeURIComponent(q));
    window.open(searchUrl, '_blank', 'noopener,noreferrer');
    setIsOpen(false);
  };

  const defaultAction = results.find(item => item.kind === 'system-command'
    || item.kind === 'switch-engine' || (item.kind === 'search-engine' && item.badge === '快捷指令'));
  // Equivalent saved URLs share a target; the first exact match precedes direct-open.
  const automaticItem = query.trim()
    ? defaultAction ?? results.find(item => item.kind === 'bookmark' && item.automaticSelection)
      ?? results.find(item => item.kind === 'direct-url') ?? results[0]
    : undefined;
  const activeIndex = resultSelected ? selectedIndex : automaticItem ? results.indexOf(automaticItem) : -1;
  const primaryItem = showEngineDropdown ? undefined : results[activeIndex] ?? defaultAction;
  const executePrimary = () => {
    if (compositionRef.current || showEngineDropdown) return;
    if (primaryItem) handleExecuteItem(primaryItem);
    else if (query.trim()) handleExternalSearch();
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229 || compositionRef.current) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (showEngineDropdown) {
        engineDropdownRef.current?.querySelector<HTMLButtonElement>('[data-engine-choice]')?.focus();
        return;
      }
      setSelectedIndex((activeIndex + 1) % Math.max(1, results.length));
      setResultSelected(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (showEngineDropdown) {
        const choices = engineDropdownRef.current?.querySelectorAll<HTMLButtonElement>('[data-engine-choice]');
        choices?.item(choices.length - 1)?.focus();
        return;
      }
      setSelectedIndex(activeIndex <= 0 ? Math.max(0, results.length - 1) : activeIndex - 1);
      setResultSelected(true);
    } else if (appShortcut(e.nativeEvent) === 'add') {
      e.preventDefault();
      e.stopPropagation();
      setIsOpen(false);
      onQuickAdd(isLikelyUrl(query) ? normalizeUrl(query) : undefined);
    }
  };

  const getBadgeStyle = (color: string) => {
    switch (color) {
      case 'amber':
        return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/20';
      case 'emerald':
        return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20';
      case 'purple':
        return 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/20';
      case 'indigo':
        return 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/20';
      case 'blue':
        return 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/20';
      default:
        return 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/20';
    }
  };

  return (
    <>
      {/* Center Spotlight Search Bar (iPadOS / Mac Glass Style) */}
      <div ref={entranceRef} role="search" aria-label="桌面搜索" className="mx-auto w-full max-w-[660px] px-4"
        onMouseEnter={() => setTipHovered(true)} onMouseLeave={() => setTipHovered(false)}
        onFocusCapture={() => setTipFocused(true)}
        onBlurCapture={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setTipFocused(false);
        }}>
        <div className="liquid-glass flex h-14 min-w-0 items-center gap-2 rounded-lg p-1.5 transition-shadow focus-within:ring-2 focus-within:ring-sky-500/40">
          <button type="button" title={`切换搜索引擎：${currentEngine.name}`}
            aria-label={`切换搜索引擎：${currentEngine.name}`} aria-haspopup="true"
            onClick={() => { setIsOpen(true); setShowEngineDropdown(true); }}
            className="flex h-10 w-14 shrink-0 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-white/10 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15">
            <FaviconImage url={currentEngine.urlTemplate} title={currentEngine.name} icon={currentEngine.icon} size="sm" className="!h-6 !w-6" />
            <ChevronDown size={12} />
          </button>
          <button type="button" data-onboarding="search" data-tips-paused={tipsPaused || isOpen || tipHovered || tipFocused}
            aria-label={t('onboardingOpenSearch')} title={rotatingTip.text}
            onClick={() => setIsOpen(true)}
            className="h-full min-w-0 flex-1 truncate px-1 text-left text-sm text-slate-600 outline-none dark:text-slate-300">
            <span data-tip-id={rotatingTip.id} data-tip-phase={rotatingTip.phase} aria-hidden="true"
              style={{ opacity: rotatingTip.phase === 'fadeOut' ? 0 : 1, transition: `opacity ${rotatingTip.transitionMs}ms` }}>
              {rotatingTip.text}
            </span>
          </button>
          <button type="button" aria-label="搜索" title="搜索" onClick={() => setIsOpen(true)}
            className="spotlight-submit flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2">
            <Search size={19} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Spotlight Backdrop & Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-[1300] flex flex-col items-center px-3 pb-3 pt-[8dvh] sm:px-6 sm:pb-6 sm:pt-[12dvh]">
          {/* Subtle Dim Backdrop */}
          <div
            className="desktop-dialog-backdrop fixed inset-0 transition-opacity animate-in fade-in duration-150"
            onClick={() => setIsOpen(false)}
          />

          {/* Spotlight Container: overflow-visible prevents dropdown clipping */}
          <div ref={dialogRef} data-panel="search" role="dialog" aria-modal="true" aria-label="全局搜索"
            className="spotlight-shell desktop-dialog-surface liquid-glass relative z-10 flex max-h-[min(80dvh,760px)] w-full min-w-0 max-w-[720px] flex-col overflow-hidden rounded-lg animate-in fade-in zoom-in-95 duration-150"
            onKeyDown={event => {
              if (event.key !== 'Tab' || event.nativeEvent.isComposing || compositionRef.current) return;
              const visible = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"]') ?? [])
                .filter(control => control.getClientRects().length > 0);
              const fieldIndex = visible.indexOf(inputRef.current!);
              const options = visible.filter(control => control.getAttribute('role') === 'option');
              const controls = fieldIndex < 0 ? visible : [
                ...visible.slice(0, fieldIndex + 1), ...options,
                ...visible.slice(fieldIndex + 1).filter(control => !options.includes(control)),
              ];
              const index = controls.indexOf(document.activeElement as HTMLElement);
              event.preventDefault();
              controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
            }}>
            {/* Input Header */}
            <form role="search" aria-label="搜索网址与收藏" onSubmit={event => { event.preventDefault(); executePrimary(); }}
              className="flex h-16 min-w-0 shrink-0 items-center gap-2 border-b border-slate-200/90 px-2.5 sm:gap-3 sm:px-4 dark:border-white/10">
              <button type="button" title={`切换搜索引擎：${currentEngine.name}`}
                aria-label={`切换搜索引擎：${currentEngine.name}`} aria-expanded={showEngineDropdown} aria-controls="spotlight-engines"
                onClick={() => setShowEngineDropdown(previous => !previous)}
                className="flex h-10 w-14 shrink-0 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-white/10 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15">
                <FaviconImage url={currentEngine.urlTemplate} title={currentEngine.name} icon={currentEngine.icon} size="sm" className="!h-6 !w-6" />
                <ChevronDown size={12} className={showEngineDropdown ? 'rotate-180' : ''} />
              </button>
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-label="搜索内容"
                aria-expanded={!showEngineDropdown && results.length > 0}
                aria-controls={!showEngineDropdown ? 'spotlight-results' : undefined}
                aria-activedescendant={!showEngineDropdown && results[activeIndex] ? `spotlight-result-${results[activeIndex].id}` : undefined}
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                  setResultSelected(false);
                }}
                onCompositionStart={() => { compositionRef.current = true; }}
                onCompositionEnd={() => { compositionRef.current = false; }}
                onKeyDown={handleKeyDown}
                placeholder={t('onboardingSearchPlaceholder')}
                className="spotlight-input h-12 min-w-0 flex-1 border-0 p-0 text-base font-medium text-slate-950 outline-none placeholder:text-slate-500 dark:text-slate-100 dark:placeholder:text-slate-400"
              />
              <button type="submit" aria-label="搜索" title="搜索" aria-describedby="spotlight-primary-action"
                disabled={showEngineDropdown || (!query.trim() && !primaryItem)}
                className="spotlight-submit flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-40">
                <Search size={20} strokeWidth={2} />
              </button>
            </form>
            <p role="status" aria-live="polite" className="sr-only">{switchNotice ?? ''}</p>
            {showEngineDropdown && <div ref={engineDropdownRef} className="flex min-h-0 flex-1 flex-col">
              <SearchEngineGrid engines={availableEngines} selectedId={currentEngine.id} onSelect={selectEngine}
                onClose={() => { setShowEngineDropdown(false); inputRef.current?.focus(); }}
                onManage={onOpenSearchEngineSettings ? () => {
                  setIsOpen(false);
                  onOpenSearchEngineSettings();
                } : undefined} />
            </div>}

            {/* Quick Suggestions / Recent Searches Bar (When empty) */}
            {!showEngineDropdown && !query.trim() && recentSearches.length > 0 && (
              <div className="flex items-center gap-2 px-5 py-2.5 border-b border-slate-200/50 dark:border-white/5 text-xs text-slate-600 dark:text-slate-400 overflow-x-auto shrink-0">
                <span className="shrink-0 font-medium text-slate-500">最近搜索:</span>
                {recentSearches.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setQuery(s);
                      setSelectedIndex(0);
                      setResultSelected(false);
                      inputRef.current?.focus();
                    }}
                    className="hover:text-sky-600 dark:hover:text-sky-400 transition-colors whitespace-nowrap px-2 py-0.5 rounded-lg bg-black/5 dark:bg-white/5"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Results List */}
            {!showEngineDropdown && <div
              ref={listRef}
              id="spotlight-results" role="listbox" aria-label="搜索结果"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 space-y-1"
            >
              {results.length > 0 ? (
                results.map((item, index) => {
                  const isSelected = index === activeIndex;
                  const CommandIcon = item.kind === 'system-command' ? systemCommandIcons[item.command] : Settings;
                  return (
                    <div
                      key={item.id}
                      id={`spotlight-result-${item.id}`}
                      role="option" aria-selected={isSelected}
                      tabIndex={0}
                      onFocus={() => { setSelectedIndex(index); setResultSelected(true); }}
                      onKeyDown={event => {
                        if (event.nativeEvent.isComposing || event.keyCode === 229 || compositionRef.current) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleExecuteItem(item);
                        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                          event.preventDefault();
                          const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
                          document.getElementById(`spotlight-result-${results[next].id}`)?.focus();
                        }
                      }}
                      onClick={() => handleExecuteItem(item)}
                      className={`flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sky-500 transition-colors duration-150 ${
                        isSelected
                          ? 'bg-sky-500/15 text-slate-950 dark:text-white font-semibold ring-1 ring-sky-500/30'
                          : 'hover:bg-black/5 dark:hover:bg-white/5 text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {/* Left Icon */}
                      {item.kind === 'system-command' ? (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-300">
                          <CommandIcon size={20} />
                        </div>
                      ) : item.kind === 'direct-url' ? (
                        <div className="w-10 h-10 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                          <ExternalLink size={20} />
                        </div>
                      ) : item.kind === 'bookmark-url' ? (
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                          <Plus size={20} />
                        </div>
                      ) : item.kind === 'switch-engine' ? (
                        <div className="w-10 h-10 flex items-center justify-center shrink-0">
                          <FaviconImage
                            url={item.engine.urlTemplate}
                            title={item.engine.name}
                            icon={item.engine.icon}
                            size="sm"
                          />
                        </div>
                      ) : item.kind === 'search-engine' ? (
                        <div className="w-10 h-10 flex items-center justify-center shrink-0">
                          {item.engine ? (
                            <FaviconImage
                              url={item.engine.urlTemplate}
                              title={item.engine.name}
                              icon={item.engine.icon}
                              size="sm"
                            />
                          ) : (
                            <Search size={20} className="text-indigo-600 dark:text-indigo-400" />
                          )}
                        </div>
                      ) : item.kind === 'bookmark' ? (
                        <FaviconImage
                          url={item.data.url}
                          title={item.data.title}
                          icon={item.data.icon}
                          iconMode={item.data.iconMode}
                          iconBg={item.data.iconBg}
                          size="md"
                        />
                      ) : item.kind === 'folder' ? (
                        <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                          <FolderIcon size={20} />
                        </div>
                      ) : item.kind === 'collection' ? (
                        <div className="w-10 h-10 rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                          <Layers size={20} />
                        </div>
                      ) : item.kind === 'platformSite' ? (
                        <FaviconImage
                          url={item.data.url}
                          title={item.data.title}
                          platformIcon={item.data.icon}
                          iconBg={item.data.iconBg}
                          size="md"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                          <Wrench size={20} />
                        </div>
                      )}

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold truncate text-slate-950 dark:text-white">
                            {item.title}
                          </span>

                          {/* Distinctive Badge */}
                          <span
                            className={`hidden sm:inline text-[10px] font-medium px-2 py-0.5 rounded border shrink-0 ${getBadgeStyle(
                              item.badgeColor
                            )}`}
                          >
                            {item.badge}
                          </span>
                        </div>

                        {item.kind === 'bookmark' || item.kind === 'folder' ? <div
                          className="mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-3 text-[11px] leading-4">
                          <span data-result-url title={item.kind === 'bookmark' ? item.data.url : item.subtitle}
                            className="truncate text-slate-600 dark:text-slate-400">
                            {item.kind === 'bookmark' ? item.data.url : item.subtitle}
                          </span>
                          <span data-library-path title={item.path}
                            className="truncate text-right text-slate-500 dark:text-slate-400">{item.path}</span>
                        </div> : <div className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-400">{item.subtitle}</div>}
                      </div>

                      {/* Shortcut Hint on the Right */}
                      <div className="hidden sm:flex items-center gap-1.5 shrink-0 pl-2">
                        <kbd className="px-2 py-0.5 text-[10px] font-mono font-bold text-slate-600 dark:text-slate-300 bg-black/5 dark:bg-white/10 rounded-md border border-slate-300/80 dark:border-white/10">
                          {item.shortcut}
                        </kbd>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-8 px-4 text-center">
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                    未在本地收藏中找到与 “{query}” 相关的网址
                  </p>
                  <button
                    onClick={() => handleExternalSearch()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-sm transition-colors"
                  >
                    <Search size={14} />
                    <span>使用 {currentEngine.name} 全网搜索</span>
                  </button>
                </div>
              )}
            </div>}

            {/* Footer Navigation Bar */}
            <div className="flex min-w-0 shrink-0 items-center justify-between gap-3 border-t border-slate-200/70 bg-slate-50/70 px-4 py-2.5 text-[11px] text-slate-600 dark:border-white/10 dark:bg-white/[0.025] dark:text-slate-400">
              <span id="spotlight-primary-action" className="min-w-0 truncate">{showEngineDropdown ? '选择搜索引擎' : primaryItem
                ? primaryItem.title
                : `使用 ${currentEngine.name} 搜索`}</span>
              {onOpenSearchEngineSettings && <button type="button" title="管理搜索引擎" aria-label="管理搜索引擎"
                onClick={() => { setIsOpen(false); onOpenSearchEngineSettings(); }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-sky-500 dark:hover:bg-white/10">
                <Settings size={15} />
              </button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, ChevronRight, Folder as FolderIcon, FolderOpen, FolderPlus, Search, X } from 'lucide-react';
import type { Folder } from '../../types';
import { buildFolderTree, navigateFolderTree, visibleFolderRows } from './folder-tree';
import { createTranslator } from '../../i18n';
import { preferenceSaveError } from '../../services/preference-save-error';

export interface FolderTreeSelectProps {
  folders: Folder[];
  value?: string;
  onChange: (id: string | undefined) => void;
  language?: string;
  label?: string;
  excludedIds?: string[];
  onCreateFolder?: (name: string, parentId?: string) => Folder | Promise<Folder>;
  rootLabel?: string;
}

export function FolderTreeSelect({
  folders, value, onChange, language, label, excludedIds, onCreateFolder, rootLabel,
}: FolderTreeSelectProps) {
  const t = createTranslator(language);
  const caption = label ?? t('bookmarkLocation');
  const root = rootLabel ?? t('libraryRoot');
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef(new Map<string | undefined, HTMLDivElement>());
  const nameInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(new Set<string>());
  const [activeId, setActiveId] = useState<string | undefined>(value);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [name, setName] = useState('');
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null);
  const error = failure ? failure.cause instanceof Error
    ? preferenceSaveError(failure.cause, language, 'library') : t('folderCreateFailed') : '';
  const [created, setCreated] = useState<Folder[]>([]);
  const tree = useMemo(() => {
    const ids = new Set(folders.map(folder => folder.id));
    return buildFolderTree([...folders, ...created.filter(folder => !ids.has(folder.id))], excludedIds);
  }, [folders, created, excludedIds]);
  const allRows = useMemo(() => {
    const ids = new Set<string>();
    const queue = [...tree];
    for (let index = 0; index < queue.length; index++) {
      ids.add(queue[index].folder.id);
      for (const child of queue[index].children) queue.push(child);
    }
    return visibleFolderRows(tree, ids);
  }, [tree]);
  const selected = allRows.find(row => row.node.folder.id === value)?.node;
  const selectedId = selected?.folder.id;
  const path = [root, ...(selected?.path.map(folder => folder.name) ?? [])].join(' / ');
  const rows = useMemo(() => visibleFolderRows(tree, expanded, search), [tree, expanded, search]);
  const visibleActive = rows.some(row => row.node.folder.id === activeId) ? activeId : undefined;
  const inputClass = 'min-w-0 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 dark:border-white/20 dark:bg-white/5';
  const iconClass = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-sky-500 dark:hover:bg-white/10';

  function close(restoreFocus = true) {
    setOpen(false);
    setCreating(false);
    setName('');
    setFailure(null);
    setSearch('');
    if (restoreFocus) trigger.current?.focus();
  }

  function show() {
    setExpanded(new Set(selected?.path.slice(0, -1).map(folder => folder.id) ?? []));
    setActiveId(selectedId);
    setSearch('');
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpen(false);
        setCreating(false);
        setName('');
        setFailure(null);
        setSearch('');
      }
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => {
    if (open) rowRefs.current.get(selectedId)?.focus();
  }, [open]);

  useEffect(() => {
    if (creating) nameInput.current?.focus();
  }, [creating]);

  function focusRow(folderId: string | undefined) {
    setActiveId(folderId);
    // New rows mount after an expansion; focus them once React has committed.
    requestAnimationFrame(() => {
      const row = rowRefs.current.get(folderId);
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: 'nearest' });
    });
  }

  function choose(folderId: string | undefined) {
    onChange(folderId);
    close();
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const next = navigateFolderTree(rows, visibleActive, expanded, event.key);
    if (next.select) choose(next.activeId);
    else {
      // Search deliberately reveals ancestors, so collapsing clears the filter first.
      if (search.trim() && event.key === 'ArrowLeft' && rows.find(row => row.node.folder.id === visibleActive)?.expanded) {
        setSearch('');
      }
      setExpanded(next.expandedIds);
      focusRow(next.activeId);
    }
  }

  async function createFolder() {
    if (!name.trim() || !onCreateFolder || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const folder = await onCreateFolder(name.trim(), selectedId);
      setCreated(current => [...current.filter(item => item.id !== folder.id), folder]);
      choose(folder.id);
    } catch (cause) {
      setFailure({ cause });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <div ref={container} className="min-w-0"
    onBlur={event => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close(false);
    }}
    onKeyDownCapture={event => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
        // IME confirmation must neither create a folder nor submit the bookmark form.
        if (event.key === 'Enter') event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (open && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }}>
    <span id={`${id}-label`} className="mb-1.5 block text-xs font-medium">{caption}</span>
    <button ref={trigger} type="button" aria-labelledby={`${id}-label ${id}-value`}
      aria-expanded={open} aria-haspopup="tree" aria-controls={open ? `${id}-tree` : undefined}
      title={path} onClick={() => open ? close() : show()}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!open) show();
          else focusRow(selectedId);
        }
      }}
      className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-white/20 dark:bg-white/5">
      <FolderOpen size={17} aria-hidden="true" className="shrink-0 text-sky-600 dark:text-sky-400" />
      <span id={`${id}-value`} className="min-w-0 flex-1 truncate">{path}</span>
      <ChevronDown size={16} aria-hidden="true" className={`shrink-0 ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="mt-2 flex max-h-[min(60dvh,28rem)] min-w-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-lg dark:border-white/20 dark:bg-zinc-900">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-white/10">
        <Search size={15} aria-hidden="true" className="shrink-0 text-slate-500" />
        <input type="search" aria-label={t('searchFolders')} placeholder={t('searchFolders')}
          value={search} onChange={event => { setSearch(event.target.value); setActiveId(undefined); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              focusRow(event.key === 'ArrowDown' ? rows[0]?.node.folder.id : rows.at(-1)?.node.folder.id);
            }
            if (event.key === 'Enter') event.preventDefault();
          }}
          className="w-full min-w-0 bg-transparent py-1 text-sm outline-none" />
      </div>
      <div id={`${id}-tree`} role="tree" aria-label={caption}
        className="max-h-[min(36dvh,18rem)] min-h-0 overflow-y-auto overscroll-contain p-1">
        <div ref={element => { if (element) rowRefs.current.set(undefined, element); else rowRefs.current.delete(undefined); }}
          role="treeitem" aria-level={1} aria-selected={selectedId === undefined}
          aria-expanded={tree.length ? true : undefined} aria-label={root}
          tabIndex={visibleActive === undefined ? 0 : -1} onFocus={() => setActiveId(undefined)}
          onKeyDown={navigate} onClick={() => choose(undefined)}
          className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500 ${selectedId === undefined ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}>
          <FolderOpen size={16} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={root}>{root}</span>
          {selectedId === undefined && <Check size={15} aria-hidden="true" className="shrink-0" />}
        </div>
        {rows.map(({ node, depth, expanded: isExpanded }) => {
          const fullPath = [root, ...node.path.map(folder => folder.name)].join(' / ');
          return <div key={node.folder.id}
            ref={element => { if (element) rowRefs.current.set(node.folder.id, element); else rowRefs.current.delete(node.folder.id); }}
            role="treeitem" aria-level={depth + 1} aria-label={fullPath}
            aria-expanded={node.children.length ? isExpanded : undefined} aria-selected={selectedId === node.folder.id}
            tabIndex={visibleActive === node.folder.id ? 0 : -1} onFocus={() => setActiveId(node.folder.id)}
            onKeyDown={navigate} onClick={() => choose(node.folder.id)}
            style={{ paddingLeft: `${Math.min(depth, 6) * 12 + 4}px` }}
            className={`flex min-h-12 min-w-0 cursor-pointer items-center gap-1 rounded-md pr-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500 ${selectedId === node.folder.id ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}>
            {node.children.length > 0 ? <button type="button" tabIndex={-1}
              className={iconClass} aria-label={t(isExpanded ? 'collapseFolderNamed' : 'expandFolderNamed', { name: node.folder.name })}
              title={t(isExpanded ? 'collapseFolder' : 'expandFolder')}
              onKeyDown={event => event.stopPropagation()}
              onClick={event => {
                event.stopPropagation();
                if (search.trim()) {
                  setSearch('');
                  setExpanded(new Set(rows.filter(row => row.expanded && row.node.folder.id !== node.folder.id).map(row => row.node.folder.id)));
                } else setExpanded(current => {
                  const next = new Set(current);
                  if (next.has(node.folder.id)) next.delete(node.folder.id);
                  else next.add(node.folder.id);
                  return next;
                });
                focusRow(node.folder.id);
              }}>
              <ChevronRight size={15} aria-hidden="true" className={isExpanded ? 'rotate-90' : ''} />
            </button> : <span className="h-9 w-9 shrink-0" />}
            {isExpanded ? <FolderOpen size={16} aria-hidden="true" className="shrink-0" />
              : <FolderIcon size={16} aria-hidden="true" className="shrink-0" />}
            <span className="min-w-0 flex-1 py-1 pl-1" title={fullPath}>
              <span className="block truncate text-sm">{node.folder.name}</span>
              <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{fullPath}</span>
            </span>
            {selectedId === node.folder.id && <Check size={15} aria-hidden="true" className="shrink-0" />}
          </div>;
        })}
        {search.trim() && !rows.length && <p role="status" className="px-3 py-4 text-xs text-slate-500">
          {t('noMatchingFolders')}
        </p>}
      </div>
      {onCreateFolder && <div className="shrink-0 border-t border-slate-200 p-2 dark:border-white/10">
        {!creating ? <button type="button" className="flex min-h-9 items-center gap-2 rounded-md px-2 text-xs hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-sky-500 dark:hover:bg-white/5"
          onClick={() => { setCreating(true); setFailure(null); }}>
          <FolderPlus size={16} aria-hidden="true" />{t('newFolder')}
        </button> : <div>
          <p className="mb-2 truncate px-1 text-xs text-slate-500 dark:text-slate-400" title={path}>{path}</p>
          <div className="flex min-w-0 items-center gap-1">
            <input ref={nameInput} type="text" value={name}
              aria-label={t('newFolderName')} placeholder={t('newFolderName')}
              aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
              className={`${inputClass} w-full flex-1`}
              onChange={event => { setName(event.target.value); setFailure(null); }}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); createFolder(); }
              }} />
            <button type="button" disabled={saving || !name.trim()} className={`${iconClass} text-sky-700 disabled:opacity-40 dark:text-sky-300`}
              aria-label={t('createFolder')} title={t('createFolder')} onClick={createFolder}>
              <Check size={17} aria-hidden="true" />
            </button>
            <button type="button" className={iconClass} aria-label={t('cancelFolderCreation')} title={t('cancel')}
              onClick={() => { setCreating(false); setName(''); setFailure(null); focusRow(visibleActive); }}>
              <X size={17} aria-hidden="true" />
            </button>
          </div>
          {error && <p id={`${id}-error`} role="alert" className="mt-2 break-words text-xs text-rose-600 dark:text-rose-300">{error}</p>}
        </div>}
      </div>}
    </div>}
  </div>;
}

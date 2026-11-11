import type { Bookmark, Folder } from '../../types';
import { buildBookmarkSearchIndex, matchesSearchFields, searchTokens } from '../../services/bookmark-search';

export interface LaunchpadEntry {
  bookmark: Bookmark;
  path: string;
  initialLetter: string;
  sortKey: string;
  searchFields: string[];
}

function validUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url) || /[\s\u0000-\u001f\u007f]/u.test(url)) return false;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && !!parsed.hostname && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function buildLaunchpadIndex(bookmarks: Bookmark[], folders: Folder[]): LaunchpadEntry[] {
  const folderById = new Map(folders.map(folder => [folder.id, folder]));
  const pathCache = new Map<string, string>();
  function archivePath(folderId: string | undefined): string {
    if (!folderId) return '';
    const cached = pathCache.get(folderId);
    if (cached !== undefined) return cached;
    const names: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = folderId;
    // Walk iteratively so even malformed, cyclic archives cannot overflow the stack.
    while (current && !seen.has(current)) {
      seen.add(current);
      const folder = folderById.get(current);
      if (!folder) break;
      names.push(folder.name);
      current = folder.parentId;
    }
    const path = names.reverse().join(' / ');
    pathCache.set(folderId, path);
    return path;
  }
  const validBookmarks = bookmarks.filter(bookmark => validUrl(bookmark.url));
  const searchIndex = buildBookmarkSearchIndex(validBookmarks, bookmark => archivePath(bookmark.folderId));
  const entries: LaunchpadEntry[] = [];
  for (const bookmark of validBookmarks) {
    const path = archivePath(bookmark.folderId);
    const indexed = searchIndex.get(bookmark.id)!;
    const titleFields = indexed.fields.title;
    const sortKey = titleFields[1] ?? titleFields[0];
    const first = sortKey.charAt(0);
    entries.push({
      bookmark, path, sortKey, initialLetter: /^[a-z]$/.test(first) ? first.toUpperCase() : '#',
      searchFields: indexed.searchFields,
    });
  }
  // Stable ties preserve separate records and never consult archive or desktop order.
  return entries.sort((a, b) => {
    if (a.initialLetter === '#' && b.initialLetter !== '#') return 1;
    if (a.initialLetter !== '#' && b.initialLetter === '#') return -1;
    return a.sortKey.localeCompare(b.sortKey, 'en', { sensitivity: 'base' });
  });
}

export function searchLaunchpad(index: LaunchpadEntry[], query: string): LaunchpadEntry[] {
  const tokens = searchTokens(query);
  if (!tokens.length) return index.slice();
  return index.filter(entry => matchesSearchFields(entry.searchFields, tokens));
}

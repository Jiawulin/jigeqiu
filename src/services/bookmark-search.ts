import { pinyin } from 'pinyin-pro';
import type { Bookmark } from '../types';

type SearchableBookmark = Pick<Bookmark, 'id' | 'title' | 'url' | 'domain'> &
  Partial<Pick<Bookmark, 'notes' | 'keywords'>>;

export interface BookmarkSearchEntry {
  fields: Record<'title' | 'url' | 'domain' | 'notes' | 'keywords' | 'path', string[]>;
  searchFields: string[];
}

export type BookmarkSearchIndex = ReadonlyMap<string, BookmarkSearchEntry>;

export function normalizeSearchText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

export function buildBookmarkSearchIndex<T extends SearchableBookmark>(
  bookmarks: readonly T[],
  pathFor: (bookmark: T) => string = () => '',
): BookmarkSearchIndex {
  const cache = new Map<string, string[]>();
  const indexedText = (text: string): string[] => {
    const plain = normalizeSearchText(text);
    const cached = cache.get(plain);
    if (cached) return cached;
    const result = [plain];
    if (/\p{Script=Han}/u.test(plain)) {
      const syllables = pinyin(plain, { toneType: 'none', type: 'all', nonZh: 'consecutive' });
      result.push(syllables.map(part => part.result).join(''), syllables.map(part => part.first).join(''));
    }
    cache.set(plain, result);
    return result;
  };
  return new Map(bookmarks.map(bookmark => {
    const fields: BookmarkSearchEntry['fields'] = {
      title: indexedText(bookmark.title),
      url: indexedText(bookmark.url),
      domain: indexedText(bookmark.domain),
      notes: indexedText(bookmark.notes ?? ''),
      keywords: (bookmark.keywords ?? []).flatMap(indexedText),
      path: indexedText(pathFor(bookmark)),
    };
    return [bookmark.id, { fields, searchFields: [...new Set(Object.values(fields).flat())].filter(Boolean) }];
  }));
}

export function searchTokens(query: string): string[] {
  return normalizeSearchText(query).split(' ').filter(Boolean);
}

export function matchesSearchFields(fields: readonly string[], tokens: readonly string[]): boolean {
  return tokens.every(token => fields.some(field => field.includes(token)));
}

export function searchBookmarkIds(index: BookmarkSearchIndex, query: string): Set<string> {
  const tokens = searchTokens(query);
  return new Set([...index].filter(([, entry]) => matchesSearchFields(entry.searchFields, tokens)).map(([id]) => id));
}

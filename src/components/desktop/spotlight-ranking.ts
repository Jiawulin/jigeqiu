import type { Bookmark } from '../../types';
import { buildBookmarkSearchIndex, normalizeSearchText, searchBookmarkIds, type BookmarkSearchIndex } from '../../services/bookmark-search';

type SearchableBookmark = Pick<Bookmark, 'id' | 'title' | 'url' | 'domain'> &
  Partial<Pick<Bookmark, 'notes' | 'tags' | 'keywords'>>;

export type SpotlightUrlMatch = 'exact' | 'same-host' | 'subdomain' | 'other';

export const normalizeSpotlightText = normalizeSearchText;

function parseHttpUrl(value: string): URL | undefined {
  if (!/^https?:\/\/[^/]/iu.test(value) || /[\s\\]/u.test(value)) return;
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url;
  } catch { /* Invalid addresses cannot establish an automatic URL match. */ }
}

export function parseSpotlightUrlQuery(value: string): URL | undefined {
  const raw = value.trim();
  if (/^https?:\/\//iu.test(raw)) return parseHttpUrl(raw);
  if (!raw || raw.startsWith('/')) return;
  const url = parseHttpUrl(`https://${raw}`);
  if (url && (url.hostname.includes('.') || url.hostname === 'localhost' || url.hostname.startsWith('['))) return url;
}

function urlMatchKey(url: URL): string {
  // Only ranking ignores protocol/www and a final slash; execution keeps the saved URL.
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  return JSON.stringify([url.hostname.replace(/^www\./u, ''), url.port, path, url.search, url.hash]);
}

export function rankSpotlightBookmarks<T extends SearchableBookmark>(
  bookmarks: readonly T[],
  query: string,
  pathFor: (bookmark: T) => string = () => '',
  searchIndex?: BookmarkSearchIndex,
) {
  const q = normalizeSpotlightText(query);
  if (!q) return { matches: [], automaticId: undefined };
  const queryUrl = parseSpotlightUrlQuery(query);
  const queryKey = queryUrl ? urlMatchKey(queryUrl) : undefined;
  const queryHost = queryUrl?.hostname.replace(/^www\./u, '');
  const compactQuery = q.replace(/\s+/gu, '');
  const pathQuery = query.includes('/');
  const matchingIds = searchBookmarkIds(searchIndex ?? buildBookmarkSearchIndex(bookmarks, pathFor), query);
  const matches = bookmarks.flatMap(bookmark => {
    const title = normalizeSpotlightText(bookmark.title);
    const compactTitle = title.replace(/\s+/gu, '');
    const url = parseHttpUrl(bookmark.url);
    const hostname = url?.hostname.replace(/^www\./u, '') ?? '';
    const exactUrl = Boolean(url && queryKey && urlMatchKey(url) === queryKey);
    const urlMatch: SpotlightUrlMatch = exactUrl ? 'exact'
      : queryHost && hostname === queryHost ? 'same-host'
        : queryHost && hostname.endsWith(`.${queryHost}`) ? 'subdomain' : 'other';
    const titleMatch = compactTitle.includes(compactQuery);
    const fields = [title, hostname, bookmark.domain, bookmark.url, bookmark.notes ?? '',
      ...(bookmark.tags ?? []), ...(bookmark.keywords ?? []), pathFor(bookmark)];
    const originalMatch = titleMatch || fields.some(field => normalizeSpotlightText(field).includes(q));
    if (urlMatch === 'other' && !originalMatch && !matchingIds.has(bookmark.id)) return [];
    let score = titleMatch ? 40 : hostname.includes(q) ? 30 : originalMatch ? 10 : 5;
    if (exactUrl) score = 120;
    else if (queryUrl && urlMatch === 'same-host') score = 80;
    else if (queryUrl && urlMatch === 'subdomain') score = 60;
    else if (hostname && !queryUrl && !pathQuery) {
      if (compactTitle === compactQuery) score = 100;
      else if (hostname === q) score = 95;
      else if (q.length >= 3 && hostname.split('.')[0] === q) score = 90;
      else if (compactQuery.length >= 4 && compactTitle.startsWith(compactQuery)
        && compactQuery.length / compactTitle.length >= 0.7) score = 85;
    }
    return [{ bookmark, score, urlMatch }];
  }).sort((a, b) => b.score - a.score);
  // Equivalent exact URLs share a target; ordinary text still requires a clear lead.
  const first = matches[0];
  const automaticId = queryUrl
    ? first?.urlMatch === 'exact' ? first.bookmark.id : undefined
    : first && first.score >= 85 && first.score - (matches[1]?.score ?? 0) >= 15 ? first.bookmark.id : undefined;
  return { matches, automaticId };
}

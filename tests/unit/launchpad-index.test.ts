import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Bookmark, Folder } from '../../src/types';
import { buildLaunchpadIndex, searchLaunchpad } from '../../src/components/desktop/launchpad-index';

function bookmark(id: string, title: string, extra: Partial<Bookmark> = {}): Bookmark {
  return {
    id, title, url: `https://example.test/${id}`, domain: 'example.test',
    category: 'legacy-category', pinnedToDesktop: false, order: 0,
    collectionIds: [], createdAt: 1, updatedAt: 1, ...extra,
  };
}
function folder(id: string, name: string, parentId?: string): Folder {
  return {
    id, name, ...(parentId ? { parentId } : {}), bookmarkIds: [],
    pinnedToDesktop: false, order: 0, createdAt: 1, updatedAt: 1,
  };
}
const ids = (entries: ReturnType<typeof buildLaunchpadIndex>) => entries.map(entry => entry.bookmark.id);

test('flattens all valid HTTP(S) bookmarks regardless of archive or desktop pin and emits no folder items', () => {
  const bookmarks = [
    bookmark('root', 'Alpha'), bookmark('nested', 'Beta', { folderId: 'deep' }),
    bookmark('pinned', 'Gamma', { pinnedToDesktop: true }),
    bookmark('http', 'Delta', { url: 'HTTP://example.test/path' }),
  ];
  const index = buildLaunchpadIndex(bookmarks, [folder('deep', 'Archive')]);
  assert.equal(index.length, 4);
  assert.deepEqual(new Set(ids(index)), new Set(bookmarks.map(item => item.id)));
  assert.ok(index.every(entry => entry.bookmark && typeof entry.path === 'string' && !('type' in entry)));
});

test('excludes unsafe protocols, relative, malformed, credential-bearing and whitespace-corrupted URLs', () => {
  const urls = [
    'javascript:alert(1)', 'data:text/html,hi', 'file:///etc/hosts', 'ftp://example.test',
    '//example.test', 'example.test', '/path', '', 'https://', 'https://exa mple.test',
    'https://user:password@example.test/', 'https://example.test/a\nb',
  ];
  const index = buildLaunchpadIndex(urls.map((url, index) => bookmark(String(index), 'Bad', { url })), []);
  assert.deepEqual(index, []);
});

test('same URL with different IDs is never collapsed and multiple field matches return a record only once', () => {
  const index = buildLaunchpadIndex([
    bookmark('one', 'Find', { url: 'https://find.test', notes: 'find', keywords: ['find'] }),
    bookmark('two', 'Find', { url: 'https://find.test' }),
  ], []);
  assert.deepEqual(ids(searchLaunchpad(index, 'find')), ['one', 'two']);
});

test('sorts names by real pinyin and Latin alphabet, ignores legacy order, and places # last', () => {
  const index = buildLaunchpadIndex([
    bookmark('z', '知乎', { order: -10 }), bookmark('hash', '123 tools'),
    bookmark('b', '百度'), bookmark('a', '  alpha  '), bookmark('g', 'Google'),
    bookmark('c', '重庆'), bookmark('empty', ''), bookmark('symbol', '!Bang'),
  ], []);
  assert.deepEqual(ids(index).slice(0, 5), ['a', 'b', 'c', 'g', 'z']);
  assert.deepEqual(index.slice(0, 5).map(entry => entry.initialLetter), ['A', 'B', 'C', 'G', 'Z']);
  assert.ok(index.slice(5).every(entry => entry.initialLetter === '#'));
});

test('equal normalized names retain input order and neither build nor query mutates source arrays', () => {
  const bookmarks = [bookmark('b', 'same'), bookmark('a', 'Same')];
  const folders = [folder('parent', 'Parent')];
  const before = structuredClone({ bookmarks, folders });
  const index = buildLaunchpadIndex(bookmarks, folders);
  assert.deepEqual(ids(index), ['b', 'a']);
  assert.equal(index[0].bookmark, bookmarks[0]);
  const order = [...index];
  searchLaunchpad(index, 'same');
  assert.deepEqual(index, order);
  assert.deepEqual({ bookmarks, folders }, before);
});

test('archive paths include all known ancestors and distinguish equal-title equal-URL records', () => {
  const index = buildLaunchpadIndex([
    bookmark('work', 'Docs', { folderId: 'deep', url: 'https://docs.test/' }),
    bookmark('home', 'Docs', { folderId: 'home', url: 'https://docs.test/' }),
    bookmark('root', 'Docs'),
  ], [folder('deep', '前端', 'work'), folder('work', '工作'), folder('home', '生活')]);
  assert.equal(index.find(entry => entry.bookmark.id === 'work')!.path, '工作 / 前端');
  assert.equal(index.find(entry => entry.bookmark.id === 'root')!.path, '');
  assert.deepEqual(ids(searchLaunchpad(index, '前端')), ['work']);
  assert.deepEqual(ids(searchLaunchpad(index, '生活')), ['home']);
});

test('missing folders, missing ancestors, self cycles and longer cycles safely retain reachable path names', () => {
  const index = buildLaunchpadIndex([
    bookmark('missing', 'A', { folderId: 'missing' }),
    bookmark('orphan', 'B', { folderId: 'orphan' }),
    bookmark('self', 'C', { folderId: 'self' }),
    bookmark('cycle', 'D', { folderId: 'child' }),
  ], [
    folder('orphan', 'Orphan', 'missing'), folder('self', 'Self', 'self'),
    folder('parent', 'Parent', 'child'), folder('child', 'Child', 'parent'),
  ]);
  assert.deepEqual(index.map(entry => entry.path), ['', 'Orphan', 'Self', 'Parent / Child']);
});

test('matches title, domain, URL, private notes, keywords and path case-insensitively but never tags', () => {
  const index = buildLaunchpadIndex([
    bookmark('one', 'Photos', {
      domain: 'CustomDomain.test', url: 'https://example.test/unique-url',
      notes: 'Private Memo', keywords: ['wallpaper'], folderId: 'f', tags: ['tag-only-secret'],
    }),
  ], [folder('f', 'ArchivePath')]);
  for (const query of ['PHOTOS', 'customdomain', 'unique-url', 'private memo', 'wallpaper', 'archivepath']) {
    assert.deepEqual(ids(searchLaunchpad(index, query)), ['one'], query);
  }
  assert.deepEqual(searchLaunchpad(index, 'tag-only-secret'), []);
});

test('matches Chinese pinyin, syllable queries and initials from names, notes, keywords and paths', () => {
  const index = buildLaunchpadIndex([
    bookmark('cn', '重庆银行', { notes: '私人备注', keywords: ['图片壁纸'], folderId: 'f' }),
  ], [folder('f', '工作资料')]);
  for (const query of ['chongqing', 'chong qing', 'cqyh', 'sirenbeizhu', 'srbz', 'tupianbizhi', 'tpbz', 'gongzuoziliao', 'gzzl']) {
    assert.deepEqual(ids(searchLaunchpad(index, query)), ['cn'], query);
  }
});

test('trims whitespace and AND-matches tokens across fields without requiring field order', () => {
  const index = buildLaunchpadIndex([
    bookmark('match', '重庆', { keywords: ['壁纸'], folderId: 'f' }),
    bookmark('partial', '重庆'),
  ], [folder('f', '工作')]);
  assert.deepEqual(ids(searchLaunchpad(index, '  BIZHI \t cq \n 工作  ')), ['match']);
  assert.deepEqual(searchLaunchpad(index, 'cq nonexistent'), []);
  assert.deepEqual(searchLaunchpad(index, '  \t\n '), index);
  assert.deepEqual(searchLaunchpad(index, ''), index);
});

test('query uses built index fields rather than converting bookmark text again', () => {
  const source = bookmark('b', '中文');
  const index = buildLaunchpadIndex([source], []);
  Object.defineProperty(source, 'title', { get() { throw new Error('query must not reread title'); } });
  assert.deepEqual(ids(searchLaunchpad(index, 'zhongwen')), ['b']);
  assert.deepEqual(ids(searchLaunchpad(index, 'zw')), ['b']);
});

test('fuel title supports normalized pinyin and mixed queries without typo expansion', () => {
  const index = buildLaunchpadIndex([bookmark('fuel', '小熊油耗', { keywords: ['汽车'] })], []);
  for (const query of [' 小熊油耗 ', 'xxyh', 'XXYH', 'ＸＸＹＨ', ' xxyh ', 'xiaoxiongyouhao', 'xxy', 'xiaoxiong', 'xx 油耗', 'xxyh qiche']) {
    assert.deepEqual(ids(searchLaunchpad(index, query)), ['fuel'], query);
  }
  assert.deepEqual(searchLaunchpad(index, 'xxyg'), []);
  assert.deepEqual(searchLaunchpad(index, 'xxyh nonexistent'), []);
});

test('supports a 64-level archive without truncating or modifying names', () => {
  const folders = Array.from({ length: 64 }, (_, index) => folder(`f${index}`, `Level${index}`, index ? `f${index - 1}` : undefined));
  const index = buildLaunchpadIndex([bookmark('deep', 'Deep', { folderId: 'f63' })], folders);
  assert.equal(index[0].path, folders.map(item => item.name).join(' / '));
  assert.deepEqual(ids(searchLaunchpad(index, 'level0 level63')), ['deep']);
});

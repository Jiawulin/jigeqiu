import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSpotlightUrlQuery, rankSpotlightBookmarks } from '../../src/components/desktop/spotlight-ranking';

const bookmark = (id: string, title: string, url = `https://${id}.test/`, keywords: string[] = []) =>
  ({ id, title, url, domain: new URL(url).hostname, keywords });

test('pinyin, initials and cross-field tokens retrieve bookmarks without automatic selection', () => {
  const item = { ...bookmark('fuel', '小熊油耗', undefined, ['汽车']), notes: '私人备注' };
  for (const query of ['xxyh', 'XXYH', 'ＸＸＹＨ', ' xxyh ', 'xiaoxiongyouhao', 'xxy', 'xiaoxiong', 'xx 油耗', 'xxyh qiche', 'srbz gzzl']) {
    const result = rankSpotlightBookmarks([item], query, () => '工作资料');
    assert.deepEqual(result.matches.map(match => match.bookmark.id), ['fuel'], query);
    assert.equal(result.automaticId, undefined, query);
  }
  assert.equal(rankSpotlightBookmarks([item], 'xxyg').matches.length, 0);
  assert.equal(rankSpotlightBookmarks([item], 'xxyh nonexistent').matches.length, 0);
  const ranked = rankSpotlightBookmarks([item, bookmark('literal', 'xxyh')], 'xxyh');
  assert.deepEqual(ranked.matches.map(match => match.bookmark.id), ['literal', 'fuel']);
  assert.equal(ranked.automaticId, 'literal');
});

test('normalized exact title outranks substrings independently of library order', () => {
  const result = rankSpotlightBookmarks([
    bookmark('docs', 'GitHub documentation'), bookmark('github', 'GitHub'),
  ], ' ＧｉｔＨｕｂ ');
  assert.deepEqual(result.matches.map(match => match.bookmark.id), ['github', 'docs']);
  assert.equal(result.automaticId, 'github');
});

test('hostname and site name qualify but repeated domains are ambiguous', () => {
  const items = [bookmark('design', 'Workspace', 'https://www.figma.com/')];
  assert.equal(rankSpotlightBookmarks(items, 'figma').automaticId, 'design');
  assert.equal(rankSpotlightBookmarks(items, 'figma.com').automaticId, 'design');
  assert.equal(rankSpotlightBookmarks([...items, bookmark('other', 'Other', 'https://figma.com/files')], 'figma').automaticId, undefined);
  assert.equal(rankSpotlightBookmarks([...items, bookmark('other', 'Other', 'https://figma.com/files')], 'figma.com').automaticId, 'design');
});

test('duplicates and close confidence scores fall back to search', () => {
  assert.equal(rankSpotlightBookmarks([bookmark('a', 'GitHub'), bookmark('b', 'GitHub')], 'github').automaticId, undefined);
  assert.equal(rankSpotlightBookmarks([bookmark('a', 'Figma'), bookmark('b', 'Workspace', 'https://figma.com/')], 'figma').automaticId, undefined);
});

test('only substantial prefixes qualify; metadata and short substrings remain searchable', () => {
  const items = [bookmark('ts', 'TypeScript handbook'), bookmark('meta', 'Reference', undefined, ['metadata-only'])];
  assert.equal(rankSpotlightBookmarks(items, 'TypeScript hand').automaticId, 'ts');
  assert.equal(rankSpotlightBookmarks(items, 'Type').automaticId, undefined);
  const metadata = rankSpotlightBookmarks(items, 'metadata-only');
  assert.equal(metadata.matches[0]?.bookmark.id, 'meta');
  assert.equal(metadata.automaticId, undefined);
  assert.equal(rankSpotlightBookmarks(items, 'unmatched').matches.length, 0);
  assert.equal(rankSpotlightBookmarks(items, '').automaticId, undefined);
});

test('folder paths remain searchable; stale domain metadata never establishes confidence', () => {
  const item = { ...bookmark('a', 'Reference'), domain: 'github.com' };
  assert.equal(rankSpotlightBookmarks([item], 'github').automaticId, undefined);
  assert.equal(rankSpotlightBookmarks([item], 'Work / Docs', () => 'Work / Docs').matches.length, 1);
});

test('unsafe URLs cannot become automatic bookmark targets', () => {
  const item = { ...bookmark('a', 'Exact title'), url: 'javascript:alert(1)' };
  assert.equal(rankSpotlightBookmarks([item], 'Exact title').automaticId, undefined);
});

test('exact URL matching ignores HTTP protocol and one trailing slash without rewriting the bookmark', () => {
  const item = bookmark('docs', 'Documentation', 'http://www.example.com/Docs/');
  for (const query of ['example.com/Docs', 'https://example.com/Docs/', 'HTTP://EXAMPLE.COM/Docs']) {
    const result = rankSpotlightBookmarks([item], query);
    assert.equal(result.automaticId, 'docs', query);
    assert.equal(result.matches[0]?.bookmark.url, item.url);
  }
});

test('full URL path selects its page rather than the homepage or sibling page', () => {
  const items = [
    bookmark('home', 'Homepage', 'https://example.com/'),
    bookmark('other', 'Other page', 'https://example.com/docs/other'),
    bookmark('docs', 'Documentation', 'https://example.com/docs/'),
  ];
  assert.equal(rankSpotlightBookmarks(items, 'http://example.com/docs').automaticId, 'docs');
  assert.equal(rankSpotlightBookmarks(items, 'https://example.com').automaticId, 'home');
  assert.equal(rankSpotlightBookmarks(items.slice(1), 'example.com').automaticId, undefined);
});

test('URL inputs cannot auto-select a title match for a different address', () => {
  const item = bookmark('wrong', 'https://example.com/docs', 'https://unrelated.test/');
  assert.equal(rankSpotlightBookmarks([item], item.title).automaticId, undefined);
});

test('URL matching preserves path case, internal slashes and encoded path boundaries', () => {
  const items = [bookmark('docs', 'Documentation', 'https://example.com/Docs/a%2Fb/')];
  assert.equal(rankSpotlightBookmarks(items, 'example.com/Docs/a%2Fb').automaticId, 'docs');
  for (const query of ['example.com/docs/a%2Fb', 'example.com/Docs/a/b', 'example.com//Docs/a%2Fb']) {
    assert.equal(rankSpotlightBookmarks(items, query).automaticId, undefined, query);
  }
});

test('query parameters and fragments distinguish pages and remain case sensitive', () => {
  const items = [
    bookmark('first', 'First', 'https://example.com/docs/?id=A#Intro'),
    bookmark('second', 'Second', 'https://example.com/docs/?id=B#Intro'),
  ];
  assert.equal(rankSpotlightBookmarks(items, 'http://example.com/docs?id=A#Intro').automaticId, 'first');
  for (const query of ['example.com/docs', 'example.com/docs?id=a#Intro', 'example.com/docs?id=A#Other']) {
    assert.equal(rankSpotlightBookmarks(items, query).automaticId, undefined, query);
  }
});

test('default ports normalize but non-default ports distinguish bookmarks', () => {
  const items = [
    bookmark('default', 'Default', 'https://example.com/docs/'),
    bookmark('custom', 'Custom', 'https://example.com:8443/docs/'),
  ];
  assert.equal(rankSpotlightBookmarks(items, 'http://example.com:80/docs').automaticId, 'default');
  assert.equal(rankSpotlightBookmarks(items, 'https://example.com:443/docs').automaticId, 'default');
  assert.equal(rankSpotlightBookmarks(items, 'example.com:8443/docs').automaticId, 'custom');
  assert.equal(rankSpotlightBookmarks(items, 'example.com:8444/docs').automaticId, undefined);
});

test('equivalent duplicate URLs select the first saved item without protocol or title preferences', () => {
  const items = [
    bookmark('http', 'Old page', 'http://example.com/docs'),
    bookmark('https', 'example.com/docs/', 'https://www.example.com/docs/'),
  ];
  assert.equal(rankSpotlightBookmarks(items, 'example.com/docs/').automaticId, 'http');
  assert.equal(rankSpotlightBookmarks(items, 'https://example.com/docs').matches.length, 2);
});

test('URL tiers separate exact targets, same-host pages, child hosts and text-only matches', () => {
  const items = [
    bookmark('weak', 'aliyun.com reference', 'https://unrelated.test/'),
    bookmark('sub', 'Workbench', 'https://devops.aliyun.com/workbench'),
    bookmark('path', 'Products', 'https://www.aliyun.com/product/ecs'),
    bookmark('http', 'Cloud', 'http://www.aliyun.com/'),
    bookmark('https', 'Cloud', 'https://aliyun.com/'),
    bookmark('false-host', 'Unrelated', 'https://fakealiyun.com/'),
    bookmark('suffix', 'Unrelated', 'https://aliyun.com.other.com/'),
  ];
  const result = rankSpotlightBookmarks(items, 'https://www.aliyun.com/');
  assert.deepEqual(result.matches.map(match => [match.bookmark.id, match.urlMatch]), [
    ['http', 'exact'], ['https', 'exact'], ['path', 'same-host'], ['sub', 'subdomain'],
  ]);
  assert.equal(result.automaticId, 'http');
  const bare = rankSpotlightBookmarks(items, 'aliyun.com');
  assert.deepEqual(bare.matches.map(match => match.bookmark.id), [
    'http', 'https', 'path', 'sub', 'weak', 'false-host', 'suffix',
  ]);
  assert.equal(bare.matches.find(match => match.bookmark.id === 'false-host')?.urlMatch, 'other');
  assert.equal(bare.matches.find(match => match.bookmark.id === 'suffix')?.urlMatch, 'other');
});

test('specific URL queries keep same-host pages related, not exact, and never broaden to parent hosts', () => {
  const items = [
    bookmark('home', 'Home', 'https://aliyun.com/'),
    bookmark('exact', 'Docs', 'https://devops.aliyun.com/docs/'),
    bookmark('child', 'Child', 'https://api.devops.aliyun.com/new'),
    bookmark('sibling', 'Sibling', 'https://other.aliyun.com/'),
  ];
  const result = rankSpotlightBookmarks(items, 'devops.aliyun.com/new');
  assert.deepEqual(result.matches.map(match => [match.bookmark.id, match.urlMatch]), [
    ['exact', 'same-host'], ['child', 'subdomain'],
  ]);
  assert.equal(result.automaticId, undefined);
});

test('title whitespace is ignored for retrieval and confidence, without changing the displayed title', () => {
  const item = bookmark('laravel', 'laravel 11 中文文档');
  for (const query of ['laravel11', 'laravel 11', 'ＬＡＲＡＶＥＬ　１１', 'laravel\t11']) {
    const result = rankSpotlightBookmarks([item], query);
    assert.equal(result.matches[0]?.bookmark.title, item.title, query);
    assert.equal(result.automaticId, undefined, 'Short prefixes remain below the confidence threshold');
  }
  assert.equal(rankSpotlightBookmarks([item], 'laravel11中文文档').automaticId, 'laravel');
  assert.equal(rankSpotlightBookmarks([bookmark('compact', 'laravel11中文文档')], item.title).automaticId, 'compact');
});

test('whitespace title collisions stay ambiguous and URL paths do not lose spaces', () => {
  const items = [bookmark('a', 'laravel 11'), bookmark('b', 'laravel11')];
  assert.equal(rankSpotlightBookmarks(items, 'laravel11').automaticId, undefined);
  const url = bookmark('docs', 'example.com/a b', 'https://example.com/ab');
  assert.equal(rankSpotlightBookmarks([url], 'example.com/a%20b').automaticId, undefined);
});

test('URL path fragments are searchable but cannot establish automatic confidence', () => {
  const item = bookmark('docs', '/guide/install', 'https://example.com/guide/install/');
  for (const query of ['/guide/install', 'guide/install']) {
    const result = rankSpotlightBookmarks([item], query);
    assert.equal(result.matches[0]?.bookmark.id, 'docs');
    assert.equal(result.automaticId, undefined);
  }
});

test('URL queries accept full and bare HTTP addresses but reject credentials, broken schemes and path-only input', () => {
  for (const query of ['example.test/docs?q=A#Intro', 'https://example.test/docs', 'example.com:8443/docs']) {
    assert.ok(parseSpotlightUrlQuery(query), query);
  }
  for (const query of ['', 'docs', '/guide/install', 'ftp://example.com/docs',
    'javascript:alert(1)', 'https://example.com/has space', 'https://user:pass@example.com/',
    'https://example.com\\@other.com', 'https://', 'http:///example.com']) {
    assert.equal(parseSpotlightUrlQuery(query), undefined, query);
  }
});

test('host suffixes, subdomains and repeated trailing slashes are not collapsed into exact URL matches', () => {
  const items = [bookmark('docs', 'Documentation', 'https://example.com/docs/')];
  for (const query of ['example.com.evil/docs', 'docs.example.com/docs', 'example.com/docs//']) {
    assert.equal(rankSpotlightBookmarks(items, query).automaticId, undefined, query);
  }
});

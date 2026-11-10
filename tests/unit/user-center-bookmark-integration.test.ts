import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { commitAndRefresh } from '../../src/services/library-mutation';
import { createTranslator } from '../../src/i18n';

const source = readFileSync(new URL('../../src/components/account/UserCenterView.tsx', import.meta.url), 'utf8');

test('library folder navigation grows with desktop viewport while retaining mobile scrolling', () => {
  assert.match(source, /className="max-h-80 md:max-h-\[max\(20rem,calc\(100dvh-22rem\)\)\] overflow-y-auto space-y-1 pr-1 custom-scrollbar"/);
});

test('manager uses one shared bookmark dialog with no implicit desktop pinning', () => {
  const dialogs = source.match(/<BookmarkDialog\b[\s\S]*?\/>/g) ?? [];
  assert.equal(dialogs.length, 1);
  for (const attribute of ['defaultPinToDesktop={false}', 'existingBookmarks={bookmarks}',
    'bookmark={editingBookmark ?? undefined}', 'onSave={handleSaveBookmark}',
    'onCreateFolder={handleCreateLibraryFolder}']) assert.ok(dialogs[0].includes(attribute));
  assert.doesNotMatch(source, /editBmNotes|addBmTitle|folderSelectOptions|parentFolderSelectOptions/);
});

test('all three personal library folder selectors use the shared tree and edit excludes its subtree', () => {
  const selectors = source.match(/<FolderTreeSelect\b[\s\S]*?\/>/g) ?? [];
  assert.equal(selectors.length, 3);
  const edit = selectors.find(element => element.includes("value={editFolderParentId === 'none' ? undefined : editFolderParentId}"));
  assert.ok(edit);
  assert.ok(edit.includes('excludedIds={[editingFolder.id]}'));
  for (const selector of selectors) assert.ok(selector.includes('folders={folders}'));
});

test('manager save forwards the shared input and existing ID, refreshes, and only then closes', async () => {
  const declaration = source.match(/const handleSaveBookmark = ([\s\S]*?\n  });/);
  assert.ok(declaration);
  const compiled = transformSync(`return (${declaration[1]});`, { loader: 'ts', target: 'es2022' }).code;
  const calls: unknown[][] = [];
  const editingBookmark = { id: 'existing' };
  const save = new Function('storage', 'editingBookmark', 'onLibraryChanged', 'setEditingBookmark',
    'setIsAddBookmarkOpen', 'onShowToast', 'commitAndRefresh', 't', compiled)(
    { saveManualBookmark: (...args: unknown[]) => calls.push(['save', ...args]) },
    editingBookmark,
    () => calls.push(['refresh']),
    (value: unknown) => calls.push(['edit', value]),
    (value: unknown) => calls.push(['add', value]),
    (message: string) => calls.push(['toast', message]),
    commitAndRefresh,
    createTranslator('zh'),
  );
  const input = { title: 'Changed', notes: 'Retained notes', collectionIds: ['old'], pinnedToDesktop: true };
  await save(input, false);
  assert.deepEqual(calls.slice(0, 2), [['save', input, 'existing'], ['refresh']]);
  assert.ok(calls.some(call => call[0] === 'edit' && call[1] === null));
  assert.ok(calls.some(call => call[0] === 'toast' && call[1] === '收藏已更新'));
  calls.length = 0;
  await assert.rejects(async () => {
    const fail = new Function('storage', 'editingBookmark', 'onLibraryChanged', 'setEditingBookmark',
      'setIsAddBookmarkOpen', 'onShowToast', 'commitAndRefresh', 't', compiled)(
      { saveManualBookmark() { throw new Error('Persistence failed'); } }, editingBookmark,
      () => calls.push(['refresh']), () => calls.push(['close']), () => calls.push(['close']), () => {},
      commitAndRefresh,
      createTranslator('zh'),
    );
    await fail(input, false);
  }, /Persistence failed/);
  assert.deepEqual(calls, []);
});

test('bookmark search and row actions use the agreed labels', () => {
  assert.ok(source.includes("placeholder={t('managerBookmarkSearch')}"));
  assert.equal(createTranslator('zh')('managerBookmarkSearch'), '按名称、网址或关键词搜索...');
  assert.equal(createTranslator('en-US')('managerBookmarkSearch'), 'Search by name, URL, or keywords...');
  for (const [key, zh, en] of [
    ['managerEditBookmark', '编辑收藏', 'Edit bookmark'],
    ['managerOpenNewTab', '在新标签页打开', 'Open in a new tab'],
    ['managerDeleteBookmark', '删除收藏…', 'Delete bookmark…'],
  ] as const) {
    assert.ok(source.includes(`title={t('${key}')}`));
    assert.equal(createTranslator('zh')(key), zh);
    assert.equal(createTranslator('en-US')(key), en);
  }
});

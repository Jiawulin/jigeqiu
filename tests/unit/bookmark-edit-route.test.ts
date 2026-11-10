import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import { commitAndRefresh } from '../../src/services/library-mutation';
import { createRequire } from 'node:module';
import React from 'react';

const source = readFileSync(new URL('../../src/PrototypeApp.tsx', import.meta.url), 'utf8');
test('legacy folder edit uses the same atomic save route and refreshes folder membership', async () => {
  const declaration = source.match(/const handleUpdateBookmark = ([\s\S]*?\n  });/);
  assert.ok(declaration);
  const compiled = transformSync(`return (${declaration[1]});`, { loader: 'ts', target: 'es2022' }).code;
  const calls: unknown[][] = [];
  const bookmark = { id: 'one', title: 'Before', url: 'https://example.test/', folderId: 'a', notes: 'kept' };
  const storage = {
    getBookmarks: () => [bookmark],
    updateBookmark: (...args: unknown[]) => calls.push(['legacy', ...args]),
    saveManualBookmark: (...args: unknown[]) => calls.push(['atomic', ...args]),
  };
  const update = new Function('storage', 'mutateLibrary', 'showToast', compiled)(
    storage, (commit: () => unknown) => commitAndRefresh(commit, () => { calls.push(['refresh']); }), () => {},
  );
  await update('one', { title: 'After', folderId: 'b' });
  assert.deepEqual(calls, [['atomic', { ...bookmark, title: 'After', folderId: 'b' }, 'one'], ['refresh']]);
  calls.length = 0;
  storage.saveManualBookmark = () => { throw new Error('Quota'); };
  await assert.rejects(update('one', { folderId: 'b' }), /Quota/);
  assert.deepEqual(calls, []);
});

test('folder rename retains its editor on failure and waits for durable success', async () => {
  const path = new URL('../../src/components/desktop/FolderModal.tsx', import.meta.url);
  const require = createRequire(path);
  const state: unknown[] = [];
  let cursor = 0;
  const noop = () => {};
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value: unknown) => { state[index] = value; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useEffect: noop,
  };
  const module = { exports: {} as { FolderModal: (props: object) => React.ReactElement<any> } };
  new Function('require', 'module', 'exports',
    transformSync(readFileSync(path, 'utf8'), { loader: 'tsx', format: 'cjs' }).code)(
    (id: string) => id === 'react' ? hooks : require(id), module, module.exports);
  let failure = true;
  let release = noop;
  const props = {
    folder: { id: 'folder', name: 'Before', bookmarkIds: [] }, allBookmarks: [],
    isOpen: true, onClose: noop, onOpenBookmark: noop, onRemoveFromFolder: noop,
    onDeleteFolder: noop, onAddMoreBookmarks: noop,
    onRenameFolder: async () => {
      if (failure) throw new DOMException('Full', 'QuotaExceededError');
      await new Promise<void>(resolve => { release = resolve; });
    },
  };
  const render = () => { cursor = 0; return module.exports.FolderModal(props); };
  function nodes(tree: React.ReactNode): React.ReactElement<any>[] {
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    if (!React.isValidElement<{ children?: React.ReactNode }>(tree)) return [];
    return [tree, ...nodes(tree.props.children)];
  }
  nodes(render().props.title).find(node => node.props.onClick)!.props.onClick();
  nodes(render().props.title).find(node => node.type === 'input')!.props.onChange({ target: { value: 'After' } });
  await nodes(render().props.title).find(node => node.props.title === '保存')!.props.onClick();
  assert.equal(nodes(render().props.title).find(node => node.type === 'input')!.props.value, 'After');
  assert.ok(nodes(render()).some(node => node.props.role === 'alert'));
  failure = false;
  const pending = nodes(render().props.title).find(node => node.props.title === '保存')!.props.onClick();
  assert.ok(nodes(render().props.title).some(node => node.type === 'input'));
  release();
  await pending;
  assert.equal(nodes(render().props.title).some(node => node.type === 'input'), false);
});

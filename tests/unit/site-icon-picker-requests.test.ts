import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import { transformSync } from 'esbuild';

function harness() {
  const path = new URL('../../src/components/common/SiteIconPicker.tsx', import.meta.url);
  const require = createRequire(path);
  const state: any[] = [];
  const effects: { deps: unknown[]; cleanup?: () => void }[] = [];
  const timers = new Map<number, { at: number; run: () => void }>();
  const searches: { url: string; options: any }[] = [];
  let cursor = 0, effectCursor = 0, now = 0, nextTimer = 0;
  let pending: (() => void)[] = [];
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value: any) => {
        state[index] = typeof value === 'function' ? value(state[index]) : value;
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = effectCursor++;
      if (effects[index]?.deps.every((value, i) => Object.is(value, deps[i]))) return;
      pending.push(() => {
        effects[index]?.cleanup?.();
        effects[index] = { deps, cleanup: effect() || undefined };
      });
    },
    useSyncExternalStore: () => false,
  };
  const module = { exports: {} as { SiteIconPicker: (props: any) => React.ReactElement<any> } };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout',
    transformSync(readFileSync(path, 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)(
    (id: string) => {
      if (id === 'react') return hooks;
      if (id.endsWith('/site-icon-discovery')) return {
        rankSiteIconCandidates: (items: unknown[]) => items,
      };
      if (id.endsWith('/site-icons')) return {
        discoverValidatedSiteIcons(url: string, options: unknown) {
          searches.push({ url, options });
          return new Promise(() => {});
        },
        validateSiteIconSource: async () => ({}),
      };
      return require(id);
    }, module, module.exports,
    (run: () => void, delay: number) => {
      const id = ++nextTimer;
      timers.set(id, { at: now + delay, run });
      return id;
    }, (id: number) => timers.delete(id),
  );
  const changes: unknown[] = [];
  const props = { url: '', title: '', value: { iconMode: 'auto' }, onChange: (value: unknown) => changes.push(value) };
  const render = () => {
    cursor = effectCursor = 0;
    const tree = module.exports.SiteIconPicker(props);
    const tasks = pending;
    pending = [];
    tasks.forEach(run => run());
    return tree;
  };
  const preview = () => render().props.children[0].props.children[0].props.url;
  const tick = (ms: number) => {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].run();
      render();
    }
    now = end;
  };
  return { props, render, preview, tick, searches, changes,
    unmount: () => effects.forEach(effect => effect.cleanup?.()) };
}

test('preview and discovery wait 450ms after the last character', () => {
  const view = harness();
  view.props.url = 'zhihu.co';
  assert.equal(view.preview(), '');
  view.tick(449);
  assert.equal(view.preview(), '');
  assert.equal(view.searches.length, 0);
  view.props.url = 'zhihu.com';
  assert.equal(view.preview(), '');
  view.tick(449);
  assert.equal(view.preview(), '');
  assert.equal(view.searches.length, 0);
  view.tick(1);
  assert.equal(view.preview(), 'https://zhihu.com/');
  assert.deepEqual(view.searches.map(item => item.url), ['https://zhihu.com/']);
  view.unmount();
});

test('incomplete hosts never reach preview or discovery', () => {
  for (const url of ['', 'z', 'zh', 'https://', 'zhihu.', 'zhihu.c', 'bad..com', '-bad.com']) {
    const view = harness();
    view.props.url = url;
    view.render();
    view.tick(2000);
    assert.equal(view.preview(), '', url);
    assert.equal(view.searches.length, 0, url);
    view.unmount();
  }
});

test('complete domains, localhost and IP addresses remain eligible', () => {
  for (const [url, expected] of [
    ['example.com/path', 'https://example.com/path'],
    ['localhost:3000', 'https://localhost:3000/'],
    ['http://192.168.1.1', 'http://192.168.1.1/'],
    ['http://[::1]:8080', 'http://[::1]:8080/'],
  ]) {
    const view = harness();
    view.props.url = url;
    view.render();
    view.tick(450);
    assert.equal(view.preview(), expected);
    assert.deepEqual(view.searches.map(item => item.url), [expected]);
    view.unmount();
  }
});

test('editing cancels discovery and ignores late candidates; unmount clears debounce', () => {
  const view = harness();
  view.props.url = 'first.example.com';
  view.render();
  view.tick(450);
  const previous = view.searches[0];
  assert.ok(previous);
  view.props.url = 'second.example.com';
  assert.equal(view.preview(), '');
  assert.equal(previous.options.signal.aborted, true);
  previous.options.onCandidate({ url: 'https://first.example.com/icon.png', kind: 'icon', width: 64, height: 64 });
  assert.deepEqual(view.changes, []);
  view.unmount();
  view.tick(1000);
  assert.equal(view.searches.length, 1);
});

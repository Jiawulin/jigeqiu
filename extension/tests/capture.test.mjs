import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaptureController, CAPTURE_PREFIX, MENU_ID, captureKey, parseCapture, centeredCaptureBounds } from '../capture/controller.ts';

function setup() {
  const data = {};
  const local = {};
  const windows = new Map();
  const menus = [];
  let fail = false;
  const controller = createCaptureController({
    session: {
      get: async key => key === null ? { ...data } : { [key]: data[key] },
      set: async values => Object.assign(data, values),
      remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
    },
    local: { get: async () => local },
    menus: {
      removeAll: async () => { menus.length = 0; },
      create: options => { menus.push(options); },
    },
    windows: {
      getLastFocused: async () => ({ left: 100, top: 50, width: 1440, height: 1000 }),
      create: async options => {
        if (fail) throw new Error('Window denied');
        const id = windows.size + 1;
        windows.set(id, options);
        return { id };
      },
      get: async id => {
        if (id === 99) return { left: -1920, top: 80, width: 1280, height: 900 };
        if (!windows.has(id)) throw new Error('Missing');
        return { id };
      },
    },
    getURL: path => `chrome-extension://test/${path}`,
    languages: () => ['en-US'],
    uuid: (() => { let id = 0; return () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`; })(),
  });
  return { controller, data, local, windows, menus, deny: () => { fail = true; } };
}

test('menu uses saved language before browser preferences and limits pages to HTTP(S)', async () => {
  const s = setup();
  await s.controller.syncMenu();
  assert.equal(s.menus[0].id, MENU_ID);
  assert.equal(s.menus[0].title, 'Save to JIGEQIU');
  assert.deepEqual(s.menus[0].documentUrlPatterns, ['http://*/*', 'https://*/*']);
  s.local['jigeqiu-extension-state-v1'] = { data: { jipage_settings_v1: '{"language":"zh"}' } };
  await s.controller.syncMenu();
  assert.equal(s.menus.length, 1);
  assert.equal(s.menus[0].title, '收藏到记个球');
});

test('popup centers on the invoking window, preserving negative multi-monitor coordinates', async () => {
  const s = setup();
  await s.controller.open({ url: 'https://example.org', windowId: 99 });
  assert.equal(s.windows.get(1).left, -1560);
  assert.equal(s.windows.get(1).top, 150);
  assert.deepEqual(centeredCaptureBounds({ left: 10, top: 20, width: 400, height: 600 }),
    { width: 400, height: 600, left: 10, top: 20 });
  assert.deepEqual(centeredCaptureBounds({}), { width: 560, height: 760 });
});

test('capture isolates drafts and never embeds private URLs in popup URLs', async () => {
  const s = setup();
  await s.controller.open({ url: 'https://example.org/private?q=secret#part', title: '<Page>' });
  await s.controller.open({ url: 'https://second.example/', title: 'Second' });
  const entries = Object.entries(s.data);
  assert.equal(entries.length, 2);
  assert.ok(entries.every(([key]) => key.startsWith(CAPTURE_PREFIX)));
  assert.equal(entries[0][1].title, '<Page>');
  assert.equal(entries[0][1].url, 'https://example.org/private?q=secret#part');
  const popup = s.windows.get(1);
  assert.equal(popup.type, 'popup');
  assert.equal(popup.width, 560);
  assert.equal(popup.height, 760);
  assert.doesNotMatch(popup.url, /secret|example.org|Page/);
  await s.controller.closed(1);
  assert.equal(Object.keys(s.data).length, 1);
  assert.equal(Object.values(s.data)[0].title, 'Second');
});

test('opening failure clears drafts; unsupported URLs become explicit error requests', async () => {
  const s = setup();
  await s.controller.open({ url: 'javascript:alert(1)' });
  assert.equal(Object.values(s.data)[0].error, 'unsupported');
  assert.equal(Object.values(s.data)[0].url, undefined);
  await s.controller.closed(1);
  s.deny();
  await assert.rejects(s.controller.open({ url: 'https://example.org' }), /Window denied/);
  assert.deepEqual(s.data, {});
});

test('cleanup after a worker restart preserves open windows and removes closed drafts', async () => {
  const s = setup();
  await s.controller.open({ url: 'https://example.org' });
  await s.controller.prune();
  assert.equal(Object.keys(s.data).length, 1);
  s.windows.clear();
  await s.controller.prune();
  assert.deepEqual(s.data, {});
});

test('request parsing rejects malformed IDs, missing drafts and credential-bearing URLs', () => {
  for (const id of ['', '../private', 'not-a-uuid']) assert.throws(() => captureKey(id), /INVALID_CAPTURE/);
  for (const value of [null, {}, { url: 'https://user:pass@example.org' }, { url: 'file:///private' }, { url: 'https://example.org', title: 1 }]) {
    assert.throws(() => parseCapture(value));
  }
});

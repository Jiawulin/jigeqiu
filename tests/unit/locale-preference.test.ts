import assert from 'node:assert/strict';
import test from 'node:test';
import { selectLocale } from '../../src/i18n/locale';
import { readUserLocale, USER_SETTINGS_KEY } from '../../src/services/user-locale';
import { configureApplicationStorage } from '../../src/services/application-storage';

test('saved language wins over browser preferences', () => {
  assert.equal(selectLocale('zh', ['en-US']), 'zh');
  assert.equal(selectLocale('en', ['zh-CN']), 'en');
  assert.equal(selectLocale('EN-gb', ['zh-CN']), 'en');
  assert.equal(selectLocale('zh-Hant', ['en']), 'zh');
  assert.equal(selectLocale('fr', ['en']), 'zh');
});

test('first use selects the first supported browser preference, otherwise Chinese', () => {
  assert.equal(selectLocale(undefined, ['en-GB', 'zh-CN']), 'en');
  assert.equal(selectLocale(undefined, ['zh-TW', 'en']), 'zh');
  assert.equal(selectLocale(undefined, ['fr', 'en-US']), 'en');
  for (const preferences of [[], ['ja'], ['fr', 'de'], ['english']]) {
    assert.equal(selectLocale(undefined, preferences), 'zh');
  }
  assert.equal(selectLocale('', ['en-US']), 'en');
  assert.equal(selectLocale(null, ['en-US']), 'en');
});

test('reading a locale never writes, including absent or unreadable preferences', () => {
  let raw: string | null = '{"language":"en"}';
  let blocked = false;
  const storage = {
    getItem(key: string) {
      assert.equal(key, USER_SETTINGS_KEY);
      if (blocked) throw new Error('Blocked');
      return raw;
    },
    setItem() { assert.fail('Locale detection must not persist defaults'); },
  } as unknown as Storage;
  configureApplicationStorage({ storage, mutate: async action => action() });
  try {
    assert.equal(readUserLocale(['zh']), 'en');
    raw = '{"language":"zh"}';
    assert.equal(readUserLocale(['en']), 'zh');
    for (raw of [null, '{}', 'null', '{broken']) {
      assert.equal(readUserLocale(['en']), 'en');
    }
    blocked = true;
    assert.equal(readUserLocale(['ja']), 'zh');
  } finally {
    configureApplicationStorage(undefined);
  }
});

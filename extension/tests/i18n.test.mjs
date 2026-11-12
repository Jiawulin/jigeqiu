import assert from 'node:assert/strict';
import test from 'node:test';
import { getPrivacySections, PRIVACY_VERSION } from '../privacy/content.ts';
import { createTranslator } from '../../src/i18n/index.ts';

test('privacy translations cover all sections and retain privacy safeguards', () => {
  const en = getPrivacySections('en-US');
  assert.equal(en.length, 12);
  assert.equal(getPrivacySections('zh').length, en.length);
  for (const section of en) {
    assert.ok(section.title.trim());
    assert.ok(section.text.trim());
    assert.doesNotMatch(section.title + section.text, /[\u3400-\u9fff]/);
  }
  assert.match(en.map(section => section.text).join(' '), /credentials|Limited Use|chrome.storage.local/);
  assert.equal(PRIVACY_VERSION, '2026-11-12.1', 'New capture permissions require a new acknowledgment');
  assert.match(createTranslator('en')('extensionRemoteImageNotice'), /cookies/);
  assert.match(createTranslator('en')('extensionStorageError'), /Do not uninstall/);
});

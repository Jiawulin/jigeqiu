import assert from 'node:assert/strict';
import test from 'node:test';
import * as keyboard from '../../src/components/desktop/desktop-keyboard';

const event = {
  key: 'ArrowRight', defaultPrevented: false, repeat: false, isComposing: false,
  keyCode: 39, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
};

test('all four ordinary arrows enter desktop navigation, other keys remain native', () => {
  assert.equal(typeof keyboard.desktopArrowKey, 'function');
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    assert.equal(keyboard.desktopArrowKey({ ...event, key }, false), key);
  }
  for (const key of ['Enter', 'Tab', 'Escape', 'Home', 'End']) {
    assert.equal(keyboard.desktopArrowKey({ ...event, key }, false), null);
  }
});

test('blocked, handled, repeated, composing and modified events remain native', () => {
  assert.equal(typeof keyboard.desktopArrowKey, 'function');
  assert.equal(keyboard.desktopArrowKey(event, true), null);
  for (const field of ['defaultPrevented', 'repeat', 'isComposing', 'altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
    assert.equal(keyboard.desktopArrowKey({ ...event, [field]: true }, false), null, field);
  }
  assert.equal(keyboard.desktopArrowKey({ ...event, keyCode: 229 }, false), null);
});

test('first arrow selects the current page first item, including on a partial last page', () => {
  assert.equal(typeof keyboard.desktopNavigationIndex, 'function');
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const) {
    assert.equal(keyboard.desktopNavigationIndex(key, -1, 1, 3, 6, 14), 6);
    assert.equal(keyboard.desktopNavigationIndex(key, -1, 2, 3, 6, 14), 12);
    assert.equal(keyboard.desktopNavigationIndex(key, -1, 0, 3, 6, 0), null);
  }
});

test('horizontal navigation is sequential across rows and pages without wrapping', () => {
  assert.equal(typeof keyboard.desktopNavigationIndex, 'function');
  const next = (key: 'ArrowLeft' | 'ArrowRight', index: number) =>
    keyboard.desktopNavigationIndex(key, index, Math.floor(index / 6), 3, 6, 14);
  assert.equal(next('ArrowRight', 2), 3);
  assert.equal(next('ArrowRight', 5), 6);
  assert.equal(next('ArrowLeft', 6), 5);
  assert.equal(next('ArrowLeft', 0), 0);
  assert.equal(next('ArrowRight', 13), 13);
});

test('vertical navigation stays in the same column and page, missing cells do not move', () => {
  assert.equal(typeof keyboard.desktopNavigationIndex, 'function');
  assert.equal(keyboard.desktopNavigationIndex('ArrowDown', 1, 0, 3, 6, 10), 4);
  assert.equal(keyboard.desktopNavigationIndex('ArrowUp', 4, 0, 3, 6, 10), 1);
  assert.equal(keyboard.desktopNavigationIndex('ArrowUp', 1, 0, 3, 6, 10), 1);
  assert.equal(keyboard.desktopNavigationIndex('ArrowDown', 4, 0, 3, 6, 10), 4);
  assert.equal(keyboard.desktopNavigationIndex('ArrowDown', 7, 1, 3, 6, 10), 7);
  assert.equal(keyboard.desktopNavigationIndex('ArrowDown', 6, 1, 3, 6, 10), 9);
  assert.equal(keyboard.desktopNavigationIndex('ArrowRight', 0, 1, 3, 6, 10), 6,
    'Stale focus outside the visible page starts at the current page first item');
});

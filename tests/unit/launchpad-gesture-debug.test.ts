import assert from 'node:assert/strict';
import test from 'node:test';
import { createLaunchpadGestureDebug } from '../../src/components/desktop/launchpad-gesture-debug';

test('gesture diagnostics are opt-in, restartable and memory bounded', () => {
  const debug = createLaunchpadGestureDebug(3);
  debug.record('move', 10, { y: 20 });
  assert.equal(debug.read().events.length, 0);
  debug.start();
  for (let i = 0; i < 5; i++) debug.record('move', 100 + i, { y: i });
  const result = debug.stop();
  assert.equal(result.active, false);
  assert.equal(result.dropped, 2);
  assert.deepEqual(result.events.map(event => event.y), [2, 3, 4]);
  assert.deepEqual(result.events.map(event => event.at), [2, 3, 4]);
  debug.record('move', 200, { y: 9 });
  assert.deepEqual(debug.read(), result);
  debug.start();
  assert.deepEqual(debug.read(), { active: true, dropped: 0, events: [] });
});

test('diagnostics whitelist numeric gesture fields and return detached snapshots', () => {
  const debug = createLaunchpadGestureDebug();
  debug.start();
  const input = { y: 100, velocity: 0, top: 40, url: 'https://private.invalid', query: 'private' };
  debug.record('release', 50, input);
  debug.record('cancel', 60, { reason: 'wheel' });
  const result = debug.read();
  assert.deepEqual(result.events, [
    { kind: 'release', at: 0, y: 100, top: 40, velocity: 0 },
    { kind: 'cancel', at: 10, reason: 'wheel' },
  ]);
  result.events[0].y = 999;
  assert.equal(debug.read().events[0].y, 100);
});

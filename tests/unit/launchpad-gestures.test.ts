import assert from 'node:assert/strict';
import test from 'node:test';
import * as gestures from '../../src/components/desktop/launchpad-gestures';
import { createDesktopGesture } from '../../src/components/desktop/desktop-gestures';

test('drag threshold distinguishes taps, horizontal motion and cancelled gestures', () => {
  assert.equal(typeof gestures.createLaunchpadDrag, 'function');
  const drag = gestures.createLaunchpadDrag(10, 100, 0);
  drag.move(18, 100, 10);
  assert.equal(drag.dragging, false);
  drag.move(19, 100, 20);
  assert.equal(drag.dragging, true);
  drag.cancel();
  assert.equal(drag.velocity(30), 0);
});

test('instantaneous speed uses recent movement, respects pauses and clamps flicks', () => {
  const drag = gestures.createLaunchpadDrag(0, 400, 0);
  drag.move(0, 300, 50);
  drag.move(0, 100, 100);
  assert.ok(drag.velocity(100) > 3, 'A fast release must not flatten at 2px/ms');
  assert.equal(drag.velocity(250), 0);
  const reverse = gestures.createLaunchpadDrag(0, 100, 0);
  reverse.move(0, 150, 50);
  assert.equal(reverse.velocity(50), -1);
});

test('inertia integrates actual elapsed time and stops at either edge', () => {
  const next = gestures.advanceLaunchpadInertia(100, 1, 100, 1000);
  assert.ok(next.position > 170 && next.position < 190);
  assert.ok(next.velocity > 0.6 && next.velocity < 0.7);
  assert.deepEqual(gestures.advanceLaunchpadInertia(990, 2, 20, 1000),
    { position: 1000, velocity: 0 });
  assert.deepEqual(gestures.advanceLaunchpadInertia(10, -2, 20, 1000),
    { position: 0, velocity: 0 });
  assert.deepEqual(gestures.advanceLaunchpadInertia(100, 0.004, 16, 1000),
    { position: 100, velocity: 0 });
  assert.equal(gestures.advanceLaunchpadInertia(100, 1, 2000, 1000).velocity, 0);
});

test('slow releases ease out instead of stopping after a few frames', () => {
  const next = gestures.advanceLaunchpadInertia(100, 0.3, 100, 1000);
  assert.ok(next.velocity > 0.1, 'Slow drags retain a decaying tail at 100ms');
  assert.ok(next.position > 120 && next.position < 130);
});

test('inertia preserves distance across frame rates and fractional positions', () => {
  const once = gestures.advanceLaunchpadInertia(100.25, 1.5, 240, 10000);
  for (const hz of [60, 120, 144]) {
    let next = { position: 100.25, velocity: 1.5 };
    const count = Math.round(hz * 0.24);
    for (let i = 0; i < count; i++) next = gestures.advanceLaunchpadInertia(next.position, next.velocity, 240 / count, 10000);
    assert.ok(Math.abs(once.position - next.position) < 0.001);
    assert.ok(Math.abs(once.velocity - next.velocity) < 0.001);
  }
});

test('instantaneous velocity follows reversal, expires during holds and limits extreme spikes', () => {
  const reverse = gestures.createLaunchpadDrag(0, 400, 0);
  for (const [y, at] of [[300, 50], [280, 80], [300, 100], [340, 120]]) reverse.move(0, y, at);
  assert.ok(reverse.velocity(120) < -0.5, 'Release follows the final downward stroke');
  reverse.move(0, 340, 270);
  assert.equal(reverse.velocity(270), 0, 'Instantaneous speed expires independently of retained release intent');
  const flick = gestures.createLaunchpadDrag(0, 500, 0);
  flick.move(0, 0, 10);
  assert.equal(flick.velocity(10), 8);
});

test('drag consumes activation slop once then follows each movement including reversal', () => {
  const drag = gestures.createLaunchpadDrag(0, 100, 0);
  drag.move(0, 96, 10);
  assert.equal(drag.deltaY, 0);
  drag.move(0, 90, 20);
  assert.equal(drag.deltaY, 2);
  drag.move(0, 70, 30);
  assert.equal(drag.deltaY, 20);
  drag.move(0, 80, 40);
  assert.equal(drag.deltaY, -10);
});

test('discarded movement at a scroll boundary cannot fling against the inward release', () => {
  for (const start of [1000, 908]) {
    const drag = gestures.createLaunchpadDrag(0, 400, 0);
    let position = start;
    for (const [y, at] of [[360, 20], [320, 40], [300, 50], [310, 60], [310, 61]]) {
      drag.move(0, y, at);
      position = drag.scrollPosition(position, 1000);
    }
    assert.equal(position, 990);
    assert.ok(drag.velocity(61) < 0, `Inward release after starting at ${start} retains its direction`);
    assert.ok(gestures.advanceLaunchpadInertia(position, drag.velocity(61), 16, 1000).position < position);
  }
});

test('alphabet hit testing follows real cell centers and clamps beyond ends', () => {
  const cells = [{ letter: 'A', center: 10 }, { letter: 'B', center: 30 }, { letter: '#', center: 60 }];
  assert.equal(gestures.launchpadLetterAt(-100, cells), 'A');
  assert.equal(gestures.launchpadLetterAt(29, cells), 'B');
  assert.equal(gestures.launchpadLetterAt(100, cells), '#');
  assert.equal(gestures.launchpadLetterAt(10, []), null);
});

test('instantaneous speed fades during a pause independently of retained release velocity', () => {
  const speeds = [0, 30, 60, 90, 100, 150].map(pause => {
    const drag = gestures.createLaunchpadDrag(0, 500, 0);
    for (let i = 1; i <= 8; i++) drag.move(0, 500 - i * 20, i * 16);
    drag.move(0, 340, 128 + pause, false);
    return drag.velocity(128 + pause);
  });
  assert.equal(speeds[0], 1.25);
  assert.equal(speeds[1], speeds[0]);
  assert.ok(speeds[2] > speeds[0] * 0.5, 'A 60ms release pause still has usable inertia');
  assert.ok(speeds[3] > 0 && speeds[3] < speeds[2], 'A longer pause progressively weakens the fling');
  assert.equal(speeds[4], 0);
  assert.equal(speeds[5], 0);
});

test('stationary pointer events and release jitter do not replace real motion history', () => {
  const drag = gestures.createLaunchpadDrag(0, 500, 0);
  for (let i = 1; i <= 8; i++) drag.move(0, 500 - i * 20, i * 16);
  const baseline = drag.velocity(188);
  for (const at of [138, 148, 158, 178, 188]) drag.move(0, 340, at);
  assert.equal(drag.velocity(188), baseline);
  drag.move(0, 339.5, 188, false);
  assert.equal(drag.deltaY, 0.5, 'Release still applies its final position');
  assert.equal(drag.velocity(188), baseline, 'Release does not fabricate a new motion sample');
  drag.move(0, 339, 278, false);
  assert.equal(drag.velocity(278), 0, 'Release jitter cannot revive a stopped gesture');
});

test('resuming after a hold starts fresh speed history instead of reviving the old flick', () => {
  const drag = gestures.createLaunchpadDrag(0, 500, 0);
  drag.move(0, 300, 20);
  drag.move(0, 100, 40);
  drag.move(0, 101, 200);
  assert.equal(drag.velocity(200), 0);
  drag.move(0, 111, 220);
  assert.equal(drag.velocity(220), -0.5);
});

test('short-pause tolerance preserves real deceleration rather than reusing peak speed', () => {
  const drag = gestures.createLaunchpadDrag(0, 500, 0);
  for (let i = 1; i <= 5; i++) drag.move(0, 500 - i * 30, i * 16);
  const fast = drag.velocity(80);
  for (let i = 1; i <= 5; i++) drag.move(0, 350 - i, 80 + i * 16);
  const slow = drag.velocity(160);
  assert.ok(slow > 0 && slow < fast / 10);
  assert.ok(drag.velocity(220) < fast / 10);
});

test('a deliberate 36px slow drag has visible release inertia like desktop vertical intent', () => {
  for (const direction of [-1, 1]) {
    const desktop = createDesktopGesture({ x: 0, y: 500, now: 0, width: 1440, height: 1000, touch: false });
    const drag = gestures.createLaunchpadDrag(0, 500, 0);
    for (let i = 1; i <= 12; i++) {
      desktop.update(0, 500 + direction * i * 3, i * 30);
      drag.move(0, 500 + direction * i * 3, i * 30);
    }
    assert.equal(desktop.finish(380), direction < 0 ? 'launchpad' : 'search');
    const velocity = drag.releaseVelocity(380);
    assert.equal(Math.sign(velocity), -direction);
    let next = { position: 1000, velocity };
    for (let i = 0; i < 100; i++) next = gestures.advanceLaunchpadInertia(next.position, next.velocity, 10, 10000);
    assert.ok(Math.abs(next.position - 1000) >= 80, 'Slow committed drags have perceptible momentum');
  }
});

test('short flicks use desktop distance and speed intent, while tiny drags do not fling', () => {
  const flick = gestures.createLaunchpadDrag(0, 500, 0);
  flick.move(0, 482, 40);
  assert.ok(flick.releaseVelocity(45) >= 0.65);
  assert.equal(flick.releaseVelocity(740), flick.releaseVelocity(45),
    'A delayed release preserves a short flick without borrowing distance intent');
  const tiny = gestures.createLaunchpadDrag(0, 500, 0);
  tiny.move(0, 488, 10);
  assert.equal(tiny.releaseVelocity(15), 0);
});

test('committed release retains final intent through a stationary release delay', () => {
  const drag = gestures.createLaunchpadDrag(0, 500, 0);
  for (let i = 1; i <= 8; i++) drag.move(0, 500 - i * 10, i * 25);
  for (let i = 1; i <= 5; i++) drag.move(0, 420 - i, 200 + i * 20);
  assert.ok(drag.releaseVelocity(320) >= 0.65, 'Slow final pixels do not erase deliberate travel');
  assert.equal(drag.releaseVelocity(420), drag.releaseVelocity(320));
  assert.equal(drag.releaseVelocity(1000), drag.releaseVelocity(320),
    'Like tmviewer, stationary release latency does not erase the last stroke');
  drag.move(0, 414, 550);
  assert.equal(drag.releaseVelocity(555), 0, 'A tiny restart cannot revive the old committed drag');
});

test('deliberate reversals and edge contact reset distance intent, tiny release jitter does not', () => {
  const drag = gestures.createLaunchpadDrag(0, 500, 0);
  for (let i = 1; i <= 5; i++) drag.move(0, 500 - i * 12, i * 20);
  drag.move(0, 442, 120);
  assert.ok(drag.releaseVelocity(125) > 0, 'Two pixels of hand retraction retain the stroke direction');
  drag.move(0, 450, 140);
  assert.equal(drag.releaseVelocity(145), 0, 'A deliberate reversal clears the previous long stroke');
  drag.cancel();
  assert.equal(drag.releaseVelocity(145), 0);
  const edge = gestures.createLaunchpadDrag(0, 500, 0);
  edge.move(0, 450, 50);
  edge.scrollPosition(990, 1000);
  assert.equal(edge.releaseVelocity(55), 0);
  const release = gestures.createLaunchpadDrag(0, 500, 0);
  release.move(0, 440, 50);
  release.move(0, 450, 70, false);
  assert.equal(release.releaseVelocity(70), 0, 'A release-only retraction cancels the committed stroke');
});

test('holding before the first drag does not consume the initial distance intent', () => {
  const drag = gestures.createLaunchpadDrag(0, 500, 0);
  drag.move(0, 464, 300);
  assert.ok(drag.releaseVelocity(320) >= 0.65);
});

test('a short delivery gap resets speed samples without erasing committed travel', () => {
  const drag = gestures.createLaunchpadDrag(0, 500, 0);
  drag.move(0, 479, 70);
  drag.move(0, 476, 190);
  drag.move(0, 464, 250);
  assert.ok(drag.releaseVelocity(280) >= 0.65);
  drag.move(0, 463, 470);
  assert.equal(drag.releaseVelocity(480), 0, 'A deliberate hold starts fresh distance intent');
});

test('activation slop at either edge does not erase an inward slow drag', () => {
  for (const direction of [-1, 1]) {
    const drag = gestures.createLaunchpadDrag(0, 500, 0);
    let position = direction < 0 ? 0 : 1000;
    for (let i = 1; i <= 12; i++) {
      drag.move(0, 500 + direction * i * 3, i * 30);
      position = drag.scrollPosition(position, 1000);
    }
    assert.equal(position, direction < 0 ? 28 : 972);
    assert.equal(drag.releaseVelocity(390), -direction * 0.65);
  }
});

test('release hand retraction within drag slop retains committed inertia in either direction', () => {
  for (const direction of [-1, 1]) {
    for (const sampled of [false, true]) {
      for (const retraction of [4, 6, 8]) {
        const drag = gestures.createLaunchpadDrag(0, 500, 0);
        for (let i = 1; i <= 8; i++) drag.move(0, 500 + direction * i * 20, i * 16);
        drag.move(0, 500 + direction * (160 - retraction), 150, sampled);
        assert.ok(drag.releaseVelocity(160) * -direction >= 0.65,
          `${retraction}px ${sampled ? 'sampled' : 'release-only'} retraction must not discard a 160px stroke`);
      }
    }
  }
});

test('slow initial events establish direction before the hold timeout at a boundary', () => {
  const drag = gestures.createLaunchpadDrag(0, 666, 819);
  let position = 6220;
  const times = [888, 978, 1034, 1111, 1142, 1176, 1218, 1261, 1294, 1326, 1360, 1393];
  for (const [index, time] of times.entries()) {
    drag.move(0, 666 + (index + 1) * 3, time);
    position = drag.scrollPosition(position, 6220);
  }
  assert.equal(position, 6192);
  assert.ok(drag.releaseVelocity(1426) <= -0.65);
});

test('real three-finger traces retain the last stroke across 671-690ms release delays', () => {
  const traces = [
    { x: 1577.87109375, y: 310.73046875, at: 0, up: 794, samples: [
      [1578.28515625, 288.91796875, 29], [1585.2890625, 193.3359375, 104],
    ] },
    { x: 1585.2890625, y: 193.3359375, at: 1179.4, up: 2002.1, samples: [
      [1585.2890625, 184.63671875, 1199.8], [1587.125, 140.3046875, 1266.5],
      [1587.125, 135.67578125, 1270.6], [1587.125, 114.06640625, 1303.9],
      [1586.8828125, 109.453125, 1320.7], [1586.62890625, 101.1640625, 1331.4],
    ] },
  ];
  for (const trace of traces) {
    for (const direction of [-1, 1]) {
      const drag = gestures.createLaunchpadDrag(trace.x, trace.y, trace.at);
      let position = 1000;
      for (const [x, y, at] of trace.samples) {
        drag.move(x, trace.y + (y - trace.y) * direction, at);
        position = drag.scrollPosition(position, 10000);
      }
      const last = trace.samples.at(-1)!;
      const immediate = drag.releaseVelocity(last[2]);
      // Real hook invokes move(..., false) for pointerup, including its unchanged coordinates.
      drag.move(last[0], trace.y + (last[1] - trace.y) * direction, trace.up, false);
      position = drag.scrollPosition(position, 10000);
      assert.equal(drag.releaseVelocity(trace.up), immediate);
      assert.ok(immediate * direction >= 0.65);
      const next = gestures.advanceLaunchpadInertia(position, drag.releaseVelocity(trace.up), 500, 10000);
      assert.ok((next.position - position) * direction > 80);
      drag.cancel();
      assert.equal(drag.releaseVelocity(trace.up + 1), 0, 'Cancellation still discards retained velocity');
    }
  }
});

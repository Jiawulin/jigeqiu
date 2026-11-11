export function rubberBand(distance: number, width: number): number {
  const limit = Math.min(96, Math.max(32, width * 0.12));
  return Math.sign(distance) * limit * (1 - Math.exp(-Math.abs(distance) * 0.45 / limit));
}

type DesktopGestureAction = 'search' | 'launchpad' | 'previous' | 'next';

export const DESKTOP_MOUSE_VERTICAL_DISTANCE = 36;
export const DESKTOP_MOUSE_FLICK_DISTANCE = 16;
export const DESKTOP_MOUSE_FLICK_SPEED = 0.25;

export function createDesktopGesture(start: {
  x: number; y: number; now: number; width: number; height: number; touch: boolean;
}) {
  const verticalThreshold = start.touch ? Math.min(104, Math.max(64, start.height * 0.105)) : DESKTOP_MOUSE_VERTICAL_DISTANCE;
  const horizontalThreshold = start.touch ? Math.max(55, Math.min(120, start.width * 0.18)) : 28;
  const samples = [{ x: start.x, y: start.y, at: start.now }];
  let peak = 0;
  let peakDirection = 0;
  let cancelled = false;
  let mouseAxisLocked = false;
  let horizontalMotionAt = start.now;
  const state = {
    dx: 0, dy: 0, axis: null as 'x' | 'y' | null, touch: start.touch,
    offsetY: 0, progress: 0,
    update(x: number, y: number, at: number) {
      const previous = samples[samples.length - 1];
      if (x !== previous.x) {
        horizontalMotionAt = at;
      }
      state.dx = x - start.x;
      state.dy = y - start.y;
      if ((!state.axis || (!start.touch && !mouseAxisLocked))
        && Math.max(Math.abs(state.dx), Math.abs(state.dy)) > (start.touch ? 10 : 8)) {
        const dominance = start.touch ? 1.25 : 1.15;
        const previousAxis = state.axis;
        if (!start.touch) state.axis = null;
        if (Math.abs(state.dx) > Math.abs(state.dy) * dominance) state.axis = 'x';
        else if (Math.abs(state.dy) > Math.abs(state.dx) * dominance) state.axis = 'y';
        if (!start.touch) {
          // Mouse startup jitter is provisional until there is deliberate travel.
          mouseAxisLocked = state.axis !== null && Math.max(Math.abs(state.dx), Math.abs(state.dy)) >= 36;
          if (state.axis !== previousAxis) { peak = 0; peakDirection = 0; }
        }
      }
      samples.push({ x, y, at });
      // Retain the sample bracketing the last 100ms rather than using whole-stroke speed.
      while (samples.length > 2 && samples[1].at < at - 100) samples.shift();
      const distance = state.axis === 'x' ? state.dx : state.axis === 'y' ? state.dy : 0;
      const retractionThreshold = start.touch ? 28 : verticalThreshold;
      if (peak >= retractionThreshold && (Math.sign(distance) !== peakDirection
        || peak - Math.abs(distance) >= (start.touch ? Math.max(18, peak * 0.18) : Math.max(12, peak * 0.25)))) cancelled = true;
      if (Math.sign(distance) !== peakDirection) { peak = 0; peakDirection = Math.sign(distance); }
      peak = Math.max(peak, Math.abs(distance));
      state.offsetY = start.touch && state.axis === 'y'
        ? Math.sign(state.dy) * 72 * (1 - Math.exp(-Math.abs(state.dy) / 180)) : 0;
      const verticalIntent = start.touch || Math.abs(state.dy) > Math.abs(state.dx) * 1.15;
      state.progress = !cancelled && state.axis === 'y' && verticalIntent
        ? Math.min(1, Math.abs(state.dy) / verticalThreshold) : 0;
    },
    finish(at: number, release?: { x: number; y: number }): DesktopGestureAction | null {
      if (release) state.update(release.x, release.y, at);
      if (!state.axis || cancelled) return null;
      const horizontal = state.axis === 'x';
      const distance = horizontal ? state.dx : state.dy;
      const magnitude = Math.abs(distance);
      if (!start.touch && magnitude <= Math.abs(horizontal ? state.dy : state.dx) * 1.15) return null;
      const last = samples[samples.length - 1];
      const first = samples.find(sample => sample.at >= at - 120) ?? last;
      const velocity = at - last.at > 100 ? 0
        : ((horizontal ? last.x - first.x : last.y - first.y) / Math.max(1, at - first.at));
      const flick = start.touch && magnitude >= (horizontal ? 32 : 28)
        && Math.sign(velocity) === Math.sign(distance) && Math.abs(velocity) >= 0.5;
      // Mouse release intent uses recent horizontal motion, not the whole drag or post-release events.
      const mouseFirst = samples.find(sample => sample.at >= at - 80) ?? last;
      const mouseVelocity = (last.x - mouseFirst.x) / Math.max(1, at - mouseFirst.at);
      const mouseFlick = !start.touch && horizontal && magnitude >= DESKTOP_MOUSE_FLICK_DISTANCE
        && at - horizontalMotionAt <= 60 && peak - magnitude <= 3
        && Math.sign(mouseVelocity) === Math.sign(distance) && Math.abs(mouseVelocity) >= DESKTOP_MOUSE_FLICK_SPEED;
      if (!flick && !mouseFlick && magnitude < (horizontal ? horizontalThreshold : verticalThreshold)) return null;
      return horizontal ? distance < 0 ? 'next' : 'previous' : distance < 0 ? 'launchpad' : 'search';
    },
  };
  return state;
}

export const WHEEL_GESTURE_IDLE_MS = 50;

export function createWheelGesture() {
  let last = -Infinity;
  let x = 0;
  let y = 0;
  let axis: 'x' | 'y' | null = null;
  let committed = false;
  let direction = 0;
  let peak = 0;
  let previousMagnitude = 0;
  let tailSamples = 0;
  let valley: number | null = null;
  let restart: { dx: number; dy: number; magnitude: number; direction: number; at: number } | null = null;
  const reset = () => {
    x = 0; y = 0; axis = null; committed = false;
    peak = 0; previousMagnitude = 0; tailSamples = 0; valley = null; restart = null;
  };
  return {
    update(dx: number, dy: number, now: number) {
      const gap = now - last;
      const magnitude = Math.max(Math.abs(dx), Math.abs(dy));
      // Small, decaying tail events do not become new swipes merely because they arrive sparsely.
      if (gap >= 240 || (gap >= WHEEL_GESTURE_IDLE_MS
        && (!committed || magnitude >= Math.max(12, previousMagnitude * 0.95)))) {
        reset();
      }
      last = now;
      if (committed) {
        const delta = axis === 'x' ? dx : dy;
        const primary = Math.abs(delta);
        const secondary = Math.abs(axis === 'x' ? dy : dx);
        peak = Math.max(peak, primary);
        const deliberate = primary >= 8 && primary > secondary * 1.2;
        const reversed = deliberate && Math.sign(delta) !== direction;
        const continuing = restart && now - restart.at <= 60 && deliberate
          && Math.sign(delta) === restart.direction && primary >= Math.max(8, restart.magnitude * 0.65);
        const confirmed = continuing && (reversed
          || (valley !== null && primary >= valley + Math.max(2, valley * 0.2)));
        if (confirmed) {
          const seed = restart!;
          reset();
          x = seed.dx; y = seed.dy;
        } else if (reversed && primary >= 48) {
          reset();
        } else {
          if (continuing) {
            restart = { ...restart!, dx: restart!.dx + dx, dy: restart!.dy + dy, magnitude: primary };
          } else {
            restart = deliberate && (reversed
              || (valley !== null && primary >= valley + Math.max(1, valley * 0.05)))
              ? { dx, dy, magnitude: primary, direction: Math.sign(delta), at: now } : null;
          }
          // Latch the decayed state: flat samples and gentle renewed effort must not disarm it.
          if (Math.sign(delta) === direction && primary > secondary * 1.2) {
            if (valley !== null) valley = Math.min(valley, primary);
            else {
              if (primary <= peak * 0.65 && primary < previousMagnitude * 0.95) tailSamples++;
              else if (primary > previousMagnitude * 1.05) tailSamples = 0;
              if (tailSamples >= 2) valley = primary;
            }
          }
          previousMagnitude = primary;
          return { step: 0, offset: 0 };
        }
      }
      x += dx;
      y += dy;
      peak = Math.max(peak, magnitude);
      previousMagnitude = magnitude;
      if (!axis && Math.max(Math.abs(x), Math.abs(y)) >= 8) {
        axis = Math.abs(x) > Math.abs(y) * 1.2 ? 'x' : 'y';
      }
      const distance = axis === 'x' ? x : axis === 'y' ? y : 0;
      if (Math.abs(distance) < 48) return { step: 0, offset: axis === 'x' ? -x : 0 };
      committed = true;
      direction = Math.sign(distance);
      return { step: direction, offset: 0 };
    },
  };
}

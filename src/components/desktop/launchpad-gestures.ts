import {
  DESKTOP_MOUSE_FLICK_DISTANCE, DESKTOP_MOUSE_FLICK_SPEED, DESKTOP_MOUSE_VERTICAL_DISTANCE,
} from './desktop-gestures';

export function createLaunchpadDrag(x: number, y: number, at: number) {
  const samples = [{ y, at }];
  let cancelled = false;
  let lastY = y;
  let intentStart = y;
  let intentEnd = y;
  let intentAt = at;
  let intentDirection = 0;
  return {
    dragging: false,
    deltaY: 0,
    move(nextX: number, nextY: number, now: number, samplePosition = true) {
      if (cancelled) return;
      const previousY = lastY;
      this.deltaY = 0;
      if (!this.dragging && Math.hypot(nextX - x, nextY - y) > 8) {
        this.dragging = true;
        this.deltaY = y - nextY - Math.max(-8, Math.min(8, y - nextY));
      } else if (this.dragging) this.deltaY = lastY - nextY;
      lastY = nextY;
      const last = samples.at(-1)!;
      if (!samplePosition) {
        if (intentDirection && intentDirection * (nextY - intentEnd) < -3) intentDirection = 0;
        return;
      }
      if (nextY === last.y || now < last.at) return;
      if (now - last.at >= 100) {
        samples.length = 0;
      }
      if (now - intentAt >= 200) {
        intentStart = intentEnd = previousY;
        intentDirection = 0;
      }
      const movement = nextY - intentEnd;
      if (intentDirection * movement > 0 || Math.abs(movement) > 3) {
        if (intentDirection && Math.sign(movement) !== intentDirection) intentStart = intentEnd;
        intentDirection = Math.sign(movement);
        intentEnd = nextY;
        intentAt = now;
      }
      if (samples.at(-1)?.at === now) samples[samples.length - 1] = { y: nextY, at: now };
      else samples.push({ y: nextY, at: now });
      while (samples.length > 2 && samples[1].at < now - 100) samples.shift();
    },
    velocity(now: number) {
      if (cancelled || !this.dragging) return 0;
      const end = samples.at(-1)!.at;
      const idle = Math.max(0, now - end);
      const start = Math.max(samples[0].at, end - 60);
      if (end <= start || idle >= 100) return 0;
      const recent = samples.filter(sample => sample.at >= start);
      const before = samples.filter(sample => sample.at < start).at(-1);
      if (before && recent[0]) recent.unshift({
        at: start, y: before.y + (recent[0].y - before.y) * (start - before.at) / (recent[0].at - before.at),
      });
      // Fit recent positions rather than a single event pair so release jitter does not jerk the fling.
      const meanTime = recent.reduce((sum, sample) => sum + sample.at - start, 0) / recent.length;
      const meanY = recent.reduce((sum, sample) => sum + sample.y, 0) / recent.length;
      let covariance = 0;
      let variance = 0;
      for (const sample of recent) {
        const time = sample.at - start - meanTime;
        covariance += time * (sample.y - meanY);
        variance += time * time;
      }
      // A brief release pause retains motion; a deliberate hold smoothly brings it to rest.
      const pause = Math.max(0, (idle - 40) / 60);
      const retention = 1 - pause * pause * (3 - 2 * pause);
      return variance && covariance ? Math.max(-8, Math.min(8, -covariance / variance)) * retention : 0;
    },
    releaseVelocity(now: number) {
      if (cancelled || !this.dragging || !intentDirection) return 0;
      const idle = Math.max(0, now - intentAt);
      if (idle >= 200) return 0;
      const distance = Math.abs(intentEnd - intentStart);
      const measured = this.velocity(samples.at(-1)!.at);
      const speed = Math.sign(measured) === -intentDirection ? Math.abs(measured) : 0;
      const committed = distance >= DESKTOP_MOUSE_VERTICAL_DISTANCE;
      const flick = distance >= DESKTOP_MOUSE_FLICK_DISTANCE && idle <= 60 && speed >= DESKTOP_MOUSE_FLICK_SPEED;
      if (!committed && !flick) return 0;
      // Distance intent, like desktop swipes, makes even a slow deliberate drag perceptible.
      const pause = Math.max(0, (idle - 80) / 120);
      const retention = 1 - pause * pause * (3 - 2 * pause);
      return -intentDirection * Math.max(0.65, speed) * retention;
    },
    scrollPosition(position: number, max: number) {
      const next = Math.max(0, Math.min(max, position + this.deltaY));
      // Activation slop at an edge is not an outward drag and must retain its intent.
      if (this.dragging && (next === 0 || next === max)) {
        samples.splice(0, samples.length - 1);
        intentStart = intentEnd = lastY;
        intentDirection = 0;
      }
      return next;
    },
    cancel() { cancelled = true; },
  };
}

export function advanceLaunchpadInertia(position: number, velocity: number, elapsed: number, max: number) {
  if (Math.abs(velocity) < 0.005) return { position, velocity: 0 };
  // Chromium FlingCurve's exponential drag, expressed in px/ms.
  const friction = 0.0037;
  const offset = 0.172;
  const initial = Math.abs(velocity);
  const duration = Math.min(Math.max(0, elapsed), Math.log1p(initial / offset) / friction);
  const decay = Math.exp(-friction * duration);
  const speed = Math.max(0, (initial + offset) * decay - offset);
  const distance = (initial + offset) * -Math.expm1(-friction * duration) / friction - offset * duration;
  const next = Math.max(0, Math.min(max, position + Math.sign(velocity) * distance));
  return { position: next, velocity: next === 0 || next === max || speed < 0.005 ? 0 : Math.sign(velocity) * speed };
}

export function launchpadLetterAt(y: number, cells: readonly { letter: string; center: number }[]): string | null {
  let closest: { letter: string; center: number } | undefined;
  for (const cell of cells) {
    if (!closest || Math.abs(y - cell.center) < Math.abs(y - closest.center)) closest = cell;
  }
  return closest?.letter ?? null;
}

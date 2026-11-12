type Kind = 'down' | 'move' | 'release' | 'cancel' | 'inertia' | 'end' | 'scroll';
type Reason = 'menu' | 'wheel' | 'key' | 'blur' | 'pointercancel' | 'lostpointercapture' | 'cleanup' | 'additional-pointer';
type Fields = {
  x?: number; y?: number; buttons?: number; top?: number; max?: number;
  velocity?: number; dragging?: boolean; captured?: boolean; delay?: number;
  reduced?: boolean; reason?: Reason; mouse?: boolean;
};
type Entry = Fields & { kind: Kind; at: number };

export function createLaunchpadGestureDebug(limit = 1500) {
  let active = false;
  let dropped = 0;
  let origin: number | undefined;
  const events: Entry[] = [];
  const read = () => ({ active, dropped, events: events.map(event => ({ ...event })) });
  return {
    start() { active = true; dropped = 0; origin = undefined; events.length = 0; },
    stop() { active = false; return read(); },
    read,
    record(kind: Kind, at: number, fields: Fields = {}) {
      if (!active) return;
      origin ??= at;
      const entry: Entry = { kind, at: at - origin };
      // Never retain event targets, text, bookmark identities or URLs.
      for (const key of ['x', 'y', 'buttons', 'top', 'max', 'velocity', 'delay'] as const) {
        if (typeof fields[key] === 'number' && Number.isFinite(fields[key])) entry[key] = fields[key];
      }
      for (const key of ['dragging', 'captured', 'reduced', 'mouse'] as const) {
        if (typeof fields[key] === 'boolean') entry[key] = fields[key];
      }
      if (fields.reason) entry.reason = fields.reason;
      if (events.length >= Math.max(1, limit)) { events.shift(); dropped++; }
      events.push(entry);
    },
  };
}

const debug = import.meta.env?.DEV ? createLaunchpadGestureDebug() : null;
if (debug && typeof window !== 'undefined') {
  Object.assign(window, { launchpadGestureDebug: {
    start: debug.start, stop: debug.stop, read: debug.read,
  } });
}
export function traceLaunchpadGesture(kind: Kind, fields: Fields = {}, at = performance.now()) {
  debug?.record(kind, at, fields);
}

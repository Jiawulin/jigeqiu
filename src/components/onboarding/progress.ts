export const ONBOARDING_KEY = 'jigeqiu_onboarding_v1';

export type OnboardingTask = 'import' | 'add' | 'pin';

export interface Progress {
  version: 1;
  welcomeShown: boolean;
  welcomeSkipped: boolean;
  tourCompleted: boolean;
  tasks: Record<OnboardingTask, boolean>;
  backupReminderShown: boolean;
}

export type ProgressPatch = Partial<Omit<Progress, 'tasks'>> & {
  tasks?: Partial<Progress['tasks']>;
};

export type ProgressStorage = Pick<Storage, 'getItem' | 'setItem' | 'length' | 'key'>;
export type ProgressError =
  | 'INVALID_RECORD'
  | 'INVALID_PATCH'
  | 'STORAGE_UNAVAILABLE'
  | 'LOCK_UNAVAILABLE'
  | 'WRITE_FAILED'
  | 'COMMIT_UNCERTAIN';

export interface ProgressReadResult {
  progress: Progress;
  /** False blocks this operation; true does not promise quota or future availability. */
  writable: boolean;
  /** Conservatively true when storage cannot be read. */
  exists: boolean;
  error?: ProgressError;
}

export interface ProgressWriteResult extends ProgressReadResult {
  ok: boolean;
}

export interface WelcomeClaimResult {
  claimed: boolean;
  progress?: Progress;
  error?: ProgressError;
}

const flags = ['welcomeShown', 'welcomeSkipped', 'tourCompleted', 'backupReminderShown'] as const;
const tasks: readonly OnboardingTask[] = ['import', 'add', 'pin'];
const fields = ['version', ...flags, 'tasks'];

function emptyProgress(): Progress {
  return {
    version: 1,
    welcomeShown: false,
    welcomeSkipped: false,
    tourCompleted: false,
    tasks: { import: false, add: false, pin: false },
    backupReminderShown: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key));
}

function isPatch(value: unknown): value is ProgressPatch {
  if (!isRecord(value) || !hasOnlyKeys(value, fields)) return false;
  if (Object.hasOwn(value, 'version') && value.version !== 1) return false;
  if (!flags.every(key => !Object.hasOwn(value, key) || typeof value[key] === 'boolean')) return false;
  if (Object.hasOwn(value, 'tasks')) {
    const taskPatch = value.tasks;
    if (!isRecord(taskPatch) || !hasOnlyKeys(taskPatch, tasks)) return false;
    if (!tasks.every(key => !Object.hasOwn(taskPatch, key) || typeof taskPatch[key] === 'boolean')) return false;
  }
  return true;
}

function isProgress(value: unknown): value is Progress {
  return isPatch(value) && value.version === 1
    && flags.every(key => Object.hasOwn(value, key))
    && isRecord(value.tasks) && tasks.every(key => Object.hasOwn(value.tasks!, key));
}

/** Null includes deleted storage events, damaged records, and unsupported schemas. */
export function parseProgress(raw: string | null): Progress | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isProgress(value) ? value : null;
  } catch {
    return null;
  }
}

/** Pure monotonic union. Invalid programmer input throws; persistence APIs return errors. */
export function mergeProgress(current: Progress, patch: ProgressPatch): Progress {
  if (!isProgress(current) || !isPatch(patch)) throw new TypeError('INVALID_PATCH');
  const merged: Progress = { ...current, tasks: { ...current.tasks } };
  for (const key of flags) merged[key] = current[key] || patch[key] === true;
  for (const key of tasks) merged.tasks[key] = current.tasks[key] || patch.tasks?.[key] === true;
  return merged;
}

export function readProgress(storage: ProgressStorage): ProgressReadResult {
  try {
    const raw = storage.getItem(ONBOARDING_KEY);
    if (raw === null) return { progress: emptyProgress(), writable: true, exists: false };
    const progress = parseProgress(raw);
    return progress
      ? { progress, writable: true, exists: true }
      : { progress: emptyProgress(), writable: false, exists: true, error: 'INVALID_RECORD' };
  } catch {
    return { progress: emptyProgress(), writable: false, exists: true, error: 'STORAGE_UNAVAILABLE' };
  }
}

export function writeProgress(storage: ProgressStorage, patch: ProgressPatch): ProgressWriteResult {
  // Re-read for every operation so a stale caller never resets already persisted flags.
  const prior = readProgress(storage);
  if (!prior.writable) return { ...prior, ok: false };
  let next: Progress;
  try {
    next = mergeProgress(prior.progress, patch);
  } catch {
    return { ...prior, ok: false, error: 'INVALID_PATCH' };
  }
  const raw = JSON.stringify(next);
  try {
    storage.setItem(ONBOARDING_KEY, raw);
  } catch {
    return { ...prior, writable: false, ok: false, error: 'WRITE_FAILED' };
  }
  try {
    if (storage.getItem(ONBOARDING_KEY) !== raw) {
      return { ...prior, writable: false, ok: false, error: 'COMMIT_UNCERTAIN' };
    }
  } catch {
    return { ...prior, writable: false, ok: false, error: 'COMMIT_UNCERTAIN' };
  }
  return { progress: next, writable: true, exists: true, ok: true };
}

/** Application writes must share this exclusive lock across tabs, including event merges. */
export async function updateProgressLocked(
  storage: ProgressStorage,
  patch: ProgressPatch,
  locks: Pick<LockManager, 'request'> | undefined,
  mutate: <T>(action: () => T) => Promise<T> = async action => action(),
): Promise<ProgressWriteResult> {
  const unavailable = (): ProgressWriteResult => ({
    ...readProgress(storage), writable: false, ok: false, error: 'LOCK_UNAVAILABLE',
  });
  if (!locks) return unavailable();
  try {
    return await locks.request('jigeqiu:onboarding-progress', { mode: 'exclusive' }, lock =>
      lock ? mutate(() => writeProgress(storage, patch)) : unavailable());
  } catch {
    return unavailable();
  }
}

/** Pre-screen eligibility before initializers; atomically claim the first welcome here. */
export async function claimWelcome(
  storage: ProgressStorage,
  locks: Pick<LockManager, 'request'> | undefined,
  mutate: <T>(action: () => T) => Promise<T> = async action => action(),
): Promise<WelcomeClaimResult> {
  const unavailable: WelcomeClaimResult = { claimed: false, error: 'LOCK_UNAVAILABLE' };
  if (!locks) return unavailable;
  try {
    return await locks.request(
      'jigeqiu:onboarding-progress',
      { mode: 'exclusive' },
      (lock) => mutate((): WelcomeClaimResult => {
        if (!lock) return unavailable;
        const current = readProgress(storage);
        if (current.error) return { claimed: false, error: current.error };
        if (current.exists) return { claimed: false, progress: current.progress };
        const result = writeProgress(storage, { welcomeShown: true });
        return result.ok
          ? { claimed: true, progress: result.progress }
          : { claimed: false, error: result.error };
      }),
    );
  } catch {
    return unavailable;
  }
}

export function createProgressStore(storage: ProgressStorage) {
  return {
    read: () => readProgress(storage),
    update: (patch: ProgressPatch) => writeProgress(storage, patch),
    merge: (external: Progress): ProgressWriteResult => {
      try {
        if (isProgress(external)) return writeProgress(storage, external);
      } catch {
        // Treat untrusted external objects just like malformed storage events.
      }
      return { ...readProgress(storage), ok: false, error: 'INVALID_PATCH' };
    },
  };
}

/** Call before application initializers can create library or preference records. */
export function detectNewUser(storage: ProgressStorage): boolean {
  try {
    if (storage.getItem(ONBOARDING_KEY) !== null) return false;
    const length = storage.length;
    if (!Number.isSafeInteger(length) || length < 0) return false;
    const seen = new Set<string>();
    for (let index = 0; index < length; index++) {
      const key = storage.key(index);
      if (typeof key !== 'string' || seen.has(key)) return false;
      seen.add(key);
      if (key === ONBOARDING_KEY || key.startsWith('jipage_')
        || key === 'jigeqiu_assets_v1' || /^jigeqiu[_-].*wallpaper/i.test(key)) return false;
    }
    // Fail closed if enumeration changed underneath the scan.
    return storage.length === length && storage.getItem(ONBOARDING_KEY) === null;
  } catch {
    return false;
  }
}

import type { ApplicationStorageDriver } from '../../src/services/application-storage';

export const STATE_KEY = 'jigeqiu-extension-state-v1';
const LOCK = 'jigeqiu:extension:storage';
type State = { version: 1; revision: number; data: Record<string, string> };
interface Dependencies {
  area: {
    get(key: string): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
  };
  locks: { request<T>(name: string, action: () => Promise<T>): Promise<T> };
  legacy(): Pick<Storage, 'length' | 'key' | 'getItem'>;
  changes: {
    addListener(listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void;
  };
}

function owned(key: string): boolean {
  return key.startsWith('jipage_') || key === 'jigeqiu_onboarding_v1'
    || key === 'jigeqiu.site-icons.third-party.v1'
    || key === 'jigeqiu-extension-privacy-acknowledged';
}

function parse(value: unknown): State {
  const state = value as State;
  if (!state || state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !state.data || typeof state.data !== 'object' || Array.isArray(state.data)
    || Object.entries(state.data).some(([key, value]) => !owned(key) || typeof value !== 'string')) {
    throw new Error('CORRUPT_DATA');
  }
  return structuredClone(state);
}

function writeError(cause: unknown): Error {
  return /quota|QUOTA/i.test(String(cause)) ? new DOMException('QUOTA_EXCEEDED', 'QuotaExceededError')
    : cause instanceof Error ? cause : new Error('STORAGE_UNAVAILABLE');
}

export function createExtensionStorage(deps: Dependencies): ApplicationStorageDriver & { initialize(): Promise<void> } {
  let state: State | undefined;
  let draft: Record<string, string> | undefined;
  let blocked: Error | undefined;
  let running = false;
  const data = () => {
    if (blocked) throw blocked;
    if (!state) throw new Error('STORAGE_UNAVAILABLE');
    return draft ?? state.data;
  };
  const writable = () => {
    if (!draft) throw new Error('MUTATION_REQUIRED');
    return draft;
  };
  const storage: Storage = {
    get length() { return Object.keys(data()).length; },
    key(index) { return Object.keys(data())[index] ?? null; },
    getItem(key) { return data()[key] ?? null; },
    setItem(key, value) {
      if (!owned(key)) throw new Error('INVALID_STORAGE_KEY');
      writable()[key] = String(value);
    },
    removeItem(key) { delete writable()[key]; },
    clear() { for (const key of Object.keys(writable())) delete writable()[key]; },
  };
  async function read(): Promise<State | undefined> {
    const result = await deps.area.get(STATE_KEY);
    return Object.hasOwn(result, STATE_KEY) ? parse(result[STATE_KEY]) : undefined;
  }
  function publish(next: State) {
    state = next;
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('application-storage-change'));
  }
  async function persist(next: State) {
    try { await deps.area.set({ [STATE_KEY]: next }); }
    catch (cause) { throw writeError(cause); }
    try {
      const saved = await read();
      if (!saved || saved.revision !== next.revision
        || Object.keys(saved.data).length !== Object.keys(next.data).length
        || Object.entries(next.data).some(([key, value]) => saved.data[key] !== value)) {
        throw new Error('COMMIT_UNCERTAIN');
      }
    } catch {
      blocked = new Error('COMMIT_UNCERTAIN');
      throw blocked;
    }
    publish(next);
  }
  return {
    storage,
    async initialize() {
      await deps.locks.request(LOCK, async () => {
        const saved = await read();
        if (saved) { state = saved; return; }
        const old = deps.legacy();
        const values: Record<string, string> = {};
        for (let i = 0; i < old.length; i++) {
          const key = old.key(i);
          if (!key || !owned(key)) continue;
          const value = old.getItem(key);
          if (value !== null) values[key] = value;
        }
        await persist({ version: 1, revision: 0, data: values });
      });
      deps.changes.addListener((changes, area) => {
        if (area !== 'local' || !Object.hasOwn(changes, STATE_KEY) || running) return;
        try {
          const next = parse(changes[STATE_KEY].newValue);
          if (!state || next.revision >= state.revision) publish(next);
        } catch {
          blocked = new Error('CORRUPT_DATA');
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('application-storage-change'));
        }
      });
    },
    async mutate<T>(action: () => T): Promise<T> {
      return deps.locks.request(LOCK, async () => {
        if (blocked) throw blocked;
        running = true;
        try {
          const current = await read();
          if (!current) throw new Error('CORRUPT_DATA');
          state = current;
          draft = { ...current.data };
          const result = action();
          if (result instanceof Promise) throw new Error('ASYNC_STORAGE_ACTION');
          const next = { version: 1 as const, revision: current.revision + 1, data: draft };
          draft = undefined;
          if (JSON.stringify(next.data) !== JSON.stringify(current.data)) await persist(next);
          return result;
        } finally {
          draft = undefined;
          running = false;
        }
      });
    },
  };
}

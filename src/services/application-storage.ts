import { recoverRestoreRecords, RESTORE_JOURNAL } from './restore-journal';

export interface ApplicationStorageDriver {
  storage: Storage;
  mutate<T>(action: () => T): Promise<T>;
}

let driver: ApplicationStorageDriver | undefined;

export function configureApplicationStorage(next: ApplicationStorageDriver | undefined): void {
  driver = next;
}

export function applicationStorage(): Storage {
  return driver?.storage ?? globalThis.localStorage;
}

export function hasApplicationStorageDriver(): boolean { return driver !== undefined; }

export function recoverApplicationRestore(): Promise<void> {
  const current = driver;
  return current ? current.mutate(() => recoverRestoreRecords(current.storage))
    : Promise.resolve().then(() => recoverRestoreRecords(applicationStorage()));
}

export function mutateStorage<T>(action: () => T): Promise<T> {
  if (applicationStorage() && applicationStorage().getItem(RESTORE_JOURNAL) !== null) {
    return Promise.reject(new Error('RESTORE_RECOVERY_REQUIRED'));
  }
  return driver ? driver.mutate(action) : Promise.resolve().then(action);
}

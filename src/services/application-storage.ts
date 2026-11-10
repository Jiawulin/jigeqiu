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

export function mutateStorage<T>(action: () => T): Promise<T> {
  return driver ? driver.mutate(action) : Promise.resolve().then(action);
}

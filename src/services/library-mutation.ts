import { storage } from './storage';

/** Publish only after persistence has acknowledged the complete command. */
export async function commitAndRefresh<T>(commit: () => T, refresh?: () => void): Promise<T> {
  const result = await storage.mutate(commit);
  try {
    refresh?.();
  } catch {
    // Persistence already succeeded; do not tell callers to retry an unsaved command.
    throw new Error('COMMIT_UNCERTAIN');
  }
  return result;
}

export const RESTORE_JOURNAL = 'jipage_workbench_restore_v1';
export interface RestoreRecord { key: string; before: string | null; after: string | null }
const allowed = new Set(['jipage_library_v2', 'jipage_search_engines_v1', 'jipage_settings_v1']);
function write(store: Storage, key: string, value: string | null) {
  if (value === null) store.removeItem(key);
  else store.setItem(key, value);
  if (store.getItem(key) !== value) throw new Error('COMMIT_UNCERTAIN');
}
function records(value: unknown): RestoreRecord[] {
  const journal = value as { version?: unknown; records?: RestoreRecord[] } | null;
  if (!journal || journal.version !== 1 || !Array.isArray(journal.records) || !journal.records.length
    || new Set(journal.records.map(r => r?.key)).size !== journal.records.length
    || journal.records.some(r => !r || !allowed.has(r.key)
      || ![r.before, r.after].every(v => v === null || typeof v === 'string'))) throw new Error('RESTORE_RECOVERY_REQUIRED');
  return journal.records;
}
export function recoverRestoreRecords(store: Storage): void {
  const raw = store.getItem(RESTORE_JOURNAL);
  if (raw === null) return;
  let pending: RestoreRecord[];
  try { pending = records(JSON.parse(raw)); } catch { throw new Error('RESTORE_RECOVERY_REQUIRED'); }
  // Check every record before reverting any: never overwrite an unrelated writer.
  if (pending.some(r => ![r.before, r.after].includes(store.getItem(r.key)))) throw new Error('RESTORE_RECOVERY_REQUIRED');
  try {
    for (const r of [...pending].reverse()) {
      const current = store.getItem(r.key);
      if (current !== r.before && current !== r.after) throw new Error('RESTORE_RECOVERY_REQUIRED');
      if (current === r.after) write(store, r.key, r.before);
    }
    if (pending.some(r => store.getItem(r.key) !== r.before)) throw new Error('RESTORE_RECOVERY_REQUIRED');
    write(store, RESTORE_JOURNAL, null);
  } catch { throw new Error('RESTORE_RECOVERY_REQUIRED'); }
}
export function commitRestoreRecords(store: Storage, changes: RestoreRecord[], journal = true): void {
  records({ version: 1, records: changes });
  if (store.getItem(RESTORE_JOURNAL) !== null) throw new Error('RESTORE_RECOVERY_REQUIRED');
  if (changes.some(r => store.getItem(r.key) !== r.before)) throw new Error('CONFLICT');
  if (journal) write(store, RESTORE_JOURNAL, JSON.stringify({ version: 1, records: changes }));
  try {
    for (const r of changes) {
      if (store.getItem(r.key) !== r.before) throw new Error('CONFLICT');
      write(store, r.key, r.after);
    }
    if (changes.some(r => store.getItem(r.key) !== r.after)) throw new Error('COMMIT_UNCERTAIN');
    if (journal) write(store, RESTORE_JOURNAL, null);
  } catch (cause) {
    if (journal) recoverRestoreRecords(store);
    throw cause;
  }
}

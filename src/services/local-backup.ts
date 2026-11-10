import { applicationStorage } from './application-storage';

// Emergency backup keeps raw values, including settings, without interpreting or repairing them.
export function downloadRawLocalBackup(filename: string): void {
  const localStorage = applicationStorage();
  const data: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith('jipage_')) data[key] = localStorage.getItem(key)!;
  }
  const blob = new Blob([JSON.stringify({
    format: 'jipage-raw-local-backup', exportedAt: new Date().toISOString(), data,
  }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

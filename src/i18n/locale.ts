import type { Locale } from './index';

export function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

export function selectLocale(saved?: unknown, preferences = browserLanguages()): Locale {
  if (typeof saved === 'string' && saved.trim()) {
    return /^en(?:-|$)/i.test(saved) ? 'en' : 'zh';
  }
  for (const language of preferences) {
    if (/^en(?:-|$)/i.test(language)) return 'en';
    if (/^zh(?:-|$)/i.test(language)) return 'zh';
  }
  return 'zh';
}

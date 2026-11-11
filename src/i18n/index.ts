export type Locale = 'zh' | 'en';
export type MessageTable = Record<string, { zh: string; en: string }>;

type Slots<S extends string> = S extends `${string}{${infer Key}}${infer Rest}` ? Key | Slots<Rest> : never;
type MessageCatalog = typeof catalog;
export type MessageKey = keyof MessageCatalog;
type ParametersFor<K extends MessageKey> = Slots<MessageCatalog[K]['en']>;
type ValuesFor<K extends MessageKey> = [ParametersFor<K>] extends [never]
  ? [] : [values: Record<ParametersFor<K>, string | number>];

import { bookmarkMessages } from './bookmarks';
import { dataTransferMessages } from './data-transfer';
import { guideMessages } from './guide';
import { iconSettingsMessages } from './icon-settings';
import { libraryActionMessages } from './library-actions';
import { libraryNoticeMessages } from './library-notice';
import { managementMessages } from './management';
import { navigationMessages } from './navigation';
import { saveErrorMessages } from './save-errors';
import { siteIconMessages } from './site-icons';
import { spotlightMessages } from './spotlight';
import { trashMessages } from './trash';
import { wallpaperMessages } from './wallpaper';
import { searchPresetMessages } from './search-presets';
import { tipMessages } from './tips';
import { onboardingMessages } from './onboarding';
import { extensionMessages } from './extension';

const catalog = {
  ...bookmarkMessages,
  ...dataTransferMessages,
  ...guideMessages,
  ...iconSettingsMessages,
  ...libraryActionMessages,
  ...libraryNoticeMessages,
  ...managementMessages,
  ...navigationMessages,
  ...saveErrorMessages,
  ...siteIconMessages,
  ...spotlightMessages,
  ...trashMessages,
  ...wallpaperMessages,
  ...searchPresetMessages,
  ...tipMessages,
  ...onboardingMessages,
  ...extensionMessages,
} as const satisfies MessageTable;

export const messages = {
  zh: Object.fromEntries(Object.entries(catalog).map(([key, value]) => [key, value.zh])),
  en: Object.fromEntries(Object.entries(catalog).map(([key, value]) => [key, value.en])),
} as Record<Locale, Record<MessageKey, string>>;

const namedParameters = (value: string) =>
  [...new Set([...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();
for (const [key, value] of Object.entries(catalog)) {
  if (!value.zh.trim() || !value.en.trim()) throw new Error(`I18N_EMPTY_MESSAGE:${key}`);
  if (JSON.stringify(namedParameters(value.zh)) !== JSON.stringify(namedParameters(value.en))) {
    throw new Error(`I18N_PARAMETER_MISMATCH:${key}`);
  }
}

export function resolveLocale(language?: string): Locale {
  return language?.toLowerCase().startsWith('en') ? 'en' : 'zh';
}

export function createTranslator(language?: string) {
  const locale = resolveLocale(language);
  return function translate<K extends MessageKey>(key: K, ...args: ValuesFor<K>): string {
    const values = args[0] as Record<string, string | number> | undefined;
    return messages[locale][key].replace(/\{(\w+)\}/g, (slot, name: string) =>
      values && Object.hasOwn(values, name) ? String(values[name]) : slot);
  };
}

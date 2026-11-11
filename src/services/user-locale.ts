import { selectLocale } from '../i18n/locale';
import { applicationStorage } from './application-storage';

export const USER_SETTINGS_KEY = 'jipage_settings_v1';

// Reading the language must not initialize assets or persist a detected default.
export function readUserLocale(preferences?: readonly string[]) {
  try {
    const saved: unknown = JSON.parse(applicationStorage().getItem(USER_SETTINGS_KEY) ?? 'null');
    return selectLocale(
      saved && typeof saved === 'object' && 'language' in saved ? saved.language : undefined,
      preferences,
    );
  } catch {
    return selectLocale(undefined, preferences);
  }
}

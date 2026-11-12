import type { MessageTable } from './index';

export const iconSettingsMessages = {
  iconSettingsTitle: { zh: '网站图标', en: 'Website icons' },
  iconSettingsLocalCache: { zh: '图标仅缓存在本机，清除后按需从对应网站重新获取。', en: 'Icons are cached locally and fetched from their websites again when needed after clearing.' },
  iconSettingsCleared: { zh: '图标缓存已清除，收藏数据未改变', en: 'Icon cache cleared. Bookmarks unchanged.' },
  iconSettingsClearFailed: { zh: '图标缓存未能完全清除，收藏数据未改变', en: 'Could not fully clear the icon cache. Bookmarks unchanged.' },
  iconSettingsClear: { zh: '清除图标缓存', en: 'Clear icon cache' },
} as const satisfies MessageTable;

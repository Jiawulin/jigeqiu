export type Visibility = 'private' | 'public' | 'unlisted';
export type SiteIconMode = 'auto' | 'custom' | 'text';

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  domain: string;
  icon?: string;
  iconMode?: SiteIconMode;
  assetIcon?: import('../domain/assets/model').Icon;
  iconBg?: string;
  category: string; // Category ID
  tags?: string[];
  notes?: string;
  keywords?: string[];
  publicNotes?: string;
  isPublicNotes?: boolean;
  folderId?: string; // Optional folder ID on desktop
  pinnedToDesktop: boolean;
  order: number;
  collectionIds: string[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  isBroken?: boolean;
}

export interface Folder {
  id: string;
  name: string;
  parentId?: string; // Multi-level nested subfolders
  bookmarkIds: string[];
  pinnedToDesktop: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  order: number;
  isDefault?: boolean;
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
  createdAt: number;
}

export interface CollectionItem {
  bookmarkId: string;
  title: string;
  url: string;
  domain: string;
  icon?: string;
  iconMode?: SiteIconMode;
  iconBg?: string;
  recommendationReason?: string;
  order: number;
}

export interface Collection {
  id: string;
  title: string;
  description: string;
  coverGradient?: string;
  category: string;
  tags?: string[];
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  items: CollectionItem[];
  visibility: Visibility;
  isPinnedToDesktop: boolean;
  isFavorited?: boolean;
  isCloned?: boolean;
  clonedFromId?: string;
  createdAt: number;
  updatedAt: number;
  assetContent?: Pick<import('../domain/assets/model').Collection, 'cover' | 'provenance' | 'sections'>;
}

export interface SearchEngine {
  id: string;
  name: string;
  icon?: string;
  keyword: string;
  urlTemplate: string; // e.g. "https://www.google.com/search?q={query}"
  isDefault?: boolean;
  isEnabled?: boolean; // Can be stopped / disabled like Alfred!
  isCustom?: boolean;
}

export interface Plugin {
  id: string;
  name: string;
  icon: string;
  author: string;
  description: string;
  version: string;
  githubUrl: string;
  permissions: string[];
  installed: boolean;
  pinnedToDesktop: boolean;
  updatedAt: string;
  instructions: string;
  isBuiltInTool?: boolean;
  toolType?: 'calculator' | 'json-formatter' | 'word-counter';
}

export type SubmissionStatus = 'draft' | 'pending' | 'needs_info' | 'approved' | 'featured' | 'rejected';

export interface Submission {
  id: string;
  type: 'site' | 'collection';
  title: string;
  url?: string;
  description: string;
  category: string;
  tags?: string[];
  recommendationReason: string;
  targetAudience?: string;
  notes?: string;
  status: SubmissionStatus;
  isAiDraft?: boolean;
  reviewNotes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlatformSite {
  id: string;
  title: string;
  url: string;
  domain: string;
  icon?: string;
  iconBg?: string;
  category: string;
  tags?: string[];
  tagline: string;
  description: string;
  recommendationReason: string;
  targetAudience: string;
  featured: boolean;
  relatedCollectionIds: string[];
  similarSiteIds?: string[];
  viewCount: number;
  favoriteCount: number;
}

export interface DailyRecommendation {
  id: string;
  date: string; // YYYY-MM-DD
  theme: string;
  title: string;
  siteId?: string;
  collectionId?: string;
  summary: string;
  editorNote: string;
  coverImage?: string;
}

export interface PublicUser {
  id: string;
  name: string;
  avatar: string;
  bio: string;
  website?: string;
  following?: boolean;
  createdCollectionIds: string[];
}

export interface DesktopAppWindow {
  id: string;
  bookmarkId?: string;
  title: string;
  url: string;
  iconBg?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
}

export type DesktopViewMode = 'icon' | 'category' | 'list';
export type AppearanceMode = 'light-glass' | 'dark-glass' | 'reduced-transparency';
export type WallpaperPreset = 'cyan-lake' | 'snow-mountain' | 'misty-mountains' | 'corner-tower' | 'green-lake' | 'arch-sky' | 'coastal-dusk' | 'botanic-sage' | 'custom';
// Retained for older saved preferences; rendering always uses cover.
export type WallpaperFit = 'contain' | 'cover';

export interface UserSettings {
  appearanceMode: AppearanceMode;
  wallpaperPreset: WallpaperPreset;
  customWallpaperId?: string;
  customWallpaperFit?: WallpaperFit;
  desktopViewMode: DesktopViewMode;
  defaultSearchEngineId: string;
  confirmBatchOpen: boolean;
  reduceMotion: boolean;
  dockBookmarkIds?: string[];
  language?: 'zh' | 'en';
  // macOS Dock settings
  showDock?: boolean; // whether bottom dock is visible (default: true)
  dockIconSize?: number; // base size in pixels: 34 ~ 74 (default 48)
  dockMagnification?: boolean;
  dockMagnificationScale?: number;
  dockAutoHide?: boolean;
}

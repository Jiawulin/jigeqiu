import React, { useEffect, useLayoutEffect, useState } from 'react';
import { readWallpaper, subscribeWallpaperChange, visibleWallpaper } from '../../services/custom-wallpaper';
import { WallpaperPreset, AppearanceMode } from '../../types';
import './wallpaper.css';

interface WallpaperBackgroundProps {
  preset: WallpaperPreset;
  appearance: AppearanceMode;
  customWallpaperId?: string;
  children: React.ReactNode;
}

export const WallpaperBackground: React.FC<WallpaperBackgroundProps> = ({
  preset,
  appearance,
  children,
  customWallpaperId,
}) => {
  const [custom, setCustom] = useState<{ id: string; url: string } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribeWallpaperChange(() => setRevision(value => value + 1)), []);
  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    if (preset === 'custom' && customWallpaperId) {
      void readWallpaper(customWallpaperId).then(blob => {
        if (cancelled) return;
        if (!blob) { setCustom(null); return; }
        url = URL.createObjectURL(blob);
        setCustom({ id: customWallpaperId, url });
      }).catch(() => { if (!cancelled) setCustom(null); });
    }
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [preset, customWallpaperId, revision]);
  const customUrl = preset === 'custom' && custom && custom.id === customWallpaperId ? custom.url : undefined;
  const isDark = appearance === 'dark-glass';
  const isReduced = appearance === 'reduced-transparency';

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', isDark);
    root.classList.toggle('dark-glass', isDark);
    root.classList.toggle('reduced-transparency', isReduced);
  }, [isDark, isReduced]);

  return (
    <div data-wallpaper={visibleWallpaper(preset)} data-custom-wallpaper={customUrl ? '' : undefined}
      style={customUrl ? {
        '--wallpaper-image': `url("${customUrl}")`,
        '--wallpaper-base': '#24282a',
      } as React.CSSProperties : undefined} className="wallpaper-root relative isolate min-h-screen w-full overflow-x-hidden">
      <div data-wallpaper-canvas="" aria-hidden="true" className="wallpaper-canvas fixed inset-0 -z-20 pointer-events-none" />
      <div data-wallpaper-scrim="" aria-hidden="true" className="wallpaper-scrim fixed inset-0 -z-10 pointer-events-none" />
      <div className="relative min-h-screen flex flex-col">{children}</div>
    </div>
  );
};

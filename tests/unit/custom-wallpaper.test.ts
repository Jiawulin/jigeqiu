import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWallpaper, visibleWallpaper, WALLPAPER_MAX_BYTES } from '../../src/services/custom-wallpaper';

test('custom wallpapers accept bounded raster files only', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
    assert.doesNotThrow(() => validateWallpaper({ type, size: 100 }));
  }
  for (const type of ['image/svg+xml', 'text/html', 'image/gif', '']) {
    assert.throws(() => validateWallpaper({ type, size: 100 }), /WALLPAPER_FORMAT/);
  }
  for (const size of [0, WALLPAPER_MAX_BYTES + 1]) {
    assert.throws(() => validateWallpaper({ type: 'image/png', size }), /WALLPAPER_SIZE/);
  }
});

test('removed presets and missing custom image use the first built-in fallback', () => {
  for (const preset of ['cyan-lake', 'arch-sky', 'coastal-dusk', 'botanic-sage', 'custom', 'unknown']) {
    assert.equal(visibleWallpaper(preset), 'snow-mountain');
  }
  for (const preset of ['snow-mountain', 'misty-mountains', 'corner-tower', 'green-lake']) {
    assert.equal(visibleWallpaper(preset), preset);
  }
});

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

const presets = ['snow-mountain', 'misty-mountains', 'corner-tower', 'green-lake'];
const css = readFileSync(new URL('../../src/components/common/wallpaper.css', import.meta.url), 'utf8');

test('each wallpaper has high-resolution desktop and portrait assets with lightweight thumbnails', () => {
  for (const preset of presets) {
    for (const [suffix, maxBytes, minWidth] of [['desktop', 3_500_000, 3000], ['mobile', 700_000, 1000], ['thumb', 15_000, 320]] as const) {
      const path = new URL(`../../public/wallpapers/${preset}-${suffix}.webp`, import.meta.url);
      assert.ok(statSync(path).size <= maxBytes, `${preset}-${suffix} stays in its byte budget`);
      const bytes = readFileSync(path);
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
      const frame = bytes.indexOf(Buffer.from([0x9d, 0x01, 0x2a]));
      assert.ok(frame >= 0, 'Lossy WebP has a VP8 frame header');
      const width = bytes.readUInt16LE(frame + 3) & 0x3fff;
      assert.ok(width >= minWidth, `${preset}-${suffix} has enough pixels (${width})`);
      assert.ok(css.includes(`/wallpapers/${preset}-${suffix}.webp?v=2`), 'New assets have a cache revision');
    }
  }
});

test('wallpaper credits include every distributed source rather than using remote runtime URLs', () => {
  const credits = readFileSync(new URL('../../public/wallpapers/CREDITS.md', import.meta.url), 'utf8');
  for (const preset of presets) assert.ok(credits.includes(preset));
  assert.ok(credits.includes('https://www.pexels.com/license/'));
  assert.ok(credits.includes('https://unsplash.com/license'));
  for (const id of ['gdE-5Oui1Y0', 'L7B3VHgOoVM', 'b_BCfhShIr0']) assert.ok(credits.includes(id));
  assert.doesNotMatch(css, /url\(["']?https?:/);
});

test('removed lake is not distributed or requested by wallpaper styles', () => {
  assert.doesNotMatch(css, /cyan-lake/);
  for (const suffix of ['desktop', 'mobile', 'thumb']) {
    assert.equal(existsSync(new URL(`../../public/wallpapers/cyan-lake-${suffix}.webp`, import.meta.url)), false);
  }
});

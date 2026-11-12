import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// Source dimensions are native maxima; never upscale to advertise more detail.
const inputDirectory = resolve(process.argv[2] ?? '/tmp');
const outputDirectory = resolve('public/wallpapers');
const wallpapers = [
  { id: 'snow-mountain', source: 'jigeqiu-snow-hi.jpg', native: [3840, 1919], mobile: [1350, 0, 1278, 1918] },
  { id: 'misty-mountains', source: 'alessio-soggetti-gdE-5Oui1Y0-unsplash.jpg', native: [5832, 3893], mobile: [1618, 0, 2594, 3891] },
  { id: 'corner-tower', source: 'zixi-zhou-L7B3VHgOoVM-unsplash.jpg', native: [4001, 2662], mobile: [1112, 0, 1774, 2661] },
  { id: 'green-lake', source: 'adem-percem-b_BCfhShIr0-unsplash.jpg', native: [6016, 3904], mobile: [2080, 0, 2602, 3903] },
];
mkdirSync(outputDirectory, { recursive: true });
for (const wallpaper of wallpapers) {
  const source = resolve(inputDirectory, wallpaper.source);
  if (!existsSync(source)) {
    if (wallpaper.id === 'snow-mountain'
      && ['desktop', 'mobile', 'thumb'].every(variant => existsSync(resolve(outputDirectory, `${wallpaper.id}-${variant}.webp`)))) continue;
    throw new Error(`Source image missing: ${source}`);
  }
  for (const [variant, width, quality, maxBytes] of [
    ['desktop', 3840, 88, 3_500_000], ['mobile', 1200, 85, 700_000], ['thumb', 320, 65, 15_000],
  ]) {
    const output = resolve(outputDirectory, `${wallpaper.id}-${variant}.webp`);
    const crop = variant === 'mobile' ? wallpaper.mobile : [0, 0, ...wallpaper.native];
    let bytes;
    for (let q = quality; q >= 40; q -= 5) {
      execFileSync('cwebp', [
        '-quiet', '-m', '6', '-q', String(q), '-metadata', 'none',
        '-crop', ...crop.map(String), '-resize', String(Math.min(width, crop[2])), '0',
        source, '-o', output,
      ]);
      bytes = statSync(output).size;
      if (bytes <= maxBytes) break;
    }
    if (bytes > maxBytes) throw new Error(`${output} exceeds ${maxBytes} bytes (${bytes})`);
    console.log(`${wallpaper.id}-${variant}.webp: ${(bytes / 1024).toFixed(1)} KiB`);
  }
}

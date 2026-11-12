export function layoutCases(env = process.env) {
  if (env.TEST_MATRIX === '1') {
    return ['zh', 'en'].flatMap(language => ['light-glass', 'dark-glass'].flatMap(appearanceMode =>
      [1440, 390, 320].map(width => ({ language, appearanceMode, width }))));
  }
  return [
    { language: 'zh', appearanceMode: 'light-glass', width: 1440 },
    { language: 'en', appearanceMode: 'dark-glass', width: 320 },
    { language: 'zh', appearanceMode: 'dark-glass', width: 390 },
    { language: 'en', appearanceMode: 'light-glass', width: 1440 },
  ];
}

export function captureScreenshots(env = process.env) {
  return env.TEST_SCREENSHOTS === '1' || env.TEST_MATRIX === '1';
}

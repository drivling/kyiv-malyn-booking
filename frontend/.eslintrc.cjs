/* Конфіг для `npm run lint` (ESLint 8, flat-config ще не використовуємо через плагіни v6). */
module.exports = {
  root: true,
  env: { browser: true, es2020: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: [
    'dist',
    'legacy',
    'coverage',
    'test-results',
    'playwright-report',
    'node_modules',
    '.eslintrc.cjs',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
  },
  overrides: [
    {
      files: ['*.test.ts', '*.test.tsx', 'e2e/**/*.ts', 'scripts/**/*.mjs'],
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
    {
      // Успадкований код: залежності хуків тут навмисно неповні (перерахунок ламає UX),
      // а великі сторінки експортують і компоненти, і хелпери. Правила лишаються
      // увімкненими для всього нового коду — тут вимкнені точково, до рефакторингу.
      files: [
        'src/components/Combobox/Combobox.tsx',
        'src/components/TelegramLoginButton/TelegramLoginButton.tsx',
        'src/pages/AdminPage/AdminPage.tsx',
        'src/pages/BookingPage/BookingPage.tsx',
        'src/pages/LocalTransportPage/LocalTransportPage.tsx',
        'src/pages/LocalTransportPage/LocalTransportStopBoardPage.tsx',
        'src/test/utils.tsx',
      ],
      rules: {
        'react-hooks/exhaustive-deps': 'off',
        'react-refresh/only-export-components': 'off',
      },
    },
  ],
};

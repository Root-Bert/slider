import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Across features only the public API (`@/features/<f>`, its `index.ts`) may be imported. */
const DEEP_FEATURE_IMPORT = {
  group: ['@/features/*/**'],
  message: 'Import another feature only via its public API: `@/features/<feature>` (index.ts).',
};
/** `app/` is wiring only; nothing below it may depend on it. */
const APP_IMPORT = {
  group: ['@/app', '@/app/**'],
  message: '`app/` is wiring only – move what you need to lib/, ui/ or shell/.',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist',
      '**/node_modules',
      '**/.data',
      'apps/api/drizzle',
      'figma-scripts',
      '.claude',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Route modules export `Component` by React Router convention.
      'react-refresh/only-export-components': ['warn', { allowExportNames: ['Component'] }],
    },
  },
  // Import boundaries of the web app (docs/design-system.md §11).
  {
    files: ['apps/web/src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [DEEP_FEATURE_IMPORT, APP_IMPORT] }],
    },
  },
  {
    files: ['apps/web/src/app/**/*.{ts,tsx}'],
    // The router imports the route pages directly, so each keeps its own lazy chunk.
    ignores: ['apps/web/src/app/router.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [DEEP_FEATURE_IMPORT] }],
    },
  },
  {
    files: ['apps/web/src/shell/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [DEEP_FEATURE_IMPORT, APP_IMPORT] }],
    },
  },
  {
    files: ['apps/web/src/ui/**/*.{ts,tsx}', 'apps/web/src/lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            APP_IMPORT,
            {
              group: ['@/features', '@/features/**', '@/shell', '@/shell/**'],
              message:
                'ui/ and lib/ are app-wide building blocks and never import features or the shell.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
);

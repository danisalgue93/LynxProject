import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Syntactic (non-type-checked) recommended rules plus the React Hooks rules,
// which catch real defects: hooks called conditionally and missing/incorrect
// effect dependencies. no-explicit-any is a warning — the existing `any`s are a
// gradual typing job, not bugs.
export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/', '*.config.js', '*.config.ts', 'server.ts', 'empty-module.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // The two React Hooks rules that catch real defects, referenced directly so
      // this works across the plugin's flat/legacy config shapes.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);

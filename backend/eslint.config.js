import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Syntactic (non-type-checked) recommended rules. This is a deliberate baseline:
// it catches real defects — unused vars, unsafe declaration merging, fallthrough,
// misused promises at the syntax level — without the churn of the type-checked
// ruleset, which can come later once this is green.
export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'prisma/generated/', 'coverage/', '*.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Allow intentionally-unused args/vars when prefixed with _ (common for
      // Express middleware signatures like (req, res, next)).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Existing code has ~130 `any`s (error boundaries, external-lib seams).
      // Typing them properly is a gradual refactor, not a bug fix, so keep this a
      // warning: visible, tracked, but not blocking the error-clean baseline.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);

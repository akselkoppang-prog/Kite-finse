import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Bevisst smalt regelsett: feil som gir reelle bugs (hook-regler, ubrukte variabler, farlige mønstre).
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'tests/e2e', 'public/sw.js', 'version.json'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  },
  { files: ['scripts/**/*.mjs', '*.config.{js,ts}', 'public/sw.js'], languageOptions: { globals: { ...globals.node, ...globals.serviceworker } } },
);

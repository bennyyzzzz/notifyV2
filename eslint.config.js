// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/src/generated/**', 'docs/api/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // Spreading request bodies into persistence calls caused V1-07 (mass assignment).
      'no-restricted-syntax': [
        'error',
        {
          selector: "SpreadElement > MemberExpression[object.name=/^(req|request)$/][property.name='body']",
          message: 'Nunca espalhe o body da requisição (V1-07). Mapeie campos explicitamente a partir do schema validado.',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['**/scripts/**/*.ts', '**/cli/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);

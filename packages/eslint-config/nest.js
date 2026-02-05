import jestPlugin from 'eslint-plugin-jest'

import baseConfig from './base.js'

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: {
        // Node.js globals
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
      },
    },
    rules: {
      // === NestJS specific ===
      // Disable consistent-type-imports for NestJS (DI uses classes at runtime via reflection)
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-import-type-side-effects': 'off',

      // Allow empty constructors (Dependency Injection)
      'no-useless-constructor': 'off',
      '@typescript-eslint/no-useless-constructor': 'off',

      // Allow parameter properties in constructors
      'no-empty-function': 'off',
      '@typescript-eslint/no-empty-function': ['error', { allow: ['constructors'] }],

      // === Stricter TypeScript for backend ===
      '@typescript-eslint/no-explicit-any': 'error', // Stricter than base (warn)
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'no-public' }, // Don't require 'public' keyword
      ],
      '@typescript-eslint/no-floating-promises': 'off', // Enable if using project-aware parsing
      '@typescript-eslint/await-thenable': 'off', // Enable if using project-aware parsing

      // === Code quality ===
      // TODO: Enable these rules when type-aware parsing is configured
      // See: https://typescript-eslint.io/getting-started/typed-linting
      'no-return-await': 'off',
      '@typescript-eslint/return-await': 'off', // Useful for try-catch, needs parserOptions.project
      '@typescript-eslint/no-unnecessary-condition': 'off', // Enable if using project-aware parsing
      '@typescript-eslint/prefer-nullish-coalescing': 'off', // Enable if using project-aware parsing

      // === Security ===
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    // Test files - use Jest plugin recommended config
    files: ['**/*.spec.ts', '**/*.test.ts', '**/*.e2e-spec.ts'],
    ...jestPlugin.configs['flat/recommended'],
    rules: {
      ...jestPlugin.configs['flat/recommended'].rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-console': 'off',
    },
  },
]

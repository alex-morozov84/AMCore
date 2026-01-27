import baseConfig from './base.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // React/Next.js specific
      'react/react-in-jsx-scope': 'off', // Not needed in Next.js
      'react/prop-types': 'off', // Using TypeScript
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      // JSX specific
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];

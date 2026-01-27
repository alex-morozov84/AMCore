import baseConfig from '@amcore/eslint-config/base';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...baseConfig,
  {
    ignores: ['apps/**', 'packages/**'],
  },
];

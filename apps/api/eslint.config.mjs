import nestConfig from '@amcore/eslint-config/nest';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...nestConfig,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nestjs/common',
              importNames: ['Logger'],
              message:
                'Use PinoLogger from nestjs-pino via dependency injection in runtime API code.',
            },
          ],
        },
      ],
    },
  },
];

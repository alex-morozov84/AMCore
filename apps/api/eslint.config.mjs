import nestConfig from '@amcore/eslint-config/nest';

const bannedExceptionImports = [
  'UnauthorizedException',
  'BadRequestException',
  'NotFoundException',
  'ForbiddenException',
  'ConflictException',
  'InternalServerErrorException',
];

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...nestConfig,
  {
    ignores: ['src/generated/prisma/**'],
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nestjs/common',
              importNames: ['Logger', ...bannedExceptionImports],
              message:
                'Use PinoLogger via DI for logging, and domain exceptions from common/exceptions (or AppException with an explicit errorCode) instead of raw NestJS HttpException subclasses.',
            },
          ],
        },
      ],
    },
  },
  {
    // Exception filters and their tests must reference raw NestJS HttpException
    // subclasses because the framework still throws them; only the Logger ban applies here.
    files: ['src/common/exceptions/**/*.ts'],
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

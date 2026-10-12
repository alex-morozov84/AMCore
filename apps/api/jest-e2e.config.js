module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup-nest-loader.cjs'],
  rootDir: '.',
  testMatch: ['**/test/**/*.e2e-spec.ts'],
  moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  transform: { '^.+\\.tsx?$': ['@swc/jest', require('./jest-swc.config.cjs')(true)] },
  transformIgnorePatterns: ['node_modules/(?!(@formatjs|openid-client|oauth4webapi|jose)/)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // E2E tests run serially to avoid DB conflicts
  maxWorkers: 1,
  // Longer timeout for container setup
  testTimeout: 60000,
}

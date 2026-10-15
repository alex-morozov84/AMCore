import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
export default {
  transform: { '^.+\\.tsx?$': ['@swc/jest', require('./jest-swc.config.cjs')()] },
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['\\.integration\\.spec\\.ts$'],
  transformIgnorePatterns: ['node_modules/(?!(@formatjs|openid-client|oauth4webapi)/)'],
  moduleFileExtensions: ['js', 'json', 'ts', 'tsx', 'mts', 'cts'],
  collectCoverageFrom: [
    'src/**/*.{js,ts}',
    '!src/**/*.d.ts',
    '!src/main.ts',
    '!src/**/*.module.ts',
  ],
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
}

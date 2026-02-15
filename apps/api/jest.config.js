module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['\\.integration\\.spec\\.ts$'],
  transformIgnorePatterns: ['node_modules/(?!(@formatjs)/)'],
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
    '^@/(.*)$': '<rootDir>/src/$1',
  },
}

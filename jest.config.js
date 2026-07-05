module.exports = {
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'test/tsconfig.json' }]
  },
  moduleFileExtensions: ['ts', 'js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.ts'],
  testMatch: ['**/test/unit/**/*.spec.ts', '**/src/**/*.spec.ts'],
  testEnvironment: 'node'
}

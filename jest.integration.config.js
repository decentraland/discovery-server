module.exports = {
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'test/tsconfig.json' }]
  },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/test/integration/**/*.spec.ts'],
  testEnvironment: 'node',
  testTimeout: 30000
}

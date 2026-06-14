/** @type {import('jest').Config} */
module.exports = {
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': '<rootDir>/tests/helpers/fix-istanbul-decorators.cjs',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(uuid)/)',
  ],
  moduleNameMapper: {
    '^uuid$': '<rootDir>/tests/helpers/uuid-mock.js',
  },
  collectCoverageFrom: [
    'src/modules/person/person.service.ts',
    'src/modules/personStatusHistory/personStatusHistory.service.ts',
    'src/modules/achievement/achievement.service.ts',
    'src/modules/achievement/achievementEvaluator.service.ts',
    'src/modules/dashboard/dashboard.service.ts',
    'src/modules/systemTime/systemTime.service.ts',
    'src/services/encryption.service.ts',
    'src/services/r2-storage.service.ts',
    'src/modules/email/emailDelivery.processor.ts',
    'src/modules/email/smtpEmail.provider.ts',
    'src/common/decorators/**/*.ts',
    'src/common/guards/**/*.ts',
    'src/common/middleware/**/*.ts',
    'src/common/swagger/**/*.ts',
    'src/common/validation/**/*.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      statements: 60,
      branches: 50,
      functions: 60,
      lines: 60,
    },
  },
  clearMocks: true,
};
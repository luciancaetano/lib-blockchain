module.exports = {
    roots: ['./__tests__'],
    testEnvironment: 'node',
    setupFilesAfterEnv: [
    ],
    moduleFileExtensions: ['ts', 'js'],
    testPathIgnorePatterns: ['node_modules/'],
    transform: {
        '^.+\\.ts?$': 'ts-jest',
    },
    testMatch: ['**/*.spec.(ts)'],
    resolver: 'jest-pnp-resolver',
    collectCoverage: true,
    collectCoverageFrom: [
        './src/**/*.{ts}',
    ],
    coverageThreshold: {
        global: {
            branches: 75,
            functions: 80,
            lines: 90,
            statements: 90,
        },
    },
    coverageReporters: [
        'json',
        'lcov',
        'text',
        'clover',
    ],
    coveragePathIgnorePatterns: [
        'node_modules',
    ],
};

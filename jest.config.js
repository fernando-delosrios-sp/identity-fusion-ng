module.exports = {
    preset: 'ts-jest',
    testTimeout: 180000,
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.+(ts|tsx|js)', '**/?(*.)+(spec|test).+(ts|tsx|js)'],
    testPathIgnorePatterns: ['<rootDir>/src/__tests__/test-config.ts'],
    transformIgnorePatterns: [
        'node_modules/(?!(double-metaphone|string-comparison|name-match)/)',
    ],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    transform: {
        '^.+\\.tsx?$': 'ts-jest',
        '^.+\\.jsx?$': 'ts-jest',
    },
}

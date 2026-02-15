const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

module.exports = async () => {
  const nextConfig = await createJestConfig({
    testEnvironment: 'node',
    testMatch: ['**/src/**/*.test.js'],
    moduleNameMapper: {
      '^@/(.*)$': '<rootDir>/src/$1',
    },
  })();

  return {
    projects: [
      // Existing Chrome extension tests (no transform needed)
      {
        displayName: 'extension',
        testEnvironment: 'node',
        testMatch: ['**/test/**/*.test.js'],
      },
      // Next.js app tests (SWC transform for ESM imports)
      {
        ...nextConfig,
        displayName: 'app',
      },
    ],
  };
};

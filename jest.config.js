module.exports = {
  testEnvironment: 'node',
  // Note: chrome mock is installed per-file via require('./setup'), not globally,
  // because content.test.js uses jsdom environment while others use node.
  testMatch: ['**/test/**/*.test.js'],
};

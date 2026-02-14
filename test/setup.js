/**
 * Chrome API mocks for Jest tests.
 * Sets up global.chrome with stubs for identity, storage, alarms, runtime, and tabs.
 * Must be loaded BEFORE requiring background.js.
 */
'use strict';

function createChromeStorageMock() {
  let store = {};
  return {
    get: jest.fn((keys) => {
      if (typeof keys === 'string') keys = [keys];
      const result = {};
      for (const k of keys) {
        if (k in store) result[k] = store[k];
      }
      return Promise.resolve(result);
    }),
    set: jest.fn((obj) => {
      Object.assign(store, obj);
      return Promise.resolve();
    }),
    remove: jest.fn((keys) => {
      if (typeof keys === 'string') keys = [keys];
      for (const k of keys) delete store[k];
      return Promise.resolve();
    }),
    _getAll: () => ({ ...store }),
    _clear: () => { store = {}; },
  };
}

function createChromeMock() {
  const storage = createChromeStorageMock();

  return {
    identity: {
      getAuthToken: jest.fn((_opts, cb) => {
        if (cb) cb('fake-token-123');
        return Promise.resolve('fake-token-123');
      }),
      removeCachedAuthToken: jest.fn((_opts, cb) => {
        if (cb) cb();
        return Promise.resolve();
      }),
      clearAllCachedAuthTokens: jest.fn((cb) => {
        if (cb) cb();
        return Promise.resolve();
      }),
    },
    storage: {
      local: storage,
    },
    runtime: {
      lastError: null,
      onMessage: {
        addListener: jest.fn(),
      },
      sendMessage: jest.fn(),
    },
    alarms: {
      create: jest.fn(),
      clear: jest.fn(),
      onAlarm: {
        addListener: jest.fn(),
      },
    },
    tabs: {
      query: jest.fn(() => Promise.resolve([])),
      update: jest.fn(),
      create: jest.fn(),
      reload: jest.fn(),
    },
  };
}

/**
 * Install chrome mock globally and return a handle for per-test reset.
 */
function installChromeMock() {
  const mock = createChromeMock();
  global.chrome = mock;
  return mock;
}

/**
 * Reset all chrome mocks and storage between tests.
 */
function resetChromeMock() {
  const mock = createChromeMock();
  global.chrome = mock;
  return mock;
}

module.exports = { installChromeMock, resetChromeMock, createChromeStorageMock };

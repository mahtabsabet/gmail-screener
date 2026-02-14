/**
 * Tests for pure helper functions from background.js and content.js.
 * These have no side effects and don't need the fake Gmail.
 */
'use strict';

const { installChromeMock } = require('./setup');

// Install chrome mock before requiring background.js
installChromeMock();
const bg = require('../background');

describe('labelQuery', () => {
  test('simple label name returns unquoted', () => {
    expect(bg.labelQuery('Allowed')).toBe('label:Allowed');
  });

  test('label with slash is quoted', () => {
    expect(bg.labelQuery('Gatekeeper/Screener')).toBe('label:"Gatekeeper/Screener"');
  });

  test('label with space is quoted', () => {
    expect(bg.labelQuery('Gatekeeper/Reply Later')).toBe('label:"Gatekeeper/Reply Later"');
  });

  test('label with both slash and space is quoted', () => {
    expect(bg.labelQuery('Gatekeeper/Set Aside')).toBe('label:"Gatekeeper/Set Aside"');
  });
});

describe('safeStorageKey', () => {
  test('simple name unchanged', () => {
    expect(bg.safeStorageKey('Allowed')).toBe('Allowed');
  });

  test('slashes replaced with underscores', () => {
    expect(bg.safeStorageKey('Gatekeeper/Screener')).toBe('Gatekeeper_Screener');
  });

  test('spaces replaced with underscores', () => {
    expect(bg.safeStorageKey('Reply Later')).toBe('Reply_Later');
  });

  test('both slashes and spaces replaced', () => {
    expect(bg.safeStorageKey('Gatekeeper/Set Aside')).toBe('Gatekeeper_Set_Aside');
  });
});

describe('storageKeyForLabel', () => {
  test('generates correct key for Gatekeeper labels', () => {
    expect(bg.storageKeyForLabel('Gatekeeper/Screener')).toBe('labelId_Gatekeeper_Screener');
    expect(bg.storageKeyForLabel('Gatekeeper/Reply Later')).toBe('labelId_Gatekeeper_Reply_Later');
    expect(bg.storageKeyForLabel('Gatekeeper/Set Aside')).toBe('labelId_Gatekeeper_Set_Aside');
  });

  test('simple label names work too', () => {
    expect(bg.storageKeyForLabel('Allowed')).toBe('labelId_Allowed');
  });
});

describe('label constants', () => {
  test('LABEL_SCREENER uses Gatekeeper hierarchy', () => {
    expect(bg.LABEL_SCREENER).toBe('Gatekeeper/Screener');
  });

  test('LABEL_REPLY_LATER uses Gatekeeper hierarchy', () => {
    expect(bg.LABEL_REPLY_LATER).toBe('Gatekeeper/Reply Later');
  });

  test('LABEL_SET_ASIDE uses Gatekeeper hierarchy', () => {
    expect(bg.LABEL_SET_ASIDE).toBe('Gatekeeper/Set Aside');
  });

  test('LABEL_ALLOWED is unchanged', () => {
    expect(bg.LABEL_ALLOWED).toBe('Allowed');
  });
});

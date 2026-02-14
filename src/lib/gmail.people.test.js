/**
 * Tests for Google People API helper functions.
 * Mocks the googleapis library to test lookupContactByEmail and searchGoogleContacts.
 */

// Mock db.js (imported by gmail.js for getUser/updateTokens)
jest.mock('./db.js', () => ({
  getUser: jest.fn(() => ({
    user_id: 'test-user',
    email: 'test@example.com',
    access_token: 'fake-token',
    refresh_token: 'fake-refresh',
    token_expiry: Date.now() + 3600000,
  })),
  updateTokens: jest.fn(),
}));

// Mock googleapis
const mockSearchContacts = jest.fn();
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn(() => ({
        setCredentials: jest.fn(),
        on: jest.fn(),
        generateAuthUrl: jest.fn(),
      })),
    },
    people: jest.fn(() => ({
      people: {
        searchContacts: mockSearchContacts,
      },
    })),
    gmail: jest.fn(() => ({})),
    oauth2: jest.fn(() => ({})),
  },
}));

import { lookupContactByEmail, searchGoogleContacts } from './gmail.js';

const USER = 'test-user';

beforeEach(() => {
  mockSearchContacts.mockReset();
});

describe('lookupContactByEmail', () => {
  test('returns contact data when found', async () => {
    mockSearchContacts.mockResolvedValue({
      data: {
        results: [{
          person: {
            names: [{ displayName: 'Michael Scott' }],
            emailAddresses: [{ value: 'michael@dundermifflin.com' }],
            photos: [{ url: 'https://lh3.google.com/photo123' }],
            phoneNumbers: [
              { value: '+1-555-0100', type: 'work' },
              { value: '+1-555-0101', type: 'mobile' },
            ],
            organizations: [
              { name: 'Dunder Mifflin', title: 'Regional Manager' },
            ],
          },
        }],
      },
    });

    const result = await lookupContactByEmail(USER, 'michael@dundermifflin.com');

    expect(result).not.toBeNull();
    expect(result.name).toBe('Michael Scott');
    expect(result.email).toBe('michael@dundermifflin.com');
    expect(result.photoUrl).toBe('https://lh3.google.com/photo123');
    expect(result.phoneNumbers).toHaveLength(2);
    expect(result.phoneNumbers[0]).toEqual({ value: '+1-555-0100', type: 'work' });
    expect(result.organizations).toHaveLength(1);
    expect(result.organizations[0]).toEqual({ name: 'Dunder Mifflin', title: 'Regional Manager' });
  });

  test('returns null when no results', async () => {
    mockSearchContacts.mockResolvedValue({ data: { results: [] } });

    const result = await lookupContactByEmail(USER, 'nobody@example.com');
    expect(result).toBeNull();
  });

  test('returns null when email does not match any result', async () => {
    mockSearchContacts.mockResolvedValue({
      data: {
        results: [{
          person: {
            names: [{ displayName: 'Wrong Person' }],
            emailAddresses: [{ value: 'wrong@example.com' }],
          },
        }],
      },
    });

    const result = await lookupContactByEmail(USER, 'michael@dundermifflin.com');
    expect(result).toBeNull();
  });

  test('matches email case-insensitively', async () => {
    mockSearchContacts.mockResolvedValue({
      data: {
        results: [{
          person: {
            names: [{ displayName: 'Michael' }],
            emailAddresses: [{ value: 'MICHAEL@dundermifflin.com' }],
            photos: [],
            phoneNumbers: [],
            organizations: [],
          },
        }],
      },
    });

    const result = await lookupContactByEmail(USER, 'michael@dundermifflin.com');
    expect(result).not.toBeNull();
    expect(result.name).toBe('Michael');
  });

  test('handles missing fields gracefully', async () => {
    mockSearchContacts.mockResolvedValue({
      data: {
        results: [{
          person: {
            emailAddresses: [{ value: 'minimal@example.com' }],
            // no names, photos, phoneNumbers, organizations
          },
        }],
      },
    });

    const result = await lookupContactByEmail(USER, 'minimal@example.com');
    expect(result).not.toBeNull();
    expect(result.name).toBe('');
    expect(result.photoUrl).toBe('');
    expect(result.phoneNumbers).toEqual([]);
    expect(result.organizations).toEqual([]);
  });

  test('returns null on 403 error (scope not granted)', async () => {
    const err = new Error('Insufficient permissions');
    err.code = 403;
    mockSearchContacts.mockRejectedValue(err);

    const result = await lookupContactByEmail(USER, 'michael@example.com');
    expect(result).toBeNull();
  });

  test('returns null on 401 error', async () => {
    const err = new Error('Unauthorized');
    err.code = 401;
    mockSearchContacts.mockRejectedValue(err);

    const result = await lookupContactByEmail(USER, 'michael@example.com');
    expect(result).toBeNull();
  });

  test('returns null on other API errors', async () => {
    mockSearchContacts.mockRejectedValue(new Error('Network error'));

    const result = await lookupContactByEmail(USER, 'michael@example.com');
    expect(result).toBeNull();
  });

  test('skips results with no person object', async () => {
    mockSearchContacts.mockResolvedValue({
      data: {
        results: [{ person: null }, {}],
      },
    });

    const result = await lookupContactByEmail(USER, 'michael@example.com');
    expect(result).toBeNull();
  });
});

describe('searchGoogleContacts', () => {
  test('returns array of contacts', async () => {
    mockSearchContacts.mockResolvedValue({
      data: {
        results: [
          {
            person: {
              names: [{ displayName: 'Michael Scott' }],
              emailAddresses: [{ value: 'michael@dundermifflin.com' }],
              photos: [{ url: 'https://photo1.jpg' }],
              organizations: [{ name: 'Dunder Mifflin' }],
            },
          },
          {
            person: {
              names: [{ displayName: 'Michael Jordan' }],
              emailAddresses: [{ value: 'michael@nba.com' }],
              photos: [],
              organizations: [{ name: 'NBA' }],
            },
          },
        ],
      },
    });

    const results = await searchGoogleContacts(USER, 'Michael');
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      name: 'Michael Scott',
      email: 'michael@dundermifflin.com',
      photoUrl: 'https://photo1.jpg',
      organization: 'Dunder Mifflin',
    });
    expect(results[1]).toEqual({
      name: 'Michael Jordan',
      email: 'michael@nba.com',
      photoUrl: '',
      organization: 'NBA',
    });
  });

  test('returns empty array when no results', async () => {
    mockSearchContacts.mockResolvedValue({ data: { results: [] } });

    const results = await searchGoogleContacts(USER, 'nobody');
    expect(results).toEqual([]);
  });

  test('filters out contacts without email', async () => {
    mockSearchContacts.mockResolvedValue({
      data: {
        results: [
          {
            person: {
              names: [{ displayName: 'No Email Person' }],
              // no emailAddresses
            },
          },
          {
            person: {
              names: [{ displayName: 'Has Email' }],
              emailAddresses: [{ value: 'has@email.com' }],
            },
          },
        ],
      },
    });

    const results = await searchGoogleContacts(USER, 'test');
    expect(results).toHaveLength(1);
    expect(results[0].email).toBe('has@email.com');
  });

  test('returns empty array on 403 error', async () => {
    const err = new Error('Forbidden');
    err.code = 403;
    mockSearchContacts.mockRejectedValue(err);

    const results = await searchGoogleContacts(USER, 'test');
    expect(results).toEqual([]);
  });

  test('returns empty array on generic error', async () => {
    mockSearchContacts.mockRejectedValue(new Error('Something went wrong'));

    const results = await searchGoogleContacts(USER, 'test');
    expect(results).toEqual([]);
  });

  test('normalizes email to lowercase', async () => {
    mockSearchContacts.mockResolvedValue({
      data: {
        results: [{
          person: {
            names: [{ displayName: 'Test' }],
            emailAddresses: [{ value: 'TEST@EXAMPLE.COM' }],
          },
        }],
      },
    });

    const results = await searchGoogleContacts(USER, 'test');
    expect(results[0].email).toBe('test@example.com');
  });
});

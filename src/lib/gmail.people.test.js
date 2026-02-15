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

// Mock googleapis — three People API search methods
const mockSearchContacts = jest.fn();
const mockSearchOtherContacts = jest.fn();
const mockSearchDirectoryPeople = jest.fn();

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
        searchDirectoryPeople: mockSearchDirectoryPeople,
      },
      otherContacts: {
        search: mockSearchOtherContacts,
      },
    })),
    gmail: jest.fn(() => ({})),
    oauth2: jest.fn(() => ({})),
  },
}));

import { lookupContactByEmail, searchGoogleContacts } from './gmail.js';

const USER = 'test-user';

// Helper to set default empty responses for all three search methods
function mockAllEmpty() {
  mockSearchContacts.mockResolvedValue({ data: { results: [] } });
  mockSearchOtherContacts.mockResolvedValue({ data: { results: [] } });
  mockSearchDirectoryPeople.mockResolvedValue({ data: { people: [] } });
}

beforeEach(() => {
  mockSearchContacts.mockReset();
  mockSearchOtherContacts.mockReset();
  mockSearchDirectoryPeople.mockReset();
  mockAllEmpty();
});

describe('lookupContactByEmail', () => {
  test('returns contact data when found in saved contacts', async () => {
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

  test('finds contact in Other Contacts when not in saved', async () => {
    mockSearchOtherContacts.mockResolvedValue({
      data: {
        results: [{
          person: {
            names: [{ displayName: 'Other Person' }],
            emailAddresses: [{ value: 'other@example.com' }],
            photos: [{ url: 'https://photo.jpg' }],
          },
        }],
      },
    });

    const result = await lookupContactByEmail(USER, 'other@example.com');
    expect(result).not.toBeNull();
    expect(result.name).toBe('Other Person');
    expect(result.photoUrl).toBe('https://photo.jpg');
  });

  test('finds contact in directory when not in contacts or other', async () => {
    mockSearchDirectoryPeople.mockResolvedValue({
      data: {
        people: [{
          names: [{ displayName: 'Directory Person' }],
          emailAddresses: [{ value: 'dir@company.com' }],
          photos: [{ url: 'https://dir-photo.jpg' }],
          organizations: [{ name: 'Company', title: 'Engineer' }],
        }],
      },
    });

    const result = await lookupContactByEmail(USER, 'dir@company.com');
    expect(result).not.toBeNull();
    expect(result.name).toBe('Directory Person');
  });

  test('returns null when no results from any source', async () => {
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

  test('filters out default silhouette photos', async () => {
    mockSearchContacts.mockResolvedValue({
      data: {
        results: [{
          person: {
            emailAddresses: [{ value: 'test@example.com' }],
            photos: [{ url: 'https://lh3.google.com/default', default: true }],
          },
        }],
      },
    });

    const result = await lookupContactByEmail(USER, 'test@example.com');
    expect(result.photoUrl).toBe('');
  });

  test('returns null on 403 error from all sources', async () => {
    const err = new Error('Insufficient permissions');
    err.code = 403;
    mockSearchContacts.mockRejectedValue(err);
    mockSearchOtherContacts.mockRejectedValue(err);
    mockSearchDirectoryPeople.mockRejectedValue(err);

    const result = await lookupContactByEmail(USER, 'michael@example.com');
    expect(result).toBeNull();
  });

  test('succeeds even when some sources fail', async () => {
    // searchContacts fails, but otherContacts succeeds
    mockSearchContacts.mockRejectedValue(new Error('fail'));
    mockSearchOtherContacts.mockResolvedValue({
      data: {
        results: [{
          person: {
            names: [{ displayName: 'Found' }],
            emailAddresses: [{ value: 'found@example.com' }],
            photos: [{ url: 'https://photo.jpg' }],
          },
        }],
      },
    });

    const result = await lookupContactByEmail(USER, 'found@example.com');
    expect(result).not.toBeNull();
    expect(result.name).toBe('Found');
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
  test('returns merged results from all sources', async () => {
    mockSearchContacts.mockResolvedValue({
      data: {
        results: [{
          person: {
            names: [{ displayName: 'Saved Contact' }],
            emailAddresses: [{ value: 'saved@example.com' }],
            photos: [{ url: 'https://photo1.jpg' }],
            organizations: [{ name: 'Saved Co' }],
          },
        }],
      },
    });
    mockSearchOtherContacts.mockResolvedValue({
      data: {
        results: [{
          person: {
            names: [{ displayName: 'Other Contact' }],
            emailAddresses: [{ value: 'other@example.com' }],
            photos: [{ url: 'https://photo2.jpg' }],
          },
        }],
      },
    });

    const results = await searchGoogleContacts(USER, 'example');
    expect(results).toHaveLength(2);
    expect(results[0].email).toBe('saved@example.com');
    expect(results[1].email).toBe('other@example.com');
  });

  test('deduplicates across sources by email', async () => {
    mockSearchContacts.mockResolvedValue({
      data: {
        results: [{
          person: {
            names: [{ displayName: 'From Contacts' }],
            emailAddresses: [{ value: 'same@example.com' }],
          },
        }],
      },
    });
    mockSearchOtherContacts.mockResolvedValue({
      data: {
        results: [{
          person: {
            names: [{ displayName: 'From Other' }],
            emailAddresses: [{ value: 'same@example.com' }],
          },
        }],
      },
    });

    const results = await searchGoogleContacts(USER, 'same');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('From Contacts'); // first source wins
  });

  test('returns empty array when no results', async () => {
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
    mockSearchOtherContacts.mockRejectedValue(err);
    mockSearchDirectoryPeople.mockRejectedValue(err);

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

  test('filters out default silhouette photos', async () => {
    mockSearchContacts.mockResolvedValue({
      data: {
        results: [{
          person: {
            names: [{ displayName: 'Test' }],
            emailAddresses: [{ value: 'test@example.com' }],
            photos: [{ url: 'https://default.jpg', default: true }],
          },
        }],
      },
    });

    const results = await searchGoogleContacts(USER, 'test');
    expect(results[0].photoUrl).toBe('');
  });
});

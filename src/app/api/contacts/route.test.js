/**
 * Tests for /api/contacts route handler.
 */

// Mock session
jest.mock('@/lib/session.js', () => ({
  getSession: jest.fn(),
}));

// Mock db functions
jest.mock('@/lib/db.js', () => ({
  searchContacts: jest.fn(),
  getContact: jest.fn(),
}));

// Mock gmail functions
jest.mock('@/lib/gmail.js', () => ({
  searchThreads: jest.fn(),
  getThreadsBatch: jest.fn(),
  parseThreadSummary: jest.fn(),
  lookupContactByEmail: jest.fn(),
  searchGoogleContacts: jest.fn(),
}));

import { GET } from './route.js';
import { getSession } from '@/lib/session.js';
import { searchContacts, getContact } from '@/lib/db.js';
import { searchThreads, getThreadsBatch, parseThreadSummary, lookupContactByEmail, searchGoogleContacts } from '@/lib/gmail.js';

function makeRequest(params) {
  const url = new URL('http://localhost/api/contacts');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/contacts', () => {
  test('returns 401 when not authenticated', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(401);
  });

  test('returns empty contacts when no query params', async () => {
    getSession.mockResolvedValue('user-1');
    const res = await GET(makeRequest({}));
    const data = await res.json();
    expect(data.contacts).toEqual([]);
  });

  describe('search by query (?q=...)', () => {
    test('returns merged local + Google contacts', async () => {
      getSession.mockResolvedValue('user-1');
      searchContacts.mockReturnValue([
        { email: 'michael@local.com', name: 'Michael Local', status: 'APPROVED' },
      ]);
      searchGoogleContacts.mockResolvedValue([
        { email: 'michael@google.com', name: 'Michael Google', photoUrl: 'https://photo.jpg', organization: 'Google' },
        { email: 'michael@local.com', name: 'Duplicate', photoUrl: '', organization: '' }, // should be deduped
      ]);

      const res = await GET(makeRequest({ q: 'michael' }));
      const data = await res.json();

      expect(data.contacts).toHaveLength(2);
      expect(data.contacts[0].email).toBe('michael@local.com');
      expect(data.contacts[1].email).toBe('michael@google.com');
      expect(data.contacts[1].photoUrl).toBe('https://photo.jpg');
    });

    test('ignores empty query', async () => {
      getSession.mockResolvedValue('user-1');
      const res = await GET(makeRequest({ q: '  ' }));
      const data = await res.json();
      expect(data.contacts).toEqual([]);
      expect(searchContacts).not.toHaveBeenCalled();
    });
  });

  describe('lookup by email (?email=...)', () => {
    test('returns merged contact + threads', async () => {
      getSession.mockResolvedValue('user-1');
      getContact.mockReturnValue({ email: 'michael@example.com', name: 'Local Name' });
      lookupContactByEmail.mockResolvedValue({
        name: 'Google Name',
        photoUrl: 'https://photo.jpg',
        phoneNumbers: [{ value: '+1-555-0100', type: 'work' }],
        organizations: [{ name: 'Acme', title: 'CEO' }],
      });
      searchThreads.mockResolvedValue([{ id: 'thread-1' }]);
      getThreadsBatch.mockResolvedValue([{ id: 'thread-1', messages: [] }]);
      parseThreadSummary.mockReturnValue({
        threadId: 'thread-1',
        subject: 'Test',
        fromEmail: 'michael@example.com',
        fromName: 'Michael',
        date: 'Mon, 14 Feb 2026',
        snippet: 'Hello',
        isUnread: false,
      });

      const res = await GET(makeRequest({ email: 'michael@example.com' }));
      const data = await res.json();

      expect(data.contact.name).toBe('Google Name'); // Google wins over local
      expect(data.contact.photoUrl).toBe('https://photo.jpg');
      expect(data.contact.phoneNumbers).toHaveLength(1);
      expect(data.contact.organizations).toHaveLength(1);
      expect(data.threads).toHaveLength(1);
    });

    test('falls back to local name when Google returns null', async () => {
      getSession.mockResolvedValue('user-1');
      getContact.mockReturnValue({ email: 'test@example.com', name: 'Local Name' });
      lookupContactByEmail.mockResolvedValue(null);
      searchThreads.mockResolvedValue([]);

      const res = await GET(makeRequest({ email: 'test@example.com' }));
      const data = await res.json();

      expect(data.contact.name).toBe('Local Name');
      expect(data.contact.photoUrl).toMatch(/gravatar\.com\/avatar\//);
      expect(data.contact.phoneNumbers).toEqual([]);
      expect(data.threads).toEqual([]);
    });

    test('handles no threads gracefully', async () => {
      getSession.mockResolvedValue('user-1');
      getContact.mockReturnValue(null);
      lookupContactByEmail.mockResolvedValue(null);
      searchThreads.mockResolvedValue([]);

      const res = await GET(makeRequest({ email: 'nobody@example.com' }));
      const data = await res.json();

      expect(data.contact.email).toBe('nobody@example.com');
      expect(data.contact.name).toBe('');
      expect(data.threads).toEqual([]);
    });

    test('returns 500 on error', async () => {
      getSession.mockResolvedValue('user-1');
      getContact.mockReturnValue(null);
      lookupContactByEmail.mockRejectedValue(new Error('API error'));

      const res = await GET(makeRequest({ email: 'test@example.com' }));
      expect(res.status).toBe(500);
    });
  });
});

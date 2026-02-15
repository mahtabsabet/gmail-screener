/**
 * Tests for /api/search route — contacts integration.
 */

jest.mock('@/lib/session.js', () => ({
  getSession: jest.fn(),
}));

jest.mock('@/lib/db.js', () => ({
  searchContacts: jest.fn(),
  upsertContact: jest.fn(),
}));

jest.mock('@/lib/gmail.js', () => ({
  searchThreads: jest.fn(),
  getThreadsBatch: jest.fn(),
  parseThreadSummary: jest.fn(),
  searchGoogleContacts: jest.fn(),
}));

import { GET } from './route.js';
import { getSession } from '@/lib/session.js';
import { searchContacts, upsertContact } from '@/lib/db.js';
import { searchThreads, getThreadsBatch, parseThreadSummary, searchGoogleContacts } from '@/lib/gmail.js';

function makeRequest(query) {
  const url = new URL('http://localhost/api/search');
  if (query) url.searchParams.set('q', query);
  return new Request(url.toString());
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/search', () => {
  test('returns 401 when not authenticated', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(makeRequest('test'));
    expect(res.status).toBe(401);
  });

  test('returns empty results for blank query', async () => {
    getSession.mockResolvedValue('user-1');
    const res = await GET(makeRequest(''));
    const data = await res.json();
    expect(data.threads).toEqual([]);
    expect(data.contacts).toEqual([]);
  });

  test('returns both threads and contacts', async () => {
    getSession.mockResolvedValue('user-1');
    searchThreads.mockResolvedValue([{ id: 't1' }]);
    getThreadsBatch.mockResolvedValue([{ id: 't1' }]);
    parseThreadSummary.mockReturnValue({
      threadId: 't1',
      subject: 'Hello Michael',
      fromEmail: 'sender@example.com',
      fromName: 'Sender',
      date: 'Mon, 14 Feb 2026',
      snippet: 'Hi there',
      isUnread: true,
    });
    searchContacts.mockReturnValue([
      { email: 'michael@local.com', name: 'Michael Local', status: null },
    ]);
    searchGoogleContacts.mockResolvedValue([
      { email: 'michael@google.com', name: 'Michael Google', photoUrl: '', organization: '' },
    ]);

    const res = await GET(makeRequest('Michael'));
    const data = await res.json();

    expect(data.threads).toHaveLength(1);
    expect(data.contacts).toHaveLength(2);
    expect(data.contacts[0].email).toBe('michael@local.com');
    expect(data.contacts[1].email).toBe('michael@google.com');
  });

  test('deduplicates Google contacts already in local DB', async () => {
    getSession.mockResolvedValue('user-1');
    searchThreads.mockResolvedValue([]);
    searchContacts.mockReturnValue([
      { email: 'michael@shared.com', name: 'Michael', status: 'APPROVED' },
    ]);
    searchGoogleContacts.mockResolvedValue([
      { email: 'michael@shared.com', name: 'Michael Dup', photoUrl: '', organization: '' },
    ]);

    const res = await GET(makeRequest('Michael'));
    const data = await res.json();

    expect(data.contacts).toHaveLength(1);
    expect(data.contacts[0].email).toBe('michael@shared.com');
    expect(data.contacts[0].name).toBe('Michael'); // local version kept
  });

  test('auto-saves contacts from email threads', async () => {
    getSession.mockResolvedValue('user-1');
    searchThreads.mockResolvedValue([{ id: 't1' }]);
    getThreadsBatch.mockResolvedValue([{ id: 't1' }]);
    parseThreadSummary.mockReturnValue({
      threadId: 't1',
      fromEmail: 'newperson@example.com',
      fromName: 'New Person',
      subject: 'Test',
      date: 'Mon, 14 Feb 2026',
      snippet: '',
      isUnread: false,
    });
    searchContacts.mockReturnValue([]);
    searchGoogleContacts.mockResolvedValue([]);

    await GET(makeRequest('test'));

    expect(upsertContact).toHaveBeenCalledWith('user-1', 'newperson@example.com', 'New Person');
  });

  test('does not save contact when name matches email username', async () => {
    getSession.mockResolvedValue('user-1');
    searchThreads.mockResolvedValue([{ id: 't1' }]);
    getThreadsBatch.mockResolvedValue([{ id: 't1' }]);
    parseThreadSummary.mockReturnValue({
      threadId: 't1',
      fromEmail: 'noreply@example.com',
      fromName: 'noreply', // same as email username — not a real name
      subject: 'Test',
      date: 'Mon, 14 Feb 2026',
      snippet: '',
      isUnread: false,
    });
    searchContacts.mockReturnValue([]);
    searchGoogleContacts.mockResolvedValue([]);

    await GET(makeRequest('test'));

    expect(upsertContact).not.toHaveBeenCalled();
  });

  test('returns 500 on error', async () => {
    getSession.mockResolvedValue('user-1');
    searchThreads.mockRejectedValue(new Error('Gmail API error'));

    const res = await GET(makeRequest('test'));
    expect(res.status).toBe(500);
  });
});

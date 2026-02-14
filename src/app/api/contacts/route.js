import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session.js';
import { searchContacts, getContact } from '@/lib/db.js';
import { searchThreads, getThreadsBatch, parseThreadSummary, lookupContactByEmail, searchGoogleContacts } from '@/lib/gmail.js';

export async function GET(request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  const email = searchParams.get('email');

  // Get details + emails for a specific contact
  if (email) {
    try {
      const [contact, googleContact, threadList] = await Promise.all([
        Promise.resolve(getContact(userId, email)),
        lookupContactByEmail(userId, email),
        searchThreads(userId, `from:${email} OR to:${email}`, 50),
      ]);

      let threads = [];
      if (threadList.length > 0) {
        const rawThreads = await getThreadsBatch(userId, threadList.map(t => t.id));
        threads = rawThreads.map(parseThreadSummary).filter(Boolean);
      }

      // Merge local contact data with Google People data
      const merged = {
        email,
        name: googleContact?.name || contact?.name || '',
        photoUrl: googleContact?.photoUrl || '',
        phoneNumbers: googleContact?.phoneNumbers || [],
        organizations: googleContact?.organizations || [],
      };

      return NextResponse.json({ contact: merged, threads });
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // Search contacts by name/email (local DB + Google Contacts)
  if (q && q.trim()) {
    const trimmed = q.trim();
    const [localContacts, googleContacts] = await Promise.all([
      Promise.resolve(searchContacts(userId, trimmed)),
      searchGoogleContacts(userId, trimmed),
    ]);

    // Merge: start with local, add Google results that aren't already present
    const seen = new Set(localContacts.map(c => c.email));
    const merged = [...localContacts];
    for (const gc of googleContacts) {
      if (!seen.has(gc.email)) {
        seen.add(gc.email);
        merged.push({
          email: gc.email,
          name: gc.name,
          status: null,
          photoUrl: gc.photoUrl,
          organization: gc.organization,
        });
      }
    }

    return NextResponse.json({ contacts: merged });
  }

  return NextResponse.json({ contacts: [] });
}

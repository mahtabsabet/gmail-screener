import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getSession } from '@/lib/session.js';
import { searchThreads, getThreadsBatch, parseThreadSummary, searchGoogleContacts } from '@/lib/gmail.js';
import { searchContacts, upsertContact } from '@/lib/db.js';

function gravatarUrl(email) {
  const hash = createHash('md5').update(email.trim().toLowerCase()).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?s=80&d=404`;
}

export async function GET(request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query || !query.trim()) {
    return NextResponse.json({ threads: [], contacts: [] });
  }

  try {
    const trimmed = query.trim();

    // Search emails, local contacts, and Google Contacts in parallel
    const [threadList, localContacts, googleContacts] = await Promise.all([
      searchThreads(userId, trimmed),
      searchContacts(userId, trimmed),
      searchGoogleContacts(userId, trimmed),
    ]);

    let threads = [];
    if (threadList.length > 0) {
      const rawThreads = await getThreadsBatch(userId, threadList.map(t => t.id));
      threads = rawThreads.map(parseThreadSummary).filter(Boolean);
      for (const t of threads) {
        if (t.fromEmail && t.fromName && t.fromName !== t.fromEmail.split('@')[0]) {
          try { await upsertContact(userId, t.fromEmail, t.fromName); } catch {}
        }
      }
    }

    // Merge local + Google contacts, deduplicating by email
    // Add Gravatar fallback for contacts without photos
    const seen = new Set(localContacts.map(c => c.email));
    const contacts = localContacts.map(c => ({
      ...c,
      photoUrl: c.photoUrl || gravatarUrl(c.email),
    }));
    for (const gc of googleContacts) {
      if (!seen.has(gc.email)) {
        seen.add(gc.email);
        contacts.push({
          email: gc.email,
          name: gc.name,
          status: null,
          photoUrl: gc.photoUrl || gravatarUrl(gc.email),
          organization: gc.organization,
        });
      }
    }

    return NextResponse.json({ threads, contacts });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

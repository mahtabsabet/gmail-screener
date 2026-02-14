import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session.js';
import { searchThreads, getThreadsBatch, parseThreadSummary } from '@/lib/gmail.js';
import { searchContacts, upsertContact } from '@/lib/db.js';

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

    // Search both emails and contacts in parallel
    const [threadList, contacts] = await Promise.all([
      searchThreads(userId, trimmed),
      Promise.resolve(searchContacts(userId, trimmed)),
    ]);

    let threads = [];
    if (threadList.length > 0) {
      const rawThreads = await getThreadsBatch(userId, threadList.map(t => t.id));
      threads = rawThreads.map(parseThreadSummary).filter(Boolean);
      for (const t of threads) {
        if (t.fromEmail && t.fromName && t.fromName !== t.fromEmail.split('@')[0]) {
          try { upsertContact(userId, t.fromEmail, t.fromName); } catch {}
        }
      }
    }

    return NextResponse.json({ threads, contacts });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

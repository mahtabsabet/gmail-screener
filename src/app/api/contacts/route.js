import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session.js';
import { searchContacts, getContact } from '@/lib/db.js';
import { searchThreads, getThreadsBatch, parseThreadSummary } from '@/lib/gmail.js';

export async function GET(request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  const email = searchParams.get('email');

  // Get emails for a specific contact
  if (email) {
    const contact = getContact(userId, email);
    try {
      const threadList = await searchThreads(userId, `from:${email} OR to:${email}`, 50);
      let threads = [];
      if (threadList.length > 0) {
        const rawThreads = await getThreadsBatch(userId, threadList.map(t => t.id));
        threads = rawThreads.map(parseThreadSummary).filter(Boolean);
      }
      return NextResponse.json({ contact, threads });
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // Search contacts by name/email
  if (q && q.trim()) {
    const contacts = searchContacts(userId, q.trim());
    return NextResponse.json({ contacts });
  }

  return NextResponse.json({ contacts: [] });
}

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session.js';
import { searchThreads, getThread, parseThreadSummary } from '@/lib/gmail.js';

export async function GET(request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query || !query.trim()) {
    return NextResponse.json({ threads: [] });
  }

  try {
    const threadList = await searchThreads(userId, query.trim());
    if (threadList.length === 0) return NextResponse.json({ threads: [] });

    const threads = [];
    for (const t of threadList) {
      try {
        const thread = await getThread(userId, t.id);
        const summary = parseThreadSummary(thread);
        if (summary) threads.push(summary);
      } catch (err) {
        console.warn(`Skipping thread ${t.id}:`, err.message);
      }
    }

    return NextResponse.json({ threads });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

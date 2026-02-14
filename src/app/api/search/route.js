import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session.js';
import { searchThreads, getThreadsBatch, parseThreadSummary } from '@/lib/gmail.js';

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

    const rawThreads = await getThreadsBatch(userId, threadList.map(t => t.id));
    const threads = rawThreads.map(parseThreadSummary).filter(Boolean);
    return NextResponse.json({ threads });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

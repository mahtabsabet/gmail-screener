import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session.js';
import { setThreadFolder, archiveThread, removeThreadState } from '@/lib/db.js';

export async function POST(request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { threadId, action } = await request.json();
  if (!threadId || !action) {
    return NextResponse.json({ error: 'threadId and action required' }, { status: 400 });
  }

  switch (action) {
    case 'REPLY_LATER':
      setThreadFolder(userId, threadId, 'REPLY_LATER');
      return NextResponse.json({ success: true });

    case 'SET_ASIDE':
      setThreadFolder(userId, threadId, 'SET_ASIDE');
      return NextResponse.json({ success: true });

    case 'MOVE_TO_IMBOX':
      setThreadFolder(userId, threadId, 'IMBOX');
      return NextResponse.json({ success: true });

    case 'ARCHIVE':
      archiveThread(userId, threadId);
      return NextResponse.json({ success: true });

    case 'REMOVE':
      removeThreadState(userId, threadId);
      return NextResponse.json({ success: true });

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}

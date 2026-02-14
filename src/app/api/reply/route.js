import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session.js';
import { archiveThread, getThreadState } from '@/lib/db.js';
import { sendReply } from '@/lib/gmail.js';

export async function POST(request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { threadId, to, subject, body, messageId, references } = await request.json();

  if (!threadId || !to || !body) {
    return NextResponse.json({ error: 'threadId, to, and body are required' }, { status: 400 });
  }

  try {
    const result = await sendReply(userId, {
      threadId,
      to,
      subject: subject || '',
      body,
      messageId: messageId || '',
      references: references || '',
    });

    // Auto-archive: if this thread was in Reply Later, mark it archived
    const state = getThreadState(userId, threadId);
    if (state && state.folder === 'REPLY_LATER') {
      archiveThread(userId, threadId);
    }

    return NextResponse.json({ success: true, messageId: result.id });
  } catch (err) {
    console.error('Send reply error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

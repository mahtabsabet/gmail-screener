import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session.js';
import { archiveThread, getThreadState } from '@/lib/db.js';
import { sendReply, getLabelIdForFolder, modifyThreadLabels } from '@/lib/gmail.js';

export async function POST(request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { threadId, to, subject, body, messageId, references } = await request.json();

  if (!threadId || !to || !body) {
    return NextResponse.json({ error: 'threadId, to, and body are required' }, { status: 400 });
  }

  // Validate recipient email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json({ error: 'Invalid recipient email address' }, { status: 400 });
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

    // Auto-archive: if this thread was in Reply Later, remove the Gmail label and archive locally
    const state = getThreadState(userId, threadId);
    if (state && state.folder === 'REPLY_LATER') {
      const labelId = await getLabelIdForFolder(userId, 'REPLY_LATER');
      if (labelId) {
        await modifyThreadLabels(userId, threadId, [], [labelId, 'INBOX']).catch(err =>
          console.warn('Failed to remove Reply Later label:', err.message)
        );
      }
      archiveThread(userId, threadId);
    }

    return NextResponse.json({ success: true, messageId: result.id });
  } catch (err) {
    console.error('Send reply error:', err);
    return NextResponse.json({ error: 'Failed to send reply' }, { status: 500 });
  }
}

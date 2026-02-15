import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session.js';
import { setThreadFolder, archiveThread, removeThreadState, getThreadState } from '@/lib/db.js';
import { getLabelIdForFolder, modifyThreadLabels } from '@/lib/gmail.js';

export async function POST(request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { threadId, action } = await request.json();
  if (!threadId || !action) {
    return NextResponse.json({ error: 'threadId and action required' }, { status: 400 });
  }

  try {
    switch (action) {
      case 'REPLY_LATER':
      case 'SET_ASIDE': {
        const folder = action; // 'REPLY_LATER' or 'SET_ASIDE'

        // Remove previous Gmail label if thread was in a different folder
        const prev = await getThreadState(userId, threadId);
        if (prev && prev.folder !== folder && prev.folder !== 'IMBOX') {
          const oldLabelId = await getLabelIdForFolder(userId, prev.folder);
          if (oldLabelId) {
            await modifyThreadLabels(userId, threadId, [], [oldLabelId]);
          }
        }

        // Add new Gmail label and remove INBOX
        const labelId = await getLabelIdForFolder(userId, folder);
        if (labelId) {
          await modifyThreadLabels(userId, threadId, [labelId], ['INBOX']);
        }

        await setThreadFolder(userId, threadId, folder);
        return NextResponse.json({ success: true });
      }

      case 'MOVE_TO_IMBOX': {
        // Remove the triage Gmail label and restore INBOX
        const prev = await getThreadState(userId, threadId);
        if (prev && prev.folder !== 'IMBOX') {
          const oldLabelId = await getLabelIdForFolder(userId, prev.folder);
          if (oldLabelId) {
            await modifyThreadLabels(userId, threadId, ['INBOX'], [oldLabelId]);
          }
        }

        await setThreadFolder(userId, threadId, 'IMBOX');
        return NextResponse.json({ success: true });
      }

      case 'ARCHIVE': {
        // Remove triage label when archiving
        const prev = await getThreadState(userId, threadId);
        if (prev && prev.folder !== 'IMBOX') {
          const oldLabelId = await getLabelIdForFolder(userId, prev.folder);
          if (oldLabelId) {
            await modifyThreadLabels(userId, threadId, [], [oldLabelId, 'INBOX']);
          }
        }

        await archiveThread(userId, threadId);
        return NextResponse.json({ success: true });
      }

      case 'REMOVE':
        await removeThreadState(userId, threadId);
        return NextResponse.json({ success: true });

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('Triage error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

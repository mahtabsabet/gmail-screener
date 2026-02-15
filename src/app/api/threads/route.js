import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session.js';
import { getSenderStatus, getAllApprovedEmails, getAllDeniedEmails, getThreadsByFolder, upsertContact } from '@/lib/db.js';
import { listInboxThreads, listSentThreads, getThread, getThreadsBatch, getThreadFull, parseThreadSummary, parseFullThread, markThreadRead } from '@/lib/gmail.js';

function saveContactsFromThreads(userId, threads) {
  for (const t of threads) {
    if (t.fromEmail && t.fromName && t.fromName !== t.fromEmail.split('@')[0]) {
      try { upsertContact(userId, t.fromEmail, t.fromName); } catch {}
    }
  }
}

export async function GET(request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const view = searchParams.get('view'); // 'screener', 'imbox', 'reply_later', 'set_aside'
  const threadId = searchParams.get('threadId'); // for single thread detail

  // Single thread detail (full messages)
  if (threadId) {
    try {
      const thread = await getThreadFull(userId, threadId);
      const messages = parseFullThread(thread);

      // Mark as read in Gmail (fire-and-forget)
      markThreadRead(userId, threadId).catch(err =>
        console.warn('Failed to mark thread read:', err.message)
      );

      return NextResponse.json({ thread: { threadId: thread.id, messages } });
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // Reply Later / Set Aside — read from local DB, then fetch thread metadata
  if (view === 'reply_later' || view === 'set_aside') {
    const folder = view === 'reply_later' ? 'REPLY_LATER' : 'SET_ASIDE';
    const rows = getThreadsByFolder(userId, folder);
    if (rows.length === 0) return NextResponse.json({ threads: [] });

    const rawThreads = await getThreadsBatch(userId, rows.map(r => r.thread_id));
    const threads = rawThreads.map(parseThreadSummary).filter(Boolean);
    saveContactsFromThreads(userId, threads);
    return NextResponse.json({ threads });
  }

  // Sent mail — fetch sent threads, no sender filtering
  if (view === 'sent') {
    try {
      const threadList = await listSentThreads(userId);
      if (threadList.length === 0) return NextResponse.json({ threads: [] });

      const rawThreads = await getThreadsBatch(userId, threadList.map(t => t.id));
      const threads = rawThreads.map(parseThreadSummary).filter(Boolean);
      saveContactsFromThreads(userId, threads);
      return NextResponse.json({ threads });
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // Screener or Imbox — fetch inbox threads and filter by sender status
  try {
    const threadList = await listInboxThreads(userId);
    if (threadList.length === 0) return NextResponse.json({ threads: [] });

    const approved = new Set(getAllApprovedEmails(userId));
    const denied = new Set(getAllDeniedEmails(userId));

    const rawThreads = await getThreadsBatch(userId, threadList.map(t => t.id));
    const allSummaries = rawThreads.map(parseThreadSummary).filter(Boolean);
    saveContactsFromThreads(userId, allSummaries);
    const threads = [];
    for (const summary of allSummaries) {
      const email = summary.fromEmail;
      const isApproved = approved.has(email);
      const isDenied = denied.has(email);

      if (view === 'screener') {
        if (!isApproved && !isDenied) threads.push(summary);
      } else if (view === 'imbox') {
        if (isApproved) threads.push(summary);
      } else if (view === 'screened_out') {
        if (isDenied) threads.push(summary);
      } else {
        threads.push({ ...summary, senderStatus: isApproved ? 'APPROVED' : isDenied ? 'DENIED' : null });
      }
    }

    return NextResponse.json({ threads });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

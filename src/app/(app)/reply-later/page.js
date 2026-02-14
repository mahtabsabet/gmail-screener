'use client';

import { useState, useEffect, useCallback } from 'react';
import ThreadList, { ActionButton } from '@/components/ThreadList';
import FocusReply from '@/components/FocusReply';

export default function ReplyLaterPage() {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [focusThread, setFocusThread] = useState(null);
  const [focusIndex, setFocusIndex] = useState(0);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/threads?view=reply_later');
      const data = await res.json();
      setThreads(data.threads || []);
    } catch (err) {
      console.error('Failed to fetch reply later:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  async function openThread(thread, index) {
    try {
      const res = await fetch(`/api/threads?threadId=${thread.threadId}`);
      const data = await res.json();
      setFocusThread({ ...thread, messages: data.thread?.messages || [] });
      setFocusIndex(index !== undefined ? index : 0);
    } catch (err) {
      console.error('Failed to fetch thread:', err);
    }
  }

  async function handleMoveToImbox(threadId) {
    await fetch('/api/threads/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, action: 'MOVE_TO_IMBOX' }),
    });
    setThreads(prev => prev.filter(t => t.threadId !== threadId));
  }

  function handleReplySent(threadId) {
    // Thread auto-archived by API, move to next
    setThreads(prev => prev.filter(t => t.threadId !== threadId));

    const remaining = threads.filter(t => t.threadId !== threadId);
    if (remaining.length > 0 && focusIndex < remaining.length) {
      openThread(remaining[focusIndex], focusIndex);
    } else {
      setFocusThread(null);
    }
  }

  function startFocusMode() {
    if (threads.length > 0) {
      openThread(threads[0], 0);
    }
  }

  return (
    <div className="h-full">
      <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Reply Later</h2>
          <p className="text-sm text-gray-500">Your focus stack — reply one at a time</p>
        </div>
        {threads.length > 0 && (
          <button
            onClick={startFocusMode}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Focus & Reply ({threads.length})
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>
      ) : (
        <ThreadList
          threads={threads}
          onThreadClick={(thread) => openThread(thread, threads.indexOf(thread))}
          emptyMessage="No emails to reply to. Move emails here from the Imbox."
          actions={(thread) => (
            <ActionButton
              onClick={() => handleMoveToImbox(thread.threadId)}
              title="Move back to Imbox"
              variant="default"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
              </svg>
            </ActionButton>
          )}
        />
      )}

      {focusThread && (
        <FocusReply
          thread={focusThread}
          onClose={() => setFocusThread(null)}
          onReplySent={handleReplySent}
        />
      )}
    </div>
  );
}

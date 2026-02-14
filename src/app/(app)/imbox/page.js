'use client';

import { useState, useEffect, useCallback } from 'react';
import ThreadList, { ActionButton } from '@/components/ThreadList';
import FocusReply from '@/components/FocusReply';

export default function ImboxPage() {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [focusThread, setFocusThread] = useState(null);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/threads?view=imbox');
      const data = await res.json();
      setThreads(data.threads || []);
    } catch (err) {
      console.error('Failed to fetch imbox:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  async function handleTriage(threadId, action) {
    await fetch('/api/threads/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, action }),
    });
    setThreads(prev => prev.filter(t => t.threadId !== threadId));
  }

  async function openThread(thread) {
    try {
      const res = await fetch(`/api/threads?threadId=${thread.threadId}`);
      const data = await res.json();
      setFocusThread({ ...thread, messages: data.thread?.messages || [] });
    } catch (err) {
      console.error('Failed to fetch thread:', err);
    }
  }

  return (
    <div className="h-full">
      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <h2 className="text-lg font-semibold text-gray-900">Imbox</h2>
        <p className="text-sm text-gray-500">Emails from approved senders</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>
      ) : (
        <ThreadList
          threads={threads}
          onThreadClick={openThread}
          emptyMessage="Your Imbox is empty. Approve senders in the Screener to see emails here."
          actions={(thread) => (
            <>
              <ActionButton
                onClick={() => handleTriage(thread.threadId, 'REPLY_LATER')}
                title="Reply Later"
                variant="blue"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </ActionButton>
              <ActionButton
                onClick={() => handleTriage(thread.threadId, 'SET_ASIDE')}
                title="Set Aside"
                variant="default"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
                </svg>
              </ActionButton>
            </>
          )}
        />
      )}

      {focusThread && (
        <FocusReply
          thread={focusThread}
          onClose={() => setFocusThread(null)}
          onReplySent={() => {
            setFocusThread(null);
            fetchThreads();
          }}
        />
      )}
    </div>
  );
}

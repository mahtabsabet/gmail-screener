'use client';

import { useState, useEffect, useCallback } from 'react';
import ThreadList from '@/components/ThreadList';
import FocusReply from '@/components/FocusReply';

export default function SentPage() {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [focusThread, setFocusThread] = useState(null);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/threads?view=sent');
      const data = await res.json();
      setThreads(data.threads || []);
    } catch (err) {
      console.error('Failed to fetch sent:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

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
        <h2 className="text-lg font-semibold text-gray-900">Sent</h2>
        <p className="text-sm text-gray-500">Emails you've sent</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>
      ) : (
        <ThreadList
          threads={threads}
          onThreadClick={openThread}
          emptyMessage="No sent emails found."
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

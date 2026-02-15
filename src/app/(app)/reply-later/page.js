'use client';

import { useState, useEffect, useCallback } from 'react';
import ThreadList, { ActionButton } from '@/components/ThreadList';
import ThreadDetail from '@/components/ThreadDetail';

export default function ReplyLaterPage() {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedThread, setSelectedThread] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

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

  async function openThread(thread) {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/threads?threadId=${thread.threadId}`);
      const data = await res.json();
      setSelectedThread({ ...thread, messages: data.thread?.messages || [] });
    } catch (err) {
      console.error('Failed to fetch thread:', err);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleMoveToImbox(threadId) {
    await fetch('/api/threads/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, action: 'MOVE_TO_IMBOX' }),
    });
    setThreads(prev => prev.filter(t => t.threadId !== threadId));
    if (selectedThread?.threadId === threadId) setSelectedThread(null);
  }

  function handleReplySent(threadId) {
    setThreads(prev => prev.filter(t => t.threadId !== threadId));
    setSelectedThread(null);
  }

  return (
    <div className="flex h-full">
      {/* Email list */}
      <div className={`${selectedThread ? 'w-96' : 'w-full'} flex-shrink-0 border-r border-gray-200 flex flex-col h-full overflow-hidden transition-all`}>
        <div className="px-6 py-4 border-b border-gray-200 bg-white flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Reply Later</h2>
          <p className="text-sm text-gray-500">Your focus stack — reply one at a time</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>
          ) : (
            <ThreadList
              threads={threads}
              selectedThreadId={selectedThread?.threadId}
              onThreadClick={openThread}
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
        </div>
      </div>

      {/* Detail panel */}
      {selectedThread ? (
        <div className="flex-1 min-w-0 overflow-hidden">
          {loadingDetail ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading...</div>
          ) : (
            <ThreadDetail
              thread={selectedThread}
              onClose={() => setSelectedThread(null)}
              onReplySent={handleReplySent}
              actions={
                <button
                  onClick={() => handleMoveToImbox(selectedThread.threadId)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-gray-200 text-gray-700 rounded-full hover:bg-gray-50 transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                    <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
                  </svg>
                  Move to Imbox
                </button>
              }
            />
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-300">
          <div className="text-center">
            <svg className="w-16 h-16 mx-auto mb-3 text-gray-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <p className="text-sm">Select an email to read and reply</p>
          </div>
        </div>
      )}
    </div>
  );
}

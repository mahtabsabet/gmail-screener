'use client';

import { useState, useEffect, useCallback } from 'react';
import ThreadList, { ActionButton } from '@/components/ThreadList';
import ThreadDetail from '@/components/ThreadDetail';
import ContactCard from '@/components/ContactCard';

export default function ImboxPage() {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedThread, setSelectedThread] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [contactCard, setContactCard] = useState(null);

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
    if (selectedThread?.threadId === threadId) setSelectedThread(null);
  }

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

  return (
    <div className="flex h-full">
      {/* Email list */}
      <div className={`${selectedThread ? 'w-96' : 'w-full'} flex-shrink-0 border-r border-gray-200 flex flex-col h-full overflow-hidden transition-all`}>
        <div className="px-6 py-4 border-b border-gray-200 bg-white flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">The Imbox</h2>
          <p className="text-sm text-gray-500">{threads.length} messages</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>
          ) : (
            <ThreadList
              threads={threads}
              selectedThreadId={selectedThread?.threadId}
              onThreadClick={openThread}
              onSenderClick={setContactCard}
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
              onSenderClick={setContactCard}
              onReplySent={(threadId) => {
                setSelectedThread(null);
                fetchThreads();
              }}
              actions={
                <>
                  <button
                    onClick={() => handleTriage(selectedThread.threadId, 'REPLY_LATER')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-gray-200 text-gray-700 rounded-full hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    Reply Later
                  </button>
                  <button
                    onClick={() => handleTriage(selectedThread.threadId, 'SET_ASIDE')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-gray-200 text-gray-700 rounded-full hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200 transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
                    </svg>
                    Set Aside
                  </button>
                </>
              }
            />
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-300">
          <div className="text-center">
            <svg className="w-16 h-16 mx-auto mb-3 text-gray-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z" />
              <polyline points="22 6 12 13 2 6" />
            </svg>
            <p className="text-sm">Select an email to read</p>
          </div>
        </div>
      )}

      {contactCard && (
        <ContactCard
          email={contactCard.email}
          name={contactCard.name}
          onClose={() => setContactCard(null)}
          onThreadClick={(thread) => {
            setContactCard(null);
            openThread(thread);
          }}
        />
      )}
    </div>
  );
}

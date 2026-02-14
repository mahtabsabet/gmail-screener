'use client';

import { useState, useEffect, useCallback } from 'react';
import ThreadList, { ActionButton } from '@/components/ThreadList';
import FocusReply from '@/components/FocusReply';
import ContactCard from '@/components/ContactCard';

export default function SetAsidePage() {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [focusThread, setFocusThread] = useState(null);
  const [contactCard, setContactCard] = useState(null);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/threads?view=set_aside');
      const data = await res.json();
      setThreads(data.threads || []);
    } catch (err) {
      console.error('Failed to fetch set aside:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  async function handleMoveToImbox(threadId) {
    await fetch('/api/threads/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, action: 'MOVE_TO_IMBOX' }),
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
        <h2 className="text-lg font-semibold text-gray-900">Set Aside</h2>
        <p className="text-sm text-gray-500">Reference dock — emails you want to keep handy</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>
      ) : (
        <ThreadList
          threads={threads}
          onThreadClick={openThread}
          onSenderClick={setContactCard}
          emptyMessage="Nothing set aside. Move emails here from the Imbox."
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
          onSenderClick={setContactCard}
          onReplySent={() => {
            setFocusThread(null);
            fetchThreads();
          }}
        />
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

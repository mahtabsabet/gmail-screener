'use client';

import { useState, useEffect, useCallback } from 'react';
import ThreadList, { ActionButton } from '@/components/ThreadList';
import FocusReply from '@/components/FocusReply';
import ContactCard from '@/components/ContactCard';

export default function ScreenedOutPage() {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [focusThread, setFocusThread] = useState(null);
  const [contactCard, setContactCard] = useState(null);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/threads?view=screened_out');
      const data = await res.json();
      setThreads(data.threads || []);
    } catch (err) {
      console.error('Failed to fetch screened out:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  async function handleApprove(email) {
    await fetch('/api/senders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, status: 'APPROVED' }),
    });
    setThreads(prev => prev.filter(t => t.fromEmail !== email));
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
        <h2 className="text-lg font-semibold text-gray-900">Screened Out</h2>
        <p className="text-sm text-gray-500">Emails from denied senders</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>
      ) : (
        <ThreadList
          threads={threads}
          onThreadClick={openThread}
          onSenderClick={setContactCard}
          emptyMessage="No screened out emails in your inbox."
          actions={(thread) => (
            <ActionButton
              onClick={() => handleApprove(thread.fromEmail)}
              title="Approve sender"
              variant="approve"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
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

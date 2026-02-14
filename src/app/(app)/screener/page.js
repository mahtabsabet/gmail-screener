'use client';

import { useState, useEffect, useCallback } from 'react';
import ThreadList, { ActionButton } from '@/components/ThreadList';

export default function ScreenerPage() {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/threads?view=screener');
      const data = await res.json();
      setThreads(data.threads || []);
    } catch (err) {
      console.error('Failed to fetch screener:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  // Group by sender for the screener view
  const senderMap = new Map();
  for (const thread of threads) {
    const key = thread.fromEmail;
    if (!senderMap.has(key)) {
      senderMap.set(key, { ...thread, threadCount: 1 });
    } else {
      senderMap.get(key).threadCount++;
    }
  }
  const uniqueSenders = Array.from(senderMap.values());

  async function handleDecision(email, status) {
    await fetch('/api/senders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, status }),
    });
    setThreads(prev => prev.filter(t => t.fromEmail !== email));
  }

  return (
    <div className="h-full">
      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <h2 className="text-lg font-semibold text-gray-900">Screener</h2>
        <p className="text-sm text-gray-500">
          Emails from unknown senders. Approve or deny them.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {uniqueSenders.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
              No new senders to screen. You're all caught up!
            </div>
          ) : (
            uniqueSenders.map((sender) => (
              <div
                key={sender.fromEmail}
                className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors"
              >
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                  {(sender.fromName || sender.fromEmail || '?')[0].toUpperCase()}
                </div>

                {/* Sender info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-900">
                      {sender.fromName || sender.fromEmail}
                    </span>
                    {sender.threadCount > 1 && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                        {sender.threadCount}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">{sender.fromEmail}</div>
                  <div className="text-sm text-gray-600 truncate mt-0.5">
                    {sender.subject} — {sender.snippet}
                  </div>
                </div>

                {/* Approve / Deny */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleDecision(sender.fromEmail, 'APPROVED')}
                    className="p-2.5 rounded-full bg-green-50 text-green-600 hover:bg-green-100 hover:text-green-800 transition-colors"
                    title="Approve — show in Imbox"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDecision(sender.fromEmail, 'DENIED')}
                    className="p-2.5 rounded-full bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-700 transition-colors"
                    title="Deny — hide forever"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

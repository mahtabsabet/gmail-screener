'use client';

import { useState, useEffect, useCallback } from 'react';

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default function ContactCard({ email, name, onClose, onThreadClick }) {
  const [contact, setContact] = useState(null);
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchContactData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contacts?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      setContact(data.contact);
      setThreads(data.threads || []);
    } catch (err) {
      console.error('Failed to fetch contact:', err);
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => { fetchContactData(); }, [fetchContactData]);

  const displayName = contact?.name || name || email.split('@')[0];
  const initial = (displayName || email)[0].toUpperCase();
  const photoUrl = contact?.photoUrl;
  const phoneNumbers = contact?.phoneNumbers || [];
  const organizations = contact?.organizations || [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden animate-slide-in">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-200 bg-gray-50">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={displayName}
                  className="w-14 h-14 rounded-full flex-shrink-0 object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xl font-bold flex-shrink-0">
                  {initial}
                </div>
              )}
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-gray-900 truncate">{displayName}</h2>
                <p className="text-sm text-gray-500 truncate">{email}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 flex-shrink-0"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Contact details (from Google People API) */}
        {(organizations.length > 0 || phoneNumbers.length > 0) && (
          <div className="px-6 py-4 border-b border-gray-100 space-y-2">
            {organizations.map((org, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-gray-600">
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
                  <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
                  <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
                  <path d="M10 6h4" />
                  <path d="M10 10h4" />
                  <path d="M10 14h4" />
                  <path d="M10 18h4" />
                </svg>
                <span>
                  {org.title && org.name ? `${org.title} at ${org.name}` : org.name || org.title}
                </span>
              </div>
            ))}
            {phoneNumbers.map((phone, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-gray-600">
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                <span>{phone.value}</span>
                <span className="text-xs text-gray-400">({phone.type})</span>
              </div>
            ))}
          </div>
        )}

        {/* Email threads */}
        <div className="flex-1 overflow-auto">
          <div className="px-6 py-3 border-b border-gray-100">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Emails ({loading ? '...' : threads.length})
            </h3>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
              Loading...
            </div>
          ) : threads.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
              No emails found.
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {threads.map((thread) => (
                <button
                  key={thread.threadId}
                  onClick={() => onThreadClick?.(thread)}
                  className="w-full text-left px-6 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm truncate ${thread.isUnread ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                      {thread.fromEmail === email ? 'From them' : 'To them'}
                    </span>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {formatDate(thread.date)}
                    </span>
                  </div>
                  <div className={`text-sm truncate ${thread.isUnread ? 'font-medium text-gray-900' : 'text-gray-600'}`}>
                    {thread.subject}
                  </div>
                  <div className="text-xs text-gray-400 truncate mt-0.5">
                    {thread.snippet}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

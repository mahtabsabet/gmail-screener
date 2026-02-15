'use client';

import { useState, useCallback } from 'react';
import ThreadList from '@/components/ThreadList';
import FocusReply from '@/components/FocusReply';
import ContactCard from '@/components/ContactCard';
import ContactAvatar from '@/components/ContactAvatar';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [threads, setThreads] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [focusThread, setFocusThread] = useState(null);
  const [contactCard, setContactCard] = useState(null);

  const handleSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      setThreads(data.threads || []);
      setContacts(data.contacts || []);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  }, [query]);

  async function openThread(thread) {
    try {
      const res = await fetch(`/api/threads?threadId=${thread.threadId}`);
      const data = await res.json();
      setFocusThread({ ...thread, messages: data.thread?.messages || [] });
    } catch (err) {
      console.error('Failed to fetch thread:', err);
    }
  }

  function openContactCard(sender) {
    setContactCard(sender);
  }

  return (
    <div className="h-full">
      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <h2 className="text-lg font-semibold text-gray-900">Search</h2>
        <form onSubmit={handleSearch} className="mt-3 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emails and contacts..."
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Searching...</div>
      ) : (
        <>
          {/* Contact results */}
          {contacts.length > 0 && (
            <div className="border-b border-gray-200">
              <div className="px-6 py-3 bg-gray-50">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Contacts ({contacts.length})
                </h3>
              </div>
              <div className="divide-y divide-gray-50">
                {contacts.map((contact) => (
                  <button
                    key={contact.email}
                    onClick={() => openContactCard({ email: contact.email, name: contact.name })}
                    className="w-full flex items-center gap-3 px-6 py-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    <ContactAvatar
                      photoUrl={contact.photoUrl}
                      name={contact.name || contact.email}
                      size="w-9 h-9"
                      textSize="text-sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {contact.name || contact.email}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {contact.organization ? `${contact.organization} · ` : ''}{contact.email}
                      </div>
                    </div>
                    {contact.status && (
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                        contact.status === 'APPROVED'
                          ? 'bg-green-50 text-green-700'
                          : 'bg-red-50 text-red-600'
                      }`}>
                        {contact.status === 'APPROVED' ? 'Approved' : 'Denied'}
                      </span>
                    )}
                    <svg className="w-4 h-4 text-gray-300 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Email results */}
          {searched && (
            <>
              {contacts.length > 0 && threads.length > 0 && (
                <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    Emails ({threads.length})
                  </h3>
                </div>
              )}
              <ThreadList
                threads={threads}
                onThreadClick={openThread}
                onSenderClick={openContactCard}
                emptyMessage={contacts.length > 0 ? 'No matching emails.' : 'No results found.'}
              />
            </>
          )}
        </>
      )}

      {focusThread && (
        <FocusReply
          thread={focusThread}
          onClose={() => setFocusThread(null)}
          onSenderClick={(sender) => {
            setContactCard(sender);
          }}
          onReplySent={() => {
            setFocusThread(null);
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

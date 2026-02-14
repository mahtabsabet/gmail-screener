'use client';

import { useState, useCallback } from 'react';
import ThreadList from '@/components/ThreadList';
import FocusReply from '@/components/FocusReply';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [focusThread, setFocusThread] = useState(null);

  const handleSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      setThreads(data.threads || []);
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

  return (
    <div className="h-full">
      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <h2 className="text-lg font-semibold text-gray-900">Search</h2>
        <form onSubmit={handleSearch} className="mt-3 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emails... (supports Gmail syntax: from:, subject:, has:attachment, etc.)"
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
        <ThreadList
          threads={threads}
          onThreadClick={openThread}
          emptyMessage={searched ? 'No results found.' : 'Enter a search query above.'}
        />
      )}

      {focusThread && (
        <FocusReply
          thread={focusThread}
          onClose={() => setFocusThread(null)}
          onReplySent={() => {
            setFocusThread(null);
          }}
        />
      )}
    </div>
  );
}

'use client';

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

export default function ThreadList({ threads, actions, onThreadClick, emptyMessage }) {
  if (threads.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        {emptyMessage || 'No emails here.'}
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {threads.map((thread) => (
        <div
          key={thread.threadId}
          className="flex items-center gap-4 px-6 py-3 hover:bg-gray-50 transition-colors group"
        >
          {/* Sender avatar */}
          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
            {(thread.fromName || thread.fromEmail || '?')[0].toUpperCase()}
          </div>

          {/* Thread info — clickable */}
          <button
            onClick={() => onThreadClick?.(thread)}
            className="flex-1 min-w-0 text-left"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-gray-900 truncate">
                {thread.fromName || thread.fromEmail}
              </span>
              <span className="text-xs text-gray-400 flex-shrink-0">
                {formatDate(thread.date)}
              </span>
            </div>
            <div className="text-sm text-gray-700 truncate">
              {thread.subject}
            </div>
            <div className="text-xs text-gray-400 truncate">
              {thread.snippet}
            </div>
          </button>

          {/* Action buttons */}
          {actions && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              {actions(thread)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ActionButton({ onClick, title, variant = 'default', children }) {
  const variants = {
    approve: 'hover:bg-green-50 hover:text-green-700',
    deny: 'hover:bg-red-50 hover:text-red-700',
    default: 'hover:bg-gray-100 hover:text-gray-700',
    blue: 'hover:bg-blue-50 hover:text-blue-700',
  };

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className={`p-2 rounded-full text-gray-400 transition-colors ${variants[variant] || variants.default}`}
    >
      {children}
    </button>
  );
}

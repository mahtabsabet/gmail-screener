'use client';

import { useState, useMemo } from 'react';
import DOMPurify from 'dompurify';

function formatFullDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString([], {
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function formatShortDate(dateStr) {
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

export default function ThreadDetail({ thread, onClose, actions, onReplySent, onSenderClick }) {
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [showReply, setShowReply] = useState(false);

  if (!thread) return null;

  const messages = thread.messages || [];
  const lastMsg = messages[messages.length - 1];
  const senderName = lastMsg?.fromName || lastMsg?.fromEmail || 'Unknown';
  const senderEmail = lastMsg?.fromEmail || '';

  async function handleSend() {
    if (!replyBody.trim() || !lastMsg) return;
    setSending(true);
    try {
      const res = await fetch('/api/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: thread.threadId,
          to: lastMsg.fromEmail || lastMsg.from,
          subject: lastMsg.subject || '',
          body: replyBody,
          messageId: lastMsg.messageId || '',
          references: lastMsg.references || '',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setReplyBody('');
        setShowReply(false);
        onReplySent?.(thread.threadId);
      } else {
        alert(`Failed to send: ${data.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 pt-6 pb-4 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => onSenderClick?.({ email: senderEmail, name: senderName })}
              className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold flex-shrink-0 hover:ring-2 hover:ring-blue-300 transition-all"
              title={`View contact: ${senderName}`}
            >
              {senderName[0].toUpperCase()}
            </button>
            <div>
              <button
                onClick={() => onSenderClick?.({ email: senderEmail, name: senderName })}
                className="font-semibold text-gray-900 hover:text-blue-600 hover:underline"
              >
                {senderName}
              </button>
              <div className="text-xs text-gray-500">{senderEmail}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{formatFullDate(lastMsg?.date)}</span>
            {onClose && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          {thread.subject || lastMsg?.subject || '(no subject)'}
        </h2>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowReply(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
            </svg>
            Reply
          </button>
          {actions}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.map((msg, i) => (
          <MessageItem key={msg.id || i} msg={msg} defaultExpanded={i === messages.length - 1} onSenderClick={onSenderClick} />
        ))}
      </div>

      {/* Reply composer */}
      {showReply && (
        <div className="border-t border-gray-200 p-4 flex-shrink-0">
          <div className="text-xs text-gray-400 mb-2">
            Replying to {lastMsg?.fromName || lastMsg?.fromEmail}
          </div>
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Write your reply..."
            className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={4}
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => { setShowReply(false); setReplyBody(''); }}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={!replyBody.trim() || sending}
              className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function sanitizeHtml(html) {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'u', 'em', 'strong', 'a', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code',
      'div', 'span', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img', 'hr'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'style', 'width', 'height',
      'target', 'rel', 'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  });
}

function MessageItem({ msg, defaultExpanded, onSenderClick }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const senderName = msg.fromName || msg.fromEmail || 'Unknown';
  const senderEmail = msg.fromEmail || '';
  const sanitizedBody = useMemo(() => sanitizeHtml(msg.body), [msg.body]);

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      {/* Clickable header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-8 py-3 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            onClick={(e) => { e.stopPropagation(); onSenderClick?.({ email: senderEmail, name: senderName }); }}
            className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-xs font-semibold flex-shrink-0 hover:ring-2 hover:ring-blue-300 transition-all cursor-pointer"
          >
            {senderName[0].toUpperCase()}
          </div>
          <span
            className="text-sm font-medium text-gray-900 truncate hover:text-blue-600 hover:underline"
            onClick={(e) => { e.stopPropagation(); onSenderClick?.({ email: senderEmail, name: senderName }); }}
          >
            {senderName}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-400">{formatShortDate(msg.date)}</span>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-8 pb-6">
          {sanitizedBody ? (
            <div
              className="text-sm text-gray-700 prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizedBody }}
            />
          ) : msg.snippet ? (
            <div className="text-sm text-gray-700 whitespace-pre-wrap">{msg.snippet}</div>
          ) : (
            <div className="text-sm text-gray-400 italic">No content</div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useMemo } from 'react';
import DOMPurify from 'dompurify';

export default function FocusReply({ thread, onClose, onReplySent, onSenderClick }) {
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);

  const sanitizeHtml = useMemo(() => {
    return (html) => {
      if (!html) return '';
      return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'u', 'em', 'strong', 'a', 'ul', 'ol', 'li',
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code',
          'div', 'span', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img', 'hr'],
        ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'style', 'width', 'height',
          'target', 'rel', 'colspan', 'rowspan'],
        ALLOW_DATA_ATTR: false,
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
      });
    };
  }, []);

  if (!thread) return null;

  const messages = thread.messages || [];
  const lastMsg = messages[messages.length - 1];

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

  function handleSenderClick(msg) {
    if (onSenderClick) {
      onSenderClick({ email: msg.fromEmail, name: msg.fromName });
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="font-semibold text-lg text-gray-900">Focus & Reply</h2>
            <p className="text-sm text-gray-500">{lastMsg?.subject || '(no subject)'}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Message thread */}
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className="border border-gray-100 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => handleSenderClick(msg)}
                  className="font-medium text-sm text-gray-900 hover:text-blue-600 hover:underline transition-colors"
                  title={`View contact: ${msg.fromEmail}`}
                >
                  {msg.fromName || msg.fromEmail}
                </button>
                <span className="text-xs text-gray-400">
                  {msg.date}
                </span>
              </div>
              <div
                className="text-sm text-gray-700 prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(msg.body || msg.snippet || '') }}
              />
            </div>
          ))}
        </div>

        {/* Reply compose */}
        <div className="border-t border-gray-200 p-4">
          <div className="text-xs text-gray-400 mb-2">
            Replying to {lastMsg?.fromName || lastMsg?.fromEmail}
          </div>
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Write your reply..."
            className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={4}
          />
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={!replyBody.trim() || sending}
              className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {sending ? 'Sending...' : 'Send Reply'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

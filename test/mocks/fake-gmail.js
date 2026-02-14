/**
 * FakeGmail: An in-memory Gmail API simulator.
 *
 * Maintains state for labels, messages, threads, filters, and history.
 * Used to replace `gmailFetch` in background.js tests so we can verify
 * full workflows without hitting the real API.
 */
'use strict';

class FakeGmail {
  constructor() {
    this.reset();
  }

  reset() {
    this._nextId = 1;
    this._historyId = 1000;
    this._labels = new Map();   // id -> { id, name, labelListVisibility, messageListVisibility }
    this._messages = new Map(); // id -> { id, threadId, labelIds: [] }
    this._threads = new Map();  // id -> { id, messages: [msgId, ...] }
    this._filters = new Map();  // id -> { id, criteria, action }
    this._history = [];         // { id, messagesAdded, labelsAdded, labelsRemoved }
    this._calls = [];           // Record of all API calls for assertions

    // Seed system labels
    this._addSystemLabel('INBOX');
    this._addSystemLabel('SENT');
    this._addSystemLabel('TRASH');
    this._addSystemLabel('SPAM');
    this._addSystemLabel('UNREAD');
    this._addSystemLabel('STARRED');
    this._addSystemLabel('DRAFT');
  }

  _addSystemLabel(name) {
    this._labels.set(name, {
      id: name,
      name,
      type: 'system',
      messagesTotal: 0,
      messagesUnread: 0,
      threadsTotal: 0,
      threadsUnread: 0,
    });
  }

  _genId(prefix = '') {
    return `${prefix}${this._nextId++}`;
  }

  _bumpHistory() {
    return String(++this._historyId);
  }

  /**
   * Add a message to the fake mailbox.
   * Returns the created message object.
   */
  addMessage({ threadId, labelIds = ['INBOX'], from, subject, snippet } = {}) {
    const msgId = this._genId('msg_');
    threadId = threadId || this._genId('thread_');

    const msg = {
      id: msgId,
      threadId,
      labelIds: [...labelIds],
      payload: {
        headers: [
          { name: 'From', value: from || 'sender@example.com' },
          { name: 'Subject', value: subject || 'Test subject' },
          { name: 'Date', value: new Date().toISOString() },
        ],
      },
      snippet: snippet || 'Test snippet...',
    };

    this._messages.set(msgId, msg);

    // Maintain thread
    if (!this._threads.has(threadId)) {
      this._threads.set(threadId, { id: threadId, messages: [] });
    }
    this._threads.get(threadId).messages.push(msgId);

    // Update label counts
    for (const lid of labelIds) {
      if (this._labels.has(lid)) {
        this._labels.get(lid).messagesTotal++;
        this._labels.get(lid).threadsTotal =
          this._countThreadsWithLabel(lid);
      }
    }

    return msg;
  }

  _countThreadsWithLabel(labelId) {
    const threadIds = new Set();
    for (const [, msg] of this._messages) {
      if (msg.labelIds.includes(labelId)) {
        threadIds.add(msg.threadId);
      }
    }
    return threadIds.size;
  }

  _recountLabel(labelId) {
    if (!this._labels.has(labelId)) return;
    const label = this._labels.get(labelId);
    let msgCount = 0;
    const threadIds = new Set();
    for (const [, msg] of this._messages) {
      if (msg.labelIds.includes(labelId)) {
        msgCount++;
        threadIds.add(msg.threadId);
      }
    }
    label.messagesTotal = msgCount;
    label.threadsTotal = threadIds.size;
  }

  /**
   * Process a gmailFetch-style request.
   * path: e.g. '/labels', '/messages/msg_1/modify'
   * options: { method, body }
   */
  async handleRequest(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    this._calls.push({ path, method, body });

    // --- Profile ---
    if (path === '/profile' && method === 'GET') {
      return { emailAddress: 'test@gmail.com', historyId: String(this._historyId) };
    }

    // --- Labels ---
    if (path === '/labels' && method === 'GET') {
      return { labels: Array.from(this._labels.values()) };
    }

    if (path === '/labels' && method === 'POST') {
      const id = this._genId('Label_');
      const label = {
        id,
        name: body.name,
        labelListVisibility: body.labelListVisibility || 'labelShow',
        messageListVisibility: body.messageListVisibility || 'show',
        type: 'user',
        messagesTotal: 0,
        messagesUnread: 0,
        threadsTotal: 0,
        threadsUnread: 0,
      };
      this._labels.set(id, label);
      return label;
    }

    const labelMatch = path.match(/^\/labels\/(.+)$/);
    if (labelMatch && method === 'GET') {
      const label = this._labels.get(labelMatch[1]);
      if (!label) throw this._error(404, 'Label not found');
      this._recountLabel(label.id);
      return { ...label };
    }

    // --- Messages ---
    const msgSearchMatch = path.match(/^\/messages\?(.+)$/);
    if (msgSearchMatch && method === 'GET') {
      const params = new URLSearchParams(msgSearchMatch[1]);
      const query = params.get('q') || '';
      const maxResults = parseInt(params.get('maxResults') || '100', 10);
      const results = this._searchMessages(query, maxResults);
      return {
        messages: results.map((m) => ({ id: m.id, threadId: m.threadId })),
        resultSizeEstimate: results.length,
      };
    }

    const msgModifyMatch = path.match(/^\/messages\/([^/]+)\/modify$/);
    if (msgModifyMatch && method === 'POST') {
      const msg = this._messages.get(msgModifyMatch[1]);
      if (!msg) throw this._error(404, 'Message not found');

      const addLabelIds = body.addLabelIds || [];
      const removeLabelIds = body.removeLabelIds || [];

      const historyEntry = {
        id: this._bumpHistory(),
        labelsAdded: [],
        labelsRemoved: [],
        messagesAdded: [],
      };

      for (const lid of removeLabelIds) {
        const idx = msg.labelIds.indexOf(lid);
        if (idx !== -1) {
          msg.labelIds.splice(idx, 1);
          historyEntry.labelsRemoved.push({
            message: { id: msg.id, threadId: msg.threadId, labelIds: [...msg.labelIds] },
            labelIds: [lid],
          });
        }
      }

      for (const lid of addLabelIds) {
        if (!msg.labelIds.includes(lid)) {
          msg.labelIds.push(lid);
          historyEntry.labelsAdded.push({
            message: { id: msg.id, threadId: msg.threadId, labelIds: [...msg.labelIds] },
            labelIds: [lid],
          });
        }
      }

      if (historyEntry.labelsAdded.length > 0 || historyEntry.labelsRemoved.length > 0) {
        this._history.push(historyEntry);
      }

      return msg;
    }

    // --- Threads ---
    const threadMatch = path.match(/^\/threads\/([^?]+)/);
    if (threadMatch && method === 'GET') {
      const threadId = threadMatch[1];
      const thread = this._threads.get(threadId);
      if (!thread) throw this._error(404, 'Thread not found');
      const messages = thread.messages.map((mid) => {
        const msg = this._messages.get(mid);
        return msg ? { ...msg } : null;
      }).filter(Boolean);
      return { id: threadId, messages, snippet: messages[0]?.snippet || '' };
    }

    const threadListMatch = path.match(/^\/threads\?(.+)$/);
    if (threadListMatch && method === 'GET') {
      const params = new URLSearchParams(threadListMatch[1]);
      const labelIds = params.get('labelIds');
      const maxResults = parseInt(params.get('maxResults') || '50', 10);
      const matchingThreads = [];
      if (labelIds) {
        for (const [tid, thread] of this._threads) {
          const hasLabel = thread.messages.some((mid) => {
            const msg = this._messages.get(mid);
            return msg && msg.labelIds.includes(labelIds);
          });
          if (hasLabel) matchingThreads.push({ id: tid });
          if (matchingThreads.length >= maxResults) break;
        }
      }
      return { threads: matchingThreads.length > 0 ? matchingThreads : undefined };
    }

    // --- Filters ---
    if (path === '/settings/filters' && method === 'GET') {
      return { filter: Array.from(this._filters.values()) };
    }

    if (path === '/settings/filters' && method === 'POST') {
      const id = this._genId('filter_');
      const filter = { id, criteria: body.criteria, action: body.action };
      this._filters.set(id, filter);
      return filter;
    }

    const filterDeleteMatch = path.match(/^\/settings\/filters\/(.+)$/);
    if (filterDeleteMatch && method === 'DELETE') {
      if (!this._filters.has(filterDeleteMatch[1])) {
        throw this._error(404, 'Filter not found');
      }
      this._filters.delete(filterDeleteMatch[1]);
      return null;
    }

    // --- History ---
    const historyMatch = path.match(/^\/history\?(.+)$/);
    if (historyMatch && method === 'GET') {
      const params = new URLSearchParams(historyMatch[1]);
      const startHistoryId = parseInt(params.get('startHistoryId'), 10);

      if (startHistoryId < this._historyId - 10000) {
        throw this._error(404, 'Start history ID is too old');
      }

      const matching = this._history.filter((h) => parseInt(h.id, 10) > startHistoryId);
      return {
        history: matching.length > 0 ? matching : undefined,
        historyId: String(this._historyId),
      };
    }

    throw this._error(400, `Unhandled fake request: ${method} ${path}`);
  }

  /**
   * Simple message search. Supports:
   *  - from:sender
   *  - label:"Name" or label:Name
   *  - in:inbox
   */
  _searchMessages(query, maxResults) {
    const tokens = this._parseQuery(query);
    let results = Array.from(this._messages.values());

    for (const { type, value } of tokens) {
      if (type === 'from') {
        const target = value.toLowerCase();
        results = results.filter((m) => {
          const fromHeader = (m.payload?.headers || []).find((h) => h.name === 'From');
          const fromVal = (fromHeader?.value || '').toLowerCase();
          return fromVal.includes(target);
        });
      } else if (type === 'label') {
        const labelName = value.replace(/^"|"$/g, '');
        // Find label ID by name
        let labelId = null;
        for (const [id, label] of this._labels) {
          if (label.name === labelName || label.name.toLowerCase() === labelName.toLowerCase()) {
            labelId = id;
            break;
          }
        }
        if (labelId) {
          results = results.filter((m) => m.labelIds.includes(labelId));
        } else {
          results = [];
        }
      } else if (type === 'in' && value === 'inbox') {
        results = results.filter((m) => m.labelIds.includes('INBOX'));
      }
    }

    return results.slice(0, maxResults);
  }

  _parseQuery(query) {
    const tokens = [];
    const regex = /(\w+):("([^"]+)"|(\S+))/g;
    let match;
    while ((match = regex.exec(query)) !== null) {
      tokens.push({ type: match[1], value: match[3] || match[4] });
    }
    return tokens;
  }

  _error(status, message) {
    return new Error(`Gmail API ${status}: ${JSON.stringify({ error: { message } })}`);
  }

  /** Get recorded API calls for assertions. */
  getCalls() {
    return [...this._calls];
  }

  /** Get calls matching a path pattern. */
  getCallsMatching(pathPattern) {
    return this._calls.filter((c) =>
      typeof pathPattern === 'string'
        ? c.path.includes(pathPattern)
        : pathPattern.test(c.path)
    );
  }

  /** Get a message by ID. */
  getMessage(id) {
    return this._messages.get(id);
  }

  /** Get all messages in a thread. */
  getThreadMessages(threadId) {
    const thread = this._threads.get(threadId);
    if (!thread) return [];
    return thread.messages.map((mid) => this._messages.get(mid)).filter(Boolean);
  }

  /** Add a sent reply to a thread (simulates user replying). */
  addSentReply(threadId) {
    const msg = this.addMessage({
      threadId,
      labelIds: ['SENT'],
      from: 'test@gmail.com',
      subject: 'Re: Test',
    });

    // Record in history as messagesAdded
    this._history.push({
      id: this._bumpHistory(),
      messagesAdded: [{
        message: { id: msg.id, threadId: msg.threadId, labelIds: [...msg.labelIds] },
      }],
      labelsAdded: [],
      labelsRemoved: [],
    });

    return msg;
  }
}

module.exports = FakeGmail;

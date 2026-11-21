'use strict';

const path = require('path');
const { Worker } = require('worker_threads');

// A wait pattern arrives from an API client and is tested against up to 200 KB
// of terminal output, repeatedly. JavaScript cannot interrupt a catastrophic
// backtrack, so a textual "is this pattern safe" heuristic is not enough:
// `((a+))+Z` and `(a|aa)+Z` defeat every simple guard, while `^ready.*?done$`
// and `\*+` are legitimate patterns a naive guard wrongly rejects.
//
// Evaluate in a worker thread and terminate it when a match exceeds its
// deadline. The event loop, and every other request, stays responsive.
const MAX_PATTERN = 200;
const DEFAULT_MATCH_TIMEOUT_MS = 500;

function createPatternMatcher(pattern, flags = 'im') {
  if (typeof pattern !== 'string' || !pattern.trim()) {
    return { error: 'Pattern must be a non-empty string.' };
  }
  if (pattern.length > MAX_PATTERN) {
    return { error: `Pattern is longer than ${MAX_PATTERN} characters; use a literal match instead.` };
  }
  try {
    new RegExp(pattern, flags);
  } catch (error) {
    return { error: `Invalid regex: ${error.message}` };
  }

  const worker = new Worker(path.join(__dirname, 'regex-worker.js'));
  worker.unref?.();
  let sequence = 0;
  let closed = false;
  const pending = new Map();

  const failPending = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };
  worker.on('message', ({ id, matched }) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(Boolean(matched));
  });
  worker.on('error', (error) => {
    failPending(Object.assign(new Error(`Pattern worker failed: ${error.message}`), { status: 500 }));
  });
  worker.on('exit', () => {
    if (!closed) failPending(Object.assign(new Error('Pattern worker exited.'), { status: 500 }));
  });

  const close = () => {
    closed = true;
    for (const entry of pending.values()) clearTimeout(entry.timer);
    pending.clear();
    worker.terminate().catch(() => {});
  };

  const test = (text, timeoutMs = DEFAULT_MATCH_TIMEOUT_MS) => {
    if (closed) return Promise.reject(Object.assign(new Error('Pattern matcher is closed.'), { status: 500 }));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        // The worker may be wedged inside the regex engine; kill it and refuse
        // the pattern rather than waiting for a backtrack that may never end.
        closed = true;
        worker.terminate().catch(() => {});
        reject(Object.assign(new Error('Pattern took too long; use a literal match instead.'), {
          status: 400,
          code: 'PATTERN_TIMEOUT'
        }));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, pattern, flags, text });
    });
  };

  return { test, close };
}

module.exports = { createPatternMatcher, MAX_PATTERN, DEFAULT_MATCH_TIMEOUT_MS };

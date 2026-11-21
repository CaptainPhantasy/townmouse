'use strict';

// Runs client-supplied wait patterns off the main thread so a catastrophic
// backtrack can be terminated instead of stalling every request.
const { parentPort } = require('worker_threads');

parentPort.on('message', ({ id, pattern, flags, text }) => {
  try {
    parentPort.postMessage({ id, matched: new RegExp(pattern, flags).test(text) });
  } catch (error) {
    parentPort.postMessage({ id, matched: false, error: error.message });
  }
});

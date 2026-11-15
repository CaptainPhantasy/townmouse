import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pruneAttachments } = require('../src/attachments.js');

test('pruneAttachments archives buckets older than the retention window', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'townmouse-retention-'));
  try {
    const old = path.join(stateDir, 'attachments', '20200101');
    const fresh = path.join(stateDir, 'attachments', '20261115');
    fs.mkdirSync(old, { recursive: true });
    fs.mkdirSync(fresh, { recursive: true });
    fs.writeFileSync(path.join(old, 'old.txt'), 'old');
    fs.writeFileSync(path.join(fresh, 'fresh.txt'), 'fresh');
    const now = Date.UTC(2026, 10, 15);
    const result = pruneAttachments(stateDir, { retentionDays: 30, now });
    assert.equal(result.moved, 1);
    assert.equal(fs.existsSync(old), false);
    assert.equal(fs.existsSync(path.join(stateDir, 'attachments-archive', '20200101', 'old.txt')), true);
    assert.equal(fs.existsSync(fresh), true);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('pruneAttachments leaves a bucket that is already archived', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'townmouse-retention-'));
  try {
    const old = path.join(stateDir, 'attachments', '20200101');
    const archived = path.join(stateDir, 'attachments-archive', '20200101');
    fs.mkdirSync(old, { recursive: true });
    fs.mkdirSync(archived, { recursive: true });
    fs.writeFileSync(path.join(old, 'keep.txt'), 'keep');
    const result = pruneAttachments(stateDir, { retentionDays: 30, now: Date.UTC(2026, 10, 15) });
    assert.equal(result.moved, 0);
    assert.equal(fs.existsSync(path.join(old, 'keep.txt')), true);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

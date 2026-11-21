'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPatternMatcher, MAX_PATTERN } = require('../src/safe-regex');

test('accepts ordinary patterns, including lazy and escaped quantifiers', async () => {
  for (const [pattern, text] of [
    ['^ready.*?done$', '\nready ... done\n'],
    ['\\*+', '***'],
    ['(foo|bar)+', 'foobar'],
    ['\\d{3}', 'abc 123'],
    ['a+b', 'aaab']
  ]) {
    const matcher = createPatternMatcher(pattern);
    assert.ok(matcher.test, `${pattern} should compile: ${matcher.error}`);
    try {
      assert.equal(await matcher.test(text), true, pattern);
    } finally {
      matcher.close();
    }
  }
});

test('refuses an empty, oversized, or invalid pattern without starting a worker', () => {
  assert.match(createPatternMatcher('').error, /non-empty/);
  assert.match(createPatternMatcher(null).error, /non-empty/);
  assert.match(createPatternMatcher('a'.repeat(MAX_PATTERN + 1)).error, /longer than/);
  assert.match(createPatternMatcher('[').error, /Invalid regex/);
});

test('terminates a catastrophic pattern and keeps the event loop alive', async () => {
  // Both shapes defeat simple textual guards.
  for (const pattern of ['((a+))+Z', '(a|aa)+Z']) {
    const matcher = createPatternMatcher(pattern);
    assert.ok(matcher.test, `${pattern} compiles; safety comes from isolation`);
    let ticked = false;
    const tick = setTimeout(() => { ticked = true; }, 50);
    const started = Date.now();
    await assert.rejects(
      () => matcher.test('a'.repeat(40) + '!', 150),
      (error) => error.code === 'PATTERN_TIMEOUT'
    );
    clearTimeout(tick);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2000, `${pattern} was terminated promptly (${elapsed}ms)`);
    assert.equal(ticked, true, 'the event loop kept running while the worker was stuck');
  }
});

test('close is safe on an idle matcher', () => {
  const matcher = createPatternMatcher('x+');
  matcher.close();
  matcher.close();
});

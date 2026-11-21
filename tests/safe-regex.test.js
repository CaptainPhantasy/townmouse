'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compileSafePattern, MAX_PATTERN } = require('../src/safe-regex');

test('rejects the catastrophic shapes that can stall the event loop', () => {
  for (const pattern of ['(.*)+Z', '(a+)*', '(\\d{2,})+', 'a++', 'a**', 'a?+']) {
    assert.ok(compileSafePattern(pattern).error, `${pattern} must be rejected`);
  }
});

test('accepts ordinary patterns', () => {
  for (const pattern of ['error|failed', '^https://example\\.com', '(foo|bar)+', '\\d{3}', 'a+b']) {
    const compiled = compileSafePattern(pattern);
    assert.ok(compiled.regex, `${pattern} should compile: ${compiled.error}`);
  }
});

test('caps the pattern length', () => {
  assert.match(compileSafePattern('a'.repeat(MAX_PATTERN + 1)).error, /longer than/);
});

test('reports an invalid pattern instead of throwing', () => {
  assert.match(compileSafePattern('[').error, /Invalid regex/);
  assert.match(compileSafePattern('').error, /non-empty/);
  assert.match(compileSafePattern(null).error, /non-empty/);
});

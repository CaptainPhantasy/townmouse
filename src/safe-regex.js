'use strict';

// A wait pattern arrives from an API client and is tested synchronously on the
// event loop. JavaScript cannot interrupt a catastrophic backtrack, so a
// hostile or careless pattern like `(.*)+Z` can stall every terminal, browser,
// and API request. There is no dependency-free way to prove a pattern safe, so
// this rejects the classic exponential shapes, caps the length, and lets the
// caller prefer literal matching where it can.
const MAX_PATTERN = 200;

// A quantified group whose contents are themselves quantified: `(.*)+`,
// `(a+)*`, `(\d{2,})+`.
const NESTED_QUANTIFIER = /\((?:\\.|[^()\\])*[*+{](?:\\.|[^()\\])*\)\s*[*+{]/;
// Two quantifiers stacked on one atom: `a++`, `a**`, `a?+`, `a{2,}*`.
const STACKED_QUANTIFIER = /(?:\*|\+|\?|\{\d+(?:,\d*)?\})\s*(?:\*|\+|\?)/;

function compileSafePattern(pattern, flags = 'im') {
  if (typeof pattern !== 'string' || !pattern.trim()) {
    return { error: 'Pattern must be a non-empty string.' };
  }
  if (pattern.length > MAX_PATTERN) {
    return { error: `Pattern is longer than ${MAX_PATTERN} characters; use a literal match instead.` };
  }
  if (NESTED_QUANTIFIER.test(pattern) || STACKED_QUANTIFIER.test(pattern)) {
    return { error: 'Nested or stacked quantifiers are not allowed in a wait pattern; use a literal match instead.' };
  }
  try {
    return { regex: new RegExp(pattern, flags) };
  } catch (error) {
    return { error: `Invalid regex: ${error.message}` };
  }
}

module.exports = { compileSafePattern, MAX_PATTERN };

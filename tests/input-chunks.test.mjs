import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkInput } from '../public/input-chunks.mjs';

test('chunkInput preserves short input exactly', () => {
  assert.deepEqual(chunkInput('hello', 24000), ['hello']);
  assert.deepEqual(chunkInput('', 24000), []);
});

test('chunkInput never splits a surrogate pair at the boundary', () => {
  const payload = 'a'.repeat(23999) + '😀' + 'b';
  const chunks = chunkInput(payload, 24000);
  assert.equal(chunks.join(''), payload);
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    const last = chunk.charCodeAt(chunk.length - 1);
    assert.ok(!(last >= 0xD800 && last <= 0xDBFF), `chunk ${index} ends on a high surrogate`);
    if (index + 1 < chunks.length) {
      const next = chunks[index + 1].charCodeAt(0);
      assert.ok(!(next >= 0xDC00 && next <= 0xDFFF), `chunk ${index + 1} starts on a low surrogate`);
    }
  }
});

test('chunkInput splits a long paste into bounded ordered chunks', () => {
  const payload = 'x'.repeat(50000);
  const chunks = chunkInput(payload, 24000);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [24000, 24000, 2000]);
  assert.equal(chunks.join(''), payload);
});

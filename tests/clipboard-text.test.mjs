import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeClipboardText } from '../public/clipboard-text.mjs';
for (const text of ['café 😀', '日本語\nλ = 2;', 'plain ASCII']) {
  test(`OSC52 preserves ${JSON.stringify(text)}`, () => {
    assert.equal(decodeClipboardText(Buffer.from(text).toString('base64')), text);
  });
}
test('OSC52 refuses malformed bytes instead of silently corrupting clipboard', () => {
  assert.throws(() => decodeClipboardText('/w=='));
  assert.throws(() => decodeClipboardText('%%%'));
});

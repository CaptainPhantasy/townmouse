// Split terminal input without cutting a UTF-16 surrogate pair in half.
// A split pair becomes U+FFFD in the PTY, which silently corrupts emoji and
// supplementary-plane characters in large pastes.
export function chunkInput(payload, size = 24000) {
  const text = String(payload || '');
  const limit = Math.max(2, Math.floor(Number(size) || 24000));
  const chunks = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + limit, text.length);
    if (end < text.length) {
      const last = text.charCodeAt(end - 1);
      // High surrogate at the boundary: leave it for the next chunk so the
      // low surrogate travels with it.
      if (last >= 0xD800 && last <= 0xDBFF) end -= 1;
      if (end <= offset) end = Math.min(offset + limit, text.length);
    }
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
}

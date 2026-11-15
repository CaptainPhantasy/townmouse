// OSC 52 carries UTF-8 bytes encoded as base64, not a JavaScript string.
export function decodeClipboardText(payload) {
  const bytes = Uint8Array.from(atob(payload), (byte) => byte.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

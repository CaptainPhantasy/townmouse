'use strict';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// A container is published on a host port that need not equal the port inside
// it, so an exact `host:port` match would refuse every request (including
// /health) for `-p 127.0.0.1:8080:11002`. The loopback *hostname* is what makes
// a request local; the port is the publisher's choice. When an Origin is
// present it must still match the Host exactly and pass the origin checks
// below, so a page on another local port cannot drive this server.
function isLoopbackHost(host) {
  if (typeof host !== 'string') return false;
  const name = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.split(':')[0];
  return LOOPBACK_HOSTS.has(name.toLowerCase());
}

// The listener remains on loopback. These origins belong to separately
// authenticated HTTPS proxies that preserve the external Host header.
function createRequestBoundary(port, trustedOrigins = '') {
  const allowedOrigins = new Set([
    `http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`
  ].map((origin) => new URL(origin).origin));
  for (const entry of trustedOrigins.split(',').map((value) => value.trim()).filter(Boolean)) {
    let url;
    try { url = new URL(entry); } catch { /* rejected below */ }
    if (!url || url.protocol !== 'https:' || url.hostname.includes('*') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('TERMINALONE_TRUSTED_ORIGINS must contain exact HTTPS origins, separated by commas (for example https://terminal.example.com).');
    }
    allowedOrigins.add(url.origin);
  }
  const allowedHosts = new Set([...allowedOrigins].map((origin) => new URL(origin).host));
  return (req) => {
    const host = req.headers.host;
    if (typeof host !== 'string') return false;
    const normalized = host.toLowerCase();
    if (!isLoopbackHost(normalized) && !allowedHosts.has(normalized)) return false;
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (typeof origin !== 'string') return false;
      try {
        const url = new URL(origin);
        const sameLoopback = isLoopbackHost(url.host) && url.host.toLowerCase() === normalized;
        if (url.origin !== origin || url.host.toLowerCase() !== normalized) return false;
        if (!allowedOrigins.has(url.origin) && !sameLoopback) return false;
      } catch { return false; }
    }
    return true;
  };
}

function isTrustedRequest(req, port) {
  return createRequestBoundary(port)(req);
}

module.exports = { isTrustedRequest, createRequestBoundary };

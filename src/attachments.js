'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

function installAttachments(app) {
  const stateDir = process.env.TOWNMOUSE_STATE_DIR || path.join(os.homedir(), '.townmouse');
  const root = path.join(stateDir, 'attachments');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });

  app.use('/attachments', express.static(root, {
    fallthrough: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Attachments are untrusted URL-backed documents. Sandbox them into an
      // opaque origin so HTML/SVG cannot read the workspace token or call the
      // pane-control API from the Townmouse origin.
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'");
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    }
  }));

  app.post('/api/attachments', express.raw({ type: '*/*', limit: '25mb' }), async (req, res) => {
    try {
      const paneToken = req.get('X-Townmouse-Token') || (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const agentUpload = Boolean(paneToken && app.locals.townmousePaneToken && paneToken === app.locals.townmousePaneToken);
      if (!req.isOwner && !agentUpload) {
        res.status(403).json({ error: 'Owner page or workspace token required.' });
        return;
      }
      const data = req.body;
      if (!Buffer.isBuffer(data) || data.length === 0) {
        res.status(400).json({ error: 'No file body was received.' });
        return;
      }
      let original = 'attachment';
      try { original = decodeURIComponent(String(req.get('X-Filename') || 'attachment')); } catch (_) { /* keep fallback */ }
      const base = path.basename(original).replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\.+/, '').slice(-120) || 'attachment';
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const dir = path.join(root, day);
      await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
      const stored = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${base}`;
      const target = path.join(dir, stored);
      await fs.promises.writeFile(target, data, { mode: 0o600 });
      const relative = `/attachments/${day}/${encodeURIComponent(stored)}`;
      const host = req.get('host') || `127.0.0.1:${process.env.PORT || 11001}`;
      res.set('Cache-Control', 'no-store');
      res.json({
        name: original,
        path: target,
        url: `${req.protocol}://${host}${relative}`,
        relativeUrl: relative,
        mime: String(req.get('Content-Type') || 'application/octet-stream'),
        bytes: data.length
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  return { root };
}

module.exports = { installAttachments };

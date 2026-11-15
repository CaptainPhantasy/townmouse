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
      // Never render an uploaded HTML/SVG/XML document as active content on
      // the workspace origin. Downloads keep even a CSP bypass from reaching
      // the bootstrap endpoints or the pane-control API.
      const extension = path.extname(String(res.req?.path || '')).toLowerCase();
      if (['.html', '.htm', '.xhtml', '.svg', '.xml'].includes(extension)) {
        res.setHeader('Content-Disposition', 'attachment');
      }
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
      // Bound one day's uploads so a runaway agent cannot fill the disk a
      // request at a time. Older day directories are left for the owner to
      // inspect or remove; nothing is silently deleted.
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      const files = entries.filter((entry) => entry.isFile());
      if (files.length >= 2000) {
        res.status(413).json({ error: 'Daily attachment count limit reached.' });
        return;
      }
      let dayBytes = 0;
      for (const entry of files) {
        try { dayBytes += (await fs.promises.stat(path.join(dir, entry.name))).size; } catch (_) { /* vanished */ }
      }
      if (dayBytes + data.length > 512 * 1024 * 1024) {
        res.status(413).json({ error: 'Daily attachment storage limit reached.' });
        return;
      }
      const stored = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${base}`;
      const target = path.join(dir, stored);
      await fs.promises.writeFile(target, data, { mode: 0o600 });
      const relative = `/attachments/${day}/${encodeURIComponent(stored)}`;
      const forwardedHost = String(req.get('X-Forwarded-Host') || '').split(',')[0].trim();
      const forwardedProto = String(req.get('X-Forwarded-Proto') || '').split(',')[0].trim();
      const host = forwardedHost || req.get('host') || `127.0.0.1:${process.env.PORT || 11001}`;
      const protocol = forwardedProto === 'https' ? 'https' : req.protocol;
      res.set('Cache-Control', 'no-store');
      res.json({
        name: original,
        path: target,
        url: `${protocol}://${host}${relative}`,
        localUrl: `http://127.0.0.1:${process.env.PORT || 11001}${relative}`,
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

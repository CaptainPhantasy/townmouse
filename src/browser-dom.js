'use strict';

// Page-side helpers for the agent browser.
//
// Every function in this file that is prefixed `page...` is serialized by
// Puppeteer and therefore must stay self-contained: no closures over module
// variables, no `require`. Everything it needs travels in its argument object.
//
// Element identity is stamped into the page as `data-townmouse-ref`. That
// marker survives re-renders of unrelated parts of the page, works inside open
// shadow roots, and can be found again from any frame. It deliberately does not
// encode position, so a target does not silently point at whatever moved under
// old coordinates.

const REF_ATTRIBUTE = 'data-townmouse-ref';

function pageCatalog(options) {
  const opts = options || {};
  const MAX = Math.max(1, Math.min(500, Number(opts.max) || 200));
  const INCLUDE_HIDDEN = Boolean(opts.includeHidden);
  const MARK = 'data-townmouse-ref';
  const start = Math.max(0, Number(opts.start) || 0);

  const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'OPTION', 'LABEL']);
  const TEXTUAL = /^H[1-6]$/;

  function walk(root, visit) {
    if (!root) return;
    const stack = [root];
    const seen = new Set();
    while (stack.length) {
      const node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      if (node.nodeType === 1) visit(node);
      const children = node.children ? Array.from(node.children) : [];
      // A shadow host's children are not rendered; the shadow tree is.
      const shadow = node.nodeType === 1 ? node.shadowRoot : null;
      const next = shadow ? [shadow] : children;
      for (let index = next.length - 1; index >= 0; index--) stack.push(next[index]);
      if (shadow && children.length) {
        for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
      }
    }
  }

  function labelFor(el) {
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const labelledby = el.getAttribute && el.getAttribute('aria-labelledby');
    if (labelledby) {
      let scope = null;
      try { scope = el.getRootNode(); } catch (_) { scope = null; }
      const parts = String(labelledby).split(/\s+/).map((id) => {
        if (scope && typeof scope.getElementById === 'function') return scope.getElementById(id);
        const doc = el.ownerDocument;
        return doc ? doc.getElementById(id) : null;
      }).filter(Boolean);
      const text = parts.map((part) => part.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    if (el.labels && el.labels.length) {
      const text = Array.from(el.labels).map((label) => label.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    const placeholder = el.getAttribute && el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();
    const alt = el.getAttribute && el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();
    const title = el.getAttribute && el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    if (el.tagName === 'INPUT' && el.type === 'submit' && el.value) return String(el.value);
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    return text.slice(0, 160);
  }

  function roleFor(el) {
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit && explicit.trim()) return explicit.trim().split(/\s+/)[0];
    const tag = el.tagName;
    if (tag === 'A') return el.hasAttribute('href') ? 'link' : 'generic';
    if (tag === 'BUTTON') return 'button';
    if (tag === 'SELECT') return el.multiple ? 'listbox' : 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'IFRAME') return 'iframe';
    if (tag === 'IMG') return 'image';
    if (tag === 'SUMMARY') return 'button';
    if (tag === 'OPTION') return 'option';
    if (tag === 'LABEL') return 'label';
    if (TEXTUAL.test(tag)) return 'heading';
    if (tag === 'INPUT') {
      const type = String(el.type || 'text').toLowerCase();
      if (type === 'submit' || type === 'reset' || type === 'button' || type === 'image') return 'button';
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'range') return 'slider';
      if (type === 'file') return 'file';
      if (type === 'color') return 'color';
      if (['date', 'time', 'datetime-local', 'month', 'week'].includes(type)) return type;
      return 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return 'generic';
  }

  function interesting(el) {
    const tag = el.tagName;
    if (INTERACTIVE.has(tag)) return true;
    if (tag === 'IFRAME' || tag === 'IMG') return true;
    if (TEXTUAL.test(tag)) return true;
    if (el.isContentEditable) return true;
    if (el.hasAttribute('role') || el.hasAttribute('tabindex')) return true;
    if (el.hasAttribute('onclick') || el.hasAttribute('aria-label') || el.hasAttribute('contenteditable')) return true;
    return false;
  }

  function boxFor(el) {
    let rect;
    try { rect = el.getBoundingClientRect(); } catch (_) { return null; }
    return {
      x: Math.round(rect.left * 10) / 10,
      y: Math.round(rect.top * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10
    };
  }

  function visibleFor(el) {
    let style;
    try { style = getComputedStyle(el); } catch (_) { return false; }
    if (!style || style.visibility === 'hidden' || style.display === 'none') return false;
    if (Number(style.opacity || 1) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const elements = [];
  let counter = start;
  walk(document, (el) => {
    if (elements.length >= MAX) return;
    if (!interesting(el)) return;
    const visible = visibleFor(el);
    if (!visible && !INCLUDE_HIDDEN) return;
    const box = boxFor(el);
    if (!box) return;
    // Reuse an existing marker so a target keeps its identity across repeated
    // catalogs. A fresh number is only minted for an element that never had one.
    let existing = null;
    try { existing = el.getAttribute(MARK); } catch (_) { existing = null; }
    const ref = existing || `e${counter++}`;
    if (!existing) {
      try { el.setAttribute(MARK, ref); } catch (_) { /* detached or read-only host */ }
    }
    const descriptor = {
      ref,
      role: roleFor(el),
      tag: el.tagName.toLowerCase(),
      name: labelFor(el),
      box,
      visible,
      disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
      checked: typeof el.checked === 'boolean' ? el.checked : null,
      selected: el.tagName === 'OPTION' ? Boolean(el.selected) : null,
      expanded: el.getAttribute('aria-expanded') === 'true'
        ? true
        : (el.getAttribute('aria-expanded') === 'false' ? false : null),
      required: Boolean(el.required) || el.getAttribute('aria-required') === 'true',
      readonly: Boolean(el.readOnly) || el.getAttribute('aria-readonly') === 'true',
      value: (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
        ? String(el.value == null ? '' : el.value).slice(0, 400)
        : null
    };
    if (el.tagName === 'IFRAME') {
      descriptor.role = 'iframe';
      descriptor.name = el.getAttribute('title') || el.getAttribute('name') || el.src || 'iframe';
    }
    elements.push(descriptor);
  });

  return {
    elements,
    nextRef: counter,
    scrollX: Math.round(window.scrollX || 0),
    scrollY: Math.round(window.scrollY || 0),
    docWidth: Math.round(document.documentElement ? document.documentElement.scrollWidth : 0),
    docHeight: Math.round(document.documentElement ? document.documentElement.scrollHeight : 0)
  };
}

// Same traversal, no stamping: a geometry snapshot used to decide whether a
// coordinate recorded against an observation still means anything.
function pageSignature(options) {
  const opts = options || {};
  const MAX = Math.max(1, Math.min(600, Number(opts.max) || 300));
  const parts = [];
  let count = 0;
  const stack = [document];
  const seen = new Set();
  while (stack.length && count < MAX) {
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    if (node.nodeType === 1) {
      let rect = null;
      try { rect = node.getBoundingClientRect(); } catch (_) { rect = null; }
      let style = null;
      try { style = getComputedStyle(node); } catch (_) { style = null; }
      if (rect && style && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0) {
        parts.push(`${node.tagName}:${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`);
        count++;
      }
    }
    const children = node.children ? Array.from(node.children) : [];
    const shadow = node.nodeType === 1 && node.shadowRoot ? node.shadowRoot : null;
    if (shadow) stack.push(shadow);
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
  }
  return {
    signature: parts.join('|'),
    scrollX: Math.round(window.scrollX || 0),
    scrollY: Math.round(window.scrollY || 0),
    url: location.href,
    title: document.title || ''
  };
}

// Resolve a stamped marker to a real element, piercing open shadow roots.
function pageResolve(marker) {
  const MARK = 'data-townmouse-ref';
  const stack = [document];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    if (node.nodeType === 1 && node.getAttribute && node.getAttribute(MARK) === marker) return node;
    // Descend below the document node too: `document` is not an Element, but it
    // still has children.
    if (node.shadowRoot) stack.push(node.shadowRoot);
    const children = node.children ? Array.from(node.children) : [];
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
  }
  return null;
}

function pageFocusInfo() {
  const el = document.activeElement;
  if (!el) return null;
  const info = {
    role: (el.getAttribute && el.getAttribute('role')) || el.tagName.toLowerCase(),
    name: (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder')))
      || (el.labels && el.labels[0] ? el.labels[0].textContent : '')
      || '',
    tag: el.tagName.toLowerCase()
  };
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
    info.value = String(el.value == null ? '' : el.value).slice(0, 400);
    info.type = String(el.type || '').toLowerCase();
  }
  return info;
}

function pageScroll(options) {
  const opts = options || {};
  const MARK = 'data-townmouse-ref';
  const dx = Number(opts.dx) || 0;
  const dy = Number(opts.dy) || 0;

  // Inlined on purpose: this function is serialized alone into the page, so it
  // cannot call a module-level helper.
  function resolve(marker) {
    const stack = [document];
    const seen = new Set();
    while (stack.length) {
      const node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      if (node.nodeType === 1 && node.getAttribute && node.getAttribute(MARK) === marker) return node;
      if (node.shadowRoot) stack.push(node.shadowRoot);
      const children = node.children ? Array.from(node.children) : [];
      for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
    }
    return null;
  }

  function deepestScrollable(start) {
    let node = start;
    while (node && node !== document.body && node !== document.documentElement) {
      let style = null;
      try { style = getComputedStyle(node); } catch (_) { style = null; }
      if (style) {
        const scrollableY = /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
        const scrollableX = /(auto|scroll|overlay)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
        if (scrollableY || scrollableX) return node;
      }
      node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
    }
    return null;
  }

  let target = null;
  if (opts.marker) {
    target = resolve(opts.marker);
    if (!target) return { found: false, reason: 'missing' };
  } else if (opts.selector) {
    try { target = document.querySelector(opts.selector); } catch (_) { target = null; }
    if (!target) return { found: false, reason: 'missing' };
  } else {
    target = document.scrollingElement || document.documentElement;
  }

  const scroller = (opts.marker || opts.selector)
    ? (deepestScrollable(target) || document.scrollingElement || document.documentElement)
    : (document.scrollingElement || document.documentElement);

  const before = { x: scroller.scrollLeft, y: scroller.scrollTop };
  scroller.scrollBy({ left: dx, top: dy, behavior: 'instant' });
  const after = { x: scroller.scrollLeft, y: scroller.scrollTop };
  return {
    found: true,
    scroller: scroller === (document.scrollingElement || document.documentElement)
      ? 'page'
      : (scroller.tagName.toLowerCase() + (scroller.id ? '#' + scroller.id : '')),
    before,
    after,
    moved: before.x !== after.x || before.y !== after.y,
    scrollX: Math.round(window.scrollX || 0),
    scrollY: Math.round(window.scrollY || 0)
  };
}

function pageSnapshotText(options) {
  const opts = options || {};
  const limit = Math.max(1000, Math.min(2000000, Number(opts.limit) || 2000000));
  const text = (document.body ? document.body.innerText : '') || '';
  const total = text.length;
  const truncated = total > limit;
  return {
    text: truncated ? text.slice(0, limit) : text,
    totalLength: total,
    truncated,
    title: document.title || '',
    url: location.href
  };
}

// ── Node-side drivers ───────────────────────────────────────────────────────

const crypto = require('crypto');

function hashSignature(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 16);
}

/**
 * Catalog the page across every frame, including cross-origin iframes.
 * Returns element descriptors with a globally unique `ref` and the frame that
 * owns each one.
 *
 * @param {import('puppeteer').Page} page
 */
async function catalog(page, options = {}) {
  const frames = page.frames();
  const max = Math.max(1, Math.min(500, Number(options.max) || 200));
  const includeHidden = Boolean(options.includeHidden);
  const elements = [];
  let next = Math.max(0, Number(options.start) || 0);
  let frameIndex = 0;
  for (const frame of frames) {
    if (elements.length >= max) break;
    const remaining = max - elements.length;
    let result;
    try {
      result = await frame.evaluate(pageCatalog, { max: remaining, includeHidden, start: next });
    } catch (_) {
      // A frame can detach mid-walk (navigation, removed iframe). Skip it; the
      // rest of the page is still catalogued.
      frameIndex++;
      continue;
    }
    next = Number(result.nextRef) || next;
    for (const element of result.elements) {
      elements.push({
        ...element,
        frame: frameIndex,
        frameUrl: frame.url(),
        inFrame: frameIndex > 0
      });
    }
    frameIndex++;
  }
  return { elements, nextRef: next, frameCount: frames.length };
}

/**
 * Resolve a ref to a live element handle. Ref numbers are only ever resolved by
 * the marker stamped into the DOM, never by index or coordinate.
 */
async function resolveRef(page, ref) {
  if (!ref || typeof ref !== 'string') return null;
  for (const frame of page.frames()) {
    let handle;
    try { handle = await frame.evaluateHandle(pageResolve, ref); } catch (_) { continue; }
    if (!handle) continue;
    const element = handle.asElement();
    if (element) return element;
    await handle.dispose().catch(() => {});
  }
  return null;
}

// Cheap position read for the per-second viewer snapshot. The full layout
// signature is only needed when deciding whether a target is stale.
async function scrollPosition(page) {
  try {
    const result = await page.mainFrame().evaluate(() => ({
      scrollX: Math.round(window.scrollX || 0),
      scrollY: Math.round(window.scrollY || 0)
    }));
    return { scrollX: result.scrollX, scrollY: result.scrollY };
  } catch (_) {
    return { scrollX: 0, scrollY: 0 };
  }
}

async function signature(page) {
  // Every frame contributes, because a click inside an iframe is invalidated
  // by that iframe scrolling or rearranging even when the outer page is still.
  const parts = [];
  let main = null;
  for (const frame of page.frames()) {
    let result;
    try { result = await frame.evaluate(pageSignature, {}); } catch (_) { continue; }
    if (!main) main = result; // page.frames() lists the main frame first
    parts.push(`${frame.url()}|${result.scrollX},${result.scrollY}|${result.signature}`);
  }
  if (!main) return { hash: '', scrollX: 0, scrollY: 0, url: '', title: '' };
  return {
    hash: hashSignature(parts.join('||')),
    scrollX: main.scrollX,
    scrollY: main.scrollY,
    url: main.url,
    title: main.title
  };
}

async function focusInfo(page) {
  try { return await page.mainFrame().evaluate(pageFocusInfo, {}); }
  catch (_) { return null; }
}

async function scroll(page, options) {
  // Scroll the frame that actually owns the target, so a list inside an iframe
  // scrolls without moving the outer page.
  for (const frame of page.frames()) {
    let exists = false;
    try {
      exists = await frame.evaluate(
        (wanted) => {
          if (wanted.marker) {
            const MARK = 'data-townmouse-ref';
            const stack = [document];
            const seen = new Set();
            while (stack.length) {
              const node = stack.pop();
              if (!node || seen.has(node)) continue;
              seen.add(node);
              if (node.nodeType === 1 && node.getAttribute && node.getAttribute(MARK) === wanted.marker) return true;
              if (node.shadowRoot) stack.push(node.shadowRoot);
              const children = node.children ? Array.from(node.children) : [];
              for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
            }
            return false;
          }
          try { return Boolean(document.querySelector(wanted.selector)); } catch (_) { return false; }
        },
        { marker: options.marker || null, selector: options.selector || null }
      );
    } catch (_) {
      exists = false;
    }
    if (!exists) continue;
    try {
      return await frame.evaluate(pageScroll, {
        marker: options.marker,
        selector: options.selector,
        dx: options.dx,
        dy: options.dy
      });
    } catch (error) {
      return { found: false, reason: 'failed', error: error.message };
    }
  }
  return { found: false, reason: 'missing' };
}

/**
 * Read the visible text of a page without silently truncating it. The caller
 * gets an explicit flag when the text was cut.
 */
async function content(page, limit = 200000) {
  const frames = [];
  for (const frame of page.frames()) {
    try {
      const part = await frame.evaluate(pageSnapshotText, { limit });
      frames.push({ url: frame.url(), text: part.text, totalLength: part.totalLength, truncated: part.truncated });
    } catch (_) { /* frame detached mid-read */ }
  }
  const text = frames.map((part) => part.text).filter(Boolean).join('\n\n');
  const totalLength = frames.reduce((sum, part) => sum + part.totalLength, 0);
  let title = '';
  try { title = await page.title(); } catch (_) { title = ''; }
  return {
    text: text.slice(0, limit),
    totalLength,
    truncated: frames.some((part) => part.truncated) || text.length > limit,
    frameCount: frames.length,
    frames: frames.map((part) => ({ url: part.url, length: part.totalLength, truncated: part.truncated })),
    title,
    url: page.url()
  };
}

module.exports = {
  REF_ATTRIBUTE,
  catalog,
  resolveRef,
  signature,
  scrollPosition,
  focusInfo,
  scroll,
  content,
  pageCatalog,
  pageSignature,
  pageResolve,
  pageScroll,
  pageSnapshotText,
  pageFocusInfo
};

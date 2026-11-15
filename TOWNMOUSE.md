# TOWNMOUSE

TOWNMOUSE is a terminal and agent browser workspace. It embeds TerminalOne as
its terminal engine.

## Relationship to TerminalOne

- `CaptainPhantasy/TerminalOne` remains the canonical simple PTY.
- TOWNMOUSE owns the browser workspace, the agent browser, view/control grants,
  and the workspace interface.
- These features do not go upstream into TerminalOne.

## Origin

Seeded on 2026-11-14 from TerminalOne commit `dd0cbde6`
("Preserve recovered TerminalOne glass browser workspace"), originally branch
`dot/recover-terminalone-20261114`.

## Current structure

The recovery snapshot keeps TerminalOne at the repository root, with the
workspace layer integrated through `src/browser-workspace.js`,
`public/workspace.css`, `public/workspace.mjs`, and small hooks in
`src/server.js` and `public/index.html`.

A future restructure should make the boundary explicit, for example:

- `terminalone/` — vendored upstream engine
- `workspace/` — TOWNMOUSE product layer
- a product server that mounts both

## Product

- Display name: **Townmouse**.
- Repository and package: `townmouse`.
- Codename: TOWNMOUSE.
- Character: Townmouse, the monocled colonial mouse, holding a terminal sign.
  The full-figure illustration is the large sidebar brand art, the browser empty
  state and the README; the bust portrait is the small SVG icon asset (favicon
  and app/PWA icons). Both are shown uncropped.
- Assets: originals in `assets/brand/mascot/`, optimized WebP in `public/brand/`,
  generated PWA icons in `public/icon-*.png`. Both mascot originals are the
  owner's 1254×1254 RGBA PNGs and are never cropped.
- Creator credit: the Floyd’s Labs neon-cats mark is a small labeled credit in
  the desktop sidebar and Tools sheet, linking to floydslabs.com. It is distinct
  from the Townmouse character and does not replace the product brand.
- Palette: porcelain `#eef1f5`, ink `#202832`, line `#cbd2dc`, blue `#175cbb`,
  terminal `#14171b`.
- Type: the system sans for workspace chrome; the terminal keeps its monospace
  face.
- The product chrome does not carry TerminalOne branding. TerminalOne is named
  in documentation as the engine and remains its own product.

## Status

Version 0.1.0. Two working surfaces: the single terminal/browser workspace and
the pane workspace (`/panes.html`), where each tab holds up to four live panes —
terminal or browser — and the orchestrator agent creates and drives them through
the injected `TOWNMOUSE_API` / `scripts/panes` interface. Three deliberate
layouts: desktop sidebar, tablet rail, phone bottom navigation. Phone shows one task surface at a time; the key bar collapses
to one row and expands with the chevron. Tablet and phone put browser tabs and
sharing controls in the browser surface; on phone the tab strip, address bar,
and Share sit together at the bottom. Those rows are tightly padded, and after
seven seconds without a touch the content takes the whole frame while the bottom
navigation stays; the next touch wakes the chrome. The session pill opens a
Sessions sheet with switching and New session. Tools is a grouped surface;
Close terminal uses an in-design confirmation.

## Naming

TOWNMOUSE completes the *Pigs (Three Different Ones)* triptych with FATCHIN and
RATBAG: oversight, labor, and the space they operate in.

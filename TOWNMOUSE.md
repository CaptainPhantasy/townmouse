# TOWNMOUSE

## Or: The house, the town, and the mouse holding the terminal sign

- **DOCUMENT CLASSIFICATION:** PRODUCT BOUNDARY / ENGINE ATTRIBUTION / THE APP IS TOWNMOUSE
- **DATE RECORDED:** 2026-11-15 — 2:47 AM, allegedly
- **LOCATION:** Brown County, Indiana — the garage with the good terminal
- **BEVERAGE:** Coffee that tastes like motor oil; the browser renders anyway
- **FELINE SUPERVISION:** Bella on product identity; Bowser monitoring the engine boundary
- **CURRENT STATE:** Townmouse-shaped, engine-powered, no identity crisis

## What Townmouse Is (Or: The Application, Not the Engine)

Townmouse is a terminal and agent browser workspace. It runs a real shell and real browser pages on the same host, in one workspace, so a person or an agent can work in both. The terminal is the anchor; the browser is a peer surface.

It embeds TerminalOne as its terminal engine. That sentence has two nouns and one job each: Townmouse is the application; TerminalOne is the engine. The product is not a TerminalOne skin, and TerminalOne is not the product.

## Relationship to TerminalOne (Or: The Engine Stays in the Terminal Where It Belongs)

- `CaptainPhantasy/TerminalOne` remains the canonical simple PTY.
- Townmouse owns the browser workspace, the agent browser, view/control grants, and the workspace interface.
- These features do not go upstream into TerminalOne.
- The product chrome carries no TerminalOne branding. TerminalOne appears in the documentation as the embedded engine and as origin provenance, and it remains its own product.

## Origin (Or: Seeded From a Commit, Not Rebranded From a Product)

Townmouse was seeded on 2026-11-14 from TerminalOne commit `dd0cbde6` ("Preserve recovered TerminalOne glass browser workspace"), originally branch `dot/recover-terminalone-20261114`.

That is engine ancestry. The commit belongs to TerminalOne's history; the workspace built on top of it belongs to Townmouse. The recovered glass browser was the starting point, not the product name.

## Current Structure (Or: One Repository, Two Jobs, and a Boundary We Owe Ourselves)

The recovery snapshot keeps the TerminalOne engine at the repository root, with the workspace layer integrated through `src/browser-workspace.js`, `public/workspace.css`, `public/workspace.mjs`, and small hooks in `src/server.js` and `public/index.html`.

A future restructure should make the boundary explicit:

- `terminalone/` — vendored upstream engine.
- `workspace/` — Townmouse product layer.
- a product server that mounts both.

One directory boundary is cheaper than a rebrand.

## Product (Or: The Name, the Codename, and the Chrome Rules)

- Display name: **Townmouse**.
- Repository and package: `townmouse`.
- Codename: TOWNMOUSE.
- Chrome: no engine branding. The app is Townmouse through the whole chrome.

## Character and Assets (Or: One Mouse, Two Portraits, Zero Crops)

Townmouse is the monocled colonial mouse, holding a terminal sign. The terminal is the house; the browser is the town. The mouse is the identity, not a sticker applied after the fact.

The full-figure illustration is the large sidebar brand art, the browser empty state, and the README. The bust portrait is the small SVG icon asset: favicon and app/PWA icons. Both are shown uncropped. The full figure gets the square footage; the bust fits in a favicon. Neither gets cropped to make a point.

Assets: originals live in `assets/brand/mascot/`, optimized WebP in `public/brand/`, generated PWA icons in `public/icon-*.png`. Both mascot originals are the owner's 1254×1254 RGBA PNGs and are never cropped.

## Creator Credit (Or: The Cats Get a Logo, Not the Product)

The Floyd’s Labs neon-cats mark is a small labeled credit in the desktop sidebar and Tools sheet, linking to floydslabs.com. It is distinct from the Townmouse character and does not replace the product brand. It stays small enough to be a credit, not a second mascot.

## Palette and Type (Or: Porcelain, Ink, and One Blue That Behaves)

- Palette: porcelain `#eef1f5`, ink `#202832`, line `#cbd2dc`, blue `#175cbb`, terminal `#14171b`.
- Type: the system sans for workspace chrome; the terminal keeps its monospace face.

One blue accent. The terminal stays black. Nobody borrows anybody else's elevation.

## Status (Or: Version 0.1.0, Two Surfaces, Three Layouts)

Version 0.1.0. Two working surfaces: the single terminal/browser workspace and the pane workspace (`/panes.html`), where each tab holds up to four live panes — terminal or browser — and the orchestrator agent creates and drives them through the injected `TOWNMOUSE_API` / `scripts/panes` interface.

Three deliberate layouts: desktop sidebar, tablet rail, phone bottom navigation. Phone shows one task surface at a time; the key bar collapses to one row and expands with the chevron. Tablet and phone put browser tabs and sharing controls in the browser surface; on phone the tab strip, address bar, and Share sit together at the bottom. Those rows are tightly padded, and after seven seconds without a touch the content takes the whole frame while the bottom navigation stays; the next touch wakes the chrome.

The session pill opens a Sessions sheet with switching and New session. Tools is a grouped surface. Close terminal uses an in-design confirmation. None of that is decorative. It is the product.

## Naming and Ancestry (Or: The Triptych, and Why There Are Three)

TOWNMOUSE completes the *Pigs (Three Different Ones)* triptych with FATCHIN and RATBAG: oversight, labor, and the space they operate in.

## Receipts (Or: The Design Doc Has the Numbers)

The layouts, motions, accessibility gates, and evidence live in [DESIGN.md](DESIGN.md). Math. Not vibes.

**DOCUMENT ENDS**

*— The Product, Which Is Not the Engine*

*Floyd’s Labs — Townmouse Division*

*"The terminal is the house. The browser is the town. The mouse is the product."*

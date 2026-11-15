# TOWNMOUSE

TOWNMOUSE is a terminal + agent browser workspace. It embeds TerminalOne as its
terminal engine.

## Relationship to TerminalOne

- `CaptainPhantasy/TerminalOne` remains the canonical simple PTY.
- TOWNMOUSE owns the browser workspace, the agent browser, view/control grants,
  and the workspace UI.
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

## Naming

TOWNMOUSE completes the *Pigs (Three Different Ones)* triptych with FATCHIN and
RATBAG: oversight, labor, and the space they operate in.

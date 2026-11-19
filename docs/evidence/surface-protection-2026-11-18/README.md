# Surface protection pass — 2026-11-18

**Claim (scope of this pass):** no workspace dock, pane sheet, page prompt, toast, or in-flow notice paints over a live terminal or browser surface in Townmouse. Chrome docks and reflows the live surface, or replaces it as a first-class mode. The inherited command palette, shortcut help, search, recent-commands popover, and session-lock overlays are outside this pass and remain known exceptions.

**Artifact version:** working tree at `main` + the 2026-11-18 changes to `public/workspace.css`, `public/workspace.mjs`, `public/index.html`, `public/panes.css`, `public/panes.html`, `public/panes.mjs`, `tests/attachments-ui.test.cjs`, `tests/ui-surfaces.test.cjs`, `package.json`, `DESIGN.md`.

## What changed

- Tools, Sessions, the close confirmation, and Settings are non-modal docked panels. Desktop reserves a 300px right column; tablet reserves 32dvh at the bottom; phone reserves 44dvh above the four-item navigation. No scrim, no backdrop blur, no inert background, no focus trap.
- Desktop can collapse the 208px labeled menu to a 72px rail (`#workspace-nav-toggle`, persisted). The rail keeps a New tab control; with 2+ tabs the browser strip also appears so tabs stay reachable, and a single tab adds no strip height.
- The pane workspace docks its tabs/menu/shortcuts/confirmations (360px right at ≥900px, 48dvh bottom below), turns context menus into a docked action rail, and moves its notice into the bottom stack.
- Banner, toasts, and the attachment handoff card are in the shell's flow and push the terminal down.
- Phone navigation is four surfaces: Terminal, Browser, Agent, Tools. Panes and Attach are labeled rows in the Tools dock.
- Control boundaries use `--ws-control: #7c8898` (3.60:1 on white, 3.18:1 on paper). Pane controls use `#5f6f88` on `#11161d` (3.4:1).
- The pane workspace is unified to the graphite family and the Townmouse blue (`#8ab4ff` on dark). The mint-on-green identity is retired.
- Fixed: the empty iPad keybar strip that appeared on desktop; the pane grid collapsing to 44px when the tab strip was hidden; the phone sheet overflowing 8px past the viewport; the browser state row being hidden by the seven-second chrome collapse; desktop browser chrome reduced from 208px above the page to 138px.

## Checks run

| Check | Command | Result |
|---|---|---|
| No panel intersects a live surface, and live surfaces stay inside the shell, at 1440×900, 1150×800, 820×1180, 393×852, 932×430 | `npm run test:ui` | PASS — Tools, Sessions, close confirmation, Settings, pane menu, pane context rail: 0 intersections; no clipping by `.app-shell`; no horizontal overflow; phone navigation = [Terminal, Browser, Agent, Tools]; Panes + Attach present in Tools |
| Contrast floors | `npm run test:ui` | PASS — control 3.60:1 white / 3.18:1 paper; ink 13.14:1; muted 5.60:1; blue 5.64:1 on paper; pane control 3.4:1; pane text 15.3:1; pane muted 7.9:1 |
| Workspace journeys | `npm run test:workspace` | PASS — terminal, tools, browser navigation, human input, multiple tabs, page text, sharing/revocation, headless agent, reduced motion at 1440×900 and 1920×1080 |
| Responsive matrix | `npm run test:responsive` | PASS — all iPhone/iPad/desktop checks including 44pt targets and chrome collapse |
| Pane workspace | `npm run test:panes` | PASS — 31/31 API + persistence, resume width, attachments UI, idle wake, multi-window |
| Max pane survives tab switch/close | `npm run test:maximize` | PASS |
| Full suite | `npm test` | PASS (recorded in the final run log; `test:ui` is now part of the chain) |

## Measured geometry (CSS px, headless Chrome)

| Breakpoint and panel | Live surface while the panel is open | Panel rectangle | Intersection |
|---|---|---|---|
| 1440×900, Tools, browser open | terminal 371×744 (x 265); canvas 443×661 (x 664) | right 300×868 (x 1124) | none |
| 1440×900, Tools + collapsed rail | terminal 445×744 (x 109); canvas 525×661 (x 582) | right 300×868 (x 1124) | none |
| 820×1180, Tools, browser open | terminal 682×172 (y 90); canvas 714×244 (y 481) | bottom 716×378 (y 790) | none |
| 393×852, Tools, browser open | canvas 375×226 (y 37) | bottom 377×375 (y 401) | none |
| 932×430 landscape, Tools | terminal 442×174 (x 109); key bar collapses while the panel is open | right 340×414 (x 584) | none |
| 320×640 reflow, Tools | terminal 286×106; header wraps to a second row instead of clipping | bottom 304×282 (y 282) | none; scrollWidth 320 = viewport 320 |
| 1440×900, pane menu | pane grid 1056×848 (the dock column is reserved; the grid was 1440 wide at rest) | right 360×876 (x 1068) | none |
| 393×852, pane menu | pane grid 393×322 (y 0) | bottom 377×409 (y 435) | none |

## Screenshots

All captured headless at device scale factor 2.

- `final-home-desktop.png`, `final-home-phone.png`
- `final-browser-desktop.png`
- `final-tools-desktop.png`, `final-tools-tablet.png`, `final-tools-phone.png`
- `final-tools-desktop-collapsed.png`
- `final-settings-phone.png`
- `final-panes-desktop.png`, `final-panes-phone.png`
- `final-panes-menu-desktop.png`, `final-panes-menu-phone.png`

## Limits

- Headless Chrome only; real Safari/iPadOS rendering is not exercised. The `:has()` selector used to reserve dock space is supported in Safari 15.4+.
- The tablet and phone docks shrink the live surface while open (tablet 32dvh, phone 44dvh). This is deliberate: the alternative is covering the surface, which the design forbids. The dock is dismissible with Done/Escape, and on phone the bottom navigation stays awake.
- The browser viewer remains image-based; assistive technology still sees the page text through Read page/`/content`, not the bitmap.
- No performance or bandwidth change is claimed by this pass.

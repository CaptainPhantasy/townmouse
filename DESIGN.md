# TOWNMOUSE design

## Or: A quiet light frame around a black rectangle, with one mouse doing all the shouting

- **DOCUMENT CLASSIFICATION:** DESIGN RECORD / MODERATE CHAOS / TECHNICALLY CREDIBLE
- **DATE RECORDED:** 2026-11-15 — late enough that the coffee has opinions
- **LOCATION:** The garage; the good monitor faces the cats
- **BEVERAGE:** Coffee that tastes like motor oil and exactly one blue accent
- **FELINE SUPERVISION:** Bella approved the quiet parts; Bowser is monitoring the separator
- **CURRENT STATE:** Porcelain, ink, and a terminal that stays black

## Product job (Or: What This Thing Is For, Before Anyone Says "Platform")

Townmouse is a terminal and agent browser workspace. A person needs to run a real shell and a real browser page on the same host, switch between them quickly, and understand exactly what an agent can see or control. The terminal is the anchor; the browser is a peer surface.

That is the whole job. Everything below is in service of it, or it does not ship.

## Selected workflow (Or: We Read the Studio, We Did Not Move In)

Primary: the Legacy Design Studio's Frontend Design workflow (`frontend-design/SKILL.md`). Supplemental review: the Studio's Open Design anti-AI-slop guide (`open-design/craft/anti-ai-slop.md`). The Studio is read in place from its installed library; the application stays in this repository and the Studio supplies guidance only.

We read the Studio. We did not rename the garage or schedule a kickoff about the kickoff.

## Design plan (Or: One Blue Accent, a System Sans, and a Firm No)

**Color.** Porcelain `#eef1f5`, ink `#202832`, glass `#ffffffcc`, line `#cbd2dc`, blue `#175cbb`, terminal `#14171b`. The blue is the only chrome accent. The terminal surface keeps its own dark palette; workspace chrome never inherits the terminal's accent or elevation colors. If the chrome starts glowing, we have failed.

**Type.** The system sans (SF on Apple platforms) for workspace chrome. The terminal keeps its monospace face. Type sizes step 10 / 11 / 12 / 13 / 14 / 18 / 20 / 22 px; the brand wordmark is 19 px with tight tracking. No font pilgrimage. The system sans is already installed, and the terminal has a job.

**Layout.** A quiet, light frame around a dark terminal. Navigation is one consistent model with device-specific structures; the terminal and browser surfaces are never merely scaled from one device to another. Three devices, three structures. Scaling is not design.

**Principles.**

- The terminal is uninterrupted. Controls sit outside the black surface.
- State is explicit: Human or Agent, Private / View only / Control, session and working directory.
- Every primary control is reachable and at least 44pt.
- Spend boldness in one place: the Townmouse character and the terminal's contrast. Everything around it stays quiet.
- No emoji, decorative gradients, invented metrics, template hero, or identical card grid.

That last bullet is not a mood. It is a checklist.

**Brand character.** Townmouse is the monocled colonial mouse: the terminal is the house, the browser is the town. The full-figure illustration is the single bold visual move: the large sidebar brand art, the browser empty state, and the README. The bust portrait is the small SVG icon asset (favicon, app/PWA icons, and tiny chrome), shown uncropped. Both are the owner's original 1254×1254 RGBA PNGs, scaled with `object-fit: contain`; the character is never cropped. The character is never repeated as an emoji.

The ancestry is deliberate: the name completes the *Pigs (Three Different Ones)* triptych with FATCHIN and RATBAG — oversight, labor, and the space they operate in. The mouse is the product's identity, not a sticker on the terminal.

**Assets.** Originals live in `assets/brand/mascot/` (`townmouse-aristocrat.png`, `townmouse-monocled.png`), copied byte-for-byte from the owner's files, with their checksums recorded in that folder's `README.md`. The bust is wrapped as `townmouse-icon.svg` for the SVG icon surfaces. Optimized transparent WebP files live in `public/brand/`; the generated PWA/app icons are `public/icon-*.png`, including the padded maskable icon. If it is not the owner's pixels, it does not ship.

**Creator credit.** A small Floyd’s Labs neon-cats mark appears in the desktop sidebar and in the Tools sheet, labeled “Built at Floyd’s Labs” and linking to floydslabs.com. It is a creator credit, distinct from the Townmouse character, and stays small enough never to compete with the product brand. The cats get the credit; the mouse gets the product.

## Three layouts (Or: Three Structures, Not One Structure Scaled Three Times)

The layouts share a navigation model, not a pixel grid. Each device gets the structure it can actually use.

**Desktop (1440×900 and wider).** A 208px sidebar holds the brand, Terminal, Browser, the tab list, New tab, Agent, Tools, and the real local server address. The terminal fills the main frame. Opening a browser splits the frame horizontally with a 60px header and a 30px footer. The 12px separator between terminal and browser is draggable left and right; the terminal keeps at least 320px and the browser at least 420px. Browser tabs live in the sidebar; sharing controls are always visible in the browser surface.

**Tablet (820×1180).** A 72px labeled rail holds the mark, Terminal, Browser, Agent, and Tools. The terminal fills the frame. Opening a browser stacks the terminal above the browser with a draggable separator; the key bar and footer leave the split so the browser gets the space. The separator can be dragged up and down between a 25% and 75% browser share. Browser tabs, Share, Expand, and Hide live in the browser tab strip. Share reveals the permissions row. Expand gives the browser the whole frame.

**Phone (393×852).** A bottom navigation holds Terminal, Browser, Agent, and Tools. One task surface is visible at a time. The terminal key bar collapses to one row of essentials plus a chevron that reveals the rest. In the browser, the state row sits at the top. The tab strip, address bar, and Share sit at the bottom above the remote keyboard, within thumb reach. The address bar carries back, forward, reload, the URL, and Go; Share opens the permissions row above the address bar. The tab itself carries Close. The control rows keep their 44pt targets but carry almost no outer padding. After seven seconds without a touch, every chrome row except the bottom navigation collapses, and the terminal or browser fills the frame. The first touch wakes the chrome; the bottom navigation stays awake and operable throughout.

Content first is the phone's whole personality. The navigation never leaves.

## Pane workspace (Or: Four Live Things in a 2x2 Box)

`/panes.html` is the agent-first workspace. A workspace tab holds one to four panes in a 2x2 grid; each pane is a live PTY terminal or a live headless-browser page. Tabs are the units the human or the orchestrator creates and selects, and every tab can hold a different mix of terminals and browsers. The browser is the substrate: browser panes are real pages rendered by the server, and terminal panes are real PTYs. No iframe cosplay.

The orchestrator pane is spawned with `TOWNMOUSE_API`, `TOWNMOUSE_TOKEN`, `TOWNMOUSE_PANE_ID` and `scripts/panes`, so an agent creates tabs, adds panes, opens URLs and runs commands without copying a connection code. The bottom bar is the only chrome: back, host/session pill, tab count, keyboard, and menu. That is the whole chrome. It is enough.

This follows the Chrome split-view model — live tabs sharing one surface with a draggable divider — extended to four panes per tab.

The pane workspace is the same product, not a second identity. It uses the graphite family (`#0a0d12` / `#11161d`) and the one Townmouse blue as `--accent` (#8ab4ff, the dark-surface step of `#175cbb`). The old mint-on-green palette is retired.

## Surface protection (Or: A Menu May Never Cover a Live Face)

Recorded 2026-11-18. This is a hard invariant, not a preference: **no menu, sheet, dialog, toast, or panel may paint over a live terminal or browser surface.** Chrome either docks and reflows the surface, or replaces it as a first-class mode with an explicit way back. Scope of this pass: the workspace chrome and pane surfaces listed below. The inherited command palette, shortcut help, search, recent-commands popover, and session-lock overlays are not yet ported and remain known exceptions.

- **Tools, Sessions, the close confirmation, Settings, and the browser page-text dialogs are docked peers.** On desktop (≥1100px) they reserve a 300px right column; on tablet (700–1099px) a 32dvh bottom row; on phone (≤699px) a 44dvh bottom row above the four-item navigation. The live surface shrinks; it is never covered. No scrim, no backdrop blur, no inert background, no focus trap.
- **Desktop menu is collapsible, not fixed overhead.** `#workspace-nav-toggle` trades the 208px labeled sidebar for a 72px icon rail and remembers the choice. The rail keeps a New tab control; when there are 2+ browser tabs the tab strip also appears in the browser surface so tabs stay reachable, and a single tab costs no extra height.
- **Reader view** is a mode, not an overlay: it replaces the transcript surface and always shows Close.
- **Notifications live in the flow.** Banner, toasts, and the attachment handoff card are siblings in the shell and push the terminal down. The pane workspace puts its notice in the bottom stack.
- **Pane workspace menus dock.** Tabs, menu, shortcuts, and confirmations reserve a 360px right column at ≥900px and a 48dvh bottom row below that. Context actions are a docked action rail above the workspace bar, not a floating menu on a pane.
- **Phone navigation is four surfaces** — Terminal, Browser, Agent, Tools. Panes and Attach are labeled rows in the Tools dock, because they are actions, not surfaces.
- **Visible control boundaries.** `--ws-control: #7c8898` (3.60:1 on white, 3.18:1 on paper) replaces the 1.3–1.5:1 hairline on inputs, key caps, tab chips, and both resize grips. The pale `--ws-line` remains decorative only. Dark pane controls use `#5f6f88` on `#11161d` (3.4:1).
- **Enforced by software.** `npm run test:ui` (`tests/ui-surfaces.test.cjs`) fails if any docked panel intersects `#terminal` or `.browser-canvas` at 1440×900, 1150×800, 820×1180, 393×852, or 932×430, or if a rendered live surface extends outside `.app-shell`; it also asserts the contrast floors, no horizontal overflow, the four-item phone navigation, and the Panes/Attach rows in Tools.

## Navigation and browser model (Or: Who Can See What, and Who Can Touch It)

- The session pill is a button. It opens a Sessions sheet listing every named session, marking the current one, switching between them, and offering New session. The footer keeps the shell command, working directory, and uptime.
- Human and agent browser tabs share one tab strip. Each tab advertises Human or Agent; the persistent state row shows the active kind and permission.
- Human tabs start Private. View only and Allow control rotate the connection token. Private revokes subsequent token requests. Close tab destroys the context.
- The agent browser has control granted and keeps running when its view is hidden.

State is not a badge in a corner. It is the answer to the only question that matters: what can this thing see and do?

## Motions (Or: Five Motions, Then We Stop)

Five motions, all with a job. The house style is arrive, do not perform.

1. **Drawer reveal** — Tools opens and closes; 260ms; `cubic-bezier(.2,.8,.2,1)`; reduced-motion: immediate, no transform.
2. **Surface switch** — terminal or browser surface enters; 220ms; `cubic-bezier(.2,.8,.2,1)`; reduced-motion: immediate.
3. **Control press** — pointer down/up on controls; 180ms; `cubic-bezier(.2,.8,.2,1)`; reduced-motion: no transform/transition.
4. **Active tab feedback** — selected tab background and border; 200ms; `cubic-bezier(.2,.8,.2,1)`; reduced-motion: immediate.
5. **Tool state** — active tool row fill, white text, and checkmark; 180ms; `cubic-bezier(.2,.8,.2,1)`; reduced-motion: immediate.

Reduced motion also disables the xterm cursor blink and the two-finger inertia scroller. No parallax or continuous motion is used.

## Accessibility (Or: 44pt, 2px, and No Traps)

- Native buttons, inputs, selects, and modal dialogs; visible 2px focus ring.
- Browser tabs use `role="tab"` with `aria-selected`; the tab lists use `role="tablist"`. Workspace navigation uses `aria-current="page"`.
- The phone permission select keeps an accessible name; the visual label is present when Share is open.
- Primary controls and tab close are at least 44pt. The split separator is a visible line with a grip, pointer and touch drag, and keyboard support: Left and Right arrows on the desktop vertical separator, Up and Down on the tablet horizontal separator, with Home and End jumping to the bounds. Safe-area insets are respected at the top, bottom, and around the phone sheet.
- The phone's collapsed state is not a trap: keydown wakes the chrome, the bottom navigation remains reachable, and the first touch on the content only restores the chrome instead of activating the page or terminal underneath.
- The destructive Close terminal action uses an in-design confirmation with Cancel and Close terminal. The settings dialog uses the workspace type system and 44px fields.
- Text and controls meet contrast on the porcelain chrome; the terminal keeps its own theme.

This is load-bearing. None of it is a nice-to-have, and none of it is negotiable.

## Anti-AI-slop review (Or: The Checklist We Actually Ran)

Reviewed against the Open Design checklist:

- No indigo accent, no two-stop trust gradient, no emoji, no invented metrics, no filler copy.
- No identical rounded card grid; Tools is a grouped list with task headings, icons, descriptions, and a destructive row separated by color and confirmation.
- The only repeated card-like shapes are controls and tabs, which carry different roles.
- The character is the identity: a monocled colonial mouse holding a terminal sign, used large in the sidebar brand art and the browser empty state; the bust portrait is the small SVG icon asset. The terminal surface stays black; the chrome stays quiet.
- The empty browser state is specific to the product ("A place for the web" with local-host guidance), not placeholder content.

That is the review. It was not a vibe check.

## Evidence (Or: Math. Not Vibes.)

- `npm run test:workspace` covers terminal input, human and agent tabs, sharing/revocation, page text, hidden-agent navigation, reduced motion, the tablet split drag and expand, and phone/tablet/desktop layouts at 393×852, 820×1180, 1440×900, and 1920×1080. The desktop separator drag and both orientation bounds are verified in the split-handle pass recorded in `docs/evidence/mascot-correction/` and `stewardship/screens/pass16`.
- `npm run test:ui` measures the surface-protection invariant and token contrast at all three breakpoints. The pass recorded 2026-11-18 found zero intersections for Tools, Sessions, close confirmation, Settings, and the pane menu, with control-boundary ratios of 3.60:1 (white) and 3.18:1 (paper), and pane control at 3.4:1.
- `npm test` covers the engine suite and responsive layout tests.
- Accepted screenshots are recorded in the stewardship evidence directory.
- The adversarial secondary-model grade is recorded in the stewardship `EVIDENCE.md`.

If you do not believe us, run it yourself.

## Known limits (Or: The Honest Part)

- The browser viewer is image-based; it is remote interaction, not a native DOM exposed to the viewer's assistive technology. Agents use `/content` for text.
- Browser sessions and grants are in memory; a server restart closes them.
- Browser audio, file dialogs, extensions, and password managers are not provided.
- At most 32 browser contexts can remain open.
- Real Safari/iPadOS behavior and an authenticated remote proxy are not verified by the headless test matrix.

These are limits, not features waiting for a better slide.

```
┌──────────────────────────────────────────────────────────┐
│  DOCUMENT METADATA                                       │
├──────────────────────────────────────────────────────────┤
│  Layouts:            3 (desktop, tablet, phone)          │
│  Panes per tab:      1-4, 2x2 grid                       │
│  Chrome accents:     1 (blue #175cbb)                    │
│  Emoji:              0                                   │
│  Cat Supervision:    Bella approved / Bowser monitoring  │
│  Corporate Feelings: HURT (intended)                     │
└──────────────────────────────────────────────────────────┘
```

**DOCUMENT ENDS**

*— The Design Record That Would Like a Monocle for the Edge Cases*

*Floyd’s Labs — Townmouse Design Division*

*"Quiet chrome, black terminal, uncropped mouse. The rest is negotiation."*

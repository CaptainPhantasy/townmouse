# TOWNMOUSE design

## Product job

TOWNMOUSE is a terminal and agent browser workspace. A person needs to run a
real shell and a real browser page on the same host, switch between them
quickly, and understand exactly what an agent can see or control. The terminal
is the anchor; the browser is a peer surface.

## Selected workflow

Primary: the Legacy Design Studio's Frontend Design workflow
(`frontend-design/SKILL.md`). Supplemental review: the Studio's Open Design
anti-AI-slop guide (`open-design/craft/anti-ai-slop.md`). The Studio is read in
place from its installed library; the application stays in this repository and
the Studio supplies guidance only.

## Design plan

**Color.** Porcelain `#eef1f5`, ink `#202832`, glass `#ffffffcc`, line
`#cbd2dc`, blue `#175cbb`, terminal `#14171b`. The blue is the only chrome
accent. The terminal surface keeps its own dark palette; workspace chrome never
inherits the terminal's accent or elevation colors.

**Type.** The system sans (SF on Apple platforms) for workspace chrome. The
terminal keeps its monospace face. Type sizes step 10 / 11 / 12 / 13 / 14 / 18 /
20 / 22 px; the brand wordmark is 19 px with tight tracking.

**Layout.** A quiet, light frame around a dark terminal. Navigation is one
consistent model with device-specific structures; the terminal and browser
surfaces are never merely scaled from one device to another.

**Principles.**

- The terminal is uninterrupted. Controls sit outside the black surface.
- State is explicit: Human or Agent, Private / View only / Control, session and
  working directory.
- Every primary control is reachable and at least 44pt.
- Spend boldness in one place: the Townmouse character and the terminal's
  contrast. Everything around it stays quiet.
- No emoji, decorative gradients, invented metrics, template hero, or identical
  card grid.

**Brand character.** Townmouse is the monocled colonial mouse: the terminal is
the house, the browser is the town. The full-figure illustration is the single
bold visual move: the large sidebar brand art, the browser empty state, and the
README. The bust portrait is the small SVG icon asset (favicon, app/PWA icons,
and tiny chrome), shown uncropped. Both are the owner's original 1254×1254 RGBA
PNGs, scaled with `object-fit: contain`; the character is never cropped. The
character is never repeated as an emoji.

**Assets.** Originals live in `assets/brand/mascot/` (`townmouse-aristocrat.png`,
`townmouse-monocled.png`), copied byte-for-byte from the owner's files, with
their checksums recorded in that folder's `README.md`. The bust is wrapped as
`townmouse-icon.svg` for the SVG icon surfaces. Optimized transparent WebP files
live in `public/brand/`; the generated PWA/app icons are `public/icon-*.png`,
including the padded maskable icon.

**Creator credit.** A small Floyd’s Labs neon-cats mark appears in the desktop
sidebar and in the Tools sheet, labeled “Built at Floyd’s Labs” and linking to
floydslabs.com. It is a creator credit, distinct from the Townmouse character,
and stays small enough never to compete with the product brand.

## Three layouts

**Desktop (1440×900 and wider).** A 208px sidebar holds the brand, Terminal,
Browser, the tab list, New tab, Agent, Tools, and the real local server
address. The terminal fills the main frame. Opening a browser splits the frame
horizontally with a 60px header and a 30px footer. Browser tabs live in the
sidebar; sharing controls are always visible in the browser surface.

**Tablet (820×1180).** A 72px labeled rail holds the mark, Terminal, Browser,
Agent, and Tools. The terminal fills the frame. Opening a browser stacks the
terminal above the browser with a draggable split handle; the key bar and
footer leave the split so the browser gets the space. Browser tabs, Share,
Expand, and Hide live in the browser tab strip. Share reveals the permissions
row. Expand gives the browser the whole frame.

**Phone (393×852).** A bottom navigation holds Terminal, Browser, Agent, and
Tools. One task surface is visible at a time. The terminal key bar collapses to
one row of essentials plus a chevron that reveals the rest. In the browser, the
state row sits at the top. The tab strip, address bar, and Share sit at the
bottom above the remote keyboard, within thumb reach. The address bar carries
back, forward, reload, the URL, and Go; Share opens the permissions row above
the address bar. The tab itself carries Close.

## Navigation and browser model

- The session pill is a button. It opens a Sessions sheet listing every named
  session, marking the current one, switching between them, and offering New
  session. The footer keeps the shell command, working directory, and uptime.
- Human and agent browser tabs share one tab strip. Each tab advertises Human or
  Agent; the persistent state row shows the active kind and permission.
- Human tabs start Private. View only and Allow control rotate the connection
  token. Private revokes subsequent token requests. Close tab destroys the
  context.
- The agent browser has control granted and keeps running when its view is
  hidden.

## Motions

1. **Drawer reveal** — Tools opens and closes; 260ms; `cubic-bezier(.2,.8,.2,1)`;
   reduced-motion: immediate, no transform.
2. **Surface switch** — terminal or browser surface enters; 220ms;
   `cubic-bezier(.2,.8,.2,1)`; reduced-motion: immediate.
3. **Control press** — pointer down/up on controls; 180ms;
   `cubic-bezier(.2,.8,.2,1)`; reduced-motion: no transform/transition.
4. **Active tab feedback** — selected tab background and border; 200ms;
   `cubic-bezier(.2,.8,.2,1)`; reduced-motion: immediate.
5. **Tool state** — active tool row fill, white text, and checkmark; 180ms;
   `cubic-bezier(.2,.8,.2,1)`; reduced-motion: immediate.

Reduced motion also disables the xterm cursor blink and the two-finger inertia
scroller. No parallax or continuous motion is used.

## Accessibility

- Native buttons, inputs, selects, and modal dialogs; visible 2px focus ring.
- Browser tabs use `role="tab"` with `aria-selected`; the tab lists use
  `role="tablist"`. Workspace navigation uses `aria-current="page"`.
- The phone permission select keeps an accessible name; the visual label is
  present when Share is open.
- Primary controls and tab close are at least 44pt. The tablet split handle is a
  44pt row with a visible grip and keyboard-arrow support. Safe-area insets are
  respected at the top, bottom, and around the phone sheet.
- The destructive Close terminal action uses an in-design confirmation with
  Cancel and Close terminal. The settings dialog uses the workspace type system
  and 44px fields.
- Text and controls meet contrast on the porcelain chrome; the terminal keeps
  its own theme.

## Anti-AI-slop review

Reviewed against the Open Design checklist:

- No indigo accent, no two-stop trust gradient, no emoji, no invented metrics,
  no filler copy.
- No identical rounded card grid; Tools is a grouped list with task headings,
  icons, descriptions, and a destructive row separated by color and
  confirmation.
- The only repeated card-like shapes are controls and tabs, which carry
  different roles.
- The character is the identity: a monocled colonial mouse holding a terminal
  sign, used large in the sidebar brand art and the browser empty state; the
  bust portrait is the small SVG icon asset. The terminal surface stays black;
  the chrome stays quiet.
- The empty browser state is specific to the product ("A place for the web" with
  local-host guidance), not placeholder content.

## Evidence

- `npm run test:workspace` covers terminal input, human and agent tabs,
  sharing/revocation, page text, hidden-agent navigation, reduced motion, the
  tablet split drag and expand, and phone/tablet/desktop layouts at
  393×852, 820×1180, 1440×900, and 1920×1080.
- `npm test` covers the engine suite and responsive layout tests.
- Accepted screenshots are recorded in the stewardship evidence directory.
- The adversarial secondary-model grade is recorded in the stewardship
  `EVIDENCE.md`.

## Known limits

- The browser viewer is image-based; it is remote interaction, not a native DOM
  exposed to the viewer's assistive technology. Agents use `/content` for text.
- Browser sessions and grants are in memory; a server restart closes them.
- Browser audio, file dialogs, extensions, and password managers are not
  provided.
- At most eight browser contexts can remain open.
- Real Safari/iPadOS behavior and an authenticated remote proxy are not verified
  by the headless test matrix.

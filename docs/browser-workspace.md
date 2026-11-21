# Browser Workspace

## Or: The Browser Is Real, The Iframe Is Not

---

- **DOCUMENT CLASSIFICATION:** Technical / Moderate Chaos
- **DATE RECORDED:** 2026-11-15 — Late Enough To Be Useful
- **LOCATION:** The Garage, Brown County, Indiana
- **BEVERAGE:** Coffee that tastes like motor oil (fresh pot)
- **CURRENT STATE:** One Chromium engine, several opinions

---

Open **Browser** or the **+** in the tab strip to create an isolated Chromium
page on the terminal host. Enter a web address, search phrase, or localhost URL.
Navigation, clicking, typing, and scrolling happen in that real page,
independent of iframe policies. The iframe was a compromise. This is not that.

Each tab has its own cookie context. These are workspace browser tabs, not an
attachment to an existing Safari or Chrome profile. Browser audio, file
upload/download dialogs, extensions, and password-manager integration are not
provided by the image-based viewer.

## Pane workspace

Open `/panes.html` (or **Panes** in the sidebar) for the split workspace. Each
workspace tab holds up to four panes in a 2x2 grid; a pane is either a real PTY
terminal or a real browser page. The browser panes are rendered by the same
headless-browser backend as the single browser tab, and the terminal panes are
independent PTY sessions powered by the embedded TerminalOne engine.

An agent running in a terminal pane receives:

```text
TOWNMOUSE_API=http://127.0.0.1:<port>/api/panes
TOWNMOUSE_TOKEN=<workspace token>
TOWNMOUSE_TAB_ID=<this tab>
TOWNMOUSE_PANE_ID=<this pane>
TOWNMOUSE_PANES_CLI=<repo>/scripts/panes
```

So it can create tabs, add panes, open URLs, run commands, read output, and send
input natively. No connection code is copied between the browser and the
terminal. The pane limits are 24 tabs, four panes per tab, 24 terminal panes, and
32 browser contexts. The full command list is in [panes.md](panes.md).

## Layouts

- **Desktop:** persistent sidebar, browser tabs in the sidebar, terminal and
  browser split horizontally when a browser is open. The separator is draggable
  left and right; the terminal keeps at least 320px and the browser at least
  420px.
- **Tablet:** labeled rail, browser tabs in a strip above the address bar,
  terminal and browser stacked vertically when a browser is open. The separator
  is draggable up and down between a 25% and 75% browser share.
- **Phone:** bottom navigation with Terminal, Browser, Agent, and Tools. One task
  surface is visible at a time. The key bar collapses to one row; the chevron
  reveals the remaining keys. Browser tabs and sharing controls live in the
  browser surface. The browser and terminal chrome is tightly padded, and after
  seven seconds without a touch it collapses to the content; the bottom
  navigation stays and the next touch wakes the chrome.

Three layouts, not one layout stretched until it apologizes.

## Sharing

Human tabs start Private. Select **Share** to open the sharing row at every
width; it starts closed so the page keeps the space. A **Collapse** control
removes every bar above the page and remembers the choice, leaving a slim strip
that names the page and brings the controls back. The mascot stays in the
navigation rail and no longer appears in the working area.

This is the **compatibility** path. For agent work, open `/panes.html`; the
orchestrator receives `TOWNMOUSE_API` and `scripts/panes` directly, with no
connection code to copy. If you are using the legacy single-browser flow, select
View only or Allow control, then Copy connection, and paste the connection JSON
into your terminal agent. Changing permission rotates the token; choosing Private immediately
rejects subsequent token requests. Commands already executing can finish.
Closing a tab destroys its context.

The supplied endpoint accepts a Bearer token in the `Authorization` header:

- `GET /content`: current URL, title, and visible text.
- `GET /snapshot`: current URL, title, and JPEG image in base64.
- `POST /action` with JSON: `navigate` (url), `back`, `forward`, `reload`,
  `click` (x,y in the dimensions returned by `/snapshot`), `type` (text), `key`
  (Puppeteer key name), `scroll` (deltaY).

View tokens cannot invoke actions or change grants. Never paste the token into a
visited web page. A token is a key, and web pages are full of people who would
love a copy of your keys.

Choose **Agent** to create a separate context with control granted. Hide view
keeps the browser running headless. Reopen Agent to observe the same context.
Revoking access also works on the agent context.

The viewer samples images once per second when open. This is remote interaction,
not a native browser DOM exposed to the viewer's assistive technology. Agents can
use `/content` for text. Keyboard Tab moves through the workspace interface; the
Send field, Tab, and Enter buttons interact with page inputs.

Localhost means the terminal server host, not the phone or tablet. HTTP and HTTPS
are supported; file URLs and embedded URL credentials are rejected.

## Agent control

The agent surface describes what it sees and what it did. It does not make an
agent guess from a picture alone, and it does not report success it cannot show.

- **Observations.** `GET /api/browser/:id/observe` returns a screenshot plus a
  label: observation id, capture time, viewport size, scroll offset, address,
  title, and a revision counter. `?elements=1` adds the controls.
- **Controls by identity.** `GET /api/browser/:id/elements` catalogs controls
  across every frame (including cross-origin iframes) and open shadow roots with
  role, accessible name, value, state, box, and a stable `ref` (`e12`). The ref
  is a DOM marker, not an index, so it survives unrelated re-renders.
- **Actions.** `POST /api/browser/:id/action` accepts `click`, `hover`, `drag`,
  `type`, `key`, `scroll`, `select`, `navigate`, `back`, `forward`, and `reload`,
  by `ref` or by coordinate. Key combinations such as `Alt+M` are supported;
  `type` with `replace: true` clears the field first.
- **Results.** Every action returns `status`: `completed`, `missing`,
  `wrong-kind`, `failed`, `stale`, or `unconfirmed`, plus the focused control and
  its value where useful. A coordinate cites the observation it came from; if
  the page's geometry moved, the action is refused with `409` and an instruction
  to look again.
- **Waiting.** `POST /api/browser/:id/wait` waits for an address, title, text,
  selector, or field value, always bounded by a timeout.
- **Scrolling.** `scroll` with a ref or selector scrolls that element's own
  scroll box; without one it scrolls the page deliberately.
- **Sizing.** `POST /api/browser/:id/sizing` with `mode: fixed` locks the page
  viewport so the owner's viewer scales the picture instead of rearranging the
  page. `mode: fit` restores the old behaviour.

Run `npm run test:agent-control` to exercise these controls against a real
browser using `tests/agent-control.test.cjs`.

## Runtime and trust

Puppeteer is a production dependency; `npm ci` downloads its compatible
Chromium. `TERMINALONE_CHROME` can select an operator-installed compatible
binary. The name is a compatibility holdover; the binary it points at is just
Chromium. Use the pinned runtime by default.

The existing loopback listener and request-origin checks protect workspace
routes. User control keys stay in page memory and are never embedded in page
URLs. API responses use no-store. At most 32 browser contexts can remain open.

Grants protect cooperative API clients, not hostile processes that already have
unrestricted access to the host shell or the browser owner's application. The
local server has the user's existing authority. Keep remote access behind the
existing authenticated proxy in [PACKAGING.md](PACKAGING.md).

Browser sessions and grants are in memory. Restarting the server closes them;
saved browser profiles and seamless session persistence are not implemented. No,
"seamless" is not a feature we are hiding. It does not exist.

## Validation

`npm run test:workspace` starts the workspace and its own local preview site,
then exercises terminal input, tabs, sharing, revocation, the agent browser,
hidden-agent navigation, reduced motion, and the phone, tablet, and desktop
layouts. It captures evidence at 393×852, 820×1180, 1440×900, and 1920×1080.

[DESIGN.md](../DESIGN.md) lists the five named motions and the device-specific
structures.

```text
┌──────────────────────────────────────────────────────────┐
│  DOCUMENT METADATA                                        │
├──────────────────────────────────────────────────────────┤
│  Classification:   Technical / Browser Workspace          │
│  Cat Supervision:  Bella, asleep on the tab strip         │
│  "I Don't Suck":   PASS                                   │
│  Corporate Feelings: HURT (intended)                      │
└──────────────────────────────────────────────────────────┘
```

**DOCUMENT ENDS**

*— Workspace, Floyd's Labs*
*The Garage — Brown County, Indiana*
*"A browser tab should be a browser, not a JPEG with a dream."*

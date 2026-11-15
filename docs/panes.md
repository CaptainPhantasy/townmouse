# Pane Workspace

## Or: Four Panes, One Token, Zero Connection Codes To Copy

---

- **DOCUMENT CLASSIFICATION:** Technical / Moderate Chaos
- **DATE RECORDED:** 2026-11-15 — Late Enough To Be Useful
- **LOCATION:** The Garage, Brown County, Indiana
- **BEVERAGE:** Coffee that tastes like motor oil (fresh pot)
- **CURRENT STATE:** Four panes open, one agent asking for a fifth

---

Open `/panes.html`, `/panes`, or **Panes** in the workspace sidebar. This is the
agent-first surface: a workspace tab holds one to four panes, and each pane is
either a live PTY terminal or a live headless-browser page. Tabs are created by
the human or by the orchestrator, and every tab can hold a different mix.

The terminal panes are real PTYs from the embedded TerminalOne engine. The
browser panes are real Chromium pages rendered by the server. Neither one is a
screenshot pretending to be a workspace.

The server caps the workspace at 24 tabs, four panes per tab, and 24 terminal
panes. The browser runtime caps open browser contexts at 32. The state response
carries `maxTabs`, `maxPanesPerTab`, and `maxTerminalPanes`. The caps exist so a
runaway agent runs out of room before it runs the machine out of memory.

## Human

- **Tabs** button in the bottom bar: list, switch, create, and close workspace
  tabs.
- **Menu**: add a terminal or browser pane to the active tab, or create a tab.
- **Keyboard**: focus the active terminal; in a browser pane it focuses the
  page-type field.
- Browser panes accept clicks, wheel scrolling, typing, Back, Reload, and an
  address. The browser is a real Chromium page rendered by the server, and its
  viewport reflows to the pane's actual size so text wraps at the pane edge.
- Drop or paste files/images onto a terminal pane. The file is uploaded once to
  `~/.townmouse/attachments/<YYYYMMDD>/` (25 MB limit) and a shell-quoted
  absolute path is inserted into the PTY. The terminal never receives a base64
  stream. Dropping onto a browser pane opens the attachment URL instead.

## Agent

Each terminal pane is spawned with:

```text
TOWNMOUSE_API=http://127.0.0.1:<port>/api/panes
TOWNMOUSE_TOKEN=<workspace token>
TOWNMOUSE_TAB_ID=<this tab>
TOWNMOUSE_PANE_ID=<this pane>
TOWNMOUSE_PANES_CLI=<repo>/scripts/panes
```

No code is copied between the browser and the terminal. Run the CLI directly:

```sh
"$TOWNMOUSE_PANES_CLI" state
"$TOWNMOUSE_PANES_CLI" tab list
"$TOWNMOUSE_PANES_CLI" tab create --title "Second workspace"
"$TOWNMOUSE_PANES_CLI" tab close <tab-id>
"$TOWNMOUSE_PANES_CLI" pane create --tab <tab-id> --kind terminal
"$TOWNMOUSE_PANES_CLI" pane create --kind browser --url https://example.com
"$TOWNMOUSE_PANES_CLI" pane url <pane-id> https://example.com
"$TOWNMOUSE_PANES_CLI" pane run <pane-id> "npm test"
"$TOWNMOUSE_PANES_CLI" pane input <pane-id> "echo hello"
"$TOWNMOUSE_PANES_CLI" pane read <pane-id> --lines 120
"$TOWNMOUSE_PANES_CLI" pane close <pane-id>
"$TOWNMOUSE_PANES_CLI" active --tab <tab-id> --pane <pane-id>
```

`pane create` defaults to `TOWNMOUSE_TAB_ID` when `--tab` is omitted. It also
accepts `--cwd` and `--title`. `tab create` accepts `--activate` when the new
tab should become active; without it, the CLI creates the tab without moving the
active tab. The orchestrator can create as many tabs as the server allows; each
tab holds up to four panes. A single tab can be all terminals, all browsers, or
any mix.

`pane url` requires a browser pane. `pane run` writes the command with a newline
and returns the last 4,000 characters of output after its wait. `pane input`
writes raw text and does not append a newline. Both `pane run` and `pane input`
require a terminal pane.

The CLI reads `TOWNMOUSE_API` and `TOWNMOUSE_TOKEN` from the environment and
falls back to `~/.townmouse/pane-token` when the token is absent. It sends the
token in `X-Townmouse-Token`; the API also accepts `Authorization: Bearer
<token>`. The owner bootstrap route is separate: an agent token cannot bootstrap
the owner workspace.

## Wire facts

- Terminal output is an SSE stream at
  `GET /api/panes/panes/<pane-id>/stream?since=<offset>` with
  `Content-Type: text/event-stream`. Each event's JSON payload carries `data` and
  `offset`; the initial replay also reports `exited`. The server keeps the last
  200,000 characters of output and replays from `since`. It sends a `: ping`
  comment every 15 seconds.
- If the stream drops, the client falls back to polling
  `GET /api/panes/panes/<pane-id>/read?since=<offset>` every 180 ms. A dropped
  stream is not a dead terminal.
- Terminal input is batched by the client: keystrokes and pastes are coalesced
  for 12 ms, and at most one `POST /api/panes/panes/<pane-id>/input` is in
  flight. Payloads over 24,000 characters are split into sequential chunks so
  each request stays under the JSON body limit; order is preserved. A burst of
  typing arrives as one ordered request, which is the difference between smooth
  and jittery when the agent is also producing output.
- Resize is `POST /api/panes/panes/<pane-id>/resize`. Terminal columns are
  clamped to 20-400 and rows to 5-200. Browser panes set a viewport clamped to
  320-1920 by 240-1200.

The workspace limits are real. The token is real. The panes are real. The old
way copied a connection string between the browser and the terminal; this one
hands the agent the environment and gets out of the way.

```text
┌──────────────────────────────────────────────────────────┐
│  DOCUMENT METADATA                                        │
├──────────────────────────────────────────────────────────┤
│  Classification:   Technical / Pane Workspace             │
│  Cat Supervision:  Bowser, monitoring the pane count      │
│  "I Don't Suck":   PASS                                   │
│  Corporate Feelings: HURT (intended)                      │
└──────────────────────────────────────────────────────────┘
```

**DOCUMENT ENDS**

*— Workspace, Floyd's Labs*
*The Garage — Brown County, Indiana*
*"Four panes is a workspace. Five is an incident report."*

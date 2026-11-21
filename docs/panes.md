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

On first start, with no saved workspace, the pane surface seeds one tab with a
terminal pane titled **Orchestrator**. That is a real PTY of its own — a second
shell alongside the standard terminal view — created by the same server process,
not a second application instance. It is intentional: the workspace opens with a
place for the orchestrator to work. Keep it.

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
- Drag a divider to resize panes, use Arrow/Home/End while a divider is focused,
  or double-click it to reset. Ratios are remembered per tab.
- The phone key bar above the bottom navigation provides Esc, Tab, sticky
  Ctrl/Alt, C, arrows, Home/End, PgUp/PgDn. Ctrl then C sends SIGINT.
- Right-click or long-press a terminal for Copy, Paste, Select all, Clear, and
  Reader. Reader is a word-wrapped transcript; the live pane remains a cell
  grid. Menu also has smaller/larger text, and a shortcut sheet.
- Closing a pane or tab asks first. An answerable `alert`/`confirm`/`prompt`
  appears as a card; a forgotten dialog is dismissed after 30 seconds.
- Browser panes accept clicks, wheel scrolling, typing, Back, Forward, Reload,
  and an address. The browser is a real Chromium page rendered by the server,
  and its viewport reflows to the pane's actual size.
- Drop or paste files/images onto a terminal pane. The file is uploaded once
  into the state directory's `attachments/<YYYYMMDD>/` tree (25 MB per request,
  2,000 files / 512 MB per day) and a shell-quoted absolute path is inserted
  into the PTY. The terminal never receives a base64 stream. An attachment card
  shows the path and URL with Copy/Open actions; dropping onto a browser pane
  opens the loopback URL instead. Buckets older than
  `TOWNMOUSE_ATTACHMENT_RETENTION_DAYS` (default 30) move to
  `attachments-archive` instead of being deleted.

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
"$TOWNMOUSE_PANES_CLI" pane send-text <pane-id> "multi-line prompt"
"$TOWNMOUSE_PANES_CLI" pane keys <pane-id> ctrl+c
"$TOWNMOUSE_PANES_CLI" pane wait <pane-id> --match "PASS" --timeout 60000
"$TOWNMOUSE_PANES_CLI" pane status <pane-id> --state blocked --message "approval?"
"$TOWNMOUSE_PANES_CLI" pane dialog <pane-id> --accept
"$TOWNMOUSE_PANES_CLI" pane read <pane-id> --lines 120
"$TOWNMOUSE_PANES_CLI" pane close <pane-id>
"$TOWNMOUSE_PANES_CLI" attach ./screenshot.png --pane <pane-id>
"$TOWNMOUSE_PANES_CLI" active --tab <tab-id> --pane <pane-id>
```

### Instruction sheet

`panes guide` (or `GET /api/panes/guide`) prints the sheet an agent receives on
connect: every tool, what it needs, what it returns, and — separately — which
capabilities this connection has and has not been granted. It describes
permissions; it does not enlarge them. `npm run test:agent-control` verifies
the guide and the boundary between agent and owner capabilities.

### Pane ids default to the current pane

Inside a pane, the pane id can be omitted. The CLI recognises a real id by shape
(`p_…`) and otherwise falls back to `TOWNMOUSE_PANE_ID`, so `panes pane read` and
`panes pane browser click` work with no argument.

### Tracked commands

`pane run` types a line into the interactive terminal and returns recent output.
That does **not** prove the command finished. For ordinary, non-interactive
commands use a tracked job:

```sh
"$TOWNMOUSE_PANES_CLI" pane exec -- "npm test"        # waits, returns exit code
"$TOWNMOUSE_PANES_CLI" pane exec --no-wait -- "make"   # returns a job id
"$TOWNMOUSE_PANES_CLI" pane job <job-id>               # poll it
```

A job reports `status` (`running` | `completed` | `failed`), `exitCode`,
`signal`, `stdout`, `stderr`, and truncation flags. Keep the interactive
terminal for programs such as `dlaude` that stay open and wait for input.

### Clean and raw terminal text

`pane read` renders screen text (`replayTranscript`) so escape codes do not
clutter the output, and `--raw` returns the original terminal data. Both modes
report `offset`, `bufferStart`, and a `truncated` flag.

### Browser control

```sh
"$TOWNMOUSE_PANES_CLI" pane browser observe --elements        # labelled screenshot + controls
"$TOWNMOUSE_PANES_CLI" pane browser elements                  # controls only
"$TOWNMOUSE_PANES_CLI" pane browser click --ref e12
"$TOWNMOUSE_PANES_CLI" pane browser click --x 300 --y 200 --observation 42
"$TOWNMOUSE_PANES_CLI" pane browser type --ref e12 --replace "café 東京"
"$TOWNMOUSE_PANES_CLI" pane browser key Alt+M
"$TOWNMOUSE_PANES_CLI" pane browser hover --ref e12
"$TOWNMOUSE_PANES_CLI" pane browser drag --from-ref e12 --to-ref e15
"$TOWNMOUSE_PANES_CLI" pane browser scroll --ref e12 --dy 400
"$TOWNMOUSE_PANES_CLI" pane browser select --ref e12 --value blue
"$TOWNMOUSE_PANES_CLI" pane browser navigate https://example.com
"$TOWNMOUSE_PANES_CLI" pane browser wait --text "Saved" --timeout 10000
"$TOWNMOUSE_PANES_CLI" pane browser sizing fixed --width 1280 --height 800
```

Controls are identified by role and name, including inside cross-origin frames
and open shadow roots. Each action returns a `status` (`completed`, `missing`,
`wrong-kind`, `failed`, `stale`, `unconfirmed`); a coordinate used with a stale
`--observation` is refused with exit code 4 and a message to look again. Every
wait is bounded. In `fixed` sizing the owner's viewer scales the picture instead
of rearranging the page.

`pane create` defaults to `TOWNMOUSE_TAB_ID` when `--tab` is omitted. It also
accepts `--cwd` and `--title`. `tab create` accepts `--activate` when the new
tab should become active; without it, the CLI creates the tab without moving the
active tab. The orchestrator can create as many tabs as the server allows; each
tab holds up to four panes. A single tab can be all terminals, all browsers, or
any mix.

`pane url` requires a browser pane. `pane run` writes the command with a newline
and returns the last 4,000 characters of output after its wait, flagged
`confirmed: false` because typing a line is not proof the command finished; use
`pane exec` for a tracked job. `pane input` writes raw text and does not append a
newline. Both `pane run` and `pane input` require a terminal pane.

`pane send-text` preserves literal text and wraps it in bracketed-paste markers
by default; pass `--raw` to opt out. `pane keys` accepts logical names including
`enter`, `esc`, `tab`, `ctrl+c`, `alt+x`, and arrows. `pane wait` long-polls for
plain text, a regex, an idle interval, or an agent-reported state, and returns
the matching output with `offset` and `elapsedMs`; the server caps a wait at 120
seconds. `pane status` records `working`, `blocked`, `idle`, `done`, or `unknown`
with an optional message; the pane header colors the badge and state responses
carry `lastOutputAt`, `idleMs`, `exitCode`, and `exitSignal`. `pane dialog`
answers a waiting page dialog. `attach` uploads a file with the scoped pane token
and prints `path`, `url`, `localUrl`, and `relativeUrl`; use `--pane` to insert
the quoted path as well. Pane order is changed with
`POST /api/panes/tabs/<tab-id>/reorder` (`paneId`, `index`), or on the client by
dragging a pane header or Alt+Shift+Arrow.

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
- `POST /api/panes/panes/<pane-id>/start` spawns a deferred terminal at the
  measured cols/rows; the UI creates terminals with `start:false` so the first
  prompt is laid out at the visible width.
- At most four terminal SSE streams are open at once; additional panes use the
  polling fallback so input and state requests keep an HTTP connection. If a
  reader stops draining, the server ends its stream instead of buffering output
  without limit.
- `POST /api/panes/panes/<pane-id>/keys` writes named keys; `GET .../wait`
  supports `match`, `regex`, `idleMs`, and `state`; `POST .../status` records
  agent lifecycle; `POST .../browser/dialog` answers a page dialog.
- State includes an `epoch` minted per server boot and `restored`. After a
  restart the client keeps tabs, pane kinds, titles, cwd, and browser URLs but
  warns that terminal scrollback and running jobs are gone.
- Owner bootstrap (`GET /api/panes/bootstrap`) requires the HttpOnly owner
  cookie minted on page navigation. A pane token receives 403 there; the token
  is accepted by the pane API and by attachment uploads.

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

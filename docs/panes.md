# Pane workspace

Open `/panes.html`, `/panes`, or **Panes** in the workspace sidebar.

A workspace tab holds one to four panes. Each pane is either a live PTY
terminal or a live headless-browser page. Tabs are created by the human or by
the orchestrator, and every tab can hold a different mix. The server caps the
workspace at 24 tabs, four panes per tab, and 32 browser panes in total so a
runaway agent cannot exhaust the machine. The state response carries those
limits.

## Human

- **Tabs** button in the bottom bar: list, switch, create, and close workspace tabs.
- **Menu**: add a terminal or browser pane to the active tab, or create a tab.
- **Keyboard**: focus the active terminal; in a browser pane it focuses the
  page-type field.
- Browser panes accept clicks, wheel scrolling, typing, Back, Reload, and an
  address. The browser is a real Chromium page rendered by the server, and its
  viewport reflows to the pane's actual size so text wraps at the pane edge.
- Drop or paste files/images onto a terminal pane. The file is uploaded once to
  `~/.townmouse/attachments/<date>/` (25 MB limit) and a shell-quoted absolute
  path is inserted into the PTY; the terminal never receives a base64 stream.
  Dropping onto a browser pane opens the attachment URL instead.

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

```bash
"$TOWNMOUSE_PANES_CLI" state
"$TOWNMOUSE_PANES_CLI" tab create --title "Second workspace"
"$TOWNMOUSE_PANES_CLI" pane create --kind terminal
"$TOWNMOUSE_PANES_CLI" pane create --kind browser --url https://example.com
"$TOWNMOUSE_PANES_CLI" pane url <pane-id> https://legacyai.space
"$TOWNMOUSE_PANES_CLI" pane run <pane-id> "npm test"
"$TOWNMOUSE_PANES_CLI" pane read <pane-id> --lines 120
```

`pane create` defaults to the current tab. The orchestrator can create as many
tabs as the server allows; each tab holds up to four panes. A single tab can be
all terminals, all browsers, or any mix.

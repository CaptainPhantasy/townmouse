# Four-pane workspace evidence — 2026-11-15

The workspace tab in `public/panes.html` holds up to four live panes. This pass
was run with pane 1 and pane 2 as separate PTY terminals and panes 3 and 4 as
live headless-browser pages.

- Desktop 1440×900: 4 panes, 2 xterm instances, 2 browser images, no console
  errors. The tab sheet listed both workspace tabs.
- Phone 393×852: 4 panes stacked vertically for readability, bottom bar intact,
  tab count 2.
- API suite `tests/panes-api.test.cjs`: 16/16 pass (bootstrap, tabs, 2 terminal +
  2 browser panes, fourth-pane 409, command/read, snapshots, URL navigation,
  activation, pane/tab close).
- Native agent path verified: the orchestrator pane's environment contained
  `TOWNMOUSE_API`, `TOWNMOUSE_PANE_ID` and `TOWNMOUSE_PANES_CLI`, and
  `scripts/panes pane create --kind browser --url ...` created a real browser
  pane without copying a token or connection code.
- Review fixes landed: failed browser navigations no longer leak sessions; a
  tab closed during browser creation closes the new context; concurrent pane
  creation rechecks the four-pane limit; Chromium disconnect clears the cached
  browser; internal pane browsers are hidden from `/api/browser`; pane routes
  are no-store; PTY teardown escalates to SIGKILL; terminal-pane count is capped.

Screenshots: `panes-desktop.png`, `panes-phone.png`, `panes-tabs-dialog.png`.
The acceptance script is archived here as `panes-ui-test.cjs`.

## Attachment and reflow pass — 2026-11-15

- Dropped a 68-byte PNG onto a terminal pane. It uploaded once to
  `~/.townmouse/attachments/20261115/…` and the terminal received the
  shell-quoted absolute path, not a base64 stream.
- `POST /api/attachments` returned `{path, url, ...}`; the returned URL served
  HTTP 200 and the file existed on disk.
- In a two-pane tab the browser view measured 709 px and the snapshot image was
  exactly 709 px wide (height 804), proving the browser viewport reflows to the
  pane instead of staying fixed at 1280×800.
- `tests/panes-api.test.cjs` still passes 16/16; the four-pane UI acceptance
  still renders 4 panes / 2 terminals / 2 browsers with no console errors.
- The archival attachment test is `panes-attach-test.cjs`.

## Input coalescing pass — 2026-11-15

Typing `echo BATCH_OK` and pressing Enter (13 keystrokes) produced **one**
POST to `/api/panes/panes/:id/input`, and the shell executed it correctly.
The panes UI now buffers keystrokes for 12 ms and flushes one ordered request
instead of one HTTP round-trip per keystroke.

## Codex review fixes — 2026-11-15

- JSON attachment uploads now parse before the global JSON middleware; an 11-byte
  `sample.json` returned 200 and the file existed on disk.
- Untrusted attachment documents are served with
  `Content-Security-Policy: sandbox; default-src 'none'; …`, so HTML/SVG cannot
  read the workspace token or call the pane API as a same-origin document.
- Session menu uses full UUIDs from `/admin/sessions` and `#sessionInfo`'s
  `data-session-id`; switching from `02209129…` back to `66b0e80d…` reconnected
  to the original shell instead of starting a new one.
- The `panes` CLI preserves trailing flags: `pane run <id> "printf ... --runInBand"`
  executed with `--runInBand` intact.
- Pane output uses one SSE stream per terminal (0 `/read` polls during the test)
  and input coalescing still sends one POST for 13 keystrokes.
- Package dry-run includes `bin/townmouse`, `scripts/panes`, `public/panes.mjs`,
  and `LICENSE`.

The archival tests are `codex-fixes-test.cjs`, `input-batch-test.cjs`, and
`panes-attach-test.cjs`.

## Mobile/dialog/large-input pass — 2026-11-15

- A fixture page calling `alert("HELLO_DIALOG")` no longer deadlocks the
  browser pane. The snapshot reports `{type:"alert", message:"HELLO_DIALOG"}`
  and the page stays usable; the dialog is recorded and dismissed.
- A 70,000-byte terminal input request now returns 200; the JSON body limit is
  2 MB and the UI still chunks large pastes at 24,000 characters.
- Browser panes have touch-drag scrolling in addition to wheel/click.
- The `panes` CLI creates agent tabs in the background by default; `--activate`
  is opt-in. Human tabs from the UI still activate.
- The archival test is `pane-large-dialog-test.cjs`.

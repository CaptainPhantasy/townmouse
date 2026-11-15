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

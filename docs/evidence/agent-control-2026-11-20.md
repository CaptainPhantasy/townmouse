# Evidence — orchestrator assessment items

**Date:** 2026-11-20
**Host:** mac-mini (probed with `hostname` before the runs)
**Runtime:** `/usr/local/bin/node` v22.18.0 (`scripts/node-runtime.sh doctor` → `native_modules=ok`)
**Implementation record:** `docs/plans/townmouse-orchestrator-assessment-2026-11-20-implementation.md`

The primary evidence is `tests/agent-control.test.cjs`: a real server, a real
Chromium, and a real PTY, against fixture pages with a scrollable panel, a
cross-origin iframe, an open shadow root, and a delayed element. Run it with:

```sh
scripts/node-runtime.sh exec tests/agent-control.test.cjs
```

Every row below cites either that test or the existing suite. A row is not a
pass unless the command shown was run.

| R | item | command or observation | output excerpt | host | date |
| --- | --- | --- | --- | --- | --- |
| 1 | Instruction sheet on connect | `node tests/agent-control.test.cjs` → guide checks | `PASS guide: returns tools, permissions, and the native CLI status`; `PASS guide: requires the workspace token` | mac-mini | 2026-11-20 |
| 2 | Identify things by what they are | same → elements/click checks | `PASS elements: catalogues by role and name across frames and shadow roots`; `PASS click: acts by ref, not by guessed coordinates` | mac-mini | 2026-11-20 |
| 3 | Nested pages and custom components | same → frame/shadow checks | `PASS click: works inside a cross-origin iframe`; `PASS click: works inside an open shadow root` | mac-mini | 2026-11-20 |
| 4 | Observation labels | same → observe check | `PASS observe: returns a labelled observation with a fresh image`; `PASS content: says when the text was cut short` | mac-mini | 2026-11-20 |
| 5 | Old picture / old target warning | same → stale checks | `PASS stale: a coordinate from a changed page is refused`; `PASS stale: a fresh observation is accepted` | mac-mini | 2026-11-20 |
| 6 | Report whether the action worked | same → result/navigation checks | `PASS type: a button is the wrong kind of control`; `PASS navigate: returns the new address with the new title` | mac-mini | 2026-11-20 |
| 7 | Wait for a result with a limit | same → wait checks | `PASS wait: resolves when the expected text appears`; `PASS wait: returns a clear timeout instead of hanging` | mac-mini | 2026-11-20 |
| 8 | Modifier keys, hover, drag, replace | same → input checks | `PASS key: modifier combinations reach the page`; `PASS hover: moves the pointer without clicking`; `PASS drag: drags from one element to another`; `PASS type: --replace replaces the whole value instead of appending` | mac-mini | 2026-11-20 |
| 9 | Scroll the correct part | same → scroll check | `PASS scroll: scrolls the named panel and leaves the page where it was` | mac-mini | 2026-11-20 |
| 10 | Fixed browser size | same → sizing check | `PASS sizing: a locked browser ignores viewer resizes` | mac-mini | 2026-11-20 |
| 11 | Visible maximize/restore | `scripts/node-runtime.sh exec tests/ui-surfaces.test.cjs` | `PASS phone: live surfaces clear of every panel; controls visible; phone nav four surfaces` (maximize control asserted at desktop, desktop-narrow, tablet, phone, landscape) | mac-mini | 2026-11-20 |
| 12 | Correct starting conditions for a harness | `node tests/agent-control.test.cjs` → env check | `PASS env: an independent pane does not inherit a parent AI session identity`. **The live `dlaude` conversation-saving check was not run** (needs an interactive session and a broker lease). | mac-mini | 2026-11-20 |
| 13 | Three meanings of status | same → status check | `PASS status: program, agent, and command states stay separate` | mac-mini | 2026-11-20 |
| 14 | Command completion reports | same → job checks | `PASS jobs: a successful command reports completion and its output`; `PASS jobs: a failing command reports its exit code`; `PASS jobs: a slow command can be polled instead of guessed` | mac-mini | 2026-11-20 |
| 15 | Clean text and raw data | same → text check | `PASS text: clean text drops escape codes, raw keeps them, unicode survives` | mac-mini | 2026-11-20 |
| 16 | Permission levels stay separate | same → permission checks | `PASS permissions: an agent token cannot bootstrap the owner workspace`; `PASS permissions: an agent token cannot change browser sharing` | mac-mini | 2026-11-20 |
| 17 | Access keys out of readable places | same → token checks | `PASS tokens: the workspace token never appears in page content or observations` | mac-mini | 2026-11-20 |
| 18 | Runaway limits kept | same → limits check | `PASS limits: a fifth pane is refused with an explanation` | mac-mini | 2026-11-20 |
| 19 | Complete journeys | same → full run | `RESULT passed=36 total=36 failures=0` | mac-mini | 2026-11-20 |
| 20 | Careful change and honest reporting | `npm test` | see the final line below | mac-mini | 2026-11-20 |

## Native CLI, exercised by hand against a scratch server

| check | command | output excerpt | host | date |
| --- | --- | --- | --- | --- |
| guide | `TOWNMOUSE_API=… node scripts/panes guide` | `{"version":1,…,"cli":{"available":true,"path":"<repo>/scripts/panes"}}`, exit 0 | mac-mini | 2026-11-20 |
| observe with elements | `node scripts/panes pane browser <id> observe --elements --max 10` | `{"obs":1,"ref":"e0","image":"string"}` | mac-mini | 2026-11-20 |
| click by ref | `node scripts/panes pane browser <id> click --ref e0` | `click status: completed` | mac-mini | 2026-11-20 |
| clear a textbox (the reported bug) | `node scripts/panes pane browser <id> type --ref e0 --replace ""` on a field holding `existing text` | `after clear value: ""` | mac-mini | 2026-11-20 |

(Scratch servers on ports 11591–11593, killed afterwards; the live service on
11001 was not touched.)

## What the journey test covers beyond the numbered items

- `PASS setup: a background tab with two browsers and two terminals`
- `PASS focus: background agent work does not activate the tab or pane`
- `PASS two browsers: both operate while a terminal job is still running`
- `PASS interrupt: Ctrl+C stops a program without breaking the terminal`
- `PASS journal: a stale ref is reported as missing, not guessed`

## Full-suite gate

```text
$ npm test
... (security, hooks, unit, smoke, features, behavior, voice, responsive,
     UI surfaces, panes, agent-control, voice routing)
RESULT passed=36 total=36 failures=0   (agent control)
RESULT passed=1 total=1 failures=0     (voice routing)
EXIT=0
```

This run was made against the final tree, with no edits during it. Earlier runs
during development failed and exposed real defects, all fixed before this gate:

- each catalog renumbered refs from zero, so an earlier ref pointed at the wrong
  element (now stable per-element markers);
- the ref resolver started at the document node but only descended into
  elements, so it never found anything (fixed and verified separately);
- replace-typing used a platform accelerator that did not select the field
  (now the DOM `select()` API — verified clearing a populated field to `""`);
- the stale-target test needed a change that actually moves layout; a heading
  text edit does not, so the test now inserts a tall block.

## What is not proven

- A live `dlaude` launch and its conversation-saving behaviour (item 12). The
  inherited child-session markers are removed and verified absent; the saving
  behaviour itself needs an owner-run interactive session.
- Long-running or high-load behaviour. No soak or stress test was run, so no
  claim is made about sustained throughput.
- A human visual review of the new controls. The maximize/restore control's
  presence, target size, label, and toggle behaviour are asserted at five
  viewports. The browser-size toggle's *behaviour* is verified through the API;
  its on-screen rendering was not asserted by an automated test.
- Phone/tablet use of the agent control surface. The API is viewport-independent
  and the layouts were checked, but no touch-driven agent journey was run.

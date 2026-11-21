# Orchestrator assessment — implementation record

**Assessment:** `docs/plans/townmouse-orchestrator-assessment-2026-11-20.md` (20 items)
**Implementation date:** 2026-11-20
**Branch:** `fix/surface-protection-review`
**Evidence:** `docs/evidence/agent-control-2026-11-20.md`
**Journey test:** `tests/agent-control.test.cjs` (36 checks, run by `npm run test:agent-control`)

This record states, for each assessment item, what changed, where it lives, and
how it was checked. Items marked **verified** were exercised end to end; items
marked **untested** say exactly what remains and why it was not run.

---

## First: what was protected (unchanged)

| Promise | How it is kept |
| --- | --- |
| Mouse and keyboard stay the owner's | Agent actions run inside the headless browser's own input, never the OS pointer. |
| AI can work while the owner uses other tabs | Workspace tabs created by an agent default to *not* activating (`tests/agent-control.test.cjs` → "focus: background agent work does not activate the tab or pane"). |
| Background work must not steal the visible tab or typing | `createdBy: 'agent'` only activates when `activate: true` is explicit. Verified. |
| One workspace tab visible at a time | Unchanged. |
| Keep the look and arrangement | No layout redesign. Additions are two 26px header controls and one toolbar toggle. |
| Improve specific problems, not rebuild | All changes extend `src/browser-workspace.js`, `src/workspace-panes.js`, `scripts/panes`, and the existing pane UI. |

---

## Browser improvements

### 1. Instruction sheet on connect — done

- `src/agent-guide.js` builds the sheet from one tool table. It states each
  tool, what it needs, what it returns, and — separately — which capabilities
  this connection **has** and **has not** been granted.
- `GET /api/panes/guide` (pane token required) returns it. `panes guide` prints it.
- The sheet states permissions; it never grants any. The route is behind the
  same `auth` middleware as every other pane route.
- Guide text is asserted never to contain the workspace token.

### 2. Identify things by what they are — done

- `src/browser-dom.js` catalogs controls with `role`, accessible `name`, `tag`,
  current `value`, state (`disabled`, `checked`, `selected`, `expanded`,
  `required`, `readonly`), and `box`.
- Each control is stamped with `data-townmouse-ref` and addressed as `e12`.
  Ref numbers are **stable**: a repeat catalog reuses an existing marker instead
  of renumbering (`pageCatalog`). That was a real defect in the first draft,
  caught by the journey test.
- Actions accept `--ref`; coordinate clicking is still supported.

### 3. Nested pages and custom components — done

- `catalog()` runs the walker in **every** frame from `page.frames()`, so
  cross-origin iframes are covered, not just same-origin ones.
- The walker descends open shadow roots.
- Verified: "click: works inside a cross-origin iframe" and "click: works inside
  an open shadow root" (the shadow host's handler runs).
- Ordinary coordinate clicking is unchanged and still tested.

### 4. Label every observation — done

`GET /api/panes/:id/browser/observe` returns an `observation` object:

```
id, capturedAt, width, height, scrollX, scrollY, url, title, revision, layoutHash
```

`GET .../browser/content` returns `{ text, totalLength, truncated, frameCount,
frames[] }` — truncation is an explicit boolean, never silent. The UI snapshot
route also carries a `page` label block (size, scroll, address, title, capture
time, revision).

### 5. Warn about old pictures and targets — done

- A coordinate action that cites an `observationId` re-computes the page's
  geometry signature. If the signature, scroll offset, or navigation counter
  changed, the action is **refused** with `409` and
  `{"status":"stale","message":"... Look again before clicking ..."}`.
- A ref is re-resolved by its DOM marker and its tag/name re-checked. If the node
  is gone, the result is `missing` with an instruction to take a fresh
  observation; if the node was replaced by a different control, the result is
  `stale`.
- Verified: "stale: a coordinate from a changed page is refused" (a tall block is
  inserted above the target) and "stale: a fresh observation is accepted".

### 6. Report whether the action worked — done

Every action returns a `status`:

| status | HTTP | meaning |
| --- | --- | --- |
| `completed` | 200 | target found and the action ran |
| `missing` | 404 | no such target on the page |
| `wrong-kind` | 400 | target exists but cannot take this action (e.g. typing into a button) |
| `failed` | 500 | the action could not be completed |
| `stale` | 409 | the page changed; look again |
| `unconfirmed` | 200 | accepted, effect not yet confirmed |

The payload also carries `control.value` for a typed/selected field and
`focused` (role, name, value) for whatever holds focus.

**Navigation title bug:** the old `/api/browser/:id/action` route returned
`s.title` without refreshing it, so a navigation reported the new address with
the previous title. Both routes now go through `actionTab`, which reads the title
after the navigation. Verified: "navigate: returns the new address with the new
title".

### 7. Wait for a result, with a limit — done

`POST /api/panes/:id/browser/wait` accepts `url` (exact or regex), `title`,
`text`, `selector`, or `value` + `ref`, plus `timeout` (default 30 s, max 120 s).
Returns `{matched, reason: 'url'|'title'|'text'|'selector'|'value'|'timeout',
elapsedMs}`. Verified for both a match and a timeout.

### 8. Modifiers, hover, drag, replace — done

- `key` parses `Alt+M`, `Control+Shift+K`, `Meta+…`, holds each modifier down,
  presses the key, releases in reverse order.
- `hover` moves the pointer without clicking.
- `drag` presses on the source box, moves in steps, releases on the target.
- `type --replace` focuses the field, calls `select()` (DOM API, not a
  platform shortcut), deletes, then types. Verified with `café 東京` — the field
  holds exactly the new value.
- All of these use the page's own input pipeline, never the owner's mouse.

### 9. Scroll the correct part — done

`scroll --ref e12` finds the nearest scrollable ancestor of that element and
scrolls it; `--selector` does the same for a CSS target; without a target the
page itself scrolls (an explicit `scrollBy`, not "wherever the pointer was").
Verified: scrolling the results list moved the list and left the outer page at
the same offset.

### 10. Fixed-size mode — done

- Per browser session `sizing: 'fit' | 'fixed'`. In `fixed` mode, viewer resizes
  are ignored unless `force: true` (`setViewportTab`), so menus, viewer resizes,
  and tab switches cannot rearrange the page.
- The viewer still scales the picture to fit via `object-fit: contain`; click
  mapping already accounts for letterboxing.
- A lock toggle in the browser toolbar switches modes, with the current size
  shown in its tooltip.
- Verified at the API level: locking at 900×640 makes a 400×300 resize return
  `ignored: true` and the observation still reports 900×640.

### 11. Visible maximize/restore button — done

- A `.pane-maximize` control sits in every pane header next to Close, with an
  accessible label that flips between "Maximize pane" and "Restore pane".
- Alt+M still works and now shares the same `togglePaneMaximized` path.
- Verified at the UI level in `tests/ui-surfaces.test.cjs` for desktop,
  desktop-narrow, tablet, and phone viewports (target size, label, toggle, restore).

---

## Terminal and AI-session improvements

### 12. Correct starting conditions for a new harness — done, one part untested

- `paneEnvironment()` strips variables that describe the *parent* harness's own
  session: `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`,
  `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION_ATTENDED`,
  `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`,
  `CLAUDE_CODE_AUTO_MODE_SERVER`, `CLAUDE_PID`, `CLAUDE_EFFORT`.
- Credentials and configuration are kept (`ANTHROPIC_*`, `CLAUDE_CONFIG_DIR`,
  model settings). Extra names can be stripped with `TOWNMOUSE_PANE_ENV_STRIP`.
- Verified by probe: a pane's environment contains none of the child-session
  markers and still carries its own `TOWNMOUSE_PANE_ID`.
- **Untested:** launching the real `dlaude` command and observing that
  conversation saving is on. That requires an interactive session and a broker
  lease, so it was not run as part of the automated journey. The cause identified
  in the assessment (an inherited child-session marker) is removed; the end-to-end
  save behaviour should be confirmed by the owner on the next live launch.

### 13. Three different meanings of "status" — done

`serializePane` now exposes them separately and keeps the flat fields for
compatibility:

- `program: { status, startedAt, exitedAt, exitCode, exitSignal }` — is the
  program running?
- `agent: { state, message, reportedAt, ageMs }` — what the AI last said.
- `command: { jobId, status, exitCode, startedAt, endedAt }` — the last tracked job.

A PTY start now clears the previous agent report (a new program is not the old
task), and a program exit no longer invents `agentState: 'done'` — a quiet or
exited terminal is not an AI status report. The pane header shows the program
state plus the agent state with its age (`working · 3m`), and the tooltip adds
the last command's status and exit code.

Verified: "status: program, agent, and command states stay separate" — a
completed job does not rewrite the agent's `working` report.

### 14. Proper completion reports for ordinary commands — done

- `POST /api/panes/:id/jobs` runs the command as a real child process
  (`shell -lc`) in the pane's working directory, with a job id.
- Returns `status` (`running` | `completed` | `failed`), `exitCode`, `signal`,
  `stdout`, `stderr`, and truncation flags. `wait: false` returns immediately;
  `GET /jobs/:id` polls; `DELETE` cancels.
- Output is capped at 512 KiB per stream per job, and jobs are capped at 40 per
  pane.
- The old `/command` route stays for interactive use and now says
  `confirmed: false` with a pointer to `/jobs`. It no longer pretends success.
- Verified: success, exit code 7, a polled slow job, and an unknown job (404).

### 15. Clean text as well as raw terminal data — done

- `GET /api/panes/:id/text?mode=clean|raw`.
  - `clean` renders the PTY buffer through the existing `replayTranscript`
    screen renderer (wide-glyph aware, OSC/CSI aware).
  - `raw` returns the original bytes.
  - Both report `offset`, `bufferStart`, and an explicit `truncated` flag when
    the requested position predates the retained buffer.
- `panes pane read` uses clean text by default, `--raw` for the original.
- Verified: `café 東京` survives both modes; clean text contains no ESC bytes;
  raw text does.

---

## Safety and control

### 16. Permission levels stay separate — done

- The pane token reaches pane routes only. `GET /api/panes/bootstrap` and the
  `/api/browser` owner routes refuse an `Authorization` header / non-owner
  caller.
- Browser sharing (`/permission`, `/access`) remains owner-only.
- The guide states these boundaries explicitly rather than hinting that a
  more powerful tool implies permission.
- Verified: agent bootstrap refused (403), owner browser list refused (403),
  sharing change refused (403).

### 17. Access keys stay out of readable places — done

- Workspace and browser tokens travel in headers (`X-Townmouse-Token`,
  `Authorization: Bearer`), never in a URL or query string.
- Observations, page text, and screenshots are asserted not to contain the
  workspace token.
- Logs record ids and errors, not tokens.
- Verified: "tokens: the workspace token never appears in page content or
  observations" and the guide check.

### 18. Runaway limits kept — done

Unchanged caps (24 tabs, 4 panes/tab, 24 terminal panes, 32 browser tabs) plus
new bounds (40 jobs/pane, 512 KiB/job stream, 20 observations, 4000 ref records).
A fifth pane in a tab is still refused with "A workspace tab holds at most four
panes." Verified.

---

## How the improvements were proved

### 19. Complete journeys — done

`tests/agent-control.test.cjs` runs a real server, a real Chromium, and a real
PTY against fixture pages containing a scrollable panel, a cross-origin iframe,
an open shadow root, and a delayed element. It covers, in order:

1. guide contents and token requirement;
2. a background tab with two browsers and two terminals without activating them;
3. element catalog across frames and shadow roots;
4. clicks by ref, inside a frame, inside a shadow root;
5. observation labels;
6. stale rejection and fresh acceptance;
7. replace-typing with non-English text; wrong-kind refusal;
8. modifier combinations, hover, drag;
9. scrolling a specific panel;
10. fixed-size mode;
11. bounded wait (match and timeout);
12. navigation title correctness;
13. text truncation flag;
14. tracked jobs (success, failure, polling, unknown id);
15. clean vs raw terminal text with unicode;
16. environment hygiene;
17. status separation;
18. the four-pane limit and permission boundaries;
19. token non-exposure;
20. a missing ref reported as missing.

Terminal interrupt (Ctrl+C then a live command) and "two browsers while a
terminal job runs" are included as well.

The existing suite (smoke, features, behavior, voice, responsive, UI surfaces,
panes, persistence, attachments, multi-window, security) still runs in the same
`npm test` command.

**Not covered by the automated journey:** the live `dlaude` conversation-saving
check (item 12) and real visual regressions that only a human look would catch.
The tablet/phone layouts are checked by `tests/ui-surfaces.test.cjs`, which now
also asserts the maximize control at each viewport.

### Related defects fixed while making the tools usable

- **P2-82 (CLI ignores its caller context).** Pane-scoped commands now default to
  `TOWNMOUSE_PANE_ID` when no id is supplied, recognising a real id by its
  `p_…` shape so a command's own arguments are never mistaken for one. A helpful
  error is returned when neither an id nor the environment is available.
- **P2-83 (CLI can hang).** Every CLI request now carries an
  `AbortSignal` timeout (135 s, override with `TOWNMOUSE_CLI_TIMEOUT_MS`), so a
  stopped server fails instead of hanging the agent. `pane run` keeps every
  argument verbatim, including `--version` and `--coverage`.

### 20. Careful change and honest reporting — done

- Existing code was extended, not replaced with a parallel implementation.
  The duplicated browser-action handlers now share one `actionTab`.
- The live service on `127.0.0.1:11001` was not restarted, and the running
  `dlaude` session was not touched. All tests start their own server on
  their own port.
- What passed, what remains untested, and what needs a restart are listed here
  and in the evidence file.

## Packaging (added during the install review)

The refactor was then tested as a *product*, not as a checkout. See
`docs/evidence/packaging-dry-runs-2026-11-20.md` for the runs. The install path
had defects that the dev tree hid:

- engine assets 404'd in a normal `npm install` (hoisted dependencies) —
  fixed by `src/static-deps.js`;
- terminals could not spawn because `spawn-helper` lost its execute bit and npm
  12 skips dependency install scripts — fixed by `src/pty-permissions.js` and
  the resolved paths in `scripts/prepare-native.sh` / `scripts/node-runtime.sh`;
- `npx townmouse` was refused on Node 26 — `engines` widened to `>=22 <27` with
  a runtime fallback;
- the container refused every request when published on a host port other than
  11001 — the request boundary now accepts loopback hostnames on any port while
  keeping same-origin;
- browser panes had no engine when Puppeteer's download was skipped — system
  Chrome/Chromium/Edge/Brave fallback, reported by `/health`;
- the Docker context carried 686 MB of `.runtime`;
- the macOS installer scripts were missing from `files`.

`npm run test:package` is now the gate that installs the packed tarball into a
clean project with `--ignore-scripts` and exercises the installed application.

## Deployment

- **No new dependencies.** `src/agent-guide.js`, `src/browser-dom.js`, and
  `tests/agent-control.test.cjs` use only the existing runtime. No `npm install`
  is required.
- **A restart is required for the server changes to take effect.** The live
  service on `127.0.0.1:11001` was deliberately left running, unchanged, and
  unreloaded. Frontend files are served `no-store`, so a normal page reload picks
  up the two new controls once the server restarts.
- **Nothing was moved or deleted.** No files were quarantined; the only new
  files are the three listed above plus the two documents and the test.

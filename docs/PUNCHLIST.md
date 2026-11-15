# Townmouse Punch List

This is the living punch list for Townmouse: every item here is an open gap between what an average user expects and what the app currently does. It is a working document, not a release note. Nothing in this file is a claim that an item is fixed, closed, or verified; an item leaves this list only when a failing repro has been turned into a passing test and the evidence is linked.

**Repo root:** `/Volumes/SanDisk1Tb/TOWNMOUSE/repo`. Paths below are repo-relative. Line numbers are from the audit snapshots (commits `4dc692f` through `8f33c3b`, plus `ff66920`) and will drift; use the named functions, routes, and selectors to relocate them.

## How to use this list

1. Reproduce the item at the current commit. Audits overlapped with active development, so a few items carry a `HEAD note` describing code that appeared after the audit snapshot. A HEAD note is not closure; it is a pointer to what must be tested.
2. Write the failing test first. UI items should be tested at 393x852 (phone), 820x1180 (tablet), and 1440x900 (desktop) where applicable.
3. Fix the behavior, not just the symptom. Where an item names a root cause (wrong terminal dimensions, missing auth, missing ownership), fix the root cause.
4. Re-run the relevant suite and update this file only with the test and evidence reference attached.

**Severity**

- **P0** - breaks a basic expectation or loses data. Stop and fix.
- **P1** - important usability gap with a workaround, or a security/ownership gap that undermines the local-agent model.
- **P2** - polish, parity, accessibility, documentation, or test-coverage gap.

**Verification policy**

- Do not mark an item done because code exists. Mark it done when the repro fails cleanly and the regression test passes.
- Do not treat "the audit said X at commit Y" as proof of current behavior. Reproduce at HEAD.
- Do not delete an item without linking the test and evidence that proves the user-visible behavior.

**Audit snapshot caveat.** The six source audits were captured on 2026-11-15 while the tree was moving. They used different HEADs (`4dc692f`, `8f33c3b`, `11628fd`) and concurrent worktree edits. Where current code visibly differs, the item says `HEAD note` and the audit observation is preserved. In particular, `ff66920` added workspace layout restore, `8f33c3b` added dialog auto-dismiss, one-finger browser-pane touch scrolling, and 24,000-character pane input chunking, and the pane browser gained a text/content route. None of those are asserted fixed here; each needs a repro and a test.

## Table of contents by area

| Area | Scope | Open items |
|---|---|---|
| A. Attachments and file transfer | Drop, paste, file picker, attachment URL handoff, upload security, storage | P0-2, P0-3, P0-4, P1-7, P2-91, P2-92 |
| B. Terminal rendering and typography | Word breaking, columns, font scaling, prose/status overflow | P1-9, P2-62, P2-63 |
| C. Sessions, reconnect, and scrollback | Resume at width, multi-window ownership, reconnect, input loss, spawn failure, paste safety | P0-1, P1-46, P2-58, P2-59, P2-60, P2-61 |
| D. Panes workspace: tabs, layout, lifecycle | Visible tabs, splitters, shortcuts, close/undo, reorder, restart recovery, rename, active pane, limits, focus, agent tab activation | P1-10, P1-11, P1-12, P1-16, P1-17, P1-50, P2-51, P2-52, P2-53, P2-54, P2-55, P2-56, P2-57, P2-93, P2-94 |
| E. Panes terminal input and feature parity | PTY spawn size, on-screen keys, Ctrl+C, search/copy/font/themes/links/OSC | P1-8, P1-13, P1-14, P1-15 |
| F. Browser panes: interaction and input | Dialogs, touch, keyboard, pointer, native select, popups, text access, activation reflow, crash safety | P0-6, P1-18, P1-19, P1-20, P1-21, P1-22, P1-23, P1-31, P1-49 |
| G. Browser panes: navigation, sessions, uploads/downloads | Forward/history, URL parsing, UA, cookies, file inputs, downloads, browser drop, controls, address bar, permissions, auth | P1-24, P1-25, P1-26, P1-27, P1-28, P1-29, P1-30, P1-47, P2-69, P2-70, P2-75, P2-76 |
| H. Browser panes: rendering, freshness, error states | Polling, DPR, offline state, media/PDF | P2-71, P2-72, P2-73, P2-74 |
| I. Agent orchestration and CLI | Browser control, lifecycle/wait, prompt/send-keys, CLI context/flags, MCP, provisioning, output, navigation | P1-32, P1-33, P1-34, P2-82, P2-83, P2-84, P2-85, P2-86, P2-87 |
| J. Security and permissions | Owner bootstrap, token scoping, attachment boundary | P0-5, P1-35, P1-36 |
| K. Mobile, touch, and PWA | Keyboard avoidance, auto-zoom, safe areas, landscape, targets, long-press, idle chrome, palette, share, offline install, tab management, Android back | P1-37, P1-38, P1-39, P1-40, P1-41, P1-42, P1-43, P1-44, P2-77, P2-78, P2-79, P2-80, P2-81 |
| L. Settings, shortcuts, notifications, links, accessibility | Shortcut conflicts/help, bell/OSC/unread, stored settings, link routing, screen reader, reduced motion | P1-48, P2-64, P2-65, P2-66, P2-67, P2-68 |
| M. Packaging, release, and tests | Docker, uninstall/version, evidence/SSOT, automated coverage | P1-45, P2-88, P2-89, P2-90 |

## P0 - Breaks a basic expectation or loses data

- [ ] **P0-1 - Resuming or switching a session at a different width corrupts and truncates scrollback**
  *Expectation:* Returning to a session (page reload or session-pill switch) shows the same command history and output the user saw, with no fragments, lost lines, or split words.  
  *Current:* `resumeSession` overwrites `target.lastCols`/`lastRows` with the new client dimensions (`src/server.js:341-344`) and then replays the raw PTY `outputBuffer` (`src/server.js:361-366`) into a fresh xterm created at the new width (`public/index.html:1136-1137`). Cursor-addressed output and line wraps produced at the old width are replayed at the new width, and the old dimensions are gone after line 341. A 41-column session reloaded at 1440px showed only the fragment `for wrapping\n` plus the output line, losing the command prefix. `evidence/workspace-820x1180.png` shows the same signature (`printf "WORKSPACE_TERMI` / `NAL_OK\n"`).  
  *Fix:* Capture old cols/rows before overwriting, send them in the resume `ready` message, resize the client xterm to those dimensions before writing the replay, then fit to the viewport. Stronger: persist a serialized terminal snapshot per session (`@xterm/addon-serialize`) and replay only output produced after the snapshot; keep hidden xterm instances for in-page switches. Test: create at 41 cols, reload/switch at 1440px, assert full command and output with no fragmentary rows.  
  *Evidence:* `src/server.js:324-366`; `public/index.html:1136-1137`; `evidence/workspace-820x1180.png`; `/tmp/townmouse-audit/resume-wide.png`.  

- [ ] **P0-2 - Pasting an image or file into either terminal is a no-op**
  *Expectation:* Cmd/Ctrl+V of a screenshot or a file copied in Finder uploads it and inserts its path/URL, exactly like a drop.  
  *Current:* Paste handlers are bound on ancestors: `#terminal` (`public/index.html:608-624`) and each pane root (`public/panes.mjs:146-154`). xterm's own paste handler on the helper textarea reads only `text/plain` and calls `event.stopPropagation()` (`node_modules/@xterm/xterm/lib/xterm.mjs`, function `qs`), so the ancestor handlers never run. Live: an image clipboard item produced 0 `/api/attachments` requests and only the empty bracketed-paste frame `\x1b[200~\x1b[201~`; text paste worked.  
  *Fix:* Register a capture-phase paste listener on `document` or `term.textarea` (`capture: true`) so it runs before xterm's listener. Inspect `clipboardData.items` for `kind === 'file'`, call `preventDefault()`/`stopImmediatePropagation()`, upload, then insert the quoted path and surface the URL. Leave text paste unchanged. Test the main terminal and a pane with a real or synthetic image clipboard.  
  *Evidence:* `public/index.html:608-624`; `public/panes.mjs:146-154`; xterm `qs`; live probe (0 uploads, empty bracketed-paste frame).  

- [ ] **P0-3 - No visible Attach/file-picker control; an iPhone cannot attach an image at all**
  *Expectation:* Every terminal surface offers an Attach button that opens the file picker (and camera on iOS), so users can attach without drag-and-drop.  
  *Current:* There is no `input[type=file]` or file-picker call anywhere in `public/`. Attachments are reachable only through drag events and the broken image-paste path. The legacy file-drop module is explicitly desktop-only (`public/features/file-drop.mjs:8`), and the pane handlers only listen for drag/paste. On iPhone there is no drag source and image paste does nothing, so no attachment can be created.  
  *Fix:* Add an Attach control to the main toolbar/Tools drawer/keybar and the panes bottom bar or Menu, backed by a hidden `input[type=file]` (`multiple`, `accept="image/*"` plus common documents, optional `capture` on iOS) that feeds the existing upload pipeline. Test at 393x852: choose a file, assert one upload and one inserted quoted path.  
  *Evidence:* grep finds no file input in `public/`; `public/features/file-drop.mjs:8`; `public/index.html:583-624`; `public/panes.mjs:126-155`; `public/panes.html:27-49`.  

- [ ] **P0-4 - Legacy window-level file-drop still sends base64 into the PTY anywhere outside `#terminal`**
  *Expectation:* No file drop anywhere in the app types file bytes into the shell; only terminals accept attachments and receive a short path or URL. Other drop targets behave normally.  
  *Current:* `public/features/file-drop.mjs` is still loaded (`public/index.html:1512`). Its window handlers read images with `FileReader.readAsDataURL` and call `T1.sendData(dataUrl)` (`:49-59`), and send bare filenames for other files (`:66-71`). The new `#terminal` handler stops propagation only for drops on `#terminal`, so drops on the header, toolbar, or browser surface hit the legacy handler. Live: dropping a 2 KB PNG on `.terminal-header` sent a 2,780-byte WebSocket frame beginning `{"type":"input","data":"data:image/png;base64,...`; the base64 stream appeared in the terminal, and the legacy overlay stayed `.active` after a successful terminal drop because its window drop handler never ran.  
  *Fix:* Remove `file-drop` from `FEATURE_MODULES` and delete or rewrite the module to delegate to the attachment uploader; scope drag overlays and drop handling to terminal panes; prevent default navigation for file drops without sending bytes; use one overlay and hide it on drop/dragend. Update `tests/feature-behavior-test.js`, which currently only asserts the old overlay exists. Test: drop an image outside `#terminal`, assert the PTY receives a path/URL and no `data:` URI.  
  *Evidence:* `public/features/file-drop.mjs:39-71`; `public/index.html:1512`; live probe (2,780-byte base64 frame; overlay class still `t1-file-drop-target active`).  

- [ ] **P0-5 - Owner bootstrap endpoints hand workspace keys to any local caller**
  *Expectation:* Only the human owner UI can obtain the pane workspace token or the human browser key. An agent holding a pane token must not escalate to owner control.  
  *Current:* `GET /api/browser/bootstrap` returns `{key: humanKey}` whenever the request has no `Authorization` header and no `Sec-Fetch-Site` (or `none`) (`src/browser-workspace.js:148-153`). `GET /api/panes/bootstrap` uses the same pattern and returns the pane token (`src/workspace-panes.js:257-263`). A plain header-less curl returned both. The human key bypasses sharing checks because `session(req)` returns immediately when `human(req)` is true, so any agent inside a pane can list/read/close human browser tabs and change permissions. The only guard is "reject if `Authorization` is present," which a cooperative agent using curl does not trigger.  
  *Fix:* Require an owner capability a local agent cannot obtain (one-time nonce bound to an HttpOnly SameSite owner cookie plus a user gesture, or an owner-only Unix socket with filesystem permissions). Reject header-less bootstrap requests; do not treat absence of `Sec-Fetch-Site` as owner; give agents scoped capabilities. Add tests that call both bootstrap endpoints with no headers and with a pane token and expect 403.  
  *Evidence:* Verified on `127.0.0.1:11391`: no-header `GET /api/browser/bootstrap` returned `200 {"key":"ec7d56e0..."}`, no-header `GET /api/panes/bootstrap` returned 200 with token. `src/browser-workspace.js:24,38-46,142-153`; `src/workspace-panes.js:257-263`.  

- [ ] **P0-6 - A page popup can crash the entire Townmouse server**
  *Expectation:* Opening a page that calls `window.open`, or any site with popups, must not terminate the server or the user's terminals; popups are ignored, recorded, or handled with a bounded error.  
  *Current:* The popup listener calls `popup.url()` synchronously inside Puppeteer's event emitter before the popup main frame exists, and awaits `popup.close()` outside the try block (`src/browser-workspace.js:72-76`; same at `:172` for human tabs). Reproduced with a local page calling `window.open`: `POST /api/panes/tabs/:id/panes` failed with fetch failed and the server exited code 1; stderr was `Error: Requesting main frame too early!` with the stack through `CdpPage.url` at line 73. One popup kills every PTY in the workspace.  
  *Fix:* Wrap the entire popup handler in try/catch and do not await it from the emitter; wait for the popup target/frame to initialize or ignore `about:blank`; catch `popup.close()` rejections; apply the same guard to dialog handlers; add process-level `unhandledRejection`/`uncaughtException` logging with safe shutdown; add a popup-fixture regression test for human and pane tabs.  
  *Evidence:* `src/browser-workspace.js:68-76,172`; repro `/tmp/tm-popup3.cjs` (`PANE_REQUEST_FAILED fetch failed`, `EXIT {code:1}`).  

## P1 - Important usability gaps

- [ ] **P1-7 - The attachment URL is created but never shown to the human or the agent**
  *Expectation:* After attaching, the user sees and can copy the URL; the agent in the terminal can see or use a URL for the file, not only a filesystem path.  
  *Current:* `POST /api/attachments` returns `name`, `path`, `url`, `relativeUrl`, `mime`, and `bytes` (`src/attachments.js:38-46`), but `index.html` inserts only the quoted path (`public/index.html:601,618`) and `panes.mjs` inserts only the quoted path (`public/panes.mjs:112`); `url` is used only for browser-pane navigation (`:115`). There is no chip, Copy URL action, attachment list, or CLI attach command (`scripts/panes` has no attach verb), so the agent cannot discover the URL. The main terminal's success banner is also invisible (P2-92).  
  *Fix:* Show an attachment chip/toast with thumbnail, name, path, URL, and Copy Path/Copy URL actions; make the URL available to agents (insert it on a separate line when safe, add `GET /api/attachments` plus a `panes attach` command, or write an attachment manifest); return a `127.0.0.1` local URL in addition to the request-host URL. Test: drop a file, assert the exact URL is visible and returns HTTP 200.  
  *Evidence:* `src/attachments.js:38-46`; `public/index.html:601,618`; `public/panes.mjs:110-118`; `scripts/panes` has no attach command.  

- [ ] **P1-8 - Pane PTYs spawn at 100x30 before the pane has been measured**
  *Expectation:* A new pane starts at the dimensions it is displayed at, so its first prompt, banner, and agent output wrap at the visible edge.  
  *Current:* `createPane` hardcodes `cols: 100` and `rows: 30` and spawns the PTY immediately (`src/workspace-panes.js:81,111`); the client fits and posts `/resize` only after `mountTerminal` has already started reading and replaying output (`public/panes.mjs:518-545`). Live: a new pane reported 100x30 while the 393px page rendered 54 columns; startup/replayed output was re-wrapped at the pane width and zsh/ZLE redraw sequences were corrupted. The same class affects history replay after a tab switch at a different size.  
  *Fix:* Accept `cols`/`rows` in `POST /api/panes/tabs/:id/panes` and pass the measured pane size, or defer PTY spawn until the first client `/resize` (with a short timeout fallback). Send the initial resize before starting the output stream and record the buffer width for replay. Test at 393, 820, and 1440px: the first prompt must be formatted at the rendered column count.  
  *Evidence:* `src/workspace-panes.js:81,111`; `public/panes.mjs:518-545`; live state 100x30 versus 54 rendered columns.  

- [ ] **P1-9 - Terminal text hard-wraps inside words and narrow screens get too few columns**
  *Expectation:* Agent prose and long paths break between words where possible, and narrow screens keep a readable column count instead of silently shrinking or splitting words.  
  *Current:* Both terminals are plain xterm cell grids; every line breaks at the column edge (`public/index.html:1042-1060`; `public/panes.mjs:479-495`). Live at 393px and 41 columns, a printed sentence split `screenshot` into `screen`/`shot`; at 105 columns a 120-character line split `when` into `wh`/`en`; after resizing 105 to 72 columns, previously emitted prose re-wrapped at arbitrary cell boundaries. The panes view auto-shrinks its font (`public/panes.mjs:526-535`), but the main terminal is fixed at 14px and only manual A-/A+ changes it. The user's screenshot `docs/evidence/phone-chrome/phone-terminal-idle.png` shows `pleas` / `e` plus a lone `.` line; `evidence/workspace-820x1180.png` shows `WORKSPACE_TERMI` / `NAL_OK`.  
  *Fix:* Keep `term.cols` exactly equal to the PTY cols at all times (see P1-8 and P0-1). Reuse responsive font sizing in the main terminal with a persisted user override, and refit after `document.fonts.ready`. Add a word-wrap/read-only transcript mode for agent output and wrap app-generated messages and paths, because arbitrary shell output cannot be word-wrapped without changing semantics. Test prose produced by an agent at the reported width, not only hardcoded `printf` lines.  
  *Evidence:* `public/index.html:1042-1060`; `public/panes.mjs:479-495,526-535`; `docs/evidence/phone-chrome/phone-terminal-idle.png`; `evidence/workspace-820x1180.png`.  

- [ ] **P1-10 - The current tab is invisible in the main chrome; tabs are reachable only through a modal sheet**
  *Expectation:* The active tab name and a one-click switcher are always visible. Desktop users expect a horizontal tab strip with active state, close buttons, a plus button, and overflow chevrons; phone may use a compact active-tab control plus the sheet.  
  *Current:* The pane workspace keeps chrome to the bottom bar, exposing only a `Tabs` button and a count badge. Tab names live solely in the `tabs-dialog` `<dialog>` (`public/panes.html:52-69`); the active tab title appears only in `document.title`. Switching requires opening the modal and clicking a row, and at the 24-tab limit the only switcher is a long scrollable sheet with no search or overflow control. Runtime at 1440x900: no `[role=tablist]` outside the dialog and 0 `.tab-row` while the dialog was closed.  
  *Fix:* Add a persistent tab strip above the grid (or a bottom-bar active-tab chip/popover on narrow screens) using `role=tablist`/`role=tab`, `aria-selected`, per-tab close, a plus button, and horizontal overflow chevrons that open the full sheet. Keep the sheet as the command center, but make the current context visible without opening it.  
  *Evidence:* `public/panes.html:27-49,52-69`; `public/panes.mjs:965-1013`; `DESIGN.md:104-105`; runtime probe.  

- [ ] **P1-11 - No resizable split dividers; pane sizes are a fixed CSS template**
  *Expectation:* Drag dividers between panes (and use arrow keys) to resize; double-click to reset; each tab remembers its layout.  
  *Current:* The grid uses fixed `1fr` templates per `data-count` (`2` side-by-side, `3` full-width top pane plus two bottom, `4` equal quarters, phone stacked with 45dvh minimums) at `public/panes.css:76-103,743-759`. There is no separator element, no pointermove/pointerup resize logic, no keyboard resize, and no per-tab layout state. Four terminal panes are always forced into equal quarters. `DESIGN.md:104-106` explicitly promises a draggable divider.  
  *Fix:* Render 5-7px separator elements (`role=separator`, `tabindex=0`), store columns/rows per tab, implement pointer-capture drag plus Arrow/Home/End keyboard resizing and double-click reset, and persist the layout. Retain the phone stacking fallback.  
  *Evidence:* `public/panes.css:76-103,743-759`; grep finds no pane splitter/separator/pointermove resize logic; `DESIGN.md:104-106`.  

- [ ] **P1-12 - Pane/tab keyboard shortcuts and navigation are only partially present**
  *Expectation:* Terminal-standard shortcuts work while focus is in a pane: new tab, close pane/tab, tab switch, next/previous tab, pane-focus and maximize chords, plus discoverable shortcut help.  
  *Current:* HEAD adds a document keydown handler for `Alt+T`, `Alt+1..9`, and `Alt+arrows` (`public/panes.mjs:1218-1243`), but there is no app-level router for Cmd/Ctrl chords, no close/new/split/maximize shortcut, no tablist arrow-key navigation, and no shortcut help. The only keyboard affordance remains the bottom-bar Keyboard button that focuses the active pane (`public/panes.html:41-44`).  
  *Fix:* Add a capture-phase keydown router that preserves terminal input except reserved chords, supports tab/cycle/close/new/split/maximize and arrow navigation in the tab strip/sheet, and lists shortcuts in Menu or a help overlay. Test each chord with focus in a pane and in the tab sheet.  
  *Evidence:* `public/panes.mjs:1218-1243`; `public/panes.html:41-44`; audit observed no application keydown before 8f33c3b.  

- [ ] **P1-13 - The Panes view has no on-screen key bar or terminal keys on mobile**
  *Expectation:* Esc, Tab, Ctrl/Alt, arrows, Home/End, and PgUp/PgDn must be reachable on touch devices in every terminal surface.  
  *Current:* `index.html` builds device-specific key bars with sticky Ctrl/Alt and arrows (`buildKeyBars` and `SEQ`), but `panes.html` contains only Tabs/Keyboard/Menu bottom-bar buttons (`public/panes.html:27-49`) and `panes.mjs` has no key emission or keybar builder. The Keyboard button only focuses the active terminal (`public/panes.mjs:1164`). Vim, less, Ctrl+C, Ctrl+R, and shell completion are unusable in panes on touch.  
  *Fix:* Extract the index keybar/`SEQ`/`emitSeq` code into a shared module and render it in the panes page bound to the active pane's terminal, with sticky modifiers and 44px targets. Test at 393x852 that Esc/Ctrl/arrows are visible and emit the expected sequences.  
  *Evidence:* `public/panes.html:27-49`; `public/panes.mjs:1164-1203`; main implementation in `public/index.html` (`buildKeyBars`, `SEQ`).  

- [ ] **P1-14 - Ctrl+C with a selection stops sending SIGINT in the Panes view**
  *Expectation:* Bare Ctrl+C always interrupts the foreground process; copy is Cmd+C on macOS or Ctrl+Shift+C on Windows and Linux.  
  *Current:* `public/panes.mjs:504-511` intercepts any event with `metaKey || ctrlKey` and key `c` when `term.hasSelection()`, writes the selection to the clipboard, and returns `false`. Live: with a selection, Ctrl+C produced zero input POSTs (no `\x03`); after clearing the selection the same chord produced `{data:'\u0003'}`.  
  *Fix:* Only intercept the platform copy chord (`metaKey` on macOS; `ctrlKey+shiftKey` elsewhere) and never swallow bare Ctrl+C. Add Alt/Meta paste handling only where the platform expects it. Test with and without a selection and assert the PTY receives `\x03` for bare Ctrl+C.  
  *Evidence:* `public/panes.mjs:504-511`; live Puppeteer (no input with selection, `\u0003` without).  

- [ ] **P1-15 - Panes terminal lacks search, copy/paste UI, font controls, themes, link actions, and OSC 52**
  *Expectation:* Every terminal surface offers the same core tools: find in scrollback, copy/paste/select all, font size, link handling, and remote clipboard.  
  *Current:* `panes.html` loads only `panes.mjs` (`public/panes.html:99`); `panes.mjs` imports only `Terminal`, `FitAddon`, and `WebLinksAddon` (`public/panes.mjs:1-3`) and never loads `public/features/*`. There is no `SearchAddon`, no copy/paste/select-all buttons, no A-/A+ or pinch zoom, no theme picker, no `links.mjs` context menu, and no OSC 52/777 bridge. Search is only available in the main terminal.  
  *Fix:* Share a terminal feature kit or load the existing feature modules against a pane-scoped T1 facade; add `SearchAddon` and an overlay plus copy/paste/select-all/font controls to the pane header or menu; port `osc-bridge` and `links`. Test each action in `/panes`.  
  *Evidence:* `public/panes.html:99`; `public/panes.mjs:1-3,479-495`; feature list at `public/index.html:1507-1518`.  

- [ ] **P1-16 - Closing a pane or tab kills its running process without confirmation**
  *Expectation:* Closing a pane that is running a build or agent asks first, like the main terminal's Close dialog, or offers an undo grace period; a dead shell can be restarted.  
  *Current:* Each pane's Close button calls `closePane` immediately (`public/panes.mjs:468,754`; `closePane` at `1044-1053`); the DELETE route leads to `killPty` SIGTERM/SIGKILL (`src/workspace-panes.js:155-176`). The main terminal has a close-confirm dialog (`public/workspace.mjs:161-169`), but panes has no equivalent, no undo toast, no recently-closed list, and no restart route. An exited pane still consumes one of the four per-tab slots and can only be removed by closing it.  
  *Fix:* Show a confirmation when a pane is running or a tab has multiple/live panes (title plus do-not-ask-again), or provide an undo grace period before killing the PTY; add a Recently closed list and a Restart action that preserves id/title/cwd. Guard CLI self-close with `--force`. Test closing a pane running `sleep 60`.  
  *Evidence:* `public/panes.mjs:468,754,1044-1053`; `src/workspace-panes.js:155-176`; `public/workspace.mjs:161-169`.  

- [ ] **P1-17 - Panes cannot be dragged, reordered, moved to another tab, or duplicated; tabs cannot be reordered**
  *Expectation:* Drag a pane by its header to reorder it or drop it on another tab; drag tabs to reorder; duplicate a pane/tab from a context menu; order and membership persist.  
  *Current:* Pane headers have no drag handle and the grid has no reorder affordance. The only drop listener is `wireDrop`, which accepts file drops and calls `stopPropagation`. The server has no order, move, or duplicate route and `pane.tabId` is fixed at creation; tabs are held in a Map in insertion order (`src/workspace-panes.js:29-32,181-274`). Tab rows in the sheet have no drag behavior (runtime `draggableRows: 0`).  
  *Fix:* Add server APIs for tab order, pane move (`POST /tabs/:id/panes/:paneId/move {tabId,index}`), and tab/pane duplicate. Add pointer/touch drag from a pane header with drop indicators on panes and tab-strip tabs, draggable tabs, and keyboard equivalents (Move left/right, Move to tab, Duplicate). Use a distinct internal MIME type so pane drags and file drops coexist.  
  *Evidence:* `src/workspace-panes.js:29-32,181-274`; `public/panes.mjs:126-155,423-467,965-1013`; runtime sheet inspection (`draggableRows: 0`).  

- [ ] **P1-18 - JS alert/confirm/prompt dialogs are auto-dismissed and cannot be answered**
  *Expectation:* A page that calls `alert()`, `confirm()`, `prompt()`, or `beforeunload` shows a visible dialog the user can accept or dismiss, and the pane keeps working afterward.  
  *Current:* HEAD attaches `page.on('dialog')` handlers before navigation and immediately records then dismisses the dialog (`src/browser-workspace.js:68-71`; same at `:169`), so `confirm()` always returns false and `prompt()` always returns null, and neither the standalone browser UI nor the pane UI can answer. The pane shows only a transient notice after the fact (`public/panes.mjs:889-892`). Earlier audit at `4dc692f` had no handler at all: with `confirm()` open, `page.title()`, `page.screenshot()`, and `page.evaluate()` were unresolved at a 4s timeout and `page.mouse.click()` was still pending; the Puppeteer protocol timeout is 180s, so `POST /browser/action` could hang for minutes and snapshots left a stale frame.  
  *Fix:* Keep `page.on('dialog')` installed before the first `goto`, but record type/message/defaultValue and expose pending dialogs in snapshot/state plus accept/dismiss actions and a UI dialog with an input for `prompt`. Dismiss `beforeunload` for navigation, queue dialogs per tab, and add server-side per-request timeouts plus client `AbortSignal` timeouts so a stuck renderer cannot wedge a pane. Test confirm, prompt, alert, and beforeunload in both surfaces.  
  *Evidence:* `src/browser-workspace.js:68-71,169`; `public/panes.mjs:889-892`; deadlock probe with repo Puppeteer 25.17.0.  

- [ ] **P1-19 - Browser-pane touch gestures are incomplete: no pinch, no momentum, no horizontal scroll**
  *Expectation:* Swipe scrolls the remote page, pinch zooms it, and a two-finger drag scrolls terminal scrollback; gestures have momentum and do not turn into accidental clicks.  
  *Current:* HEAD `8f33c3b` added one-finger vertical `touchstart`/`touchmove`/`touchend` scrolling (`public/panes.mjs:784-800`; `queueBrowserScroll`), but there is no momentum, no two-finger pinch zoom, no horizontal delta, and no drag threshold/click suppression. `.browser-view` still sets `touch-action:none` (`public/panes.css:263-271`). Terminal panes still lack the two-finger momentum scroller that `index.html` implements (`public/index.html:875-964`). The audit at `4dc692f` observed no touch handlers at all; the remaining gaps need on-device verification.  
  *Fix:* Implement pointer/touch drag scrolling with momentum and a two-finger pinch-to-zoom gesture; send `deltaX` as well as `deltaY`; mirror `workspace.mjs` touch handling and add the two-finger terminal scroller; suppress the click after a drag. Test at 393x852 and 820x1180.  
  *Evidence:* `public/panes.mjs:784-800`; `public/panes.css:263-271`; `public/index.html:875-964`; `public/workspace.mjs:846-852`.  

- [ ] **P1-20 - No Enter, Tab, Backspace, arrows, Esc, or live typing to the page**
  *Expectation:* Click a page field, type, and use Enter/Tab/arrows/Esc and normal browser shortcuts while the pane is focused.  
  *Current:* The only text path is the separate "Type into the page" input plus Send, which calls `keyboard.type` once (`public/panes.mjs:712-715,962-967`). It cannot send Enter, Tab, Backspace, arrows, Escape, or modifier shortcuts, and typed characters do not appear until submit. There is no keydown forwarding and no key bar; the standalone browser has Tab and Enter buttons and a keydown handler, which the pane UI dropped (`public/workspace.mjs:121,827-843`). The server already supports `action: 'key'` at `src/browser-workspace.js:119,220`.  
  *Fix:* Add a compact key bar (Enter, Tab, Esc, arrows, Backspace) and forward physical keydown events when a browser pane is focused (with an escape hatch for outer shortcuts). Keep Send for pasted text and show the target field/focus in the UI.  
  *Evidence:* `public/panes.mjs:712-715,962-967`; `src/browser-workspace.js:119,220`; `public/workspace.mjs:121,827-843`.  

- [ ] **P1-21 - The page pointer model is click-only**
  *Expectation:* Hover menus, drag sliders and kanban cards, select text, double-click, right-click, and Cmd/Ctrl-click like a normal browser.  
  *Current:* Only image click -> `mouse.click(x,y)` and wheel exist (`public/panes.mjs:773,893-905`). There is no mousemove/hover, mousedown-mousemove-mouseup drag, double-click, right-click, modifier click, or text selection. Pages whose menus open on hover, drag controls, or context-menu actions (Copy link, Save image, Open in new tab) cannot be used.  
  *Fix:* Add move/down/up/drag and double/right-click actions plus client gestures; forward hover via periodic mousemove; support modifier flags; add a small context menu for link/image actions and open-external. Test hover menu, drag, double-click, and right-click.  
  *Evidence:* `public/panes.mjs:773,893-905`; `src/browser-workspace.js:104-125` (actions are click/type/key/scroll only).  

- [ ] **P1-22 - Native select/date/color controls are invisible and unusable**
  *Expectation:* Choose an option from a standard `<select>`, pick a date, or open a color picker.  
  *Current:* Clicking a `<select>` opens a browser-level popup that `Page.captureScreenshot` does not capture; the screenshot shows only the closed control with a focus ring. In a headless probe, Space, ArrowDown, and Enter left the value at `a`, while `page.select('#s','c')` changed it, so CDP keyboard does not operate the native popup either. Date and color pickers use the same browser UI, and the pane offers no DOM-driven alternative.  
  *Fix:* Intercept clicks on select/date/color controls, read their options/state with `page.evaluate`, render a native-looking dropdown/date field in the pane UI, and set the value plus dispatch `input`/`change` via DOM. Keep coordinate clicks for custom controls.  
  *Evidence:* Probe with repo Puppeteer 25.17.0 (select popup not captured; value stayed `a`; `page.select` changed it to `c`); `src/browser-workspace.js:113-120`.  

- [ ] **P1-23 - New windows and tabs are closed and folded into the current page**
  *Expectation:* `target=_blank` and `window.open` create a tab/window the user can see and return from; OAuth popups can `postMessage` their opener.  
  *Current:* `page.on('popup')` closes the popup and then navigates the same page to `popup.url()` (`src/browser-workspace.js:72-76`). `window.open('', name)` yields `about:blank`, which `address()` rejects, so the popup is simply closed and nothing happens. There is no browser tab strip; `target=_blank` links replace the current page. Closing the popup also destroys `window.opener`, breaking OAuth/payment popup flows that rely on `postMessage`.  
  *Fix:* Keep popups as real pages owned by the pane (a per-pane tab strip) and show them in the UI; handle `about:blank` by waiting for the popup target URL; preserve opener/window messaging; only fold into the same tab when the user chooses. Test target=_blank and `window.open('', name)`.  
  *Evidence:* `src/browser-workspace.js:72-76,172`; popup probe; standalone tab strip `public/workspace.mjs:88-89,530-598`.  

- [ ] **P1-24 - No Forward control and no history state on Back**
  *Expectation:* Back and Forward reflect history; Forward is available after going back; Back is disabled at the start of history.  
  *Current:* The pane toolbar has only Back and Reload, even though the server implements forward (`public/panes.mjs:701-707`). The bottom-bar Back button is enabled for every browser pane regardless of history (`:365-370`), and clicking it on the first page silently does nothing. There is no Forward anywhere and no history menu.  
  *Fix:* Add a Forward button wired to `action('forward')`; return `canGoBack`/`canGoForward` in the snapshot/description and disable the buttons accordingly; add Alt+Left/Right and a long-press history menu.  
  *Evidence:* `public/panes.mjs:701-707,365-370`; `src/browser-workspace.js:110-112`; `public/workspace.mjs:98`.  

- [ ] **P1-25 - URL normalization turns `host:port` into https and cannot search**
  *Expectation:* Typing `localhost:3000`, `192.168.1.5:8080`, `example.com:8080`, `LOCALHOST:3000`, `[::1]:3000`, or `weather` goes where a browser would.  
  *Current:* Only lowercase `localhost`, `127.0.0.1`, or `[::1]` with optional port get `http://` (`public/panes.mjs:931-938`). Every other scheme-less input gets `https://`, so LAN/dev servers on plain HTTP fail with TLS errors; uppercase `LOCALHOST` also gets https; bare `::1` produces `https://::1` (invalid URL). A phrase with a space becomes `https://hello world` and is rejected 400; it is not searched. The client passes `about:`/`data:`/`view-source:` through but server `address()` rejects them (`src/browser-workspace.js:48-52`), so those are 400s too.  
  *Fix:* Parse with `URL` and default to http for localhost/*.local/private/LAN addresses and `host:port` dev entries, default to https for public hostnames, search for phrases, handle bare IPv6, and align allowed schemes and error copy between client and server.  
  *Evidence:* `public/panes.mjs:931-938`; `src/browser-workspace.js:48-52`; `public/workspace.mjs:753-760`; verified URL parsing.  

- [ ] **P1-26 - HeadlessChrome UA and webdriver flag get sites blocked**
  *Expectation:* Sites treat the browser as ordinary Chrome; sign-in and anti-bot pages work.  
  *Current:* Puppeteer launches with no userAgent override and automation defaults (`src/browser-workspace.js:13-16`). The probe UA was `Mozilla/5.0 ... HeadlessChrome/157.0.0.0 Safari/537.36` and `navigator.webdriver` was true. Google, Cloudflare, and other anti-bot flows commonly refuse, CAPTCHA, or redirect this. There is also no device/mobile emulation or user-agent switch.  
  *Fix:* Launch with a normal Chrome userAgent, omit automation-specific default flags (`ignoreDefaultArgs`), set `navigator.webdriver=false` via `evaluateOnNewDocument`, and add an optional mobile/desktop UA emulation setting.  
  *Evidence:* `src/browser-workspace.js:13-16`; probe with repo Puppeteer 25.17.0.  

- [ ] **P1-27 - Each browser pane is an isolated incognito context and logins vanish**
  *Expectation:* Log in once and stay logged in across panes and server restarts; two panes of the same site share the intended session; a password manager/passkey can fill credentials.  
  *Current:* Every pane calls `createBrowserContext()`; closing the pane closes that context and restarting the server destroys all of them (`src/browser-workspace.js:62,158,230`). Two panes of the same site are independent logged-out sessions, and there is no profile import or password-manager/autofill path. The docs acknowledge in-memory sessions, but the UI gives no private/incognito warning.  
  *Fix:* Use a persistent profile or persist `storageState` per workspace/site, offer shared vs isolated contexts per pane, and add Clear site data. At minimum label the pane private and persist browser state across server restarts.  
  *Evidence:* `src/browser-workspace.js:62,158,230`; `docs/browser-workspace.md:5,50`.  

- [ ] **P1-28 - File inputs, uploads, and drops in the page do nothing (or navigate the pane away)**
  *Expectation:* Clicking Choose file opens a picker, the selected file is attached to the site, and drag-drop onto an upload zone works.  
  *Current:* No `page.on('filechooser')` and no `DOM.setFileInputFiles` path exists, and the pane has no upload control. A headless probe clicking `<input type=file>` produced no filechooser event, no change event, and no file; the click is a silent no-op. For drops, `wireDrop` is attached to every pane (`public/panes.mjs:126-155`); for a browser record `attachFiles` uploads to `/api/attachments` and then POSTs the attachment URL to `/panes/:id/url` (`:114-118`), so the pane navigates to the raw file and the page the user was working in is gone. The page never sees a drop or file input.  
  *Fix:* Add a pane "Upload file to page" action: listen for `filechooser`, upload bytes through `/api/attachments`, then `fileChooser.accept([path])` or `DOM.setFileInputFiles`. For drag-drop zones use `Input.dispatchDragEvent` (type=drop) with file entries; for browser panes keep "Open attachment in this pane" as an explicit secondary action, and leave the terminal attachment path unchanged.  
  *Evidence:* `src/browser-workspace.js:13-23,104-125`; `public/panes.mjs:106-124,126-155,689-716,777`; `docs/panes.md:27-29`; probe (`chooserSeen=0`, `changed=0`).  

- [ ] **P1-29 - Downloads are silently discarded**
  *Expectation:* Clicking a download link saves the file or offers it to the user, with a visible downloads indicator.  
  *Current:* No `Browser.setDownloadBehavior` and no `Page.downloadWillBegin`/`Progress` handling. A probe clicking a `Content-Disposition: attachment` link produced no download events and no file. There is no UI to retrieve a download and the user is not told anything happened; PDF save/print controls hit the same wall.  
  *Fix:* Set download behavior to a per-session temp directory, capture download events, and expose a downloads shelf with Save-to-device (stream through the attachment route). Add agent API access and a toast on start and finish.  
  *Evidence:* `src/browser-workspace.js:13-23,104-125`; probe with repo Puppeteer 25.17.0.  

- [ ] **P1-30 - No page zoom and horizontal scrolling is dropped; fixed-width pages are clipped**
  *Expectation:* Pinch or Ctrl-wheel zooms the page; a fixed-width page can be scrolled sideways; a small pane can show a desktop layout.  
  *Current:* The viewport is locked to the pane's CSS size by the resize observer, with no zoom control (`public/panes.mjs:778-804`). `onBrowserWheel` reads only `deltaY` and ignores `deltaX`/`ctrlKey`, and the server only sends `deltaY` (`public/panes.mjs:893-905`; `src/browser-workspace.js:120,221`), so horizontal wheel/trackpad and Shift+wheel do nothing; `touch-action:none` suppresses pinch. Fixed-width pages in a narrow pane are clipped on the right with no scrollbar or scroll-position indicator.  
  *Fix:* Add zoom in/out/fit controls (`Emulation.setPageScaleFactor` or a deviceScaleFactor plus CSS scale) and a device-width toggle; send `deltaX`; render a scroll position/scrollbar; treat ctrl+wheel and pinch as zoom.  
  *Evidence:* `public/panes.mjs:778-804,893-905`; `src/browser-workspace.js:120,221`; `public/panes.css:269`.  

- [ ] **P1-31 - Page content is pixels only: no selection, copy, find, or screen-reader access for the human**
  *Expectation:* Select and copy page text, use Ctrl/Cmd+F to find in the page, have a screen reader read it, and open a readable page view.  
  *Current:* The page is a single `<img>` with `alt="Snapshot of ..."` (`public/panes.mjs:709-710`). There is no selectable text layer; Ctrl+F searches the wrapper HTML (pane chrome only); clipboard writes inside the page go to the server's clipboard, not the user's device. The standalone browser has a Read page drawer (`public/workspace.mjs:108,775-790`), but the pane has no equivalent. HEAD has a `/browser/content` text route (`src/workspace-panes.js:333-340`), but no UI uses it.  
  *Fix:* Add a Read page drawer fed by the content route, a find overlay, a selectable text layer (or a copy-page-text action that writes to the client clipboard), and a screen-reader representation. Test selecting/copying a paragraph and Ctrl/Cmd+F finding a page word.  
  *Evidence:* `public/panes.mjs:709-710,864-868`; `src/workspace-panes.js:333-340`; `public/workspace.mjs:108,775-790`.  

- [ ] **P1-32 - Agent browser control is coordinate-only and only partly exposed in the CLI**
  *Expectation:* An agent in a terminal can inspect and drive a browser pane with the same native CLI it uses for terminals: snapshot, text, click, type, key, scroll, back, forward, and selector/role/text targeting.  
  *Current:* HEAD has `/browser/content` and `panes pane text <pane-id>` (`src/workspace-panes.js:333-340`; `scripts/panes:88`), which closes the pure text gap, but `/browser/action` accepts only coordinate click, type, key, and scroll (`src/workspace-panes.js:316-323`; `src/browser-workspace.js:104-125`). There are no CLI verbs for snapshot, click, type, key, scroll, back, or forward; no selector/role/text targeting or form-value inspection; and no pane-header indication that an agent is driving the pane.  
  *Fix:* Add pane browser subcommands and a content/DOM endpoint; support selector/role/text-based click and type, fill, press key, setInputFiles, and waitForSelector; document the API in `docs/panes.md`; show an agent-control badge/activity indicator in the pane header. Add a page-text extraction test and a selector-click test.  
  *Evidence:* `src/workspace-panes.js:316-340`; `scripts/panes:47-90`; `src/browser-workspace.js:41,104-125`; `docs/panes.md`.  

- [ ] **P1-33 - Pane lifecycle is binary; no idle/blocked/done, exit code, or wait**
  *Expectation:* An orchestrator can tell whether each pane's agent is working, idle at a prompt, blocked on an approval/question, done, or crashed, and can wait for a state or output without polling forever.  
  *Current:* State serializes only `status: pane.exited ? 'exited' : 'running'` (`src/workspace-panes.js:132-137`). A fresh shell sitting at a prompt is `running` forever, a browser pane is always `running`, and there is no `lastOutputAt`, foreground process, agent kind/name, command boundary, or exit code. There is no wait/wait-output route or CLI verb. `POST /command` writes the text, sleeps 300 ms (or `waitMs`), and returns `{ok,output,offset}` regardless of whether the command finished (`:398-405`); `waitMs` has no upper bound, and only the last 4000 characters are returned.  
  *Fix:* Track per-pane activity (`lastOutputAt`, command start/end and exit status, foreground process or shell integration) and add optional agent lifecycle reporting (idle/working/blocked/done/unknown). Expose wait primitives: `pane wait-output --match/--regex --timeout` and `agent wait --until ...` over long-poll or SSE, and surface state in the pane header, tab list, CLI JSON, and state endpoint. Cap `waitMs` and return a command id/offset or await exit.  
  *Evidence:* `src/workspace-panes.js:132-137,398-405`; `scripts/panes:60-70`; `docs/panes.md:60-70`; Herdr 0.9.5 `agent wait --until` and `pane wait-output` benchmark.  

- [ ] **P1-34 - No agent-safe prompt or key submission**
  *Expectation:* An orchestrator can submit a multi-line prompt as one ordered write, send Enter separately, send Esc/Ctrl-C/Tab/arrows, and detect a blocked agent before typing.  
  *Current:* The only terminal write paths are `POST /input` (raw `String(req.body.data)`) and `POST /command` (text plus one newline plus 300 ms wait) (`src/workspace-panes.js:378-405`). `scripts/panes input` joins argv with spaces and has no key names, no Enter control, and no bracketed-paste framing. Raw multiline text sent to a TUI agent is therefore submitted line-by-line, because `ESC[200~`/`ESC[201~` markers are never sent. There is no send-keys equivalent, no prompt command, and no blocked-state check.  
  *Fix:* Add `pane send-text` (literal, preserves newlines, uses bracketed paste when the application enabled it), `pane send-keys <KEY...>` with logical names (enter, esc, tab, ctrl+c, arrows), and `agent prompt --wait --until ...` with blocked detection and an ordered text+Enter submission. Add integration tests against a TUI fixture.  
  *Evidence:* `scripts/panes:79-80`; `src/workspace-panes.js:378-405`; grep finds bracketed paste only in xterm's `term.paste`; Herdr documents `pane send-text`, `pane send-keys`, `agent prompt --wait`, and `agent wait --until blocked`.  

- [ ] **P1-35 - One global token gives every pane full workspace control**
  *Expectation:* A worker agent can read/write its own pane and only resources the human or parent explicitly grants; the human can see, rotate, and audit that access.  
  *Current:* A single token is generated/read once, compared for every pane route, and injected into the environment of every pane (`src/workspace-panes.js:18-27,44-48,92-105`). Any pane can read every other pane's output, close any tab or pane, create tabs, and change the global active tab/pane. There is no per-pane scope, read-only role, audit log, rotation endpoint, or UI showing what a pane can do. `activeTabId` and `activePaneId` are global server state, so one agent (or a second phone/desktop viewer) moves every other viewer's focus.  
  *Fix:* Issue per-pane capability tokens (self read/write, parent/child create, explicit cross-pane read/control grants), keep an owner token separate, add rotation/revocation and an audit log, and show effective scope in the pane/tab UI. Stop injecting the global token into every process environment; let the CLI read the 0600 token file or a scoped socket instead.  
  *Evidence:* `src/workspace-panes.js:18-27,31-32,44-48,92-105,211-220`; live `panes tab create` changed `activeTabId` for all clients.  

- [ ] **P1-36 - Attachments are unauthenticated, unbounded, and can be served as active documents**
  *Expectation:* Uploads require the workspace or owner capability, are bounded and cleaned up, cannot execute script in the app's origin, and return URLs that work behind the documented HTTPS proxy.  
  *Current:* `POST /api/attachments` has no token check; a header-less curl uploaded a file successfully (`src/attachments.js:24-55`). HEAD now sets a sandbox CSP and `Cross-Origin-Resource-Policy` on `/attachments` (`:10-21`, a change reported in `11628fd`), but the route still serves by extension with no `Content-Disposition`, and the audit's pre-sandbox probe uploaded `test.svg` and received `200 image/svg+xml`. An HTML/SVG attachment opened same-origin could call the header-less bootstrap endpoints (P0-5). There is no quota or cleanup beyond the 25 MB per-request parser limit, and the URL uses `req.protocol`/`req.get('host')`, so an HTTPS proxy still yields an `http://` URL (`:42-46`).  
  *Fix:* Require the owner or pane token for upload; serve untrusted attachments with `Content-Disposition: attachment` and `Content-Security-Policy: sandbox; default-src 'none'` (or a separate origin); normalize/re-encode images; add per-day count/size quotas and cleanup; return a relative URL or a fixed local origin rather than `req.protocol`/host. Add a security test that an uploaded SVG/HTML cannot execute or fetch bootstrap.  
  *Evidence:* `src/attachments.js:10-21,24-55`; `src/server.js:820`; `docs/PACKAGING.md:157-169`; live probes (unauth upload 200; SVG 200; proxy URL http).  

- [ ] **P1-37 - The software keyboard covers the key bar, bottom navigation, and lower terminal**
  *Expectation:* Opening the keyboard shrinks or raises the typing surface so the cursor, on-screen control keys, and bottom navigation stay visible, and focused fields scroll into view.  
  *Current:* The workspace is a fixed 100%-height, `overflow:hidden` page (`public/index.html:34-41,62-70`) with the key bar/footer at the bottom of the layout viewport (`:144-158`). Panes is `position:fixed; inset:0` with a bottom bar (`public/panes.css:59-65,399-409`). There is no `visualViewport` listener anywhere in `public/`, and both viewport metas omit `interactive-widget` (`public/index.html:5`, `public/panes.html:5`). `.terminal-container` and `.browser-view` also set `touch-action:none` (`public/index.html:139`, `public/panes.css:269`), so the page cannot scroll a focused field above the keyboard.  
  *Fix:* Track `window.visualViewport` resize/scroll, expose an app-height CSS variable, refit xterm and translate bottom bars above the keyboard; add `interactive-widget=resizes-content` to both viewport metas; scroll focused address/type inputs into view.  
  *Evidence:* `public/index.html:5,34-41,62-70,132-158`; `public/panes.css:59-65,263-271,399-409`; grep for `visualViewport` returns no matches.  

- [ ] **P1-38 - iOS auto-zooms the whole app when address, type, or settings fields receive focus**
  *Expectation:* Focusing any input should not change page zoom or crop the app chrome.  
  *Current:* Text fields use 11.5-14px text: `.address-input` is 11.5px (`public/panes.css:244-255`), `.browser-type-input` is 12px (`:293-303`), workspace inputs/selects are 14px (`public/workspace.css:256-265`), and settings selects/textareas are 13px/12px (`public/index.html:271-281,287-299`). iOS Safari zooms the layout when a text field under 16px is focused and leaves it zoomed after blur.  
  *Fix:* Set a 16px minimum for text inputs, selects, and textareas under `(pointer: coarse)`, keeping compact desktop sizing. Verify focus on iPhone Safari and in standalone PWA.  
  *Evidence:* `public/panes.css:244-255,293-303`; `public/workspace.css:256-265`; `public/index.html:271-281,287-299`.  

- [ ] **P1-39 - Panes workspace draws under the notch and rounded corners in landscape**
  *Expectation:* Pane headers, close buttons, and terminal text stay inside the safe area on notched iPhones and rounded iPads.  
  *Current:* `panes.html` opts into `viewport-fit=cover` (`:5`), but `.panes-app` is fixed `inset:0` (`public/panes.css:59-65`) and `.pane-grid` gets only 6px padding (`:76-84`). `env(safe-area-inset-*)` is used only for the bottom bar, sheets, and notice (`:406,505,686`); there is no top/left/right inset. On iPhone landscape the 47pt side inset overlaps the pane header, close button, and first terminal column.  
  *Fix:* Apply `env(safe-area-inset-top/right/bottom/left)` to `.panes-app`/`.pane-grid` and the bar sides (`max()` for bottom), and test with non-zero insets in landscape and standalone.  
  *Evidence:* `public/panes.html:5`; `public/panes.css:59-65,76-84,406,505,686`.  

- [ ] **P1-40 - iPhone landscape uses the tablet rail: Tools is clipped and chrome consumes most of the height**
  *Expectation:* Rotating to landscape keeps every navigation control reachable and gives the terminal most of the 393px height, matching the existing content-first landscape goal.  
  *Current:* At 852x393 the 700-1099px tablet breakpoint applies: body padding drops to 12px with no left/right safe area (`public/workspace.css:659`), and the 72px rail holds a 64px brand plus five 62px buttons (`:660-670`). Measured at 852x393: `#workspace-tools` spans top 368 to bottom 430 versus a 393px viewport, so Tools is 37px clipped. The iPhone key bar still renders all groups because phone-only hiding is `max-width:699` (`:759-760`), the "Hide bars" FAB is explicitly hidden in workspace mode (`:75`), and auto-hide is also `max-width:699` (`public/workspace.mjs:929`); the result is roughly 61px header + suggestions row + two-row key bar + footer, leaving about 113px of terminal.  
  *Fix:* Make the rail safe-area-aware and compact/scrollable in short landscape; select the compact key bar by device rather than width; enable the landscape-focus/auto-hide logic for coarse-pointer devices with short viewport height; add an iPhone-landscape assertion for every nav button's bottom edge.  
  *Evidence:* `public/workspace.css:27,75,659-670,759-760`; `public/workspace.mjs:929-930`; measured with Puppeteer at 852x393.  

- [ ] **P1-41 - Touch targets are far below the 44pt minimum, especially destructive close controls**
  *Expectation:* Every tappable control is at least 44x44pt on phones/tablets, and closing a running pane cannot be an accidental one-tap loss.  
  *Current:* Measured at 393x852: pane close 26x26, pane header 28px tall, bottom-bar buttons 38x40, browser toolbar/address/type controls 30px tall, sheet close 32x32, tab close 38px wide, menu rows about 36px (`public/panes.css:157-169,215-230,244-255,284-303,356-369,411-426,524-536,614-624,651-661`). Closing a pane immediately sends DELETE with no confirmation or undo (`public/panes.mjs:460,669`). `DESIGN.md:141-154` requires 44pt.  
  *Fix:* Add a coarse-pointer media query with 44x44 minimums for close/back/bar/sheet/tab/menu controls; enlarge the pane header hit area; separate the close target from the tab switch target; add a target-size test. Pair this with the close confirmation/undo in P1-16.  
  *Evidence:* paths above; `DESIGN.md:141-154`; measured at 393x852.  

- [ ] **P1-42 - No long-press context menu on iPhone or in panes; the iPad menu relies on dead `execCommand` paste**
  *Expectation:* Long-press terminal text or browser content to get Copy, Paste, Select All, Search, and Clear. Right-click on desktop should offer the same plus Export.  
  *Current:* `two-finger-menu.mjs` initializes only on iPad (`:8`) and implements copy/paste with `document.execCommand('copy'/'paste')` (`:67-68`), which is deprecated and does not perform a paste in modern Safari; `stylus-support.mjs` repeats the same calls (`:103-104`). `panes.mjs` has no `contextmenu` or long-press handler at all. On desktop, `links.mjs` intercepts `contextmenu` only for links or filename matches (`:81-94,121-123`); elsewhere the browser menu appears. Search dispatches action `search` while `search.mjs` listens for `toggle-search` (`:128-133`).  
  *Fix:* Add one shared terminal context menu (Copy, Paste, Select All, Search, Clear, Export) plus a 500-600ms long-press handler with a movement threshold on the xterm screen and browser image; use `navigator.clipboard`, `term.getSelection`/`selectAll`, and haptics; replace `execCommand`; dispatch `toggle-search`. Test right-click on a non-link cell and the iPad two-finger menu.  
  *Evidence:* `public/features/two-finger-menu.mjs:8,67-68`; `public/features/stylus-support.mjs:103-104`; `public/features/links.mjs:81-94,121-123`; `public/features/search.mjs:128-133`; `public/panes.mjs` has only `pointerdown`, no contextmenu.  

- [ ] **P1-43 - Idle chrome swallows the first tap and hides the key bar**
  *Expectation:* Waking chrome should pass the tap through to the terminal/page, and the key bar plus connection state should remain available.  
  *Current:* After 7 seconds (`public/workspace.mjs:930,947-972`) `body.chrome-idle` hides `.keybar`, `.terminal-header`, and the browser address/type rows (`public/workspace.css:810-819`) and puts an overlay over `.app-shell` (`:821-826`). Measured at 393x852 after 8.2s: body had `chrome-idle`, key bar and header were `display:none`, and a tap at the terminal center produced 0 `pointerdown` and 0 `click` events on `.terminal-container` (only document capture saw it) because `workspace.mjs:974-992` `preventDefault`/`stopPropagation` and `:987-992` swallow the follow-up click. Every link/terminal tap after idle needs two taps, and Esc/Tab/Ctrl disappear while the software keyboard can still be open.  
  *Fix:* Wake chrome without `preventDefault`/`stopPropagation`; never auto-hide the key bar/status/reconnect (keep the always-visible-control-bar invariant); pause the idle timer while any input, including the xterm helper textarea, is focused.  
  *Evidence:* `public/workspace.mjs:930,934-940,947-992`; `public/workspace.css:810-829`; measured at 393x852.  

- [ ] **P1-44 - The tablet floating palette's Copy/Paste/Select All/Search/Theme commands do nothing**
  *Expectation:* Tapping any command in the large touch-optimized palette performs that command.  
  *Current:* `floating-palette.mjs:94` dispatches `t1:action` events named `search`, `select-all`, `copy`, `paste`, and `theme`, but no module listens for those names. Existing handlers cover `clear` (`keyboard-shortcuts.mjs:64-67`), font actions (`zoom.mjs:22-27`), `command-palette` (`command-palette.mjs:169-171`), and `toggle-search` (`search.mjs:128-130`). Six of the nine buttons are dead on iPad.  
  *Fix:* Wire those palette entries to the clipboard/search/theme implementations or click their toolbar buttons, and add a test asserting every palette action has a handler.  
  *Evidence:* `public/features/floating-palette.mjs:76-94`; grep `t1:action` handlers finds no handling for paste, copy, select-all, search, or theme.  

- [ ] **P1-45 - The documented Docker channel cannot build or be reached**
  *Expectation:* `docker build` succeeds and the documented `docker run -p 127.0.0.1:11001:11001` command reaches the UI.  
  *Current:* The Dockerfile runs `npm ci --omit=dev` before `COPY scripts ./scripts` (`Dockerfile:16-19`). The package `postinstall` is `sh scripts/prepare-native.sh` (`package.json:40`), so `npm ci` fails because `scripts/` does not exist yet. Even if it built, `src/server.js:18` hardcodes `HOST='127.0.0.1'`; a Docker published port forwards to the container's bridge IP, not its loopback, so the documented run command cannot connect. Voice settings under `~/.config/terminalone` are also not on the declared `VOLUME` (only `/home/node/.townmouse`).  
  *Fix:* Copy `scripts/prepare-native.sh` before `npm ci`, or run `npm ci --ignore-scripts` and run `prepare-native` after the copies; make `HOST` configurable and set `HOST=0.0.0.0` in the image while publishing to host `127.0.0.1`; persist both data directories; add a Docker build-and-health smoke test.  
  *Evidence:* `Dockerfile:14-27`; `package.json:40`; `src/server.js:18,924`; `docs/PACKAGING.md:71-83`.  

- [ ] **P1-46 - Two windows sharing a session can detach or kill each other's shell**
  *Expectation:* Opening a second window attaches safely with shared output or is refused; closing one window must not detach or kill the shell used by another.  
  *Current:* The session id lives in shared localStorage (`terminalone.sessionId`), so both tabs send resume for the same id. `resumeSession` overwrites `target.ws` without closing or tracking the previous socket; the old socket still has `__sessionRef = target`. When the old window closes, its close handler sets `target.ws = null` and `sessionActive = false`, silently cutting output to the live window; an explicit close can kill the PTY under both. The session menu lists attached sessions and makes switching into one easy, so this is reachable from normal use.  
  *Fix:* Track an owner/generation on each session; reject or close superseded sockets; detach only when `session.ws === ws`; fan output out to all attached sockets; give each window its own session by default and use `BroadcastChannel` for coordinated switching.  
  *Evidence:* `src/server.js:324-337,721-724,771-798`; `public/index.html:540,1121,1217`; `public/features/multi-window-sync.mjs`.  

- [ ] **P1-47 - Restart or Chromium loss leaves unclosable ghost browser tabs**
  *Expectation:* If browser contexts vanish, the UI reconciles the tab list, marks tabs offline, and allows close or reopen without reloading the page.  
  *Current:* The browser tab list is fetched once at startup and never refreshed (`public/workspace.mjs:922,927`). After a server restart or Chromium disconnect, every snapshot returns 404, `refresh()` only writes an error message (`:667-689`), and `closeTab()` awaits DELETE before removing the local tab (`:522-533`), so a 404 leaves the tab in the sidebar forever. Pane browser state keeps a stale URL/title after `browserWorkspace.get()` returns null (`src/workspace-panes.js:124-134`). The only recovery is a full page reload.  
  *Fix:* Fetch `GET /api/browser` on any 404/5xx or reconnect; remove the local tab on 404; add offline/reopen affordances; listen for page/context close/crash on the server and prune dead sessions; return per-tab status instead of failing the whole list.  
  *Evidence:* `public/workspace.mjs:522-533,667-689,922,927`; `src/browser-workspace.js:25,142-151,230-231`; `src/workspace-panes.js:124-134`.  

- [ ] **P1-48 - Global shortcuts steal Ctrl+K and Ctrl+B on Windows/Linux and the help sheet does not match the handlers**
  *Expectation:* Shortcuts must not shadow readline/emacs keys, and the help sheet must match the actual bindings.  
  *Current:* `public/features/keyboard-shortcuts.mjs` treats `meta(e)` as `ctrlKey` on non-Mac (`:9-10`) and preventDefaults Ctrl+K to clear (`:43-45`) and Ctrl+B to toggle snippets (`:53-55`), so kill-line and backward-char never reach the shell on Windows/Linux. `public/features/shortcut-help.mjs` advertises Ctrl/Cmd+K as command palette and Ctrl/Cmd+F as search (`:50-53`), while the handlers use Cmd+K for clear and Cmd+Shift+F for search (`:43-60`).  
  *Fix:* Use Cmd-only chords on macOS and non-conflicting Ctrl+Shift+... chords elsewhere; never bind bare Ctrl+K or Ctrl+B; generate the help list from the same table as the handlers or add a test asserting they match. Test with a platform override.  
  *Evidence:* `public/features/keyboard-shortcuts.mjs:9-10,43-60`; `public/features/shortcut-help.mjs:50-53`.  

- [ ] **P1-49 - Pane activation reflows the page twice and first taps can miss**
  *Expectation:* Switching panes does not reflow the page or move the click target under the finger.  
  *Current:* Inactive browser panes hide `.browser-toolbar` and `.browser-type-row` with `display:none`, changing `.browser-view` height by about 82px when a pane becomes active (`public/panes.css:762-763`). The ResizeObserver then resizes the remote viewport 180ms later and requests a new snapshot, so every pane switch reflows the page (`public/panes.mjs:778-804`). Because activation happens on `pointerdown` (`:752-753`), the toolbar appears and the image moves before the `click` event; `onBrowserImageClick` maps `clientY` against the moved rect (`:872-891`), and a tap near the top can hit the toolbar instead of the page. During the resize round-trip `record.width`/`height` can also be newer than the displayed image.  
  *Fix:* Keep chrome in layout (`visibility:hidden`/overlay) or capture the image rect at pointerdown and use that for the click; do not resize the remote viewport on `is-active` transitions; debounce/serialize resize and snapshot so dimensions and image always match. Test activation taps near the pane top at 393x852.  
  *Evidence:* `public/panes.css:762-763`; `public/panes.mjs:381-392,752-753,778-804,872-891`; pane-sized reflow landed in `367b6d8`, activation thrash remains.  

- [ ] **P1-50 - Workspace restart recovery is unverified and does not say what was lost**
  *Expectation:* Tabs, pane layout, titles, kinds/URLs, and terminal working directories survive a local server restart or auto-update; the client detects the restart and offers or performs session restore.  
  *Current:* The audit at `4dc692f` observed only in-memory Maps and only the auth token persisted; after creating tabs, killing the server, and restarting it, `GET /api/panes/state` returned `{tabs: [], activeTabId: null}` and the loaded client rendered the empty state. HEAD `ff66920` adds a `workspace.json` save/restore path and `/state` now calls `ensureInitial()` (`src/workspace-panes.js:28-35,142-198,257-264`), so layout/cwd may now restore, but there is no end-to-end test, no restart epoch/notice, and PTYs, browser contexts, and scrollback cannot survive. This item stays open until a kill/restart test proves the layout survives and the user is told what could not be restored.  
  *Fix:* Keep the debounced layout persistence; add a `sessionEpoch`/`restored` marker to state; when the client sees an epoch change or `tabs: []` after having state, re-bootstrap or show a prominent "Workspace restarted - reopen N tabs" recovery action; spawn fresh shells at recorded cwd; show a recovery banner for anything not restored. Test kill/restart with 2 tabs and 3 panes.  
  *Evidence:* `src/workspace-panes.js:28-35,134-198,257-264`; `public/panes.mjs:1153-1192`; runtime `tabs: []` at `4dc692f`; `ff66920`.  

## P2 - Polish, parity, accessibility, documentation, and tests

- [ ] **P2-51 - Switching tabs discards terminal instances, losing scroll position, selection, and history beyond 120k characters**
  *Expectation:* Switching away and back preserves the terminal viewport, selection/search state, and available scrollback, or restores the viewport where the user left it; an exited pane can be restarted.  
  *Current:* `rebuild()` calls `teardownPanes()` on every tab switch, disposing all xterm instances (`public/panes.mjs:280-285`). On return a new terminal is created, only `histories` (capped at 120,000 characters, `:9`) is replayed (`:518-519`), then new output arrives; the viewport sits at the bottom and selection/search state is gone. The server buffer is 200,000 characters (`src/workspace-panes.js:12`), so the client replay can be smaller than the server's retained output. `markTerminalExited` only changes the label to "Terminal - exited" (`public/panes.mjs:676-684`); there is no restart control, only Close.  
  *Fix:* Keep one xterm per pane/tab mounted (hide inactive tabs with `display:none`) or save/restore `term.buffer.active.viewportY` and selection; align `MAX_HISTORY` with `MAX_BUFFER` or manage scrollback by line count; add a Restart action that spawns a new PTY in the same pane. Test scroll-to-middle then switch and return, and exit then restart.  
  *Evidence:* `public/panes.mjs:9,280-285,518-519,676-684`; `src/workspace-panes.js:12`.  

- [ ] **P2-52 - No maximize/restore action for a pane**
  *Expectation:* A maximize button or double-click on the header expands one pane to the workspace and restores it, per tab.  
  *Current:* Pane headers contain only title, kind, and close (`public/panes.mjs:429-435,609-614`); no maximize button, class, double-click handler, or shortcut exists. The grid always shows all panes.  
  *Fix:* Add a maximize control next to close with `aria-pressed`, double-click title toggling, a `.pane.is-maximized` layout, Escape restore, and per-tab state. Test maximize/restore on a four-pane tab.  
  *Evidence:* `public/panes.mjs:429-435,609-614`; grep for `maximize|maximized|is-max` returns nothing.  

- [ ] **P2-53 - Tabs and panes cannot be renamed; generated names collide and pane identity is ambiguous**
  *Expectation:* Double-click rename, unique defaults, terminal pane titles from OSC title/cwd, and tab labels that reflect active content; users can map an agent's `p_...` id to a visible pane.  
  *Current:* The UI creates tabs with an empty body so the server names them `Workspace ${tabs.size + 1}`; closing a tab can create a duplicate of an open tab name. Terminal titles are positional `Terminal ${tab.panes.length + 1}` and duplicate after a middle pane closes. There is no PATCH/rename endpoint or CLI rename, no rename input, and xterm's title-change and cwd are not surfaced. Runtime: after closing a tab, two tabs named `Workspace 4`; after closing a middle terminal, titles `['Terminal 1','Terminal 3','Terminal 3']`. State does not expose cwd even though `createPane` stores it.  
  *Fix:* Add PATCH endpoints and inline edit (double-click/F2) for tabs and panes; make defaults unique (max existing number + 1 or Session N); capture `term.onTitleChange` and cwd for labels; show or copy ids in the pane header/tabs sheet.  
  *Evidence:* `src/workspace-panes.js:55,81,91,206`; `public/panes.mjs:889,910,965-1013`; runtime duplicate-name probe.  

- [ ] **P2-54 - Active pane is global, not per-tab; `/active` can leave inconsistent state**
  *Expectation:* Each tab remembers its active pane; activating a pane also activates its tab; switching tabs restores the last active pane; closing an active pane selects a neighbor.  
  *Current:* The server stores one `activePaneId` (`src/workspace-panes.js:31-32`). `activateTab()` always sends `tab.panes[0].id`, so returning to a tab loses the pane the user was in (`public/panes.mjs:128-132`). `POST /active` accepts `paneId` without `tabId` and updates it independently (`src/workspace-panes.js:211-215`); runtime showed `activeTabId` on tab B while `activePaneId` still referenced a pane in tab A, and `serializePane` marked that background pane `active`. `closePane` also selects `tab.panes[0]`, not the adjacent pane.  
  *Fix:* Store `activePaneByTab`; derive/update the tab from a `paneId` in `/active`; validate state consistency; the client remembers and sends the last pane per tab; close picks the previous/next neighbor. Test tab A pane 2 -> tab B -> back.  
  *Evidence:* `src/workspace-panes.js:31-32,132,160-170,211-215`; `public/panes.mjs:128-132,942-947`; runtime probe.  

- [ ] **P2-55 - Add/split controls are buried and New tab opens an empty pane-less tab**
  *Expectation:* An always-visible plus adds a tab; a split/add-pane control lives in the pane header or empty tile; New tab opens a useful default (terminal or an explicit terminal/browser choice).  
  *Current:* Adding a pane is available only from the empty state, the Tabs sheet, or the Menu sheet (`public/panes.html:19-23,60-64,79-92`); there is no plus on the main surface and no split control in pane headers. New tab posts an empty body and creates a zero-pane tab, landing the user on "This tab is empty" and requiring a second action (`public/panes.mjs:884-916,280-304`). At the 4-pane limit all add controls disable silently (`:1015-1032`).  
  *Fix:* Add a plus to the tab strip and a split/add-pane button to pane headers or an empty grid tile; make New tab open a terminal or present a small terminal/browser choice; keep the sheets as fallback and explain disabled states inline.  
  *Evidence:* `public/panes.html:19-23,60-64,79-92`; `public/panes.mjs:280-304,884-916,1015-1032`.  

- [ ] **P2-56 - Limit states are silent, incomplete, and internally inconsistent; there is no global resource budget**
  *Expectation:* A blocked action names the limit and the next step; all enforced caps are surfaced and disabled controls explain why; one documented global budget prevents agents/users from exhausting the host.  
  *Current:* `updateAddLimits()` only checks `maxPanesPerTab` and `maxTabs`; it never consults `maxTerminalPanes`, so at 24 terminal panes Add terminal stays enabled and fails with a 409 toast (`public/panes.mjs:1015-1032`). The sheet note says only "Up to 24 tabs, 4 panes per tab." The 32-browser cap is not in the state limits payload or UI (`src/browser-workspace.js:7,57,154`; `src/workspace-panes.js:147`). `docs/panes.md:7-10` says state carries those limits; `README.md:60` says eight contexts; `DESIGN.md:129` says eight; code enforces 32 shared between standalone and pane browsers. Separately, 24 pane terminals plus 10 WebSocket sessions allow 34 shells on top of 32 Chromium contexts, with 200KB buffers per pane and unbounded SSE socket buffering (write return values ignored).  
  *Fix:* Disable Add terminal at the global terminal cap and Add browser at the browser cap; show usage and the blocking reason via inline copy/tooltip/`aria-describedby`; include all caps (`maxTabs`, `maxPanesPerTab`, `maxTerminalPanes`, `maxBrowserTabs`) in state and the UI; define caps once in config and reconcile README/docs/DESIGN; add SSE backpressure and limit tests; choose and enforce one global shell/browser budget.  
  *Evidence:* `public/panes.mjs:1015-1032,263-270`; `src/workspace-panes.js:9-12,147`; `src/browser-workspace.js:7,57,154`; `docs/panes.md:7-10`; `README.md:60`; `DESIGN.md:129`.  

- [ ] **P2-57 - The tab sheet shows only names and counts, with no pane-level detail, status, or actions**
  *Expectation:* Each tab row reveals its panes (title/kind/running/exited/offline), can close or move a pane in a background tab, and shows agent/attention state; large tab lists are searchable.  
  *Current:* Rows contain only tab name, "N panes", and a Current marker (`public/panes.mjs:965-1013`). There is no expansion, pane title/status list, per-pane close/move, rename, duplicate, search, or attention badge. To close a pane in a background tab the user must switch to it first, and an exited terminal or offline browser in another tab is invisible. Runtime row texts: `['Workspace 1 CURRENT 1 pane','Agent Scratch 0 panes']`, `hasRenameInput:false`.  
  *Fix:* Make rows expandable with pane chips and status dots, add per-pane actions, search/filter and keyboard navigation for 24-tab lists, and surface agent/unread/attention state from the tab model.  
  *Evidence:* `public/panes.mjs:965-1013`; `public/panes.css:485-508`; `MAX_TABS=24` at `src/workspace-panes.js:10`; runtime probe.  

- [ ] **P2-58 - Reconnect/offline handling is silent; input is lost and replay can restart mid-stream**
  *Expectation:* A persistent disconnected/reconnecting state, offline styling, input gating or queueing, retry with backoff, and state recovery when the server returns.  
  *Current:* `sendInput` returns without doing anything when `ws.readyState` is not OPEN (`public/index.html:1068-1072`); there is no client queue and no notice. The server's `pendingInput` only covers input received before the PTY exists (`src/server.js:657-663`). The panes client chunks large payloads, but a failed chunk still clears the payload and only writes the sr-only status (`public/panes.mjs:577-595`). `connect()` always calls `initTerminal()`, disposing xterm and its scrollback; resume replays the whole 512KB ring rather than the bytes the client missed, and the ring can start mid-escape sequence (`src/server.js:44-56,124-131,351-368`). Autosave restore runs only once per page load (`public/features/autosave.mjs:52-62`). The panes state poll shows only a transient notice on failure (`public/panes.mjs:241-260`); terminal read failures are caught with an empty handler (`:601-602`); browser snapshot failures add `is-offline` but `panes.css` has no `.is-offline` rule, and there is no backoff or manual retry; a token change (403) would leave the page polling forever.  
  *Fix:* Buffer input while disconnected and flush on open; keep failed chunks queued for retry; show a visible "Reconnecting, input queued" or error notice. Track the last offset delivered per session/socket and replay only missed bytes into the existing terminal, or keep the xterm instance across reconnects and rehydrate full scrollback. Add a sticky disconnected banner with Retry, `.pane.is-offline` styling, exponential backoff, and state/focus recovery when the server returns; distinguish server restart from network loss.  
  *Evidence:* `public/index.html:1068-1072`; `src/server.js:44-56,124-131,351-368,657-663`; `public/panes.mjs:241-260,577-595,601-602,778-808,1180-1188`; `public/features/autosave.mjs:52-62`; grep no `.is-offline` in `public/panes.css`.  

- [ ] **P2-59 - Large pastes and failed input requests need an explicit, visible result**
  *Expectation:* Pasting a normal log, diff, or code block into a terminal works; if it cannot, the user or agent sees an error and can retry.  
  *Current:* The audit at `4dc692f` found the app-level `express.json({ limit: '64kb' })` applied to pane input: a 70,000-byte input JSON returned HTTP 413 with an HTML `PayloadTooLargeError` page, and the pane UI's `flushTerminalInput` catch only called `logStatus`, which writes to the sr-only element, so a sighted user saw nothing and the input was dropped (`public/panes.mjs:577-585`). HEAD `8f33c3b` chunks pane input at 24,000 characters (`public/panes.mjs:587-588`), but there is no regression test, the server still returns an HTML 413, and the main terminal path has no equivalent chunking or visible failure handling.  
  *Fix:* Give terminal input its own raw/text route with a larger limit (and/or keep client chunking), return a JSON error, show a visible retry notice, and add a >64 KB paste test for both surfaces.  
  *Evidence:* `src/server.js:818`; `public/panes.mjs:577-595`; audit 70KB 413 probe; HEAD 24,000-character chunking.  

- [ ] **P2-60 - A shell spawn failure reports Connected with no process**
  *Expectation:* If the shell cannot start, the terminal shows a clear error and offers retry, not pretend to be connected.  
  *Current:* `spawnShell` catches `pty.spawn` errors, logs them, and returns (`src/server.js:273-306`, catch at `:289-292`). The shell message handler then still sends `{type:'ready'}` with command and cwd (`:619-637`). The client shows Connected, stores keystrokes in `pendingInput`, and nothing ever runs; no error reaches the user. The rapid-exit error path only covers a process that started and exited.  
  *Fix:* Return a success/error result from `spawnShell`; on failure send a `SHELL_SPAWN_FAILED` error with code and message, do not send `ready`, and let the client show Reconnect or doctor guidance. Add a test with an invalid shell or cwd.  
  *Evidence:* `src/server.js:273-306,619-637`; `public/index.html:1151-1180` (error branch exists but is never reached).  

- [ ] **P2-61 - Multi-line text pastes execute without confirmation**
  *Expectation:* Pasting several commands should prompt or at least warn before sending newlines to the shell.  
  *Current:* xterm's text paste goes through `onData` and the input guard with no inspection (`public/index.html:1070-1073`; `public/input-guard.mjs:57-61`; `public/panes.mjs:564-575`). Neither terminal has a paste confirmation, so pasting a log or README with newlines can execute commands.  
  *Fix:* Capture text pastes in the same capture handler, count newlines or commands, and show a confirm dialog for multi-line or dangerous content (allow single-line). Test pasting three lines and pasting a single line.  
  *Evidence:* `public/index.html:1070-1073`; `public/input-guard.mjs:57-61`; `public/panes.mjs:564-575`.  

- [ ] **P2-62 - Main-terminal font size never adapts, pane text can shrink to 10-11px, and users cannot scale text**
  *Expectation:* Phone users get a readable, useful column count without hunting for A-/A+; users can enlarge terminal and UI text (pinch/A+/A-), and system text-size settings affect chrome where possible.  
  *Current:* `fontSize: 14` is hardcoded at `public/index.html:1045`; live at 393x852 the main terminal rendered 41 columns. The panes view auto-selects 11px and 54 columns (`public/panes.mjs:526-535`), and can go to 10px at narrow widths (`:510-518`). `public/features/fontsize.mjs` applies the stored size only when the terminal becomes ready and has no viewport-based logic (`:6-7,38-41,60-61`). `panes.html` loads only `panes.mjs`; the zoom/fontsize features are loaded only by `index.html:1437-1460`, so panes has no A+/pinch control. UI chrome is fixed-px and `index.html:47` sets `-webkit-text-size-adjust:100%`, with labels as small as 8-10px (`public/panes.css:145-153,604-612,637-643`; `public/index.html:234-236`).  
  *Fix:* Reuse the panes viewport-based font selection in the main terminal with a persisted user override and a readable minimum; add pinch/A-/A+ font control to panes and persist it; refit after fonts load; use rem/clamp for chrome and respect text scaling; keep the terminal font as a separately persisted preference. Test at 393, 820, and 1440px.  
  *Evidence:* `public/index.html:20,47,1042-1060,1437-1460`; `public/features/fontsize.mjs:6-7,38-41,60-61`; `public/panes.mjs:471-483,510-518,526-535`; `public/panes.html:8-9`; `public/panes.css:145-153,604-612,637-643`.  

- [ ] **P2-63 - App prose, status text, and notices still break words or truncate messages**
  *Expectation:* Prose wraps at spaces, errors and status text remain readable on phone, and long paths/URLs do not run off screen.  
  *Current:* `.browser-reading` uses `overflow-wrap:anywhere`, so a word such as "Please" can split into "Pleas" and "e" (`public/workspace.css:372`); `#voiceStatus` and `#sessionInfo` also use `overflow-wrap:anywhere` (`public/index.html:305,403`). The browser empty-state paragraph contains a hardcoded `<br>` and no `max-width` (`public/workspace.css:552`; `public/workspace.mjs:119`). On screens up to 699px, `#browser-message-text` is `nowrap` + ellipsis, hiding most error text (`public/workspace.css:786`). `.notice` has no `overflow-wrap`, so long attachment paths or URLs can overflow (`public/panes.css:683-699`). Toasts slice messages to 160 characters without an ellipsis (`public/index.html:1443-1447`).  
  *Fix:* Use `overflow-wrap: break-word`, `word-break: normal`, `hyphens: auto`, and `text-wrap: pretty` for prose; remove the hard `<br>` and set a max-width; let status text wrap to two lines with break-word instead of ellipsis; add overflow-wrap to notices and banners; add ellipsis/full-text expansion to toasts. Add 320/393 overflow screenshot tests, including the "Please" case.  
  *Evidence:* `public/workspace.css:372,552,786`; `public/workspace.mjs:119`; `public/index.html:305,403,1443-1447`; `public/panes.css:683-699`.  

- [ ] **P2-64 - Bell, OSC title, OSC 777, and unread/attention signals are ignored or unsupported**
  *Expectation:* A BEL or shell-set title updates the pane/tab title and flags the surface as needing attention; agent completion/blocked/exited events surface; background panes show unread badges; notifications work on iOS where possible.  
  *Current:* xterm exposes `onBell` and `onTitleChange`, but neither terminal registers them; there is no `onBell` or `onTitleChange` anywhere in `public/`. `public/features/window-title.mjs` derives `document.title` only from the footer cwd (`:26-29`). Live: sending OSC 0 "Build Finished" plus BEL to a pane left its title "Orchestrator" and produced no visual cue. OSC 777 notifications work only in the main terminal via `osc-bridge.mjs` (`:34-45`). `updatePaneChrome` only toggles `is-active` and updates titles/status (`public/panes.mjs:329-360`); the SSE stream writes output (`:597-643`) but nothing tracks whether the pane is active or increments an unread count. There is no attention badge, tab indicator, sound, document-title/favicon change, or Notification on completion/BEL/pane exit. On iOS Safari the `Notification` constructor in page context is unsupported (a service-worker `showNotification` is required), and `requestPermission` is called from terminal output rather than a user gesture; `keepalive.mjs` pings on a 15s interval while `document.hidden` (`:10,26-31`), which iOS suspends.  
  *Fix:* Wire `onBell` to a visual bell, toast, or unread badge; wire `onTitleChange` to sanitized pane/tab titles; track output received while a pane is not active and show a dot/badge on the pane header and workspace tab; port OSC 777 to the panes view; add an in-app toast plus Web Notifications with permission requested on tap; use `ServiceWorkerRegistration.showNotification` on iOS; notify on OSC 777/BEL/terminal-exit/background activity; reflect the worst state in the document title/favicon; add a visibility-return heartbeat/resume check. Test BEL and OSC 0/2/777 in both surfaces.  
  *Evidence:* `public/index.html:1042-1060`; `public/panes.mjs:329-360,597-643`; `public/features/window-title.mjs:26-29`; `public/features/osc-bridge.mjs:34-45`; `public/features/keepalive.mjs:10,26-31`; live OSC title probe; grep no `showNotification`/`pushManager`/`serviceWorker.ready`.  

- [ ] **P2-65 - Stored cursor, bell, and scrollback settings are collected but never applied**
  *Expectation:* Changing or importing terminal settings changes the terminal.  
  *Current:* `public/features/settings-sync.mjs` collects and imports `cursorStyle`, `cursorBlink`, `bell`, `scrollback`, and `fontSize` (`:22-26,41-47`), and `.feature-manifest.md:24` claims cursor/bell/scrollback settings are DONE, but `index.html` hardcodes `cursorStyle:'block'`, `cursorBlink:true`, and `scrollback:10000` (`public/index.html:1042-1052`) and has no bell handling or settings UI for these options.  
  *Fix:* Read these values when constructing each Terminal and on settings import; add controls for cursor style, blink, bell, and scrollback; test that an imported setting changes `term.options` and behavior.  
  *Evidence:* `public/features/settings-sync.mjs:22-26,41-47`; `public/index.html:1042-1052`; `.feature-manifest.md:24`.  

- [ ] **P2-66 - Localhost and agent URLs click out of Townmouse; file paths are not linkable in Panes**
  *Expectation:* URLs printed by agents, especially `http://localhost:<port>`, open in the built-in browser or pane; external links can use the system browser; paths are openable or copyable.  
  *Current:* Both terminals load only the default `WebLinksAddon` (`public/index.html:1053`; `public/panes.mjs:494`), and `public/features/links.mjs` only offers Copy/Open via `window.open` (`:45`). There is no custom handler routing localhost/127.0.0.1 to the workspace browser API, and the panes view has no file-path link provider.  
  *Fix:* Pass a custom link handler to `WebLinksAddon`: localhost/127.0.0.1/[::1] to the workspace browser or pane, others to `window.open`; add a file-path link provider and OS path actions. Test a printed localhost URL.  
  *Evidence:* `public/index.html:1053`; `public/panes.mjs:494`; `public/features/links.mjs:45`; browser API in `public/workspace.mjs`.  

- [ ] **P2-67 - Accessibility: no screen-reader terminal mode and unlabeled terminal regions**
  *Expectation:* Screen-reader users can read terminal output; terminal regions are labeled; status changes are announced.  
  *Current:* Neither terminal sets `screenReaderMode` (`public/index.html:1042-1060`; `public/panes.mjs:479-495`), even though xterm supports it. `#terminal` has no `role` or `aria-label`, and the panes terminal host is a bare `div`. Status announcements are inconsistent and sometimes only written to the sr-only element.  
  *Fix:* Enable and persist `screenReaderMode`, label the terminal regions, announce status, and test with a screen reader or axe.  
  *Evidence:* `public/index.html:1042-1060`; `public/panes.mjs:479-495`.  

- [ ] **P2-68 - Reduced-motion mode still applies control-press scaling**
  *Expectation:* With `prefers-reduced-motion: reduce`, controls respond immediately with no transform or transition, per `DESIGN.md` motion rules.  
  *Current:* The reduced-motion blocks disable `animation`, `transition`, and `scroll-behavior` only (`public/index.html:405-407`; `public/workspace.css:832-838`); `button:active` still applies `transform: scale(0.96)` in `index.html:126` and `transform: scale(.98)` in `workspace.css:255`, so the press visibly snaps under reduced motion.  
  *Fix:* Add `transform: none !important` or a no-transform active rule inside the reduced-motion media query; test the computed transform while active with emulated reduced motion.  
  *Evidence:* `public/index.html:126,405-407`; `public/workspace.css:255,832-838`; `DESIGN.md:121-135`.  

- [ ] **P2-69 - Browser-pane status lies when the page dies, and upload/download/recreate controls are missing**
  *Expectation:* A crashed page or context is reported as an error with a recreate/reload path, and browser panes can upload a file to the page or retrieve a download.  
  *Current:* Beyond the missing Forward/Tab/Enter controls tracked in P1-24 and P1-20, there is no `setInputFiles`/upload or download handling (`README.md:59` explicitly says upload/download dialogs are not provided). Browser panes never set `pane.exited`, so `serializePane` reports `status:'running'` even after the context dies (`src/workspace-panes.js:132-137`), and there is no recreate/reload recovery.  
  *Fix:* Add file upload (`page.setInputFiles`) and download handling, detect page/context crashes into an error status, and add a recreate/reconnect action. Add a test for a crashed browser pane.  
  *Evidence:* `public/panes.mjs:701-715`; `src/browser-workspace.js:207-225`; `src/workspace-panes.js:132-137`; `README.md:59`.  

- [ ] **P2-70 - Address bar shows `about:blank` and `chrome-error` URLs; no durable error state**
  *Expectation:* A blank pane has an empty address bar; a failed navigation restores the last good URL and shows a retryable error; Esc cancels editing.  
  *Current:* A fresh pane starts with an empty input, but the 1.2s state poll overwrites it with `pane.url`, which is `about:blank` (`public/panes.mjs:750,347-349,853-858`). On failure `navigateBrowser` only shows a 4.2s toast; it sets `addressDirty=false` and keeps the failed URL focused while the pane still shows the old page (or Chrome's error page) (`:940-960,161-174`). After a cert failure `page.url()` is `chrome-error://chromewebdata/`, which the state poll then writes into the address bar. The 20s `goto` has no busy indicator or cancel, and there is no Esc-to-revert (`src/browser-workspace.js:100`).  
  *Fix:* Filter `about:blank` and `chrome-error` URLs everywhere; on failure show a durable in-pane error panel with Retry and restore the last good URL; add Esc/blur revert, a loading spinner, and cancellation.  
  *Evidence:* `public/panes.mjs:750,853-858,347-349,940-960,161-174`; `src/browser-workspace.js:100`; probe (`chrome-error://chromewebdata/`).  

- [ ] **P2-71 - Interactions are blind for up to a second and every pane polls a full JPEG**
  *Expectation:* Clicks and typing feel immediate; hidden panes do not burn CPU/battery.  
  *Current:* `SNAPSHOT_POLL_MS` is 1000 (`public/panes.mjs:8`); every browser record in the current workspace tab, active or not, captures and transfers a JPEG each second (`:827-845`), and there is no `is-active`/`document.hidden` gate. A click or scroll gives no acknowledgement, the image can be a second stale, and each action schedules a 220ms snapshot with no guarantee the page painted (`:907-929`). Four panes mean four captures per second with a new CDP session each time (`src/browser-workspace.js:87-93`). Pane routes call the internal snapshot/navigate/action functions directly and bypass the per-tab `s.queue` used by `/api/browser`. The single viewer also reassigns `image.src` every second even when bytes are unchanged (`public/workspace.mjs:667-690`), and uncoalesced wheel events each trigger an action plus snapshot.  
  *Fix:* Move to `Page.startScreencast` or event/invalidation-driven capture; pause non-active and hidden panes; compare frames before re-encoding; show a spinner/click ripple; add request timeouts/`AbortController`; reuse the CDP session; route pane calls through the per-tab queue; compare `lastImage` before setting `src`; coalesce wheel scrolling.  
  *Evidence:* `public/panes.mjs:8,827-845,907-929`; `src/browser-workspace.js:26-36,87-93`; `public/workspace.mjs:667-690,840-843,927`; measured 169,316 characters per 1280x800 frame and 2,031,792 characters in 163ms for four panes x three rounds.  

- [ ] **P2-72 - Screenshots are 1x JPEG, so text is blurry on Retina and phones**
  *Expectation:* Crisp text at the device's pixel density.  
  *Current:* `setViewport` uses the default `deviceScaleFactor` 1 and `Page.captureScreenshot` uses JPEG quality 75 (`src/browser-workspace.js:64,90,134-141`). The pane viewport is measured in CSS px (the evidence records a 709px view -> 709px image), so a DPR2 Mac or DPR3 phone upscales the bitmap 2-3x; text is soft and JPEG ringing is visible. A probe with `deviceScaleFactor 2` produced a 2x bitmap, so the capability exists but is not used.  
  *Fix:* Send `devicePixelRatio` with the resize request, set `deviceScaleFactor` (cap at 2), return CSS-pixel dimensions separately for click mapping, and use PNG or higher-quality WebP/JPEG for text-heavy pages.  
  *Evidence:* `src/browser-workspace.js:64,90,134-141`; `docs/evidence/panes/README.md` (709px measurement); probe 400x300 at DPR2 -> 800x600.  

- [ ] **P2-73 - Server disconnect is invisible in browser panes**
  *Expectation:* If the browser backend is unreachable, the pane says so and offers retry instead of pretending to be live.  
  *Current:* `pollSnapshot` adds `.is-offline` on failure and removes it on success (`public/panes.mjs:827-870`), but `panes.css` has no `.is-offline` selector and no notice/log is emitted, so the pane silently keeps showing the last JPEG forever. There is no stale timestamp or retry/backoff UI.  
  *Fix:* Add an offline banner/overlay with the last successful frame time and a Retry button, a notice/log on first failure, and backoff instead of a fixed 1s retry.  
  *Evidence:* `public/panes.mjs:827-870`; grep finds no `.is-offline` rule in `public/panes.css`.  

- [ ] **P2-74 - Audio, video, and PDF are effectively view-only**
  *Expectation:* Video plays with sound, audio plays, and PDFs can be scrolled, copied, saved, and printed.  
  *Current:* The client receives only JPEG snapshots, so there is no audio path and video is a roughly 1fps slideshow. PDFs do render in headless Chrome (a probe screenshot showed the Chrome PDF viewer with the page and thumbnail sidebar), but their download/save control is subject to the disabled download path (P1-29) and text still cannot be selected or copied through the image viewer.  
  *Fix:* Add an audio channel (WebRTC or a server-side audio stream) and a higher-rate screencast for video; enable downloads/save for PDFs and add PDF text extraction; consider handing PDFs to the system browser or a dedicated viewer.  
  *Evidence:* `src/browser-workspace.js:90` (JPEG only), no audio route; PDF render probe.  

- [ ] **P2-75 - No permission prompts or grants for camera, microphone, notifications, geolocation, or clipboard**
  *Expectation:* Camera, microphone, notifications, geolocation, and clipboard read can be granted on request.  
  *Current:* There is no `context.overridePermissions` path and no permission UI (`src/browser-workspace.js:13-23,62`). On a localhost secure origin, a probe found `Notification.requestPermission()` `denied`, `getUserMedia()` `NotAllowedError`, `clipboard.readText()` `NotAllowedError`, and geolocation `prompt` with no visible or answerable prompt. Video calls, notification-enabled apps, and clipboard-reading apps fail silently.  
  *Fix:* Add a per-site permissions panel (allow/deny per capability) backed by `context.overridePermissions`, optionally fake media devices, and surface denials in a notice.  
  *Evidence:* `src/browser-workspace.js:13-23,62`; probe results on `http://127.0.0.1`.  

- [ ] **P2-76 - HTTP Basic auth fails and self-signed TLS is not modeled**
  *Expectation:* A basic-auth prompt appears and local HTTPS dev servers with self-signed certificates can be opened after a clear warning.  
  *Current:* `address()` rejects embedded URL credentials and there is no `page.authenticate` or credentials UI (`src/browser-workspace.js:48-52`). A probe against a 401 Basic-auth site failed with `net::ERR_INVALID_AUTH_CREDENTIALS` and no prompt. Self-signed TLS does render a clickable Chrome interstitial (probe screenshot), but there is no `ignoreHTTPSErrors`/`acceptInsecureCerts` API path, and the failure leaves `page.url()` as `chrome-error://chromewebdata/` (see P2-70).  
  *Fix:* Add per-pane credential entry wired to `page.authenticate` and a scoped "proceed anyway" for certificate errors, with clear warnings and no credential logging; preserve the requested URL when showing error pages.  
  *Evidence:* `src/browser-workspace.js:13-23,48-52`; `docs/browser-workspace.md:40`; probes.  

- [ ] **P2-77 - No OS share sheet in or out; clipboard handles text only**
  *Expectation:* Share a photo/file from Photos/Files into Townmouse, and share terminal text, a URL, or a browser snapshot out through the OS share sheet.  
  *Current:* `manifest.json` has no `share_target` or `file_handlers`, there is no `navigator.share` call anywhere in `public/`, and the workspace "Share" buttons control agent access rather than the OS share sheet (`public/workspace.mjs:91,101`). `public/features/clipboard.mjs` only calls `navigator.clipboard.readText`/`writeText` (`:12-17,29-41`), so images cannot be pasted from the clipboard.  
  *Fix:* Add `navigator.share` buttons for selection/URL, a manifest `share_target`, and clipboard image read/paste handling through `clipboardData.items`/`ClipboardItem`.  
  *Evidence:* `public/manifest.json` (no share_target/file_handlers); grep `navigator.share` returns no matches; `public/features/clipboard.mjs:12-17,29-41`; `public/workspace.mjs:91,101`.  

- [ ] **P2-78 - PWA install/offline shell is incomplete and its manifest shortcuts are dead**
  *Expectation:* An installed app launches into the real workspace offline (or a clear offline state), long-press shortcuts work, and install is discoverable; the panes workspace has the same installability/offline metadata as the terminal surface.  
  *Current:* `service-worker.js` precaches only `/`, `index.html`, icons, `input-guard`, and xterm (`:3-25`); `/workspace.css`, `/workspace.mjs`, `/features/*.mjs`, `/panes.html`, `/panes.css`, and `/panes.mjs` are absent, and the fetch handler ignores every path not in the list (`:44`), so offline the workspace UI and the entire Panes page fail. `manifest.json:30-50` declares `/?action=new-tab` and `/?action=focus` shortcuts, but no code reads `location.search`/`URLSearchParams`. There is no `beforeinstallprompt` or install hint, and `panes.html` has no manifest link, apple-mobile-web-app meta, or theme-color (`panes.html:1-11`).  
  *Fix:* Generate and precache the workspace/panes/feature asset graph, add an offline fallback/banner, parse the action query parameter, add an install hint, and give `panes.html` the PWA head tags and registration. Add behavior tests for both surfaces after install.  
  *Evidence:* `public/service-worker.js:3-25,44`; `public/manifest.json:30-50`; `public/index.html:409,1437-1460`; `public/panes.html:1-11`; grep `URLSearchParams`/`location.search` returns no matches.  

- [ ] **P2-79 - The Panes page never auto-hides its bottom bar or pane headers**
  *Expectation:* On a phone, reading space expands by hiding the 52px bar (tap to restore), matching the workspace.  
  *Current:* There is no `chrome-idle`/tap-to-wake logic in `panes.html`, `panes.mjs`, or `panes.css`; `.pane-bar` is always 52px plus safe-area (`public/panes.css:399-409`) and each pane header is 28-30px (`:121-130,709`). With stacked panes on a phone this permanently costs about 80px of content height.  
  *Fix:* Mirror the workspace auto-hide for the pane bar with tap-to-wake (without hiding the active pane's close/status affordances), or collapse it on scroll.  
  *Evidence:* `public/panes.css:121-130,399-409,709`; `public/panes.html:27-50`; grep for `chrome-idle`/`idle` in `panes.mjs`/`panes.css` returns no matches.  

- [ ] **P2-80 - Phone tab selection/management is poor: identical browser-tab icons, no touch reorder or rename**
  *Expectation:* Users can tell tabs apart, reorder them by touch, and rename sessions on a phone or tablet.  
  *Current:* At <=699px every non-selected browser tab hides its label and close button and shrinks to a 44px icon (`public/workspace.css:792-794`), so more than three tabs are indistinguishable; terminal session tabs are `display:none` entirely (`:749`). `tab-reorder.mjs` uses only HTML5 `dragstart`/`dragover` (`:14,34-49`), which iOS touch does not fire, and session rename is a `dblclick` on the hidden session tabs (`public/features/session-manager.mjs:606-615`).  
  *Fix:* Show a number/favicon/initial in collapsed tabs plus a tab switcher sheet; implement pointer-event long-press drag reorder; add rename to the session menu and a visible session tab strip on phones.  
  *Evidence:* `public/workspace.css:749,792-794`; `public/features/tab-reorder.mjs:14,34-49`; `public/features/session-manager.mjs:606-615`.  

- [ ] **P2-81 - Android hardware back exits the app instead of navigating**
  *Expectation:* Back closes an open sheet or steps browser history before leaving the PWA.  
  *Current:* No `popstate` or `history.pushState` handlers exist anywhere in `public/`. Browser navigation only updates server state (`public/panes.mjs:855-875`; `public/workspace.mjs:753-766`), so Android hardware back in the standalone PWA closes the app. Pane browser panes also have no forward control (P1-24).  
  *Fix:* Push a history entry per browser navigation/tab switch, handle `popstate` to go back or close dialogs, and add a forward control in panes.  
  *Evidence:* grep for `popstate`/`pushState`/`history` returns no matches; `public/panes.mjs:855-875`; `public/workspace.mjs:753-766`.  

- [ ] **P2-82 - The CLI ignores the caller context it is given**
  *Expectation:* Inside a pane, read/input/run/url/close default to `$TOWNMOUSE_PANE_ID` (like Herdr's `--current`), and `active` defaults to `$TOWNMOUSE_TAB_ID`.  
  *Current:* The pane is spawned with `TOWNMOUSE_TAB_ID`/`TOWNMOUSE_PANE_ID` (`src/workspace-panes.js:103-105`), but only `pane create` reads `TOWNMOUSE_TAB_ID`; `read`/`input`/`run`/`url`/`close` all index `a._[0]` and send `/panes/undefined/...` when the id is omitted. Verified with `TOWNMOUSE_PANE_ID` set: `scripts/panes pane read --lines 5` returned `Terminal pane required.` and exit 1. There is no `--current` flag and no helpful local error (`scripts/panes:53,73,78-88`).  
  *Fix:* Default every pane command to `process.env.TOWNMOUSE_PANE_ID`, add `--current`, return a helpful error when no id and no env are available, and add CLI tests run from inside a spawned pane.  
  *Evidence:* `scripts/panes:53,73,78-88`; `src/workspace-panes.js:92-105`; live output.  

- [ ] **P2-83 - CLI option parsing drops `--flag` arguments and has no timeout**
  *Expectation:* `panes pane run <id> <command...>` sends exactly the command the agent intended, and network calls fail with a clear timeout instead of hanging.  
  *Current:* `args()` treats every token starting with `--` as an option anywhere in argv and has no `--` terminator (`scripts/panes:28-40`). Verified: `scripts/panes pane run p_... echo --version` executed only `echo`; commands containing `--watch`, `--coverage`, etc. lose those tokens. The fetch calls have no `AbortSignal` or timeout, so a hung server hangs the CLI indefinitely.  
  *Fix:* Stop option parsing at the first positional for `run`/`input` or support `--`; keep value flags only before the command; add `AbortSignal.timeout` with a configurable `--timeout`; add tests for commands containing `--` flags.  
  *Evidence:* `scripts/panes:28-40,79-80`; live output after `pane run p_6590cdbf6049 echo --version`.  

- [ ] **P2-84 - No MCP server or machine-readable schema; CLI/HTTP parity gaps**
  *Expectation:* External agents can discover and call pane capabilities through MCP or a documented HTTP schema, and every HTTP capability has a CLI verb.  
  *Current:* There is no MCP server, JSON-RPC endpoint, OpenAPI/JSON schema, or `panes skill` output. The HTTP API has snapshot, action, resize, and stream routes, but `scripts/panes` exposes none of them; its help lists only state, tab, pane create/url/run/read/input/close/text, and active (`scripts/panes:47-90`). CLI output is always pretty JSON with no `--json`/`--timeout`/`--retry`, and `docs/panes.md` documents only the CLI subset, not the HTTP routes.  
  *Fix:* Ship an MCP stdio/HTTP server (or at least a JSON schema/skill) covering the same verbs; add the missing CLI verbs; support `--json`/`--timeout`/`--retry`; generate docs from one source of truth; add a parity test that every route has a CLI command.  
  *Evidence:* grep for `mcp|model.context|json-rpc|openapi|schema` (excluding node_modules) finds no server or schema; `scripts/panes:47-90`; `docs/panes.md`.  

- [ ] **P2-85 - Parallel worker provisioning lacks command/env/agent intent**
  *Expectation:* An orchestrator can spawn N named workers with a chosen cwd, environment, agent kind, and initial command in the background, then broadcast/await them; state shows cwd/agent/session.  
  *Current:* `POST /tabs/:id/panes` and `pane create` accept only `kind`, `url`, `cwd`, and `title` (`src/workspace-panes.js:288-294`; `scripts/panes:72-76`). There is no `--command`, `--env`, `--agent`/`--kind` detection, `--focus`/`--no-focus`, or background creation. Terminal cwd defaults to `os.homedir()`, not the caller's cwd. There is no agent start/detection, no broadcast/read-all/wait-all, no worktree create/list/remove, and state does not expose cwd or shell. Creating a worker takes several calls and can leave empty tabs on partial failure.  
  *Fix:* Add atomic `pane spawn --name --cwd --env --agent --command --no-focus` (and an HTTP equivalent), inherit the caller cwd by default, expose cwd/shell/agent/session in state, add batch/broadcast/wait-all primitives, and worktree helpers or explicit documentation for external worktree management.  
  *Evidence:* `src/workspace-panes.js:61-118,288-294`; `scripts/panes:53,72-76`; `tests/panes-api.test.cjs` covers only kind/url/cwd/title.  

- [ ] **P2-86 - Output is raw scrollback only and truncates silently**
  *Expectation:* Agents can request the visible screen, recent output, or unwrapped text; ANSI can be stripped; output size is capped and gaps are reported; users can search, export, and copy output.  
  *Current:* The server stores the last 200,000 chars of raw PTY bytes and `GET /read` clamps `since` to `bufferStart` without returning `bufferStart` or a truncated flag (`src/workspace-panes.js:12,371-377`). Verified: 300 KB of output -> `read since=0` returned exactly 200,000 chars with offset 301,828 and no truncation field, silently losing about 100 KB. `scripts/panes` always calls `since=0` and slices by newline (`:81-87`), with no `--plain`/`--ansi`/`--source`/`--since`. There is no visible-screen snapshot (alternate-screen TUIs are not reconstructable), no byte cap, and no search/export/copy controls in the panes UI.  
  *Fix:* Keep a server-side terminal screen model and expose read sources `visible`/`recent`/`recent-unwrapped`/detection; add `--plain`/ANSI strip, `--bytes` cap, `--since`/`--follow`, and truncation metadata (`bufferStart`, `missedBytes`). Add search/export/copy controls to the pane UI.  
  *Evidence:* `src/workspace-panes.js:12,371-377`; `scripts/panes:81-87`; live truncation output.  

- [ ] **P2-87 - Panes navigation is one-way and lets the main terminal session expire**
  *Expectation:* Opening Panes and returning preserves the main terminal and its running processes; there is an obvious back/home control on every surface.  
  *Current:* `public/workspace.mjs:718` navigates the same tab with `location.assign('/panes.html')`. `panes.html` has no link back to `/`, and the footer Back button is disabled unless the active pane is a browser (`public/panes.mjs:365-369`). The main terminal page has no `pagehide`/`beforeunload` close handler, so navigating away is an unexpected WebSocket drop; the server keeps the PTY for `RESUME_GRACE_MS = 5 minutes` and then cleans it up (`src/server.js:47,781-792`). On a phone/PWA with no browser back chrome, the user is trapped in Panes and the main terminal shell is killed after five minutes.  
  *Fix:* Open Panes in a new tab or provide a persistent Terminal/Home link and an in-app way back; keep the main terminal session alive across internal navigation (do not start the expiry timer for known navigation, or move Panes into the same shell); show a clear reconnect/lost-session state.  
  *Evidence:* `public/workspace.mjs:718`; `public/panes.mjs:365-369`; `public/panes.html` (no anchors); `src/server.js:47,781-792`; grep finds no `pagehide` handler.  

- [ ] **P2-88 - Uninstall leaves Townmouse data and there is no installed-version surface**
  *Expectation:* Uninstall removes or explicitly offers to remove app data, and `/health` or the UI identifies the installed version/commit so update and rollback actions can be verified.  
  *Current:* Upgrade and rollback guidance exists for npm and Docker (`docs/PACKAGING.md:172-181`), but `GET /health` still returns only status and session count (`src/server.js:835`). CHANGELOG has no Townmouse 0.1.0 section despite being the first product cut. `scripts/uninstall-service.sh` removes the plist, t1, app bundle, and PATH line but leaves `~/.townmouse/pane-token`, `~/.townmouse/attachments`, `~/.config/terminalone/voice.json`, and `~/.cache/terminalone` (`:1-49`), while `install-service.sh:19` still says "Fully reversible." `bin/townmouse` opens a browser after a fixed 900ms without polling health and spawns `open`/`xdg-open` with no error handler (`:45-53`); `start.sh` still uses `npm install` and node directly with TerminalOne branding (`:1-40`).  
  *Fix:* Add version/commit to `/health` and the app chrome; add a 0.1.0 changelog section; make uninstall enumerate and optionally delete app data, or document the residue explicitly; health-poll before opening a browser and handle opener errors; retire or update `start.sh`.  
  *Evidence:* `src/server.js:835`; `scripts/uninstall-service.sh:1-49`; `scripts/install-service.sh:19`; `CHANGELOG.md:1-6`; `bin/townmouse:45-53`; `start.sh:1-40`.  

- [ ] **P2-89 - Release evidence and SSOT are stale or reference commands that do not exist**
  *Expectation:* Evidence is current for the released commit and reproducible from the repo without dead commands or paths.  
  *Current:* `docs/BETA_RELEASE_EVIDENCE.md` is dated 2026-07-12, lists `npm run test:input-guard`, `test:feature`, and `test:feature-behavior` (not present in `package.json`), says server LOC 549 (now 922) and 6 suites, and describes TerminalOne rather than Townmouse (`:8-30`). `SSOT/repository_report.json` still says TerminalOne and 90 percent completion. `Issues/TerminalOne_ISSUES.md:7` says "No open issues." `DESIGN.md:117` references `stewardship/screens/pass16`, which is not in the repo.  
  *Fix:* Regenerate the evidence from the current commit using existing npm scripts; update counts and suites; add Townmouse sections for panes, attachments, security, and mobile; refresh or clearly mark SSOT as generated/stale; check in referenced screenshots or point to `docs/evidence`; update the issues list.  
  *Evidence:* `docs/BETA_RELEASE_EVIDENCE.md:8-30`; `SSOT/repository_report.json:1-10`; `Issues/TerminalOne_ISSUES.md:7`; `DESIGN.md:117`; `package.json` scripts.  

- [ ] **P2-90 - No automated coverage for attachments, touch, pane UI, or reconnect races; evidence scripts are fragile**
  *Expectation:* Every shipped critical path has a pass/fail test wired into `npm test`, including the attachment security boundary and mobile interactions.  
  *Current:* `npm test` now includes the 16-check pane API suite (`package.json:32,42`), which is good, but there are no tests under `tests/` for `/api/attachments` (MIME, sandbox CSP, auth, quota), legacy file-drop base64 behavior, touch scrolling, pane UI layout/overflow, snapshot failure/recovery, multi-window resume ownership, select/dialog/upload/download, or resource caps. The archived pane/phone evidence scripts hardcode `/Volumes/SanDisk1Tb/TOWNMOUSE` paths, contain no assertions (only `console.log`), and write screenshots outside the repo (`docs/evidence/panes/panes-ui-test.cjs:5-7`; `docs/evidence/panes/codex-fixes-test.cjs`; `docs/evidence/phone-chrome/chrome-idle-test.cjs:5-6`). `tests/install-service-portability.test.sh:30` still copies `native/TerminalOneApp.swift`, which the current tree has renamed to `TownmouseApp.swift`. The responsive suite previously failed closed-dialog overflow at `tests/responsive-test.js:277`; the CSS guard landed in `7ad5d88`, so re-run it and add a regression assertion.  
  *Fix:* Add tests under `tests/` for the attachment boundary, no-base64 drop, touch scroll, 320/393 pane layout, snapshot offline/backoff, resume ownership, and limits; parameterize and assert the evidence scripts and store outputs in `docs/evidence`; update the portability test to the renamed native file; run the responsive suite and wire these into `npm test`/CI.  
  *Evidence:* `package.json:32,42`; `docs/evidence/panes/panes-ui-test.cjs:5-7`; `docs/evidence/panes/codex-fixes-test.cjs`; `docs/evidence/phone-chrome/chrome-idle-test.cjs:5-6`; `tests/install-service-portability.test.sh:30`; `tests/responsive-test.js:277`.  

- [ ] **P2-91 - Attachment insertion and cleanup UX: no boundary space, no chip, storage grows forever**
  *Expectation:* Inserting an attachment should not concatenate with what the user was typing, the attachment should be visible and removable, and storage should not grow without limit.  
  *Current:* Both clients insert the quoted path followed by a trailing space but with no leading boundary (`public/index.html:601,618`; `public/panes.mjs:112`), so typing `cat` and then dropping yields `cat'/path'` instead of `cat '/path'`. There is no thumbnail/chip/remove UI, and `src/attachments.js` adds files under `~/.townmouse/attachments` with no retention or cleanup.  
  *Fix:* Insert a leading space when the cursor is not at a word boundary; show an attachment chip/toast with thumbnail, name, size, path/URL, Copy URL, and Remove; add an age/size retention policy and a cleanup command. Test typing then dropping, repeated drops, and long-term storage.  
  *Evidence:* `public/index.html:601,618`; `public/panes.mjs:112`; `src/attachments.js` (no cleanup).  

- [ ] **P2-92 - Attach success and error feedback is invisible or clipped**
  *Expectation:* Attaching a file or hitting an error produces a visible, readable, auto-dismissing message.  
  *Current:* `showBanner('Attached ...', 'info')` sets class `banner info` (`public/index.html:602,619`), but the CSS only gives `.banner.error` and `.banner.warn` `display:block` (`:212-221`), so the success banner has `display:none`; live computed style was `display:none`. `showBanner` never auto-hides errors. Toasts slice messages to 160 characters without an ellipsis (`:1443-1447`), and `.notice` has no `overflow-wrap` (`public/panes.css:683-697`), so long paths and URLs can run off the edge.  
  *Fix:* Add a `.banner.info` style or use the toast system with auto-hide; add ellipsis/full-text expansion to toasts; add `overflow-wrap:anywhere` to notices and banners. Test attach success, an upload error, and a 200-character filename.  
  *Evidence:* `public/index.html:602,619,1443-1447,212-221`; `public/panes.css:683-697`; live computed `display:none`.  

- [ ] **P2-93 - Keyboard focus restore is desktop-only, not per-tab, and untested**
  *Expectation:* The active terminal or browser input receives focus after initial load and after a user tab switch, so typing goes directly to the pane; each tab restores its own last-focused pane.  
  *Current:* `applyState` focuses the active pane only when `!navigator.maxTouchPoints` and the rebuild signature changed (`public/panes.mjs:250-255`). There is no per-tab last-focused pane, and no test. The audit at the earlier snapshot observed `document.activeElement === BODY` after load and after switching back to a terminal tab; HEAD adds the desktop focus call, so verify it and keep the item open for the missing per-tab/mobile behavior.  
  *Fix:* After `applyState`/`rebuild`, focus `effectiveActivePaneId(tab)` on initial load and on user-initiated tab switches; track focus per tab; skip autofocus while a dialog or input outside the pane has focus; condition mobile autofocus on a user gesture; add a focus regression test.  
  *Evidence:* `public/panes.mjs:241-261,280-285,942-953,1163-1192`; audit runtime `activeElement === BODY`.  

- [ ] **P2-94 - Agent-created tabs still activate by default in the HTTP API and carry no attribution**
  *Expectation:* An agent opening a tab must not yank the human out of a live terminal; new agent tabs open in the background with an unread/attention badge, and only an explicit click switches. Agent-created panes and tabs are visually attributed and announced.  
  *Current:* `POST /api/panes/tabs` sets `activeTabId = tab.id` unless `req.body.activate === false` (`src/workspace-panes.js:265-273`). `scripts/panes tab create` now passes `activate: a.activate === true` (`scripts/panes:80`), so CLI-created tabs default to background, but any direct HTTP client/agent still steals focus, and there is no `createdBy`/`origin`/`attention` field or provenance in tab rows. The 1.2s state poll applies the new active tab and `rebuild()` disposes the terminal the human was typing in (`public/panes.mjs:241-260,280-285`). The only feedback is the sr-only `#sr-status` text "Switched to Agent Scratch."  
  *Fix:* Make background the server-side default for agent-origin creates and require an explicit activate for foreground; record `createdBy`/`origin`/`attention`; show a badge/toast and provenance in tab rows; require confirmation or a grace/undo period for agent-driven destructive actions. Add a test asserting the human's `activeTabId` is unchanged after an agent creates a tab.  
  *Evidence:* `src/workspace-panes.js:265-273`; `scripts/panes:80`; `public/panes.mjs:241-260,280-285`; runtime probe at `7ad5d88` (agent tab became active; DOM paneCount 0; only sr-only notice).  

## Top 10 - do next

This ordering follows user impact, not area order. The first six are P0. Do not start P2 polish until the P0 set has failing tests and fixes in review.

| Rank | Item | Why now | Done when |
|---|---|---|---|
| 1 | **P0-1** Resume/switch at a different width | The user's exact screenshot signature: lost command prefix and split words after reload. Loses scrollback. | A 41-column session reloaded at 1440px shows the full command and output; test asserts no fragmentary rows. |
| 2 | **P0-2** Image/file paste no-op | Paste is the primary attachment gesture on a laptop and is currently silent. | Image paste on main terminal and a pane produces exactly one upload and one inserted quoted path/URL; text paste unchanged. |
| 3 | **P0-3** No Attach/file picker | On iPhone there is no other way to attach; this blocks the requested mobile workflow. | Attach button at 393x852 opens the picker, uploads once, inserts one quoted path; camera option available. |
| 4 | **P0-4** Legacy base64 drop | Direct terminal drop works, but a drop on the header/toolbar still floods the PTY with megabytes of base64, the original user complaint. | Drop anywhere outside `#terminal` sends no `data:` URI; PTY receives only a path/URL; overlay hides on drop. |
| 5 | **P0-5** Bootstrap key leak | Any local process can obtain owner control; this breaks the agent permission boundary the product claims. | No-header and pane-token calls to both bootstrap endpoints return 403; owner UI still works. |
| 6 | **P0-6** Popup crash | One `window.open` kills every terminal in the workspace. | A popup fixture leaves the server alive and all PTYs intact; popup is recorded or ignored with a bounded error. |
| 7 | **P1-9** Word splitting and column fidelity | The user's named polish issue: `Please` splitting into `Pleas`/`e`; narrow panes silently shrink to unreadable columns. | Prose produced at 393px and 820px wraps at word boundaries or uses a transcript mode; exact PTY/client cols at spawn and resume; no single-character orphan. |
| 8 | **P1-13** Panes key bar | Without Esc/Tab/Ctrl/arrows, vim/less/Ctrl+C are unusable in panes on a phone. | Key bar visible at 393x852 and emits the same sequences as the main terminal. |
| 9 | **P1-7** Attachment URL handoff | The API creates a URL but neither the human nor the agent can see it; this is the "agent can see the URL" part of the request. | Chip/toast shows path and URL with Copy URL; a CLI or manifest path lets the agent discover the same URL. |
| 10 | **P1-16** Close is immediate and irreversible | A mis-tap kills a running build/agent with no confirm or undo. | Closing a running pane/tab requires confirmation or offers undo; exited panes can restart. |

**Runners-up, start immediately after the top 10:** P1-8 (PTY spawn at 100x30), P1-18 (dialogs auto-dismissed), P1-33 and P1-34 (agent lifecycle/wait and send-keys), P1-36 (attachment auth/quota), P1-41 (44pt targets), P1-50 (restart recovery proof).

## Cross-cutting acceptance tests to add with the fixes

These tests should exist regardless of which item is fixed first; they are the safety net for the whole list.

1. **Terminal geometry:** create at 41x20, resize to 105x30 and 72x20, reload/switch, and assert `term.cols === pty.cols` and full output is present at every step.
2. **Attachment boundary:** drop/paste/choose a PNG and an SVG outside and inside the terminal; assert exactly one `/api/attachments` request, a quoted path in the PTY, no `data:` bytes, and no script execution from the served attachment.
3. **Pane lifecycle:** create four panes, run a command in each, switch tabs, close one, restart the server, and assert layout/title/cwd recovery plus a visible notice for anything not recovered.
4. **Browser input:** in a pane browser, click a field, type, press Enter/Tab/Esc/arrows, submit a form with a file input, download a file, and answer a `confirm()`; assert the page received each action.
5. **Mobile:** at 393x852 and 852x393, assert key bar/chrome visible or wakeable in one tap, all targets >=44px, focused inputs do not zoom the page, safe-area insets are respected, and the pane/terminal text has no mid-word split in app-generated prose.
6. **Agent contract:** from inside a pane, run `panes pane read` with no id, wait for output, send a multi-line prompt as one bracketed paste, send Ctrl+C, and assert the CLI uses `$TOWNMOUSE_PANE_ID` and never hangs without a timeout.
7. **Security:** call both bootstrap endpoints with no headers, with a pane token, and from a same-origin attachment; assert 403 where owner capability is required and no token leakage.
8. **Regression suite:** keep `test:panes` and responsive tests in `npm test`; add the tests above so `npm test` fails when any P0 or P1 regresses.

## Notes on status and stale observations

- The audit snapshots overlap with commits `4dc692f`, `11628fd`, `8f33c3b`, and `ff66920`; behavior observed at one commit may not match HEAD. Each item's `Current` paragraph states what was observed; items with visible HEAD changes say so explicitly and remain open until tested.
- The checked-in artifacts most useful for repro are `evidence/workspace-820x1180.png`, `docs/evidence/phone-chrome/phone-terminal-idle.png`, and `docs/evidence/panes/panes-phone.png`.
- The user's original report maps to these items: the `Please`/`e` split and off-screen wrapping -> P1-9 and P2-62/P2-63; images turning into six billion characters -> P0-4, with P0-2/P0-3/P1-7 as the rest of the attachment workflow; the expectation that an agent can see the URL -> P1-7 and P1-32.
- Counts at the time of writing: 6 P0, 44 P1, 44 P2 (94 total). Update the counts when an item is added or retired.


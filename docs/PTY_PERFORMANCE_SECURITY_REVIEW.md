# TOWNMOUSE: PTY Performance, Correctness, Browser, and Security Review

**Review date:** 2026-11-15  
**Repository:** `/Volumes/SanDisk1Tb/TOWNMOUSE/repo`  
**Review basis:** working tree at commit `e58dd1c` ("feat(panes): keyboard navigation, agent-readable pages and mobile polish"), plus the four independent review passes listed below.  
**Deliverable:** this document only. No source files were modified.

## Scope and method

This document synthesizes four review passes that examined the PTY server, the multi-pane workspace UI, the browser-pane controller, attachments, and the request boundary:

| Pass | Basis reported by that pass | Main coverage |
| --- | --- | --- |
| 1 | `367b6d8` plus uncommitted work | PTY buffering, SSE, panes client, browser snapshots, attachment XSS |
| 2 | `8f33c3b` | Server crash paths, PTY exit, SSE backpressure, browser races, input loss |
| 3 | `11628fd` | Authentication boundary, WebSocket, voice RCE, session hijack, SSRF |
| 4 | `4dc692f` | Browser capture/rendering pipeline, viewport geometry, hidden-page work |

The reports overlapped heavily and were taken against different commits. This synthesis deduplicates them, discards findings whose failure mode no longer exists in the current tree, re-ranks what remains, and re-anchors every file/line to the pinned snapshot. Findings that lacked a concrete failure scenario were dropped; conditional hardening items are retained only where the concrete trigger is clear.

**Snapshot pin.** The tree advanced from `ff66920` to `e58dd1c` while this synthesis ran. The cited files were unchanged across that commit; these md5 sums identify the reviewed content:

```
a5bdd8777a0eaabee4c2d99656e1510d  src/server.js
38bccc9dee549d37167c4e290d16eb73  src/workspace-panes.js
7ae5010ae9474395ba2e72fab79d0c87  src/browser-workspace.js
934927417c031962ddee0c91ceb504c3  src/attachments.js
c65b0674d1cd2b4d64b25200acbda6b3  public/panes.mjs
5e17a7ac21ff6670647935acc269410b  public/panes.css
9c9acb6c2818d4e69d82d0d334492804  public/features/autosave.mjs
ef817cc63c280e8abd9107176d47a23d  public/index.html
23a445d0af013cd5fcd95606b00487da  src/request-boundary.js
```

If the tree moves again, locate findings by the named function rather than by line number.

**Concurrent edits after the snapshot.** While this document was being written, another process made uncommitted edits to `public/index.html`, `public/panes.mjs`, `public/panes.css`, `public/panes.html`, `public/workspace.mjs`, and `src/browser-workspace.js`. The only change that bears on a finding is a guarded `followPopup()` wrapper in `src/browser-workspace.js` (current lines 56-72) that catches the verified popup crash in C5; the dialog handler still has an unguarded `dialog.type()`/`message()` path and there is still no process-level `unhandledRejection` handler. The other edits add a visible tab strip and attachment UI and do not fix the performance or security findings below. Re-check anchors and status against the live worktree before implementing.

**Severity rubric for this document.** *Critical* means full workspace compromise, code execution, whole-server death, or an event-loop stall that freezes every pane. *High* means sustained typing/rendering lag, silent output/input loss, or cross-pane privilege. *Medium* means noticeable jank or battery drain, recoverable correctness bugs, or unbounded resource growth. *Low* means polish, hardening, or a bounded inefficiency.

## Executive summary

**41 deduplicated findings: 6 critical, 11 high, 18 medium, 6 low.**

### Remediation status (2026-11-15)

Closed in the implementation pass:

- Popup crash and unguarded dialog state: `followPopup()` owns the whole lifecycle in an async wrapper; dialogs are answerable and bounded.
- SSE backpressure: a slow reader is ended into the polling fallback instead of buffering without limit.
- Stream exhaustion: at most four long-lived terminal streams are open; additional panes poll, keeping HTTP/1.1 slots for input/state/close.
- Chromium sandbox: enabled by default; containers/CI opt out explicitly.
- Upload boundary: owner/pane-token auth, sandbox CSP, download disposition for active types, daily quotas, and age-based archival.
- Process resilience: unhandled rejections are logged and uncaught exceptions shut down through the normal cleanup path.
- Multi-window ownership: output fans out to every attached socket; closing one window no longer detaches or kills the shell.
- Pane spawn size, deferred start, width-aware transcript replay, write-callback-gated resume, pane key bar, Ctrl+C, and large-paste surrogate handling.

Still open after this pass: string-concatenation output rings, WebSocket/stream multiplexing, 1 Hz full-frame browser screenshots, voice-settings allowlisting, and per-pane scoped tokens (P1-35). Those remain the highest-value performance/security follow-ups.

The day-to-day "PTYs get bogged down, slow, jittery" symptoms have four concrete roots:

1. **Two independent PTY rings copy the entire retained buffer on every output chunk**, on the same event loop that serves input, heartbeats, state, and browser snapshots (`src/server.js:124-130`, `src/workspace-panes.js:115-119`). This is the single highest-impact performance defect.
2. **The pane SSE path serializes one JSON event per PTY chunk even when nobody is subscribed, ignores `res.write()` backpressure, and gives every terminal its own HTTP/1.1 connection**, exhausting Chrome's six-per-host pool (`src/workspace-panes.js:120-123`, `public/panes.mjs:603-649`).
3. **Browser panes poll full JPEG screenshots at 1 Hz, call `bringToFront` on every frame, and reflow their remote viewport on every activation/resize** (`src/browser-workspace.js:89-101`, `public/panes.css:762-763`, `public/panes.mjs:801-833`).
4. **The client writes to xterm without flow control and rebuilds terminals by replaying capped raw history on every tab switch** (`public/panes.mjs:620-643`, `278-288`, `521-523`).

The security boundary is not authentication. `src/request-boundary.js` rejects browser-shaped cross-site requests, but non-browser clients, proxy-forwarded clients, other local accounts, and same-origin scripts all pass. Four findings follow directly: unauthenticated bootstrap endpoints that hand out the owner credentials, an unauthenticated WebSocket that spawns a login shell, unauthenticated voice settings that can be turned into arbitrary command execution, and per-pane shells that inherit the global workspace token.

Separately, one unguarded async popup handler can kill the entire server and every PTY with it.

### Symptom-to-cause map

| What the user feels | Primary findings |
| --- | --- |
| Typing lags or freezes during builds/tests | C6, H1, H2, H3, H6 |
| Terminal stops updating after sleep or Wi-Fi roam | M8, M9 |
| Tab switch freezes, scroll resets, screen garbled | M3, M4 |
| Browser preview jitter, laptop fan/battery | H4, H5, M2 |
| Keystrokes lost or sent to the wrong pane | M6, M7, M18 |
| Whole app/server dies | C5 |
| Any build script or local process owns every pane | C1-C4, H9, H10 |

---

## Critical

**C1. The panes bootstrap endpoint hands the global workspace token to any client that omits `Authorization`.**  
`src/workspace-panes.js:257-263`  
*Session impact:* `GET /api/panes/bootstrap` rejects only requests that send an `Authorization` header and requests marked cross-site. A non-browser client with no headers, another OS account on a multi-user host, or any same-origin script receives `{token}`. That token creates terminal panes with arbitrary `cwd` and runs commands, reads and injects every pane, drives browsers, uploads attachments, and kills sessions. Omitting the header is the bypass.  
*Fix:* Require real owner authentication for bootstrap: an HttpOnly `SameSite=Strict` cookie minted from a loopback-only one-time secret, or peer-credential verification over a Unix socket. Stop returning a long-lived global token; issue short-lived per-client and per-pane scoped tokens. Refuse bootstrap to capability-share callers and rate-limit the endpoint.

**C2. The browser bootstrap endpoint leaks the owner key, letting a view-only share holder take over every browser tab.**  
`src/browser-workspace.js:148-153`  
*Session impact:* `GET /api/browser/bootstrap` has the same header-only guard. A client with no headers receives `{key: humanKey}`. With `X-Workspace-Key` set, `human(req)` is true and `session()` skips all token and permission checks. A view-only share holder can then list every non-internal tab, change any tab's permission to control, mint its access token, read content/snapshots, navigate, and close tabs.  
*Fix:* Gate this endpoint behind the same owner authentication as C1 and never ship an owner-wide key to a page from an unauthenticated GET. Prefer per-tab capability tokens with server-side revocation, and do not keep the owner key in a global JS variable reachable by same-origin scripts.

**C3. The terminal WebSocket has no authentication: any boundary-passing client can spawn a login shell.**  
`src/server.js:878`, shell handling `615-638`  
*Session impact:* `verifyClient` checks only Host/Origin through `isTrustedRequest`. Any local process can open `ws://127.0.0.1:<port>/` and send `{"type":"shell","cols":120,"rows":40}` to receive a PTY with the user's permissions (up to `MAX_CONCURRENT_SESSIONS = 10`), then send `input`. A browser-share token holder with proxy access is not a security boundary. No pane token, owner token, or principal is consulted.  
*Fix:* Authenticate the upgrade with an owner credential or short-lived ticket validated in `verifyClient`; bind each session to the authenticated principal and authorize `shell` and `resume` against it. Cap concurrent connections and rate-limit shell creation.

**C4. Unauthenticated voice settings accept an arbitrary executable and args, turning the voice WebSocket into code execution.**  
`src/server.js:841-852`, `515-537`  
*Session impact:* `PUT /api/voice/settings` has no token check. `validateVoiceConfig` accepts `command: "/bin/sh"` and `args: "{audio}"` because it only requires the `{audio}` placeholder and rejects control characters. An attacker then opens the WebSocket, sends `voice-start`, one `voice-chunk` whose base64 is a shell script, and `voice-end`. `finalizeVoice` writes the decoded bytes to `utterance.webm`, and `spawn('/bin/sh', [audioPath])` executes them with the server's privileges. The config persists in `~/.config/terminalone/voice.json` across restarts.  
*Fix:* Owner-authenticate both the settings endpoint and the voice flow. Do not accept a free-form command/args pair: allowlist an absolute whisper binary or a fixed argv template, build arguments from validated fields, reject interpreters and shells, and run the child with a minimal environment and cwd.

**C5. An unguarded async popup handler can crash the whole server and kill every PTY.**  
`src/browser-workspace.js:72-76` (same pattern at `169-172`)  
*Session impact:* The `page.on('popup', async ...)` listener has no try/catch. A pane whose page opens a `target=_blank` popup that closes itself (common for OAuth, payment, and redirect popups) makes `popup.url()` throw `Error: Requesting main frame too early!`. The listener's promise rejects, there is no process-level `unhandledRejection` handler, and Node exits with code 1, terminating every terminal pane, browser pane, and running build. The prior pass reproduced this live.  
*Fix:* Wrap the entire popup handler body in try/catch (both locations), attach `.catch()` to the async listener, check `popup.isClosed()`, and wait for a main frame before reading `url()` or calling `goto`. Guard the dialog handlers the same way and add a process-level `unhandledRejection` handler that logs and keeps the server alive.  
*Status:* A concurrent uncommitted edit after the pinned snapshot added `followPopup()` in the current worktree and routed both popup listeners through it, which addresses the verified crash path. The dialog handler still constructs `s.dialog` outside its `try` block, and the process-level handler is still absent; keep a crash regression test and finish those two items before closing this finding.

**C6. Both PTY output rings copy the entire retained buffer on every chunk once full, stalling the shared event loop.**  
`src/server.js:124-130` and `213-217`; `src/workspace-panes.js:115-119` and `120-123`  
*Session impact:* Once the server's 512 KB resume ring is full, every PTY chunk does `outputBuffer.slice(over)`, allocating and copying about 512 KB. The pane ring does the same at 200 KB. A 20 MB build delivered in 8 KB chunks is roughly 2,500 full-buffer copies on the event loop that also serves WebSocket input, heartbeats, `/api/panes/state`, and browser captures. Typing stalls for seconds and all terminals appear frozen. The server also keeps buffering while a client is attached, duplicating data that live frames already deliver. This is the primary cause of the reported PTY bog-down.  
*Fix:* Store output as a chunk array with a running length and evict whole chunks from the head (amortized O(1)); trim only above about 1.25x the cap. Skip buffering while the session is attached and its socket is open, or keep a small replay ring. Batch live sends on an 8-16 ms timer.

---

## High

**H1. Pane SSE builds and writes one JSON event per PTY chunk even with no subscribers, and ignores backpressure and stream caps.**  
`src/workspace-panes.js:120-123`, `341-370`  
*Session impact:* The event string is constructed outside the `pane.streams` loop, so a background tab running a verbose build pays `JSON.stringify` and ANSI escaping for every 1-8 KB chunk with zero consumers. With a subscriber, a 1 MB/s log in small chunks creates hundreds to thousands of events per second, forcing that many `JSON.parse` plus `term.write` calls in the browser. `res.write()`'s return value is ignored, there is no per-stream byte cap, and no cap on stream count; a paused reader running `yes` grew server RSS from 76 MB to 300 MB in three seconds in the prior pass, and an OOM kills every PTY.  
*Fix:* Guard event construction with `if (pane.streams.size)`. Queue raw chunks per pane and flush one joined event every 8-16 ms instead of one event per chunk. Bound per-event and per-stream bytes; honor `write() === false` with a `drain` handler; terminate or reset slow consumers with an explicit resync so they can resume using `since=offset`. Cap streams per pane and per client. Prefer binary frames so ANSI output is not JSON-escaped.

**H2. One long-lived SSE fetch per terminal exhausts Chrome's six HTTP/1.1 connections and starves keystroke POSTs.**  
`public/panes.mjs:603-649` (fetch at `611`)  
*Session impact:* Four terminal panes hold four SSE sockets. `/state` plus an input POST consume the remaining two slots. Add one or two browser snapshot downloads (tens to hundreds of KB) and a batched input POST waits for a free socket, so keypress echo can lag hundreds of milliseconds during heavy output, exactly when snapshots and streams are busiest.  
*Fix:* Multiplex all pane output, input, and state over one WebSocket, which is outside the HTTP/1.1 connection pool, or serve over HTTP/2. If SSE remains, use one stream for all panes, cap concurrent screenshot requests, and prioritize input requests.

**H3. There is no flow control between server output and `xterm.write`, so client queues grow without bound when rendering falls behind.**  
`public/panes.mjs:620-643` (write at `634`)  
*Session impact:* Each SSE event calls `term.write(payload.data)` with no completion callback, and the reader immediately fetches the next chunk. Running `yes` or a 20 MB build log lets xterm's WriteBuffer and the fetch-stream buffer accumulate hundreds of MB while the renderer paints. The main thread stalls and keystroke echo arrives seconds late. Server-side `res.write()` backpressure is also ignored, so Node buffers the entire backlog for a slow client.  
*Fix:* Coalesce frames and use `term.write(data, callback)`, reading the next batch only after the callback fires or pending bytes fall below a low watermark. Cap pending bytes; when far behind, skip to the newest offset with an explicit truncation marker. On the server, honor `res.write() === false` via `drain` and drop/resync with a visible event.

**H4. Browser panes poll a full CDP screenshot every second per pane, create a CDP session per frame, and call `bringToFront` each time.**  
`src/browser-workspace.js:89-101`; client `public/panes.mjs:837-867`, `887-890`, `938-960`  
*Session impact:* Every mounted browser pane captures a full-viewport JPEG at 1 Hz, creates and detaches a CDP session, calls `bringToFront`, base64-encodes the image into JSON, transfers and parses it, then builds a fresh `data:` URL and decodes a new bitmap. The prior pass measured 37-45 ms and 166-170 KB JPEG / 221-226 KB base64 / 3.9 MB decoded per 1280x800 frame; four concurrent captures took ~113 ms versus ~37 ms single. Four panes therefore ship roughly 420 KB/s, churn about 4 MB/s of bitmaps, and spend about 150 ms/s of renderer time on static pages, worse on animated pages. `bringToFront` fires focus and visibility churn and races click/scroll/type calls. Polling continues while the page is hidden, every browser action schedules another capture, and there is no global capture concurrency cap or stagger.  
*Fix:* Use a persistent CDP session and `Page.startScreencast` for the active/visible pane only, acknowledging frames. Cap quality at ~40-50 and cap dimensions; skip identical frames; stop when `document.hidden` or the pane is inactive. Remove `bringToFront` from the polling path and deliver frames as binary over a WebSocket or SSE instead of base64 JSON. Add a global 1-2 capture concurrency limit, jitter deadlines, and coalesce snapshot requests to the newest.

**H5. Browser viewport geometry changes on every pane activation, and resize/snapshot churn corrupts click mapping.**  
`public/panes.css:762-763`; `public/panes.mjs:801-833`, `870-917`  
*Session impact:* Non-active browser panes hide the toolbar and type row with `display: none`, so `.browser-view` changes height when a pane becomes active. Clicking an inactive pane synchronously changes its layout and the previously active pane's layout; both `ResizeObserver`s post new sizes, the remote pages reflow, and each response schedules another snapshot. Switching between four panes reflows two remote pages and captures twice per click. The resize observer only trailing-debounces 180 ms and allows overlapping requests; every intermediate size is applied and captured. Separately, `record.width/height` is updated when the resize response returns, before the matching frame, so a click during that window is mapped against the new dimensions while the old image is displayed. Shrinking 1280x800 to 400x300 can map a visual right-edge click to x=400 instead of x=1280.  
*Fix:* Reserve chrome space at all times (`visibility: hidden` or overlay it) so `.browser-view` geometry is stable, or exclude chrome from the observed area. Better, decouple the remote viewport from CSS size with a fixed or bucketed viewport and letterbox the image client-side. Keep one in-flight resize per pane with a latest-desired size, drop intermediates, make `setViewport` a no-op when unchanged, and remove the per-resize capture. Track frame dimensions separately from requested dimensions, set them only when a frame is accepted, and use those for click mapping (or send a frame id with each click and reject stale ids).

**H6. The history mirror concatenates and re-slices a 120,000-character string on every output event.**  
`public/panes.mjs:690-693`  
*Session impact:* Once a pane reaches the 120k cap, each SSE event allocates a new ~240 KB string and copies it back down to 120k. During builds with hundreds of events per second, this is tens to hundreds of MB/s of main-thread allocation and GC, felt as cursor stutter and delayed echo.  
*Fix:* Keep history as an array of chunks with a running length and evict oldest chunks in batches, trimming only above ~1.25x the cap. Alternatively stop mirroring and serialize xterm scrollback only when a tab is hidden.

**H7. PTY exit is never broadcast on the SSE stream, so streaming clients never learn the shell exited.**  
`src/workspace-panes.js:125`, stream route `341-370`  
*Session impact:* `child.onExit` only sets `pane.exited`. Running `echo EXIT_MARK; exit` in a streamed pane delivers the output, but the stream emits no `exited` event and stays open. The client's `markTerminalExited` never runs while streaming, so it keeps POSTing keystrokes to a dead pty and never shows the exit marker or status until a reconnect. The server keeps the connection and `pane.streams` entry until the pane is closed; `closeAll()` does not end streams.  
*Fix:* On `child.onExit`, broadcast a final `{exited: true, exitCode, signal, offset}` event to every stream, then `end()` and clear them. Include `exited`/`exitCode` in the initial event as well. On the client, treat `exited` as terminal: write the marker once, stop input, close the reader. End streams in `closeAll()`.

**H8. Internal browser operations bypass the per-session serialization queue, so resize, snapshot, navigate, and actions interleave.**  
`src/browser-workspace.js:30-36`, `89-147`  
*Session impact:* The HTTP wrapper queues only `/api/browser/*` paths. The pane UI uses `/api/panes/...`, which calls `browserWorkspace.snapshot/navigate/action/setViewport` directly, and those functions are not queued. `setViewportTab` mutates `s.width/height` before awaiting `page.setViewport`; a concurrent snapshot can return new dimensions with an old-size JPEG. The client stores the new dimensions and scales subsequent clicks incorrectly. The prior pass reproduced 5/25 snapshots whose reported width differed from the JPEG width when a resize overlapped capture. Concurrent navigation and actions also produce `Execution context was destroyed` errors and title/image mismatches.  
*Fix:* Put a promise-chain mutex per browser session inside `browser-workspace` and route every entry point (snapshot, navigate, action, `setViewport`, close) through it. Coalesce queued snapshots and viewport changes to the newest request, cap the queue, update dimensions only after `setViewport` succeeds, and report the dimensions actually captured.

**H9. The global workspace token is exported to every pane shell and inherited by all builds, tests, and postinstall scripts.**  
`src/workspace-panes.js:99-107`; `scripts/panes:11-14`  
*Session impact:* Every terminal pane receives `TOWNMOUSE_TOKEN`, the owner-equivalent workspace token, and the CLI falls back to reading `~/.townmouse/pane-token`. A malicious dependency run in any pane, a build or test script, or a prompt-injected agent can list all tabs, spawn terminals, read every pane's scrollback (including secrets), type into other panes, drive browsers, upload files, and kill sessions. One compromised dependency owns the whole workspace. The token can also leak into scrollback through env dumps or crash output.  
*Fix:* Issue per-pane capability tokens scoped to that pane (write own input, read own output, no tab creation or other-pane access), rotate them per pane, and never expose the owner token to PTY environments. Remove or restrict the CLI's global token-file fallback; if cross-pane control is required, mediate it through a local socket with OS peer credentials.

**H10. WebSocket resume adopts any session id, and unauthenticated `/admin/sessions` discloses every live id, enabling terminal hijack and kill.**  
`src/server.js:639-650`, `853-872`  
*Session impact:* The `resume` case accepts any active session UUID and does not require the target to be detached or owned by the caller. `GET /admin/sessions` returns every id and `POST /admin/sessions/:id/kill` kills sessions, both without authentication. Any boundary-passing client can list ids, resume a victim's session, replay up to 512 KB of scrollback, inject input even while the owner is attached, or kill shells.  
*Fix:* Owner-authenticate or remove the admin routes. Require a per-session resume secret created at spawn and held only by the owning client, not the id. Allow resume only from the same authenticated principal, and refuse to resume an already-attached session unless the current attachment presents the secret.

**H11. Browser navigation enforces only http(s), so any control-token or agent caller can read loopback, private-network, and cloud-metadata content.**  
`src/browser-workspace.js:48-52`, `103-131`, `208-213`  
*Session impact:* `address()` checks only scheme and embedded credentials; `page.goto` follows redirects. A control-share token holder or any pane-token holder can navigate to `http://169.254.169.254/latest/meta-data/...`, RFC1918 services, or loopback admin ports and read the rendered response through `/snapshot` or `/content`. Redirects from an allowed public URL are not revalidated. A shared control viewer can also navigate its tab to `http://127.0.0.1:<townmouse-port>/panes` and click through the auto-bootstrapping owner UI, making the app perform privileged calls.  
*Fix:* Apply an egress policy: resolve DNS and deny loopback, link-local, private, ULA, and metadata targets; re-check every redirect and subrequest via CDP request interception or a filtering proxy; require an explicit opt-in for localhost. Exclude the Townmouse origin/port from shared sessions and run the browser behind a network namespace or proxy that cannot reach host services.

---

## Medium

**M1. The main terminal WebSocket sends every PTY chunk without a `bufferedAmount` check and JSON-escapes ANSI output per frame.**  
`src/server.js:114-118`, `213-217`, `360-368`  
*Session impact:* `sendToSession` calls `ws.send(JSON.stringify(payload))` for every chunk. A slow, mobile, or backgrounded client accumulates an unbounded send queue while the PTY keeps producing; Node memory grows and the client appears frozen when it returns. Resume replays up to 512 KB in 16 KB frames without pacing.  
*Fix:* Coalesce output for 8-16 ms into one binary frame; check `ws.bufferedAmount`, cap the queue, and skip to the newest data with a reset/dropped marker under pressure. Pace resume replay across ticks and add client-side `term.write` flow control.

**M2. Snapshot polling and terminal write work continue while the page is hidden or the pane is inactive, and Chrome background throttling is disabled globally.**  
`public/panes.mjs:850-867`, `819-833`; `src/browser-workspace.js:15`  
*Session impact:* `pollSnapshot` checks only `disposed` and `isConnected`; the only `document.hidden` guard is in the 1.2 s state poll. Backgrounding the workspace or the device still runs one capture per second per browser pane, per-pane title evaluations, terminal parsing, and page animations. The launch flags `--disable-background-timer-throttling`, `--disable-renderer-backgrounding`, and `--disable-backgrounding-occluded-windows` apply to the whole browser, so pages in inactive workspace tabs keep running timers, rAF, and animations at full rate. This is constant CPU, battery, and thermal load on laptops and measurable jank on phones; returning to the app competes with the first keystrokes.  
*Fix:* Gate all producers on `document.visibilityState`, the active workspace tab, and IntersectionObserver visibility (or at least `is-active`). Pause and resume on `visibilitychange` with one catch-up snapshot/read. Run screencasts only for visible panes. Remove the blanket launch flags and freeze non-visible pages via CDP (`Page.setWebLifecycleState` or emulation throttling); evict idle browser sessions.

**M3. Replay is lossy: tab switches dispose every xterm and replay capped raw history, while server ring wrap is silent and can start mid-escape.**  
`public/panes.mjs:278-288`, `403-429`, `521-523`; `src/workspace-panes.js:353-355`, `374-376`  
*Session impact:* A workspace-tab switch calls `teardownPanes()`, disposing all terminals and recreating them. Remounting writes up to 120,000 characters of raw history into a fresh terminal. That reproduces the screen only when the stream is retained and contiguous. For a long-running `vim`, `htop`, `less`, or `tmux`, the cap makes replay start mid-stream, possibly mid-CSI and without alt-screen enter/exit history, so the pane returns garbled or on the wrong screen. If the server's 200 KB ring has wrapped while the tab was away, the stream clamps `since` to `bufferStart` and sends the last 200 KB with no truncation signal; the client appends a mid-escape tail after its own history and cannot tell that output was lost.  
*Fix:* Keep one pane grid per workspace tab mounted and hide the inactive tab with `display: none`/`content-visibility`; suspend its streams and snapshots and resume from saved offsets. Or snapshot terminal state with `@xterm/addon-serialize` and restore that. If raw replay remains, store history as chunk frames, begin replay at a frame/escape boundary, and include `bufferStart` plus a `truncated`/gap flag in the initial stream/read payload so the client can reset or show a marker. Chunk the initial replay instead of one large event.

**M4. Every terminal fit sends a resize POST, and window/split drags fit on every animation frame.**  
`public/panes.mjs:539-565`  
*Session impact:* The `ResizeObserver` rAF-throttles but does not debounce; `applyFontSize` and `safeFit` run xterm measurement/reflow, `onResize` fires when cols/rows change, and `sendTerminalResize` posts every distinct change. Dragging a window or splitter with `vim`/`less`/`top` open sends up to ~60 resize round trips per pane per second, and each one delivers `SIGWINCH` and a full-screen repaint. Four panes multiply the requests and produce visible flicker and input lag during the drag.  
*Fix:* Debounce fit/resize 100-200 ms trailing and coalesce to the last cols/rows, skipping redundant sends. Only refit when the host size changed beyond a threshold, skip while the terminal is not visible, and do not change font size and refit in the same frame.

**M5. State polling turns into a herd and has no ordering against mutation responses, so stale state can resurrect a closed pane or revert the active pane.**  
`public/panes.mjs:218-239`, `384-395`  
*Session impact:* `refresh()` serializes only refresh-vs-refresh: if `/state` takes longer than the 1.2 s interval, each tick awaits the same in-flight promise and then starts its own request, producing four or five concurrent `/state` calls and out-of-order `applyState` invocations. Mutations (`activateTab`, `closePane`, `setActivePane`) apply their responses directly, so a poll response started before a mutation can land after it with an older `activeTabId` and pane list. `applyState` then sees a different signature and calls `rebuild`/`teardownPanes`, reverting the UI and recreating every terminal and browser image; a closed pane can be remounted and a terminal/SSE stream attached to a deleted pane. With 24 tabs x 4 panes, a large JSON payload and DOM pass runs about once per second even though state changes only on explicit actions.  
*Fix:* Make refresh single-flight by returning the existing in-flight promise instead of issuing another request after awaiting it. Add a monotonic revision to every state payload and ignore responses older than the last applied revision. Bump a client epoch before applying a mutation response and discard in-flight refresh results from an older epoch. Push state mutations over the multiplexed socket and keep a slow poll only as a fallback; support ETag/If-None-Match.

**M6. Coalesced keystrokes are discarded when a terminal record is disposed for a tab switch, even though the PTY still exists.**  
`public/panes.mjs:580-601`, `408-417`  
*Session impact:* `flushTerminalInput` returns immediately when `record.disposed`, and `disposeRecord` clears `inputTimer` and aborts the stream on every workspace-tab switch. If an input POST is in flight when the user types or pastes and switches tabs, the queued burst never reaches the shell. The chunk loop also stops mid-payload when disposed. The prior pass reproduced this by holding the first `/input` request: typing `echo SECOND` and switching tabs left the PTY with only the earlier command.  
*Fix:* Separate "pane removed" from "view not mounted". On a tab-switch teardown, flush the remaining `pendingInput` before clearing, or keep sender state in a per-pane map that survives record disposal. Only drop input when the pane itself is closed. Add a test that switches tabs with an in-flight input POST.

**M7. A failed input chunk discards the rest of the batch, chunking can split surrogate pairs, and `api()` has no timeout.**  
`public/panes.mjs:176-191`, `580-601`  
*Session impact:* The chunk loop helps large pastes, but on any chunk error the catch only logs while `pendingInput` has already been cleared and the loop aborts, so the failed chunk and all later chunks are silently lost; earlier chunks may already have reached the shell, leaving a partial command. The loop slices at 24,000 UTF-16 code units, which can split a surrogate pair, so an emoji at a chunk boundary is sent as replacement characters. `api()` has no `AbortController` or timeout, so one hung request leaves `inputBusy` true indefinitely and keystrokes queue with no visible feedback.  
*Fix:* Size chunks by encoded bytes (for example `TextEncoder.byteLength <= 16 KB`) and never split surrogate pairs. Retry a failed chunk with smaller sizes while retaining the unsent remainder, and do not clear `pendingInput` until all chunks succeed. Surface a persistent notice with the unsent text. Add `AbortController` timeouts to `api()`, and requeue unsent data once.

**M8. The SSE reader has no heartbeat watchdog, and after any close it falls back to 180 ms polling forever instead of retrying the stream.**  
`public/panes.mjs:603-677`  
*Session impact:* If the TCP stream half-opens (Wi-Fi roam or laptop sleep), `reader.read()` stays pending. The client discards the server's 15 s `: ping` comments and never notices the silence, so the terminal stops updating with no fallback. If the stream ends or auth fails, `startTerminalRead` polls `/read` every 180 ms per pane indefinitely, producing roughly 22 failing requests per second with four panes and no visible error.  
*Fix:* Track the last byte/comment time and abort plus reconnect after 30-45 s of silence; treat SSE comment events as heartbeats. Retry the stream with capped exponential backoff and use polling only as a temporary fallback. Surface repeated failures.

**M9. Every reconnect rebuilds the terminal and replays up to 512 KB in 32 JSON frames, and backoff caps at 60 s with no online/visibility trigger.**  
`public/index.html:1204`, `1234-1242`; `src/server.js:360-368`  
*Session impact:* A laptop sleep or Wi-Fi blip closes the socket; `connect()` calls `initTerminal()`, disposing the xterm, DOM, and renderer, then resume replays the whole 512 KB buffer synchronously in 16 KB frames, freezing the page for hundreds of milliseconds. Repeated flaps repeat the freeze, and recovery can wait up to 60 s because nothing listens for `online` or `visibilitychange`.  
*Fix:* Keep the terminal instance and send the last received offset in the resume message; replay only the delta (or reset with a marker). Cap and chunk replay across animation frames, add jitter, reset backoff on `online`/`visibilitychange`, and reconnect immediately when the network returns.

**M10. Chromium disconnect clears only `browserPromise`, leaving dead sessions that break their panes and count against the browser cap.**  
`src/browser-workspace.js:17-19`  
*Session impact:* Killing Chromium during a session (OOM, crash, `pkill`) leaves `sessions` populated. The browser pane remains `running` in `/state`, every snapshot/action returns 400 `Session closed`, and the dead session still counts against `MAX_BROWSER_TABS`. After enough crashes, creating a browser pane is refused with 409 `Close a browser pane before opening another` even though a new Chromium would launch.  
*Fix:* On `disconnected`, clear or deny all sessions and reject queued work. Expose a generation/dead flag so workspace panes can mark their browser panes exited/offline and the UI can close or recreate them. Clear sessions in `closeAll()` and auto-close panes whose `browserId` no longer resolves.

**M11. Pane close signals only the login shell pid; descendants that ignore HUP/TERM survive, and the pty is never destroyed.**  
`src/workspace-panes.js:234-240`; `src/server.js:136-145`  
*Session impact:* `killPty` calls `pane.pty.kill('SIGTERM')` then `SIGKILL` on `pane.pty.pid` only; node-pty's kill is `process.kill(this.pid, sig)`. A descendant such as `sh -c 'trap "" HUP TERM; sleep 300' &` is reparented to pid 1 and keeps running after the pane is deleted. The prior pass observed the pid alive 2.5 s after DELETE with `ppid=1`. Repeated pane open/close leaks builds, watchers, and daemons plus their CPU and file descriptors.  
*Fix:* Signal the pty's process group (`process.kill(-pane.pty.pid, signal)` when it is a session leader) in addition to the pid, and call `pane.pty.destroy()` after the kill to close the master and HUP the foreground process group. Escalate to `SIGKILL` on the group. Apply the same path in `closeAll()` and the server's `killPty`.

**M12. No slot is reserved across the awaited browser-pane creation, so concurrent requests launch many contexts before the post-await four-pane check rejects them.**  
`src/workspace-panes.js:67-95`  
*Session impact:* Firing N concurrent `POST /tabs/:id/panes {kind:"browser"}` requests at a tab with room: all pass the pre-await `tab.panes.length` check and each awaits `browserWorkspace.create` (new context/page plus optional navigation up to 20 s). Only after that does the recheck reject all but the first four. The pane limit is never exceeded, but the transient burst of contexts, pages, and navigations stalls browser panes and the machine, and every loser pays the creation cost before being closed.  
*Fix:* Reserve synchronously before awaiting: track `tab.pending` (or a per-tab creating counter), reject when `tab.panes.length + tab.pending >= MAX_PANES_PER_TAB`, increment before `browserWorkspace.create`, and decrement in `finally`. Or serialize pane creation per tab. Keep the existing post-await recheck as a second line of defense.

**M13. Resume does not detach the previous socket; the old socket keeps write access and its close/error evicts the newly resumed connection.**  
`src/server.js:324-335`, `771-806`  
*Session impact:* `resumeSession` sets `target.ws` to the new socket but leaves the old socket's `__sessionRef` pointing at the target, so the old client can still send `input`. When the old socket later closes, the close handler unconditionally sets `target.ws = null` and `sessionActive = false` and starts the grace timer; an `error` event does the same. After a reconnect or hijack, a stale or half-dead socket can stop output on the live connection, force it into resume grace, and keep injecting commands; repeated reconnects thrash the PTY.  
*Fix:* On resume, clear the old socket's `__sessionRef` and close it. In the close and error handlers, only mutate the session when `session.ws === ws`, and add a per-session attachment generation so stale handlers and events are ignored.

**M14. The WebSocket keeps the `ws` default 100 MB max payload and decodes base64 before the 512 KB check, enabling memory and CPU exhaustion.**  
`src/server.js:878`, `686-697`  
*Session impact:* The `WebSocket.Server` is constructed without `maxPayload`, so ws 8.23 accepts 100 MB messages. `voice-chunk` calls `Buffer.from(data.b64, 'base64')` before checking `chunk.length > STT_MAX_CHUNK_BYTES`, so one frame allocates about 75 MB; repeated frames or 100 MB JSON messages exhaust memory and CPU. The 8 MB utterance byte cap does not cap chunk count: millions of 1-byte chunks each retain a Buffer object and array entry. HTTP JSON is capped at 2 MB, but the WebSocket path has no equivalent.  
*Fix:* Set `maxPayload` to a small limit (for example 1 MB) on the WebSocket server. Reject oversized base64 strings by encoded length before decoding, cap chunk count and `voice-start` rate, and cap concurrent connections with per-connection rate limits.

**M15. Resource caps still allow 24 shells, up to 32 Chromium contexts, unbounded WebSocket connections, and unbounded browser action queues.**  
`src/workspace-panes.js:9-12`; `src/browser-workspace.js:7`, `31-32`; `src/server.js:878`  
*Session impact:* `MAX_TERMINAL_PANES = 24` and 24 tabs x 4 panes, plus `MAX_BROWSER_TABS = 32`, give a token holder up to 24 login shells and 32 Chromium contexts; each context can consume hundreds of MB and runs a 1 Hz snapshot loop. The per-session action queue is an unbounded promise chain, `page.evaluate`/`page.title` have no operation timeout, and the WebSocket server has no connection cap (every connection allocates a session and heartbeat). A prompt-injected agent or leaked token can exhaust RAM/CPU and wedge the host.  
*Fix:* Lower and enforce memory-aware caps; add per-token/per-client creation quotas and rate limits. Cap the browser action queue (429 when full), add operation timeouts, an RSS watchdog that closes idle contexts, and a WebSocket connection limit. Document one enforced number for browser contexts.

**M16. Attachment upload and download are unauthenticated, 25 MB bodies are buffered in memory with no quota, and the response leaks an absolute path and a downgraded URL.**  
`src/attachments.js:12-51`  
*Session impact:* `/api/attachments` has no token check, rate limit, or disk quota. `express.raw({ limit: "25mb" })` buffers a 25 MB body in memory before the handler, so concurrent uploads can spike memory into the GB range, and unlimited uploads fill `~/.townmouse/attachments`. Downloads under `/attachments` are also unauthenticated, so any boundary client that learns a URL can read a user's dropped files. The response discloses the absolute local path and builds the URL from `req.protocol`, which stays `http` behind an HTTPS proxy, producing a downgraded/mixed-content URL. Files are served inline with extension-derived MIME types, so `.html`, `.svg`, and `.xhtml` are active documents; the current `sandbox; default-src 'none'` CSP is the only script barrier, and its `setHeaders` CSP replaces the global `frame-ancestors` directive rather than extending it. The earlier stored-XSS chain is mitigated in this tree by that CSP, but a header-stripping proxy or older client would reopen it.  
*Fix:* Require owner authentication for upload and download. Stream the body to a temp file with a hard byte cap, enforce per-client rate limits and daily quotas/free-space checks, delete on failure, and return only the relative capability URL. Build any absolute URL from the configured trusted origin or forwarded protocol, not `req.protocol`. Serve attachments as `application/octet-stream` with `Content-Disposition: attachment`, or allowlist raster image MIME types and force their `Content-Type`. Keep the sandbox CSP as defense in depth, add `frame-ancestors 'none'` and `Cross-Origin-Opener-Policy: same-origin`.

**M17. Workspace state saves are not serialized and share one temp path; restore creates browser panes sequentially and blocks bootstrap.**  
`src/workspace-panes.js:142-168`, `170-194`  
*Session impact:* `scheduleSave`/`saveState` always write `stateFile + ".tmp"` and are not serialized. Two overlapping saves (a slow write, a mutation during a save, or `closeAll()` racing a timer) can truncate or interleave the same temp file; one rename can fail or leave `workspace.json` partial. On the next start, `restoreState` creates browser panes sequentially, each with a navigation timeout of up to 20 s, and `ensureInitial` awaits it, so the first bootstrap or `/state` request can block for minutes on a large saved workspace.  
*Fix:* Serialize saves through a promise chain, use unique temp names, and rename atomically. Coalesce pending saves. Restore browser panes without blocking bootstrap: create placeholders and navigate lazily or in parallel with a small concurrency cap and a timeout.

**M18. `addPane` force-focuses the newly created pane 80 ms later, stealing focus from whatever the user started using.**  
`public/panes.mjs:1010-1015`  
*Session impact:* Click Add terminal/browser, then immediately click an existing pane and start typing. The `setTimeout(..., 80)` still runs and calls `focusPaneById`, so the keystrokes go to the new terminal. If the new pane is a browser, its address input is focused, so typing plus Enter navigates that browser pane instead of running the command the user intended.  
*Fix:* Capture the focused element or a focus epoch when creation starts and only auto-focus if focus has not moved. Or focus synchronously as part of mounting the new record (rAF for terminals) and drop the timer. Never focus a browser address input after the user has focused elsewhere.

---

## Low

**L1. The `[process exited]` marker is re-emitted on every remount because a new record starts with `exited = false` and the marker is also stored in client history.**  
`public/panes.mjs:464`, `641`, `679-687`  
*Session impact:* Exit a terminal, then switch away and back repeatedly. Each remount replays a history that already contains the marker, then the stream's initial `exited: true` event calls `markTerminalExited` again because `record.exited` is hardcoded false. The prior pass saw the marker count go 1 -> 2 -> 3 -> 4 across three switch cycles, with the status message repeated and history growing each time.  
*Fix:* Initialize `record.exited` from `pane.status` and make marker emission idempotent per pane (a module-level Set, or do not append the marker to histories). The server's one-time exit event plus `record.exited` should write it exactly once.

**L2. Snapshot and action responses overwrite a title-locked browser pane's title, making the header flicker against the state poll.**  
`public/panes.mjs:882-886`, `951-954`; `src/workspace-panes.js:196-202`  
*Session impact:* Create a browser pane with an explicit title (`opts.title` makes `titleLocked` true). `serializePane` and `updatePaneChrome` use the locked title, but the snapshot/action responses return the live page title and `applySnapshot`/`browserAction` write it to `titleEl`. With 1 Hz snapshots and 1.2 s state polls, the header, tooltip, and close-button aria-label flip between the two titles indefinitely.  
*Fix:* Return the effective locked title in snapshot/action responses, or include `titleLocked` in the serialized pane and carry it on the client record; apply `snapshot.title`/`updated.title` only when not locked. Alternatively have the internal browser API return the pane's title rather than the page's.

**L3. Autosave serializes up to 2,000 terminal lines and writes to localStorage synchronously every 10 s.**  
`public/features/autosave.mjs:19-38`  
*Session impact:* With a full scrollback and long lines, each tick runs up to 2,000 `translateToString` calls plus `JSON.stringify` and a synchronous `localStorage` write on the main thread, and again in `beforeunload`. On a laptop or iPad this is a periodic 50-200 ms typing hiccup and can delay unload; the payload can approach the 5 MB quota.  
*Fix:* Run in `requestIdleCallback`, capture incrementally or only changed lines, cap bytes rather than lines, skip while `document.hidden`, and use asynchronously written IndexedDB instead of localStorage.

**L4. The single-terminal page enables `minimumContrastRatio: 4.5` and `allowTransparency`, adding per-cell work on every render.**  
`public/index.html:1049-1052`  
*Session impact:* With 10,000 lines of scrollback and high output, xterm recomputes WCAG-adjusted colors for visible cells on each render (the xterm documentation warns this has a performance cost) and takes the alpha/transparency path even though the selected theme backgrounds are opaque. Rendering is measurably heavier than the panes page and contributes to paint jank on integrated GPUs. The panes page uses scrollback 5,000; the single-terminal page uses 10,000.  
*Fix:* Drop `minimumContrastRatio` (or set it to 1) and disable `allowTransparency` unless a transparent theme is actually active. Align scrollback with the panes page (5,000).

**L5. The browser content endpoint materializes and serializes the entire page's `innerText` before slicing to 100,000 characters.**  
`src/workspace-panes.js:333-340`; `src/browser-workspace.js:208-213`  
*Session impact:* The endpoint runs `document.body.innerText` on the full DOM and CDP-serializes the result before slicing. On a very large or text-heavy page this forces a full layout/text walk and a large cross-process transfer, delaying snapshot captures on that pane whenever an agent polls content.  
*Fix:* Do a bounded traversal inside the page (a TreeWalker with a node/character budget) and return at most 100,000 characters. Add a timeout and cache per URL/navigation with a short TTL.

**L6. Secrets are compared with `===` and the app CSP does not restrict scripts or connections despite long-lived keys being readable by page JavaScript.**  
`src/browser-workspace.js:24`, `43`; `src/server.js:815`  
*Session impact:* `human()` compares the owner key with `===` and `session()` compares bearer tokens with `===`. `/api/browser/bootstrap` and `/api/panes/bootstrap` return long-lived credentials to same-origin requests without authentication, and the app sets only `frame-ancestors 'none'`. A same-origin script (any future DOM XSS) can fetch bootstrap, obtain the persistent workspace token, and control every terminal and browser for the token's lifetime; the comparison itself is also a timing side channel, though a weak one locally.  
*Fix:* Compare secrets with `crypto.timingSafeEqual` over equal-length hashes. Scope and expire tokens per capability. Add a strict CSP (`default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`), validating xterm's style injection before tightening `style-src`.

---

## Fix order

This order puts the defects that directly produce the reported PTY stalls first, and the defects that let any local process or dependency take over the machine alongside them.

### Priority 0: security boundary and server survival

1. **Authenticate the owner surface.** Add owner authentication to `/api/panes/bootstrap`, `/api/browser/bootstrap`, the WebSocket upgrade, `/admin/*`, `/api/voice/settings`, and `/api/attachments`. Issue short-lived per-pane capability tokens, enforce the pane id on every route, remove `TOWNMOUSE_TOKEN` from PTY environments, and remove or restrict the CLI token-file fallback. (C1-C4, H9, H10, M16, L6)
2. **Constrain voice execution.** Allowlist an absolute whisper binary or fixed argv template; never accept a free-form interpreter or shell. (C4)
3. **Stop the crash.** Guard every async `popup`/`dialog` listener and add a process-level `unhandledRejection` handler that logs and keeps serving. (C5)

### Priority 1: PTY output path (the direct cause of typing stalls and frozen terminals)

4. **Replace both PTY rings.** Chunk arrays with a running length, whole-chunk eviction, batched trimming, and no buffering for an attached live socket. (C6)
5. **Fix SSE fan-out.** Build events only when `pane.streams.size` is nonzero; join and flush every 8-16 ms; honor `write()` backpressure; cap per-stream bytes and stream count; use binary frames. (H1)
6. **Stop burning HTTP connections.** Multiplex pane output, input, and state over one WebSocket, or move to HTTP/2. If SSE stays, use one stream for all panes, cap screenshot requests, and prioritize input. (H2)
7. **Add end-to-end flow control.** `term.write(data, callback)` with a bounded pending queue, explicit truncation/resync markers, and chunked history. Honor `ws.bufferedAmount` and `res.write()` backpressure on both server transports. (H3, H6, M1)
8. **Make the stream protocol correct.** Broadcast PTY exit, include exit codes, add gap/truncated flags, and chunk the initial replay. (H7, M3)

### Priority 2: browser pipeline

9. **Capture only what is visible and changed.** Persistent CDP session, `Page.startScreencast`, binary frames, quality and dimension caps, no `bringToFront`, and a global capture scheduler with a small concurrency limit. (H4)
10. **Stabilize geometry.** Reserve chrome space or decouple the remote viewport from CSS; coalesce resize to one in-flight request and the latest size; remove per-resize captures; map clicks against the frame actually displayed. (H5)
11. **Serialize browser operations.** One per-session mutex for snapshot, navigate, action, viewport, and close; coalesce superseded snapshots and viewports. (H8)
12. **Fix browser lifecycle and limits.** Clear dead sessions on Chromium disconnect, reserve creation slots before awaiting, cap queues and operation timeouts, and gate producers on visibility. (M10, M12, M15, M2)

### Priority 3: client correctness and resilience

13. **Keep panes alive across tab switches.** Hide inactive tabs instead of disposing them, or serialize and restore terminal state. Single-flight state refresh with a monotonic revision, input sender state that survives record disposal, byte-based chunking with retry, `AbortController` timeouts, and focus-epoch-guarded auto-focus. (M3, M5, M6, M7, M18)
14. **Debounce work that should not run per frame.** Terminal resize 100-200 ms trailing, skip hidden terminals, and coalesce browser actions. (M4)
15. **Make reconnect cheap and reliable.** SSE heartbeat watchdog with capped backoff, WS resume by offset instead of full 512 KB replay, and immediate reconnect on `online`/`visibilitychange`. (M8, M9)
16. **Close leaked processes and sessions.** Signal the PTY process group, call `pty.destroy()`, detach old sockets on resume, cap WS payloads, serialize state saves with unique temp files, and unblock restore. (M11, M13, M14, M17)

### Priority 4: low-risk polish

17. Exit-marker idempotence, title-lock handling, idle-time autosave, xterm render options, and bounded content extraction. (L1-L5)

### Tests to add with the fixes

- `/stream` emits an exit event and ends; the client shows one marker across repeated tab switches.
- A slow SSE reader with `yes` keeps RSS bounded and receives a resync/truncation signal instead of unbounded growth.
- A pasted batch containing multibyte text and emoji is delivered byte-for-byte; a failed chunk is retried; tab switching with an in-flight input POST loses nothing.
- A popup that closes immediately and a dialog during navigation do not exit the process.
- Concurrent browser-pane creation never launches more than the tab limit; resize overlapping a snapshot returns dimensions that match the image.
- Tab switching restores a `vim`/`tmux` screen, or shows an explicit gap instead of a corrupted one.
- No-header bootstrap, unauthenticated WS `shell`, unauthenticated `/admin/sessions`, unauthenticated voice PUT, and unauthenticated attachment upload all fail with 401/403.

The existing `tests/panes-api.test.cjs` currently asserts that unauthenticated bootstrap returns 200 with a token (around line 271), so it must be updated as part of the authentication fix. It has no coverage for stream exit, slow readers/backpressure, input flush on teardown, large multibyte pastes, concurrent browser creation, or popup/dialog errors.

---

## Deduplication and reconciliation

The four input reports contained 71 findings. After merging the same defect across passes and dropping findings whose failure mode no longer exists, 41 remain. The main merges:

- The server 512 KB resume ring and the workspace-pane 200 KB ring are one defect class and became **C6**.
- The per-chunk SSE `JSON.stringify` and the ignored `res.write()` backpressure/no stream cap are both in the same fan-out loop and became **H1**.
- The multiple "snapshot polling continues when hidden" reports became **M2**; the browser capture, `bringToFront`, per-frame CDP session, base64 decode churn, and action-triggered capture reports became **H4**.
- The read-offset truncation and tab-switch replay-loss reports became **M3**.
- The two input-loss reports (tab-switch disposal and failed-chunk discard) remain separate because their fixes differ: **M6** and **M7**.
- The attachment stored-XSS, MIME-hardening, and upload-quota reports became **M16**.

Findings from earlier revisions that are **not current**:

- **The >64 KB paste rejection is fixed.** `src/server.js:823` now uses `express.json({ limit: "2mb" })`, and `public/panes.mjs:587-589` chunks input at 24,000 code units. The remaining paste defects are the discard/retry, surrogate-split, and timeout issues in M7, not a 413 on ordinary pastes.
- **The per-keystroke input POST is fixed.** `public/panes.mjs:567-601` coalesces input on a 12 ms timer and sends ordered batches. The remaining input issues are M6/M7.
- **The attachment stored-XSS chain is mitigated, not gone.** `src/attachments.js:20` now serves attachments under `sandbox; default-src 'none'`, which blocks script execution and gives an opaque origin. The residual issue is the unauthenticated upload/download surface, memory and disk quota, path/protocol leak, and inline MIME types reported as M16; do not treat the CSP as a substitute for authentication and `Content-Disposition`.
- **Some original line anchors no longer exist.** For example, the older `public/panes.mjs:605` SSE fetch is now line 611, the older `workspace-panes.js:110` ring is now 118, and the older `server.js:366` replay is now `resumeSession` at 360-368. All anchors above were re-read in the pinned snapshot.

## What was not verified

- **No live reproduction was performed in this synthesis step.** The failure scenarios are taken from the four input reviews (several were live-verified there) and from inspecting the current code at the pinned checksums. This step did not edit or run the application, and did not run the test suite.
- **Claims inherited from the input passes, not re-run here:** the popup crash exiting with code 1; a streamed `echo EXIT_MARK; exit` producing no exit event while `/state` says `exited`; a paused SSE reader growing RSS from 76 MB to 300 MB in three seconds; 5/25 snapshots reporting a width that differed from the JPEG; the exit marker duplicating 1 -> 2 -> 3 -> 4 across tab switches; an in-flight input POST losing the next command on tab switch; a HUP/TERM-ignoring descendant surviving with `ppid=1`; and a killed Chromium leaving a `running` pane whose snapshots return 400. The current code still contains each mechanism, but the exact runtime behavior was not re-measured.
- **Deployment-dependent severity.** C1-C4 and H10 assume the documented local/proxy deployment. With an authenticating HTTPS proxy in front, non-browser clients, proxy-forwarded clients, share-token holders, and same-origin scripts still pass the request boundary; without one, every boundary-only route is reachable by anything that can connect to the loopback port.
- **Browser measurements are synthetic.** The 37-45 ms capture, 166-170 KB JPEG, 221-226 KB base64, 3.9 MB decoded, and 113 ms four-way concurrency numbers came from the prior pass's simple text pages, not production applications; real pages are likely slower. No browser benchmark was rerun here.
- **SSRF reachability was not exercised end to end.** The code path is confirmed, but network reachability from a shared viewer and redirect behavior depend on the deployment and were not tested.
- **The attachment CSP mitigation depends on the client honoring CSP.** It was not tested with a header-stripping proxy or an older client that ignores `Content-Security-Policy`.
- **State persistence race was inferred from code.** The overlapping-save and blocking-restore scenarios in M17 were not reproduced against a real state file.
- **Not reviewed:** packaging, branding, documentation-only changes, and any source file not listed in the scope or cited above.

## What checked out

The prior passes also confirmed several protections that should not be regressed: attachment filenames are sanitized with `path.basename`, an allowlist, leading-dot stripping, and a fixed date directory, which blocks traversal and symlink tricks; POSIX shell quoting for attachment paths is correct in both clients; `scripts/panes` uses header auth and JSON, not shell interpolation; browser tokens are not placed in URLs; pane, browser, snapshot, read, and attachment API responses use `no-store`; the panes client writes server data with `textContent`/`value` and a fixed `data:image/jpeg` prefix, and the prior passes found no DOM XSS; `address()` rejects `file:`, `data:`, `view-source:`, and embedded credentials; HTTP JSON bodies are capped; pane/tab counts are capped; browser creation is guarded by an `opening` counter; and the attachment sandbox CSP blocks the earlier stored-XSS chain.

# Changelog

All notable changes to Townmouse and the TerminalOne engine it embeds.

Townmouse is version 0.2.1, the second product cut, and is licensed AGPL-3.0-only. The 1.0.x entries below are the engine's inherited release history; the version numbers and dates stay exactly where history put them.

## [0.2.1] — 2026-11-21

### Security

- Element catalogs never serialize a password field's value. A catalog is served to view-only bearer grants, so returning it would cross the sharing boundary that the image and page text already respect.
- Browser URL waits match literally. A client-supplied regular expression was tested on the event loop, where a catastrophic pattern could stall every terminal, browser, and API request.
- Terminal wait patterns run in a worker thread with a deadline, so a pattern that backtracks pathologically is terminated and refused instead of stalling the server; patterns are capped at 200 characters.

### Packaging

- `repository.url` normalized to `git+https://…`, the form npm requires at publish time.

## [0.2.0] — 2026-11-21

### Standard browser view

- One compact address row is the header. Agent access sits behind **Share** instead of occupying its own row, and the state line is a single slim line.
- A **Collapse** control hides every bar above the page and remembers the choice, leaving a 32 px strip that names the current page and restores the controls. Measured gain: 112 px on desktop, 180 px on tablet, 127 px on phone.
- The mascot lives in the navigation rail only; it no longer occupies the working area.

### Agent control

- Browser panes address controls by role and name across cross-origin frames and open shadow roots. Every observation carries an id, capture time, viewport, scroll offset, address, title, and a truncation flag.
- A coordinate target from a page that has changed since it was observed is refused with "look again"; element refs are stable and re-checked before use.
- Actions report `completed`, `missing`, `wrong-kind`, `failed`, `stale`, or `unconfirmed`, with the focused control and value. Navigation returns the new page's title.
- Modifier chords (`Alt+M`), hover, drag, replace-typing, named-area scrolling, and bounded waits.
- Ordinary commands run as tracked jobs with an exit code; `pane read` defaults to clean screen text and `--raw` keeps the original terminal data.
- Program, agent-reported, and command status are three separate channels, and a fresh program clears the previous agent report.
- Visible maximize/restore control and a fixed-size browser lock that the owner's viewer cannot resize.
- New panes drop inherited parent-harness session markers (`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, and related).

### Packaging

- Dependency assets resolve through Node's lookup paths, so a normal `npm install` with hoisted dependencies serves the terminal engine instead of 404ing it.
- The server repairs node-pty's macOS spawn-helper mode at startup; npm 12 skips dependency install scripts by default, so the postinstall cannot be the only fix.
- Browser panes fall back to an installed Chrome, Chromium, Edge, or Brave; `GET /health` reports the resolved engine.
- `npx townmouse` works on Node 22–26. Node 22 is still preferred; the engine range is `>=22 <27`.
- Containers accept a remapped host port, the image has a `HEALTHCHECK`, and the build context no longer carries `.runtime`.
- The macOS installer scripts ship in the npm package.
- New gates: `npm run test:package` installs the packed tarball with `--ignore-scripts` and exercises the installed application; `tests/agent-control.test.cjs` covers 36 agent journeys.
- On Linux the package gate installs with the native build, because node-pty has no Linux prebuild. The server now explains a missing terminal engine and names the remedy (`npm rebuild node-pty`, `npm install --allow-scripts=node-pty townmouse`, or the container) instead of dying in a require stack.

## [0.1.0] — 2026-11-15

### Workspace

- Four-pane workspace tabs: any mix of PTY terminals and real Chromium browsers, up to four panes per tab and 24 tabs.
- Terminal agents receive `TOWNMOUSE_API`, `TOWNMOUSE_TOKEN`, `TOWNMOUSE_TAB_ID`, `TOWNMOUSE_PANE_ID`, and `TOWNMOUSE_PANES_CLI` in every pane; `scripts/panes` controls tabs, panes, URLs, input, reads, named keys, bracketed send-text, waits, agent state, dialogs, attachments, and pane order.
- Pane terminals start at the client's measured dimensions, expose `lastOutputAt`/`idleMs`/exit status, and accept agent-reported working/blocked/idle/done state.
- Workspace state, tab titles, pane cwd, browser URLs, and active selection survive a server restart.
- Visible tab strip, draggable terminal/browser separators, 7-second idle chrome collapse, and phone/tablet/desktop layouts.
- Draggable pane dividers with per-tab ratios, keyboard resizing, double-click reset, pane headers that drag to reorder, and a maximize chord.
- Phone key bar for panes (Esc, Tab, sticky Ctrl/Alt, Ctrl+C, arrows, Home/End, PgUp/PgDn), a word-wrapped Reader transcript, terminal context menus, and a shortcut sheet.
- Restart epochs and a restored-layout notice; answerable page dialogs; browser Forward; software-keyboard inset handling.

### Attachments

- Attach button in the main bottom navigation and pane menu, backed by a multi-file picker.
- Image and file paste uploads once and inserts a shell-quoted path; terminal agents and humans see the stored path.
- Drops outside a terminal never type file bytes or `data:` URIs into a PTY.

### Fixed

- Resuming at a different width replays a control-free transcript built from the width each output was produced at, so shell redraws cannot fragment commands.
- Blank browser panes survive restart instead of being discarded; restarts mint an epoch and tell the client what was not restored.
- Queued terminal input survives a workspace tab switch and reuses one queue per pane.
- A page popup can no longer crash the server; a superseded window can no longer detach a live resumed shell; dead Chromium pages are pruned.
- Slow terminal readers are disconnected into the polling fallback instead of growing server memory without bound; at most four SSE streams are open.
- The attachment picker inserts its path and shows a copyable URL card; active HTML/SVG downloads instead of rendering.
- Bare Ctrl+C always interrupts, even with a selection.

### Security

- Owner bootstrap and attachment uploads require an HttpOnly SameSite owner capability minted on page navigation. Header-less local callers and pane-token callers receive 403.
- Attachments are served with a sandbox CSP and `Cross-Origin-Resource-Policy: same-origin`.
- Chromium keeps its renderer sandbox by default; containers/CI opt out explicitly with `TOWNMOUSE_CHROMIUM_NO_SANDBOX=1`. Session and pane APIs bind loopback only unless Docker sets `HOST=0.0.0.0` for port forwarding.
- Attachment uploads are owner- or pane-token gated, daily-quota bounded, archived by age, and served with a sandbox CSP plus download disposition for active document types.

### Packaging and tests

- npm CLI (`bin/townmouse`), Dockerfile, npm files allowlist, and AGPL-3.0-only licensing.
- New regression coverage for pane API limits, persistence, resume width, attachment picker/paste/drop, and popup safety.

## [1.0.3] — 2026-11-08

- The engine learned to take dictation. Voice / speech-to-text has a settings section; the STT command, model, language, and argument template are saved server-side in `~/.config/terminalone/voice.json` and used at transcription time.
- Audio is staged under `~/.cache/terminalone`. The server accepts `.txt` or `.srt` output and no longer assumes `whisper` is on `PATH` or that a fixed `tiny.en` model is the only game in town.
- Explicit `TERMINALONE_STT_*` environment values override the saved setting for deployment and tests.

## [1.0.2] — 2026-11-06

- Added a one-tap **Ctrl+b** shortcut for herdr to the iPhone/iPad key bar and the Snippets row. It sends Control plus lowercase b immediately, without switching keyboards or pressing Enter.
- Shell respawn storms are bounded, early input survives, and terminal context resets more cleanly after disconnects.
- If `/bin/zsh` is missing on the host, the engine falls back to an available shell.
- Hardened the browser input-guard so short batched keystrokes are not dropped.
- Patched body-parser, proxy-addr, and qs advisories, and pinned CI to Node 22.
- Moved the package homepage to https://floydslabs.com and refreshed the commercial studio screenshots.

## [1.0.0] — 2026-06-26

### Initial public release

This is the first public release of TerminalOne, the browser-based terminal engine Townmouse embeds: 39 feature modules and PWA install support.

### Features

- Live PTY terminal via WebSocket — your actual shell, in your browser
- 39 feature modules covering command palette, session switching, search, clipboard, export, zoom, theme catalog, autosave, OS notification bridge, configurable key bar, and more
- Voice input module with bounded browser microphone capture, local Whisper-backed server transcription, review-before-run insertion, and oversized audio guards
- PWA support — install on iPad/iPhone as a standalone fullscreen app
- macOS launchd service installer with `t1` CLI launcher and Spotlight integration
- Responsive layout across phone, tablet, and desktop
- Settings import/export and theme system with dark/light mode
- 20/20 ShellFish-parity features implemented and tested

### Build and test

- 6 test suites (input-guard, smoke, feature, feature-behavior, voice, responsive)
- Install/uninstall/reinstall verified end-to-end
- Beta release review cleared with no blockers

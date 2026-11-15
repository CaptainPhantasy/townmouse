# Four regression fixes

Base: `4d3619d68df9e379c2caf8949d469406826f911d` (2026-11-15).

## Acceptance conditions

- R1: Erase-line operations remove stale text before the cross-width replay transcript is emitted; display erasure and supported horizontal editing are applied rather than dropped.
- R2: UTF-8 OSC 52 clipboard payloads retain non-ASCII text in both terminal surfaces; malformed input does not overwrite the clipboard.
- R3: Each voice capture, ready/error reply and transcript belongs to its requesting socket; shared terminal output still reaches both windows.
- R4: Switching tabs or removing the maximized pane clears obsolete maximization so surviving panes are visible.

## Observations

- Before repair, the actual replay function returned `doneress 100%` for the review's erase-line example, rather than `done`.
- Before repair, OSC 52's binary-string decoding corrupted the UTF-8 clipboard example.
- The new real-server/two-WebSocket integration failed against the base application because `voice-ready` was broadcast to the other window; it passes against the repaired server.
- `node --test tests/input-chunks.test.mjs tests/replay-text.test.mjs tests/clipboard-text.test.mjs`: 17 passed, zero failed.
- `node tests/voice-routing.test.cjs`: passed. Uses a deterministic external transcription fixture to isolate routing, real HTTP/WebSocket server and a real shared PTY. Does not establish microphone/ASR quality.
- Modified JavaScript syntax checks and `git diff --check`: passed.
- `node tests/panes-maximize.test.cjs`: authored but NOT RUN. This browser journey requires operator approval in the authoring environment. No browser outcome is claimed.
- Full aggregate suite and physical-device testing were not run.

## Scope and deployment

Prepared in a separate worktree. The running user instance remains on main; no server restart, live data mutation, network change or deployment belongs to this PR. Replay is still a bounded transcript renderer, not a complete terminal emulator.

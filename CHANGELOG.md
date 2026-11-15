# Changelog

All notable changes to Townmouse and the TerminalOne engine it embeds.

Townmouse is version 0.1.0, the first product cut, and is licensed AGPL-3.0-only. The 1.0.x entries below are the engine's inherited release history; the version numbers and dates stay exactly where history put them.

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
- Beta release review cleared with no blockers (docs/BETA_RELEASE_READINESS_2026-06-26.md)

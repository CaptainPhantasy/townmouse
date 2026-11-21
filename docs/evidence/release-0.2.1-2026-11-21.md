# Release evidence — Townmouse 0.2.1 (2026-11-21)

**Version:** 0.2.1
**Merge commit:** `056ed39` (PR #6)
**CI (final head `d9adb07`):** run `44901950768` — success
**Tag:** `v0.2.1` (annotated, points to `056ed39`)
**GitHub release:** https://github.com/CaptainPhantasy/townmouse/releases/tag/v0.2.1 (Latest)
**Release asset:** https://github.com/CaptainPhantasy/townmouse/releases/download/v0.2.1/townmouse-0.2.1.tgz — 6,475,409 bytes, sha256 `804a0752aada0307991dadfeba22dc6990f5ea9ee57c02de79c30c5d84f6b44b`, with `SHA256SUMS` beside it. This is an installable channel now: the asset was downloaded, checksum-verified, installed into a clean project with `--ignore-scripts`, and its server answered `/health` and served the terminal engine.
**npm:** pending the owner's second factor; `npm publish` returns `EOTP`. The release does not depend on it: the tagged tarball is attached to the release.
**Container:** `townmouse:0.2.1` (image `0f2b26e73a1a`), built from `056ed39` with provenance labels.

## Contents

- Password values are never serialized in element catalogs (view-only grants).
- Browser URL waits match literally; terminal wait patterns run in a worker
  thread with a 500 ms deadline and are capped at 200 characters.
- `repository.url` normalized for npm.

## Verification

| Check | Command or observation | Result |
| --- | --- | --- |
| Full suite | `npm test` | `TEST_EXIT=0`; agent control 47/47; pane API 31/31 |
| Package gate (macOS) | `npm run test:package` | 6/6 |
| Package gate (Linux) | container run (`node:22-bookworm`) | 6/6 (browser step skipped: no Chromium) |
| CI | GitHub Actions on `d9adb07` | success (test, docker, shellcheck, GitGuardian) |
| Review | PR #6, two rounds | 4 findings addressed; 0 unresolved; 0 new |
| Container health | `docker inspect` + `/health` | `healthy`; browser engine `/usr/bin/chromium` |
| Tag and release | `git ls-remote --tags`, `gh release view` | present; v0.2.1 marked Latest; v0.2.0 notes point here |
| Release asset | `gh release download v0.2.1`, `shasum -c`, clean `npm install`, start | checksum OK; `townmouse --version` → `0.2.1`; `/health` 200; engine asset 200 |

## Known limits (stated, not hidden)

- The macOS `.app` is a local unsigned build; there is no signed download.
- Windows is unsupported; PWA offline coverage is the shell only.
- The live `dlaude` conversation-save check was not run.
- No load or soak test was run.
- The npm artifact is not published yet; the owner's 2FA is the only blocker.

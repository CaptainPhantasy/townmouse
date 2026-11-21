# Packaging dry runs — 2026-11-20

**Purpose:** prove that the release artifact installs and runs as an application,
not that this checkout does. Every row below was run on this machine, against the
packed tarball or the built image.

**Host:** mac-mini (probed with `hostname`)
**Runtime:** Node v22.18.0 for the app's own tooling; the machine's default
`node` is v26.13.1 with npm 12.2.2. Both were exercised on purpose.
**Artifact:** `townmouse-0.1.0.tgz`, 101 files, 7.3 MB unpacked.

---

## What a real install does, and what it did

| Channel | Dry run | Before the fixes | After the fixes |
| --- | --- | --- | --- |
| npm, clean project | `npm init -y && npm install <tgz>` (scripts enabled) | install exit 0; `/health` 200; **`/node_modules/@xterm/*` 404** — terminal page dead | all five engine assets 200 |
| npm, scripts ignored | same with `--ignore-scripts` (npm 12's effective default) | helper mode `-rw-r--r--`; **`posix_spawnp failed`** on every PTY; `doctor` said `abi-mismatch` | helper repaired at startup to `-rwxr-xr-x`; seeded pane `program=running`; job `completed`, exit 0, `stdout="installed-terminal-ok\n"` |
| npm, clean HOME | `HOME=$(mktemp -d)` first run | — | `~/.townmouse` 0700, `pane-token` 0600 |
| global install | `npm install -g --prefix /tmp/tm-global <tgz>` | — | exit 0; deps nested under the package; `townmouse --version` → `0.1.0` |
| `npx` | `npx --yes --package <tgz> townmouse --version` | **`npm error notsup Required: {"node":">=22 <23"} Actual: v26.13.1`** | `0.1.0` |
| Docker | `docker build` then `docker run -p 127.0.0.1:11801:11001` | build exit 0; **403 on `/health`, `/panes.html`, every route** when the host port differed from 11001 | build exit 0; `/health` 200; assets 200; seeded pane running; tracked job `container-terminal-ok`; runs as `node`; image 1.97 GB |
| macOS service | `install-service.sh` with a fake `launchctl` and a sandbox HOME | installer scripts were not in the package at all | plist rendered and `plutil -lint` OK; `t1` stub executable; `Townmouse.app` binary built by `swiftc`; launchctl sequence `bootout → print → enable → bootstrap → kickstart` |

## Defects found and fixed

1. **Engine assets 404 in any hoisted install.** The server served
   `<pkg>/node_modules`, which only exists in a checkout or global install.
   `src/static-deps.js` now resolves each package through Node's lookup paths,
   refuses traversal, and replaces the blanket static mount.
2. **Terminals could not start in any install without a working postinstall.**
   `spawn-helper` lost its execute bit in the tarball, and npm 12 does not run
   dependency install scripts (`allow-scripts = [""]`). `src/pty-permissions.js`
   repairs the mode at server startup; `scripts/prepare-native.sh` and
   `scripts/node-runtime.sh` now resolve node-pty's real location instead of
   assuming a package-local one.
3. **`doctor` misdiagnosed the permission problem as an ABI mismatch** and used
   the same package-local assumption. Fixed; message now names the real cause.
4. **`npx townmouse` was refused on Node 26** by the `>=22 <23` engine range.
   Widened to `>=22 <27` (node-pty is Node-API and loads under both 22 and 26 —
   probed). `node-runtime.sh` prefers 22 and falls back only when node-pty loads.
5. **The container refused every request on a remapped host port.** The request
   boundary compared `Host` to the *container's* port. It now accepts loopback
   hostnames on any port while keeping the exact same-origin rule; the existing
   rebinding/origin tests still pass.
6. **Browser panes had no engine** when Puppeteer's download was skipped (npm 12)
   or version-mismatched. `src/chrome-resolve.js` falls back to a system
   Chrome/Chromium/Edge/Brave, and `GET /health` reports
   `browser: {engine, path, source}`. This machine resolves
   `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (`source:
   system`).
7. **The Docker build context carried 686 MB of `.runtime`.** `.dockerignore`
   now excludes `.runtime`, `.quarantine`, `evidence`, `docs/plans`,
   `docs/reference`, `docs/screenshots`, and `*.tgz`.
8. **The macOS installer shipped without the scripts it calls.** `native/` was
   packaged but `install-service.sh`, `uninstall-service.sh`, `t1.sh`, and
   `run-hooks` were not. All four are now in `files`.

## Codified gates

- `tests/package-install.test.cjs` (`npm run test:package`) repeats the tarball
  install with `--ignore-scripts`, then checks engine assets, data-directory
  modes, a live PTY, a tracked command, and a browser-pane screenshot.
  `RESULT passed=6 total=6 failures=0`.
- `tests/static-deps.test.js`, `tests/pty-permissions.test.js`, and
  `tests/chrome-resolve.test.js` cover the resolvers without needing an install.
- `tests/request-boundary.test.js` now pins the remapped-port behaviour and the
  same-origin rule that must still reject cross-origin pages.

## What is still not proven

- A **signed and notarized** macOS application. The `.app` is a local build from
  the wrapper, exactly as `docs/PACKAGING.md` says.
- A **Windows** install. No Windows host was available.
- **Install scripts allowed** on npm 12 with an allowlist entry. The tested path
  is the stricter one (scripts ignored); enabling them should only add the
  postinstall permission fix.
- **Puppeteer's own Chromium download** in a clean cache (about 150 MB). The
  system-browser fallback makes it unnecessary here, and the download itself is
  npm's responsibility.
- **Load or soak behaviour.** No long-running or high-concurrency run was made,
  so no claim is made about sustained throughput.
- The **service installer against the real `launchd` domain.** It was run with a
  fake `launchctl` and a sandbox `HOME` so the live service on 11001 was not
  touched or replaced.

## Reversibility

- Nothing was deleted. Temporary installs live under `/tmp/tm-*` and the
  pre-sanitisation evidence copy is in `.quarantine/2026-11-20/`.
- The live service on `127.0.0.1:11001` and its `dlaude` session were not
  restarted, stopped, or reconfigured. The container was published on 11801 and
  named `townmouse-steward`; it was removed after the probe.

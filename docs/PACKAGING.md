# Packaging and Release

## Or: How To Ship A Workspace Without Asking A Subscription Committee For Permission

---

- **DOCUMENT CLASSIFICATION:** Technical / Moderate Chaos
- **DATE RECORDED:** 2026-11-15 — Late Enough To Be Useful
- **LOCATION:** The Garage, Brown County, Indiana
- **BEVERAGE:** Coffee that tastes like motor oil (fresh pot)
- **CURRENT STATE:** Gates assembled; signed release still pending

---

Townmouse is a local, self-hosted terminal and agent browser workspace. The
release unit is the server plus its static frontend, not a hosted SaaS. There is
no per-seat meter, no subscription treadmill, and no boardroom waiting to approve
a keyboard shortcut. You install it. You run it. You own the machine it runs on.

TerminalOne is the embedded terminal engine and remains its own product.
Townmouse owns the workspace, the browser surfaces, the sharing grants, the pane
workspace, and the release artifacts. The npm package, CLI, Docker image, data
directory, and macOS wrapper all carry the Townmouse name.

This document is the working plan until the first signed release. Everything
below is a gate, not a vibe.

## License

**AGPL-3.0-only.** The complete license is in `LICENSE`. If a person or company
runs Townmouse, or a modified version of it, as a network service, they must
offer the complete corresponding source to the people using that service.
Distributing the software or a derivative also requires the source. TerminalOne's
license and copyright notices remain with the portions it supplies.

That is not a suggestion, and it is not the kind of thing that gets waived
because a launch post would look better without it.

## Release channels

### 1. npm (primary, macOS/Linux)

- Package name: `townmouse`.
- `bin`: `townmouse` starts `src/server.js`, prints the URL, and opens a browser
  unless `--no-open` is passed.
- Runtime: Node 22.x preferred and declared as `>=22 <27`, npm, and a
  Chromium/Chrome binary for browser panes. `scripts/node-runtime.sh` prefers 22
  and falls back to any installed major where node-pty loads, because node-pty
  is built on Node-API.
- `postinstall` runs `scripts/prepare-native.sh`, which marks node-pty's macOS
  spawn helpers executable. **It is not enough on its own:** npm 12 skips
  dependency install scripts by default (`allow-scripts = [""]`), so the server
  also repairs the helper mode at startup (`src/pty-permissions.js`). An install
  with scripts ignored is the tested case.
- Browser panes resolve an engine in this order: `TERMINALONE_CHROME`,
  Puppeteer's downloaded build, then a system Chrome/Chromium/Edge/Brave.
  `GET /health` reports `browser.engine`, so an install without a browser says
  so instead of failing at the first pane.
- `npm run doctor` checks the Node version and native modules; `npm run repair`
  rebuilds node-pty if they do not match.
- `npm pack` is the release artifact; `npm publish` publishes it under a semver
  tag.
- `npx townmouse` is the no-install smoke path.

**Linux and npm 12.** npm 12 does not run dependency install scripts by default
(`allow-scripts = [""]`). node-pty ships prebuilds only for macOS and Windows,
so a Linux install that skipped scripts has no terminal engine. Build it
explicitly:

```sh
npm install --allow-scripts=node-pty townmouse
# or, in an existing install:
npm rebuild node-pty          # needs python3, make, and g++
npm run doctor                # native_modules=ok
```

The server refuses to start with that explanation rather than a stack trace when
the engine cannot load. The container channel needs no such step; the image
compiles node-pty during `npm ci`.

**Release automation — trusted publishing, not tokens.** Merging a version
bump to `main` triggers `.github/workflows/publish.yml`. If that version is not
yet on npm, the workflow runs the suite and package gate, publishes with npm
**Trusted Publishing** (GitHub's OIDC token stands in for a stored npm token),
tags the commit, and creates the GitHub release with the tarball and checksum
attached. A merge whose version is already published skips after one registry
read, so ordinary main updates do not re-release. Do not create an automation
token for CI; npm warns against that use, and a long-lived publish token is a
standing liability.

One-time bootstrap, because a trusted publisher is configured on an existing
package:

1. Publish the first version interactively (`npm login --auth-type=web`, then
   `npm publish --access public`, completing the second factor).
2. On npmjs.com, open the package → Settings. Under **Trusted Publisher**,
   choose **Add Trusted Publisher connection for GitHub Actions**: organization
   or user `CaptainPhantasy`, repository `townmouse`, workflow filename
   `publish.yml`, environment name blank.
3. From then on, merging a version bump to `main` publishes and releases
   automatically with provenance. Bump `package.json`, date the changelog, and
   merge; nothing else is needed.

The CLI surface is small on purpose:

```sh
npm ci
npm start
npx townmouse
townmouse --port 11002
townmouse --port=11002 --no-open
townmouse --help
townmouse --version
npm pack
npm publish
```

The server binds to `127.0.0.1`. The CLI does not turn off the loopback listener,
and neither should you.

### 2. Container (Linux home server)

The `Dockerfile` uses `node:22-alpine`, installs Chromium, sets
`PUPPETEER_SKIP_DOWNLOAD=1` and `TERMINALONE_CHROME=/usr/bin/chromium`, runs as
the `node` user, exposes `11002`, and declares volumes for both
`/home/node/.townmouse` (workspace, attachments, pane token) and
`/home/node/.config/terminalone` (voice settings).
It sets `HOST=0.0.0.0` for container port forwarding and
`TOWNMOUSE_CHROMIUM_NO_SANDBOX=1` because the container has no Chromium sandbox
setup; both are container-only choices. The host run keeps loopback binding and
the Chromium sandbox.

Build and run:

```sh
TOWNMOUSE_VERSION=$(node -p "require('./package.json').version") \
  GIT_REVISION=$(git rev-parse HEAD) \
  docker build \
    --build-arg TOWNMOUSE_VERSION="$TOWNMOUSE_VERSION" \
    --build-arg GIT_REVISION="$GIT_REVISION" \
    -t townmouse:"$TOWNMOUSE_VERSION" \
    -t townmouse:latest .
docker run --rm -p 127.0.0.1:11002:11002 -v townmouse-home:/home/node/.townmouse -v townmouse-config:/home/node/.config/terminalone townmouse
```

The host port may differ from the container port; the request boundary accepts
loopback hostnames on any port and still enforces same-origin. Publish only to
host loopback. Mount project directories explicitly; the terminal starts in
`/home/node`, not in your project. Health:

```sh
curl http://127.0.0.1:11002/health
```

`GET /health` returns `status: "ok"` plus the live session count. If it does not
answer, the container is not ready, and staring at the logs is cheaper than
guessing.

### 3. macOS application wrapper

`native/TownmouseApp.swift` is a WKWebView shell pointed at `TOWNMOUSE_URL`
(default `http://127.0.0.1:11002`). It probes `/health`. If nothing answers, it
tries a separately installed launcher and waits up to 12 seconds before showing
a startup error.

`scripts/install-service.sh` builds a local `Townmouse.app`, installs a launcher,
and writes the launcher path into the bundle so the wrapper can start the
backend. The installer scripts ship in the npm package, so this works from a
global or local install; it is still a local convenience build, not a signed
distribution.

**Service identity.** Townmouse's service is its own: launchd label
`com.floyd.townmouse`, port `11002`, launcher `townmouse`, bundle identifier
`com.floyd.townmouse`. TerminalOne, the engine Townmouse embeds, keeps
`com.floyd.terminalone`, port `11001` and the `t1` launcher, so the two products
can be installed side by side; nothing Townmouse's installer writes takes
TerminalOne's name, port or launcher. After `install-service.sh`, the `townmouse`
launcher on the internal disk comes first on `PATH` and is service-aware: it
starts the service when it is not healthy, then opens the workspace. It accepts
`--port <n>`, `--no-open` (or `--serve-only`), `--version` and `--help`.
`scripts/uninstall-service.sh` removes the service, the launcher and the app. It never removes a `townmouse` command the installer did not write, such as the one npm creates for the package, and the installer never overwrites one. The launcher and the icon always use port 11002: `PORT` set while running `install-service.sh` changes the service's port only, so leave the service on 11002.

**Upgrading from 0.2.x.** Those versions installed the service as
`com.floyd.terminalone` on port 11001 and wrote their launcher as `t1`, so on a
Mac with TerminalOne, `t1` and TerminalOne.app opened Townmouse. The 0.3.0
installer and uninstaller stop and remove that service, and remove the `t1`
launcher 0.2.x wrote, when they find them; a TerminalOne service or launcher is
never touched. If 0.2.x displaced TerminalOne, run TerminalOne's own
`scripts/install-service.sh` afterwards to restore it.

A distributable `.app` must bundle or launch the Node server or npm CLI, use a
stable data directory, and be codesigned and notarized. Until that is done, there
is no signed downloadable macOS release. The wrapper is a WebView with
ambitions, and it knows it.

### 4. Phone/tablet PWA over the tailnet

- The app is installable from the browser. The shell and workspace load from the
  local server; live PTYs and browser pages still need that server.
- Publish with `tailscale serve` on a claimed port, bound to loopback. Never
  expose an owner tool with Funnel without explicit approval.
- An HTTPS proxy must require authentication before it forwards any request,
  including WebSocket upgrades. It must preserve the public `Host` header and
  the browser `Origin`. `TERMINALONE_TRUSTED_ORIGINS` only allows an address; it
  does not add authentication.

```sh
TERMINALONE_TRUSTED_ORIGINS=https://townmouse.example.com npm start
```

The `TERMINALONE_` prefix on that variable and on `TERMINALONE_CHROME` is a
compatibility name the runtime still reads. Renaming an environment variable is
a breaking change, not a rebranding exercise. The product name in the UI, package,
CLI, and data directory is Townmouse.

## Versioning

- Semantic versioning: `MAJOR.MINOR.PATCH`.
- Feature work lands on `feat/*`; releases are tagged from `main`.
- `CHANGELOG.md` gets a dated section for every release. The punch list is not a
  changelog.
- Package version, Git tag, Docker tag, and release notes must agree. If they
  disagree, it is not a release; it is a rumor with a download link.

## Release gates

1. `npm ci` from a clean checkout.
2. `npm test` green, including `test:panes`, `test:agent-control` (36 journeys),
   and the security suite.
3. Four-pane UI acceptance: 2 terminals + 2 browsers, no console errors.
4. Attachment test: image upload once, path in PTY, URL serves 200.
5. Input test: a burst of keystrokes produces one ordered input POST.
6. Codex code and security review has no unresolved findings on the release
   commit.
7. `npm pack --dry-run` contains `bin/`, `src/`, `public/panes.*`,
   `scripts/panes`, `LICENSE`, and no secrets or local evidence.
8. `npm run test:package` green: the packed tarball installs into a clean
   project with `--ignore-scripts`, starts, serves its engine assets, creates
   `~/.townmouse` with safe modes, spawns a PTY, runs a tracked command, and
   opens a browser pane. This is the gate that catches a dev tree that is not
   the application.
9. Docker image builds and answers `/health` on loopback, including when the
   published host port differs from the container port.

A release that skips a gate is a branch with a nicer tag. The cats are not
impressed, and Bella has already walked across the checklist.

## Data and backup

- `~/.townmouse/pane-token` — workspace API token, mode 600. The server creates
  it on first run if it is missing.
- `~/.townmouse/attachments/<YYYYMMDD>/` — dropped files, directories mode 700
  and files mode 600, with a 25 MB per-upload limit.
- Project files live wherever the member mounted them; never inside the package
  directory.
- Back up `~/.townmouse` before upgrades. Docker uses the `townmouse-home`
  volume for the same data.

```sh
cp -a ~/.townmouse ~/.townmouse.backup-$(date +%Y%m%d)
```

## Upgrade and rollback

- npm: publish under a new version; roll back with
  `npm install -g townmouse@<previous>`.
- Docker: keep immutable tags (`townmouse:<version>`) and a moving `latest`; roll
  back by running the previous tag.
- Keep the previous release artifact and its checksums. Data is compatible within
  a minor version; any breaking data change needs a migration note.

A rollback path you have not tested is a hope with a shell prompt.

## Known gaps before a public release

- The macOS wrapper does not bundle the server yet; it can only start a
  separately installed launcher.
- Browser panes do not yet bridge native file pickers or downloads.
- PWA offline coverage is the shell only; live PTYs and browser pages require the
  server.
- No Windows-signed installer.
- The pane workspace and the legacy single-browser workspace still coexist; the
  legacy Copy-connection UI is compatibility-only.

None of these are secrets. Shipping around them without saying so would be.

## Release checklist

- [ ] Version and changelog updated.
- [ ] Clean `npm ci` and `npm test`.
- [ ] `npm run test:package` green: the packed tarball installs and runs.
- [ ] Pane UI/attachment/input evidence refreshed.
- [ ] Codex review clean on the release commit.
- [ ] `npm pack` inspected and checksummed.
- [ ] Docker image built and smoke-tested.
- [ ] Version bumped and changelog dated; merge to `main` runs `publish.yml` (npm publish, tag, GitHub release) once trusted publishing is configured.
- [ ] Backup/rollback instructions included.

If it is not checked, it is not shipped. That is the entire policy.

```text
┌──────────────────────────────────────────────────────────┐
│  DOCUMENT METADATA                                        │
├──────────────────────────────────────────────────────────┤
│  Classification:   Technical / Release                    │
│  Cat Supervision:  Bella, asleep on the checklist         │
│  Bowser Status:    Monitoring routers, not releases       │
│  "I Don't Suck":   PASS                                   │
│  Corporate Feelings: HURT (intended)                      │
└──────────────────────────────────────────────────────────┘
```

**DOCUMENT ENDS**

*— Build/Release, Floyd's Labs*
*The Garage — Brown County, Indiana*
*"A release is a promise you can install from a clean checkout."*

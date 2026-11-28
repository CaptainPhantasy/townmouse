# Townmouse — Pre-Release Notes

## Or: The Workspace That Refused To Choose Between A Terminal And A Browser

---

**DOCUMENT CLASSIFICATION:** Pre-Release / Barely Containing Itself
**DATE RECORDED:** 2026-11-15 — pre-release, obviously
**ENGINE HISTORY:** TerminalOne v1.0.0 — recorded 2026-06-22, 2:47 AM
**LOCATION:** The Garage, Brown County, Indiana
**BEVERAGE:** Coffee that completed its arc from "bold roast" to "war crime"
**CURRENT STATE:** Two surfaces, four panes, an agent control surface, 39 engine features deep, and a mouse with a monocle

---

## What Townmouse Is

A terminal and agent browser workspace. It runs a real shell and real browser pages on your machine, in one workspace, so you or an agent can work in both.

The terminal is the house. The browser is the town. The mouse is the one holding the terminal sign.

Townmouse embeds TerminalOne as its terminal engine. TerminalOne remains the standalone PTY — the canonical small engine. Townmouse owns the browser workspace, the agent browser, sharing grants, and the workspace interface.

---

## What's In The Box

**Terminal.** A real PTY through TerminalOne: your shell, session resume, key bar, themes, and the existing feature modules. The session pill opens a switcher with every named shell and a New session action; the footer shows the shell, working directory, and uptime.

**Browser tabs.** Every tab is an isolated Chromium context on the terminal host. Human tabs start private. Share a tab read-only, or hand over control through a bearer token.

**Agent browser.** A separate context that keeps running when its view is hidden. In the pane workspace the agent gets native access; the legacy single-browser view still documents its bearer-token path.

**Pane workspace.** `/panes.html` holds four panes per tab — terminal or browser — and the orchestrator agent creates and drives them through the injected `TOWNMOUSE_API` and `scripts/panes` interface. No connection code is copied between the browser and the terminal.

**Three layouts.** Desktop sidebar, tablet rail, phone bottom navigation. Phone shows one task surface at a time; its key bar collapses to one row and expands on demand.

**Installable.** Add it to your home screen on iPad or iPhone; the shell and workspace load from the local server.

---

## What's NOT In The Box

- A subscription form
- An "Upgrade to Pro" modal
- A data collection pipeline
- A trust dialog asking permission to run on the device you already own
- Analytics
- A board of directors

---

## Why It Exists

A terminal and a browser are the two halves of getting work done on a machine. Townmouse puts them in the same workspace so you and an agent can see the same shell and the same page without shuttling between windows, tabs, and somebody's idea of a dashboard.

That is the pitch. The rest is details.

---

## 0.3.0 — Its own name, place and button (2026-11-27)

Townmouse and TerminalOne, the engine it embeds, can now be installed on one Mac without Townmouse taking TerminalOne's place:

- **Own service identity.** The macOS service is `com.floyd.townmouse` on port 11002, with a `townmouse` launcher and app identifier `com.floyd.townmouse`. TerminalOne keeps `com.floyd.terminalone`, port 11001 and `t1`.
- **Default port 11002** for the server, the `townmouse` command, the macOS wrapper and the container. Set `PORT` to use another port.
- **Upgrading retires the 0.2.x service** that sat under TerminalOne's label, and never touches a TerminalOne service or launcher. If 0.2.x displaced TerminalOne, run TerminalOne's `scripts/install-service.sh` afterwards.

## 0.2.1 — Security fixes (2026-11-21)

A patch release for two boundaries found after 0.2.0 was tagged:

- **Passwords never leave a read catalog.** View-only sharing now returns a redacted password field, matching what the screenshot and page text already do.
- **Wait patterns cannot stall the server.** Browser URL waits are literal; terminal wait regexes reject nested or stacked quantifiers and are length-capped.

`v0.2.0` remains tagged for the record; use 0.2.1.

## 0.2.0 — What Changed (2026-11-21)

**Agent control.** Browser panes are driven by role and name across cross-origin frames and open shadow roots, not only by coordinates. Every observation carries an id, capture time, viewport, scroll offset, address, and title; an action whose target moved is refused with "look again". Terminal panes report program, agent, and command status separately, and ordinary commands run as tracked jobs with exit codes. `pane read` is clean screen text by default; `--raw` keeps the terminal data.

**Installation.** The packed artifact now installs and runs as an application: hoisted dependency layouts resolve, the macOS spawn helper is repaired at startup, Node 22–26 are accepted, a remapped container port works, and browser panes fall back to an installed Chrome or Chromium. Linux users on npm 12 must allow the node-pty build; `docs/PACKAGING.md` gives the exact command.

**Standard view.** One compact address row, agent access behind Share, a collapsible chrome strip that gains 112–180 px of page, and the mascot only in the navigation rail. The Panes view is unchanged.

---

## Where It Came From

Townmouse was seeded on 2026-11-14 from TerminalOne commit `dd0cbde6` ("Preserve recovered TerminalOne glass browser workspace"), originally branch `dot/recover-terminalone-20261114`. The engine stays the canonical simple PTY. The browser workspace, agent browser, view/control grants, and workspace interface live here; they do not go upstream into TerminalOne.

Product version: 0.3.0, released 2026-11-27.

---

## Appendix — Engine History: TerminalOne v1.0.0 Pre-Release, 2026-06-22

The notes below belong to the engine Townmouse embeds. They are preserved from "TerminalOne v1.0.0 — Pre-Release Notes," subtitled "Or: The Terminal App That Got Tired Of Waiting For Permission," recorded on 2026-06-22. Version, date, numbers, and cats stay exactly where history put them.

### The pitch, as it was

A terminal emulator that lives in your browser.

That's it. That's the pitch. No App Store. No provisioning profile. No $99/year to put a command prompt on your own iPad. No subscription that auto-renews while you sleep. You run a command, a browser tab opens, and you have a real terminal — PTY, scrollback, the works — on whatever screen is in front of you.

Thirty-nine features deep. One port. Zero monthly invoices.

### Why the engine had to exist

Because somewhere along the line, the industry decided that a terminal emulator — literally the oldest category of software application, older than the mouse, older than the GUI, older than most of the people reading this — was worth a monthly subscription.

A terminal. A subscription. For a terminal.

We stared at that for a while. Then Bella stared at us. Then we started coding.

The engine exists because the most basic tool in computing should not be trapped behind a paywall, an app store review board, and a "trusted developer" certificate that you have to renew like a driver's license for software you already own.

### The numbers, as counted then

| Claim | Reality |
|---|---|
| Feature modules shipped | 38 |
| ShellFish-parity features | 20, all passing |
| Monthly subscription | $0 |
| App Store approval needed | None |
| Ports required | 1 (11001) |
| Keystrokes to launch | 2 (`t1`) |
| Cats involved in QA | 1 (Bella, who walks on the actual keyboard being tested) |

### What was in the engine box

**Connectivity.** WebSocket to a real PTY. Reconnects when the network drops. Stays alive when it shouldn't. Health-checks itself like a hypochondriac.

**Sessions.** Multi-session tabs. Rename them. Reorder them. Switch with a swipe. Lock one when you don't trust yourself not to fat-finger `rm` into it.

**Input.** Configurable on-screen key bar for tablets. Hardware keyboard shortcuts for people who own a real keyboard. Haptic feedback for people who need to feel the void they're typing into. Stylus support for reasons we'll explain later. (We don't have a good reason. Bowser walked across the trackpad and we committed.)

**Clipboard.** OSC 52 bridge. Copy from the server's clipboard to yours. Select-all. Paste. The things a terminal is supposed to do.

**Search.** Regex. Case-sensitivity toggle. The search box that was missing from every "modern" terminal for some reason.

**Sessions, again, because there's more.** Autosave scrollback to localStorage. Reload the page, get your terminal back. Export the whole thing as a text file when you need to prove to someone what you typed.

**Notifications.** OSC 777 → browser notifications. Your build finishes, your browser tells you. Your script crashes, your browser tells you. Bella knocks your coffee over, your browser cannot help you.

**Themes.** Full theme catalog. System dark/light detection. A command palette. Font sizing with pinch-to-zoom because reading 8pt output at 2 AM is how you go blind.

**Status.** Footer with uptime, latency, shell type. The terminal tells you how it's feeling. It's usually fine. It's lying.

### Known behaviors

- **Bowser** (Technical Director, skinny, monitors routers) has been observed sitting on the keyboard during session-switch testing. Sessions switched. This is either a feature or a fireable offense. We haven't decided.
- The engine's install script writes a macOS LaunchAgent that auto-starts it at login. This is intentional. You wanted an always-on terminal. You got one. If you didn't want one, there's an uninstall script. We're not clingy.
- PWA install works on iPad. Once installed, it runs standalone — no browser chrome, no address bar, just the terminal. The way computing was supposed to work before someone invented the address bar.

### How the engine started

```
./start.sh
```

Or if you installed the service: type `t1` and press Enter.

That's the entire installation section. We refuse to make it longer.

*"We built a terminal because someone put a terminal behind a paywall. That's the whole story."* — the engine's pre-release notes, 2026-06-22

---

## How To Start Townmouse

```sh
git clone https://github.com/CaptainPhantasy/townmouse.git
cd townmouse
npm ci
npm start
```

Open `http://localhost:11002`. The server binds to `127.0.0.1` by default. A terminal can run commands with your account's permissions.

---

## License

Townmouse is AGPL-3.0-only. If you run this software, or a modified version of it, as a network service, you must offer the complete corresponding source to the people who use it. Distributing it also requires the source. TerminalOne's license and copyright notices remain with the portions it supplies.

---

┌──────────────────────────────────────────────────────────┐
│  DOCUMENT METADATA                                        │
├──────────────────────────────────────────────────────────┤
│  Classification:   Pre-Release Notes                      │
│  Product:          Townmouse 0.3.0 (2026-11-27)           │
│  Engine:           TerminalOne v1.0.0 (2026-06-22)        │
│  Cat Supervision:  Bella Approved (keyboard walked on)    │
│  Bowser Status:    Monitoring routers, sitting on tabs    │
│  "I Don't Suck":   ✅ PASS                                │
│  Corporate Feelings: HURT (intended)                      │
│  Subscription Treadmill: OFF                              │
└──────────────────────────────────────────────────────────┘

**DOCUMENT ENDS**

*— Builder, Floyd's Labs*
*Brown County, Indiana — The Garage*
*"We built a workspace because the terminal and the browser were already sharing a desk. We just stopped making them sit in separate rooms."*

# Townmouse

<img src="public/brand/townmouse-monocled.webp" alt="Townmouse, the monocled colonial mouse holding a terminal sign" width="260">

Townmouse is a terminal and agent browser workspace. It runs a real shell and real browser pages on your machine, in one workspace, so you or an agent can work in both.

The monocled colonial mouse is the brand character: the terminal is the house, the browser is the town. Townmouse embeds TerminalOne as its terminal engine. TerminalOne remains the standalone PTY; Townmouse owns the browser workspace, the agent browser, sharing grants, and the workspace interface.

## What it does

- **Terminal.** A real PTY through TerminalOne: your shell, session resume, key bar, themes, and the existing feature modules. The session pill opens a switcher with every named shell and a New session action; the footer shows the shell, working directory, and uptime.
- **Browser tabs.** Each tab is an isolated Chromium context on the terminal host. Human tabs start private. A tab can be shared read-only or with control through a bearer token.
- **Agent browser.** A separate context that keeps running when its view is hidden. Copy its connection into your terminal agent.
- **Three layouts.** Desktop sidebar, tablet rail, phone bottom navigation. Phone shows one task surface at a time; its key bar collapses to one row and expands on demand.
- **Installable.** Add it to your home screen on iPad or iPhone; the shell and workspace load from the local server.

## Requirements

Node.js 22.x and npm on macOS or Linux. Puppeteer is a production dependency because browser tabs are real Chromium pages; `npm ci` downloads a compatible Chromium. Set `TERMINALONE_CHROME` to use an operator-installed binary.

## Run it

```sh
git clone https://github.com/CaptainPhantasy/townmouse.git
cd townmouse
npm ci
npm start
```

Open `http://localhost:11001`. The server binds to `127.0.0.1` by default. A terminal can run commands with your account's permissions.

### Use it from a phone or tablet

Put an HTTPS proxy or tunnel in front that requires you to sign in before it forwards **any** request, including WebSocket connections. Then start Townmouse with the exact public address:

```sh
TERMINALONE_TRUSTED_ORIGINS=https://townmouse.example.com npm start
```

The proxy must forward to `http://127.0.0.1:11001`, preserve the public `Host` header and browser `Origin`, and support WebSocket upgrades. This setting allows an address; it does not add authentication. Keep the server on loopback and front it with authentication before exposing it.

## Browser workspace

Open **Browser** or a new tab. Enter a web address, search phrase, or localhost URL. Navigation, clicks, typing, and scrolling happen in the real page on the terminal host, not in an iframe.

On a phone or tablet, use **Share** to reach agent access, Copy connection, Read page, and Close tab. On a phone, the tab strip, address bar, and Share sit together at the bottom above the remote keyboard; the address bar carries back, forward, reload, and Go.

Human tabs start Private. Choose View only or Allow control, then Copy connection. Changing the permission rotates the token. Choosing Private rejects subsequent token requests. Closing a tab destroys its context.

The agent browser is a separate context with control granted. Hide view keeps it running headless; reopen Agent to observe the same context.

## Security

- The terminal runs with your account's permissions. Keep the server on loopback.
- Browser tabs are isolated Chromium contexts, not your personal Safari or Chrome profile. They are not a security boundary against a process that already has unrestricted access to the host.
- Grants protect cooperative API clients. They do not protect against a hostile process with host access.
- Browser sessions and grants are in memory; restarting the server closes them.
- Browser audio, file upload/download dialogs, extensions, and password-manager integration are not provided.
- At most eight browser contexts can remain open.

## Relationship to TerminalOne

TerminalOne is the canonical terminal engine and stays a small, standalone PTY. Townmouse adds the workspace and browser layers. Browser-workspace features do not go upstream into TerminalOne. See [TOWNMOUSE.md](TOWNMOUSE.md) for the product boundary and origin.

## Development

```sh
npm start              # run the workspace
npm test               # engine suite: boundaries, input, smoke, features, voice, responsive
npm run test:workspace # browser workspace journeys (starts its own preview site)
```

Design notes live in [DESIGN.md](DESIGN.md). The product uses the Legacy Design Studio's Frontend Design workflow with the Open Design anti-AI-slop review as its supplemental checklist.

## Status

Version 0.1.0, the first product cut. The terminal engine is TerminalOne; the workspace and browser layers are new. Known limits are listed under Security.

## Credits

Built at [Floyd’s Labs](https://floydslabs.com). The creator credit in the app uses the Floyd’s Labs neon-cats mark.

## License

MIT. TerminalOne's license and copyright notices remain with the portions it supplies.

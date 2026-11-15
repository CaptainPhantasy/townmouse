# Security Policy

## Or: Keep The Shell In The House And The Browser In The Town

Townmouse is a terminal and agent browser workspace. It runs a real shell and real browser pages on your machine, with your account's permissions — that is the whole point, and also the whole risk. It embeds TerminalOne as its terminal engine. Treat the workspace as an administrative tool for a host you trust.

Written in the garage in Brown County, Indiana. The coffee is terrible. The rules are not.

## Supported Versions

Security fixes land on `main`, or they do not land. Only the latest commit on the `main` branch is supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |
| < main  | :x:                |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.** A public issue tells everyone, including the people you would rather not tell.

Report vulnerabilities privately via **GitHub Security Advisories**:

1. Go to the [Security tab](https://github.com/CaptainPhantasy/townmouse/security) on the Townmouse repository.
2. Click **Report a vulnerability**.
3. Describe the issue in detail: what is affected, how to reproduce it, and the potential impact.

### What to expect

- **Response:** Best-effort. No guaranteed SLA. We will not pretend otherwise.
- **Disclosure:** Coordinated disclosure — a fix will ship before the advisory is published.
- **Credit:** Reporters are credited in the advisory and changelog unless they request anonymity.

### Out of scope

- Issues in third-party dependencies (report upstream to the dependency maintainers)
- Social engineering or phishing attacks
- Physical access to the host machine
- Vulnerabilities that require the attacker to already have shell access to the machine running Townmouse

## Security model

- Townmouse binds to `127.0.0.1` by default. Keep it on loopback. An HTTPS proxy or tunnel in front must authenticate **every** request before it forwards it, including WebSocket upgrades. `TERMINALONE_TRUSTED_ORIGINS` allows an address; it does not add authentication.
- A terminal runs commands with your account's permissions. Browser tabs are isolated Chromium contexts, not your personal Safari or Chrome profile.
- View and control grants protect cooperative API clients. They are not a security boundary against a process that already has unrestricted access to the host.
- Browser sessions and grants are held in memory; restarting the server closes them. At most 32 browser contexts can remain open.
- Browser audio, file upload/download dialogs, extensions, and password-manager integration are not provided.

*Townmouse is AGPL-3.0-only.*

---

*— Floyd's Labs, The Garage*
*"Bowser watches the router. We watch the door."*

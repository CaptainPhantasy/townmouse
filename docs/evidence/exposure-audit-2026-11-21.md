# Exposure audit — tracked media and published surface (2026-11-21)

**Scope:** all 83 tracked images, every tracked document, the full 140-commit history, and the public release/npm surface.
**Trigger:** the owner's instruction that this audit must precede commits and publishing, not follow them.

## Method

- Text: `git grep` across the tree and `git log -p --all` across history for credentials, private keys, tokens, internal hosts and IPs, and home paths.
- Images: all non-SVG tracked images OCR'd with `tesseract` (1673 lines of extracted text), then every evidence category reviewed visually — browser, agent browser, tools, settings, session, pane workspace, share/phone, confirm dialog, mascot correction, split handle, phone chrome, brand art.
- Surface: repository visibility, branches, tags, releases, assets, and the npm package.

## Result

- **No credentials.** No private keys, API keys, npm tokens, passwords, or JWTs in the tree or in history.
- **No private life content in the images.** The screenshots are TownMouse UI and local fixture pages: no private browser tabs, notifications, messages, documents, faces, addresses, emails, or client names.
- **No client or business material** beyond the public Floyd's Labs brand.

## Findings (already public)

| Finding | Where | Severity |
| --- | --- | --- |
| Account name and host exposed in terminal prompts and footers (`floyd`, `Mac-mini`, `/Users/floyd`) | Evidence screenshots: `docs/evidence/browser-*.png`, `agent-*.png`, `panes/*.png`, `session-*.png`, `surface-protection-2026-11-18/*.png` | Low — identity, not credentials; the app itself displays these to its owner |
| Tailnet hostname and port (`mac-mini.<tailnet>.ts.net:8463`) | `docs/evidence/tailnet-2026-11-18.md` | Low — resolvable only inside the tailnet |
| Session ids and a loopback port in screenshots | Various evidence images | Negligible |

## Remediation options (owner's decision)

1. **Accept.** The account name and host are already public, and the app displays them to its owner; nothing here is a credential.
2. **Sanitize the current tree.** Mask the tailnet host in the evidence doc and replace the screenshots that show prompts with cropped or masked versions. History retains the originals.
3. **Rewrite history** and force-push to remove the old blobs. This breaks existing clones and caches may persist; only worth it for a real secret, not a hostname.

No image was quarantined: none failed the audit.

## Process change

The exposure audit is now a mandatory step in the global commit process (`~/.claude/CLAUDE.md`, `~/.config/dlaude/CLAUDE.md`) and runs **before the first commit that can leave the machine**, before any visibility change, and before any publish — with every tracked image opened and looked at, not merely grepped.

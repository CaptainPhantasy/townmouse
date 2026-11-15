# TOWNMOUSE evidence

Captured 2026-11-15 from the TOWNMOUSE workspace at
`CaptainPhantasy/townmouse`, branch `feat/townmouse-workspace-ui`.

## States

Each device has the default terminal surface, the session menu, the browser with
a loaded local page, the tools sheet with the active tool row visible, the
settings dialog, the agent browser tab, and the destructive confirmation. Phone
and tablet also capture a two-shell Sessions sheet and the sharing row. Desktop
and wide capture the split browser, sidebar tabs, and tools dialog.

- `default-phone.png` — 393×852, terminal, session pill, and single-row key bar
- `session-phone.png` — 393×852, session menu before creating a shell
- `sessions-phone.png` — 393×852, two shells with the current one marked
- `browser-phone.png` — 393×852, bottom tab strip, address bar, Share, and remote keyboard
- `share-phone.png` — 393×852, sharing row open above the address bar
- `tools-phone.png` — 393×852, grouped Tools sheet with the active Fullscreen row
- `settings-phone.png` — 393×852, restyled settings dialog
- `agent-phone.png` — 393×852, agent tab selected with Agent/Control state
- `confirm-phone.png` — 393×852, in-design destructive confirmation
- `default-tablet.png` — 820×1180, labeled rail and two-row key grid
- `session-tablet.png` — 820×1180, session menu
- `sessions-tablet.png` — 820×1180, two shells with the current one marked
- `browser-tablet.png` — 820×1180, split terminal/browser with 44pt handle
- `share-tablet.png` — 820×1180, sharing row open
- `tools-tablet.png` — 820×1180, grouped Tools sheet with the active row
- `settings-tablet.png` — 820×1180, restyled settings dialog
- `agent-tablet.png` — 820×1180, agent tab selected
- `confirm-tablet.png` — 820×1180, destructive confirmation
- `default-desktop.png` — 1440×900, sidebar and terminal
- `session-desktop.png` — 1440×900, session menu
- `browser-desktop.png` — 1440×900, horizontal split, sidebar tabs, sharing
- `tools-desktop.png` — 1440×900, grouped Tools dialog
- `settings-desktop.png` — 1440×900, restyled settings dialog
- `agent-desktop.png` — 1440×900, full human and agent tab titles
- `confirm-desktop.png` — 1440×900, destructive confirmation
- `default-wide.png` — 1920×1080, widescreen terminal

## How to reproduce

From the repository root:

```sh
npm ci
npm test               # engine suite and responsive layouts
npm run test:workspace # terminal, tabs, sharing, agent, split, expand, reduced motion
```

The journey test prints a JSON result for 393×852, 820×1180, 1440×900, and
1920×1080 and writes its own raw screenshots under `evidence/` (ignored by Git).

## Design workflow

The product follows the Legacy Design Studio's Frontend Design workflow with
the Open Design anti-AI-slop guide as the supplemental review. The three
layouts, named motions, and anti-slop review are recorded in
[`../../DESIGN.md`](../../DESIGN.md).

## Grade

The adversarial secondary-model grade is recorded in the stewardship
`EVIDENCE.md` outside the repository. Do not treat a green suite as the design
grade; they are separate checks.

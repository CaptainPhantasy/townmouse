# Phone chrome condensation and auto-collapse — 2026-11-15

The terminal and browser are the primary surface. On a phone the control rows
keep 44pt targets but lose the padding that was stealing content space.

Measured at 393×852:
- Browser chrome before: message 49, tab strip 67, address 52, type row 56.
- Browser chrome after: message 28, tab strip 45, address 44, type row 46.
  Canvas grew from 542 to 601px.
- Terminal chrome: header 57→53, key bar 53→49; the duplicate empty tablet key
  row was hidden. Terminal content grew from 639 to 664px.
- After seven seconds without a touch, every row except the 64px bottom
  navigation collapses. Terminal content and browser canvas both reach 766px.
- The first touch on the content only wakes the chrome. The bottom navigation
  stays visible and operable while collapsed; tapping it wakes and switches.
- Desktop never enters the collapsed state.

Also fixed: a closed `.workspace-drawer` (notably `#close-confirm`) was still
`display:flex` at `opacity:0` with `pointer-events:auto`, invisibly covering the
bottom navigation. Closed drawers are now `pointer-events:none`.

`chrome-idle-test.cjs` is the archival focused verification script. Source
screenshots are in `stewardship/screens/pass17/`.

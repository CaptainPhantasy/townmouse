# Draggable split evidence — 2026-11-15

The terminal/browser separator is draggable in both layouts.

- Desktop 1440×900: vertical separator. Dragging right moved the terminal from
  552px to 692px and the browser from 610px to 470px. Bounds clamp at a 320px
  terminal and a 420px browser; far-right stopped at 63%, far-left at 27%, with
  `scrollWidth === innerWidth` (no horizontal overflow).
- Tablet 820×1180: horizontal separator. Dragging down moved the terminal from
  345px to 438px and the browser from 704px to 611px. Range is 25–75% browser
  share.
- Phone 393×852: the handle is hidden because the browser uses the whole frame.
- Keyboard: ArrowLeft/ArrowRight on desktop, ArrowUp/ArrowDown on tablet,
  Home/End to the bounds.

`split-test.cjs` and `split-bounds.cjs` are archival copies of the focused
verification scripts. Source screenshots are in `stewardship/screens/pass16/`.

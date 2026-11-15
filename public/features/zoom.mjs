/**
 * Zoom / pinch-to-zoom font size for TerminalOne.
 *
 * ShellFish parity: pinch to zoom the terminal text.
 */
const LS_ZOOM = 'terminalone.fontSize';

function responsiveDefault() {
  const width = window.innerWidth;
  if (width <= 430) return 11;
  if (width <= 820) return 12;
  return 14;
}

export function init(T1) {
  const stored = T1.storage.get(LS_ZOOM, null);
  const hasStored = stored !== null && stored !== undefined && stored !== '';
  let current = hasStored ? (parseInt(stored, 10) || responsiveDefault()) : responsiveDefault();

  function apply(size, persist = false) {
    current = Math.max(8, Math.min(32, size));
    const term = T1.term;
    if (term) {
      term.options.fontSize = current;
      T1.fit();
    }
    if (persist) T1.storage.set(LS_ZOOM, String(current));
  }

  // Listen to keyboard-shortcuts action events.
  window.addEventListener('t1:action', (e) => {
    const { action } = e.detail || {};
    if (action === 'font-increase') { apply(current + 1, true); T1.toast(`Font size ${current}px`); }
    if (action === 'font-decrease') { apply(current - 1, true); T1.toast(`Font size ${current}px`); }
    if (action === 'font-reset') { T1.storage.del(LS_ZOOM); apply(responsiveDefault()); T1.toast('Font size reset'); }
  });

  // With no explicit choice, follow the viewport across rotations and window
  // resizes so a phone keeps readable columns instead of 14px at 393px.
  window.addEventListener('resize', () => {
    if (!T1.storage.get(LS_ZOOM, null)) apply(responsiveDefault());
  });

  // Pinch-to-zoom on the terminal element.
  T1.onTermReady((term) => {
    const el = term.element;
    if (!el) return;
    let startDist = 0;
    let startSize = current;
    function onTouchStart(e) {
      if (e.touches.length === 2) {
        startDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        startSize = current;
      }
    }
    function onTouchMove(e) {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const ratio = dist / (startDist || 1);
        apply(Math.round(startSize * ratio), true);
      }
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  });

  // Make sure the initial persisted zoom is applied after term is ready.
  T1.onTermReady(() => apply(current));
}

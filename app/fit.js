/**
 * Text that has to fit its box (card names, type lines, rules text, labels): rather
 * than being cut off, it's set smaller until it fits. Elements with the `fit` class
 * are fitted after `fit(root)` is called on something containing them, in one batch
 * per frame, and again once the web fonts have loaded (they change the measurements).
 *
 * The box is what the CSS allows: a width, and a height or a line clamp. A
 * `data-min` attribute sets the smallest font size (in px). Inside an element with
 * `data-fit-hide` (a hand card mostly covered by the next), text that can't fit even
 * at that size is hidden (class `unfit`) rather than cut off.
 */
const pending = new Set();
let scheduled = false;

/** Fits the `.fit` elements in `root` (and `root` itself), on the next frame. */
export function fit(root) {
  if (!root) return;
  pending.add(root);
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(flush);
}

function flush() {
  scheduled = false;
  const roots = [...pending];
  pending.clear();
  for (const root of roots) {
    if (!root.isConnected) continue;
    if (root.classList?.contains('fit')) fitText(root);
    for (const el of root.querySelectorAll('.fit')) fitText(el);
  }
}

const overflows = (el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;

/**
 * Shrinks `el`'s font until its text fits. Returns false when it can't be measured
 * (not laid out, e.g. hidden); it's left for a later call.
 */
export function fitText(el) {
  if (!el.isConnected || !el.clientWidth) return false;
  el.style.fontSize = '';
  const full = parseFloat(getComputedStyle(el).fontSize);
  const hideable = Boolean(el.closest('[data-fit-hide]'));
  // Where it can be hidden instead, it isn't made smaller than can be read.
  const min = Math.max(parseFloat(el.dataset.min) || Math.max(5.5, full * 0.5), hideable ? 6.5 : 0);
  let size = full;
  el.classList.remove('unfit');
  while (size > min && overflows(el)) {
    size = Math.max(min, size - Math.max(0.25, size * 0.05));
    el.style.fontSize = `${size.toFixed(2)}px`;
  }
  if (hideable && overflows(el)) el.classList.add('unfit');
  return true;
}

// The fallback font measures differently: fit everything again once the fonts are in.
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.ready.then(() => fit(document.body));
  document.fonts.addEventListener?.('loadingdone', () => fit(document.body));
}

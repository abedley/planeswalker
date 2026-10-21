/** Small DOM helpers: no framework, just elements. */

/**
 * Creates an element: `h('div.card.green', { onclick, dataset: {id}, style: {...} }, ...children)`.
 * Children can be strings, nodes, arrays, or null/false (skipped).
 */
export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = {};
  }
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className += (el.className ? ' ' : '') + value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') Object.assign(el.style, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'html') el.innerHTML = value;
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replaces an element's children. */
export function setChildren(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

/** Sets text only when it changed (cheap re-renders). */
export function setText(el, text) {
  const value = String(text);
  if (el.textContent !== value) el.textContent = value;
}

/** Toggles a class only when needed. */
export const toggle = (el, name, on) => {
  if (el.classList.contains(name) !== Boolean(on)) el.classList.toggle(name, Boolean(on));
};

/**
 * Makes `parent`'s element children exactly `wanted` (in order), moving existing
 * ones rather than re-creating them.
 */
export function reconcile(parent, wanted) {
  let cursor = parent.firstElementChild;
  for (const el of wanted) {
    if (el === cursor) {
      cursor = cursor.nextElementSibling;
      continue;
    }
    parent.insertBefore(el, cursor);
  }
  while (cursor) {
    const next = cursor.nextElementSibling;
    cursor.remove();
    cursor = next;
  }
}

/** Resolves after `ms` milliseconds. */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether the user asked for less motion. */
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Calls `onTap` for a short tap and `onLong` after holding (for inspecting cards).
 * Works with mouse and touch; a moved finger cancels both.
 */
export function onPress(el, { onTap, onLong, longMs = 450 }) {
  let timer = null;
  let start = null;
  let longFired = false;
  el.addEventListener('pointerdown', (event) => {
    if (event.button > 0) return;
    start = { x: event.clientX, y: event.clientY };
    longFired = false;
    if (onLong) {
      timer = setTimeout(() => {
        longFired = true;
        onLong(event);
      }, longMs);
    }
  });
  const cancel = () => {
    clearTimeout(timer);
    start = null;
  };
  el.addEventListener('pointermove', (event) => {
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancel();
  });
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', () => clearTimeout(timer));
  el.addEventListener('pointerup', (event) => {
    clearTimeout(timer);
    if (start && !longFired) onTap?.(event);
    start = null;
  });
  el.addEventListener('contextmenu', (event) => event.preventDefault());
}

/**
 * Battle effects. Everything animates only `transform` and `opacity`, so it runs
 * on the compositor and stays smooth on phones. `speed` scales durations (lower is
 * faster). Each function returns a promise for when it's done.
 */
import { h } from '../dom.js';

const done = (animation) => animation.finished.catch(() => {});
const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)';

/** A rect relative to `root`. */
export function relRect(el, root) {
  const r = el.getBoundingClientRect();
  const o = root.getBoundingClientRect();
  return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height, cx: r.left - o.left + r.width / 2, cy: r.top - o.top + r.height / 2 };
}

/**
 * FLIP: `el` was at `from` (a rect relative to the same root as `to`) and is now at
 * `to`; play the move from there to here.
 */
export function flip(el, from, to, { speed = 1, duration = 320, flipFace = false, delay = 0 } = {}) {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const sx = to.w ? from.w / to.w : 1;
  const sy = to.h ? from.h / to.h : 1;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) return Promise.resolve();
  const start = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})${flipFace ? ' rotateY(180deg)' : ''}`;
  el.style.willChange = 'transform';
  const animation = el.animate([
    { transform: start, transformOrigin: '0 0' },
    { transform: 'none', transformOrigin: '0 0' },
  ], { duration: duration * speed, easing: EASE_OUT, delay: delay * speed, fill: 'backwards' });
  return done(animation).then(() => { el.style.willChange = ''; });
}

/** Floats a number or word up from a point (damage, life gain). */
export function floatText(layer, x, y, text, kind, { speed = 1 } = {}) {
  const el = h(`div.float-text.${kind}`, text);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  layer.append(el);
  const animation = el.animate([
    { transform: 'translate(-50%, -50%) scale(.6)', opacity: 0 },
    { transform: 'translate(-50%, -80%) scale(1.25)', opacity: 1, offset: 0.2 },
    { transform: 'translate(-50%, -150%) scale(1)', opacity: 0 },
  ], { duration: 900 * Math.max(0.6, speed), easing: 'ease-out' });
  return done(animation).then(() => el.remove());
}

/** A quick hit shake. */
export function shake(el, { speed = 1 } = {}) {
  return done(el.animate([
    { transform: 'translate(0,0)' }, { transform: 'translate(-4px,1px)' }, { transform: 'translate(4px,-1px)' },
    { transform: 'translate(-2px,0)' }, { transform: 'translate(0,0)' },
  ], { duration: 260 * speed }));
}

/** A scale pop (stat changes, life totals). */
export function pop(el, { speed = 1, scale = 1.3 } = {}) {
  return done(el.animate([{ transform: 'scale(1)' }, { transform: `scale(${scale})` }, { transform: 'scale(1)' }], { duration: 320 * speed, easing: EASE_OUT }));
}

/**
 * Moves a detached element (already placed in `layer` at its old position) to a
 * point, shrinking and fading: a card going to a pile or a land group.
 */
export function flyAway(el, to, { speed = 1, duration = 380 } = {}) {
  const from = { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: el.offsetWidth, h: el.offsetHeight };
  const dx = to.cx - (from.x + from.w / 2);
  const dy = to.cy - (from.y + from.h / 2);
  return done(el.animate([
    { transform: 'none', opacity: 1 },
    { transform: `translate(${dx}px, ${dy}px) scale(.35)`, opacity: 0.2 },
  ], { duration: duration * speed, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' })).then(() => el.remove());
}

/** Breaks an element apart where it is: it swells and fades as shards fly out. */
export function crumble(el, layer, { speed = 1, kind = 'die' } = {}) {
  const x = parseFloat(el.style.left) + el.offsetWidth / 2;
  const y = parseFloat(el.style.top) + el.offsetHeight / 2;
  const shards = [];
  for (let i = 0; i < 9; i++) {
    const shard = h(`div.shard.${kind}`);
    shard.style.left = `${x}px`;
    shard.style.top = `${y}px`;
    layer.append(shard);
    const angle = (i / 9) * Math.PI * 2 + Math.random() * 0.5;
    const distance = 40 + Math.random() * 40;
    shards.push(done(shard.animate([
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${Math.sin(angle) * distance}px)) scale(.2) rotate(${angle * 90}deg)`, opacity: 0 },
    ], { duration: 520 * speed, easing: 'cubic-bezier(.1,.7,.3,1)' })).then(() => shard.remove()));
  }
  const body = done(el.animate([
    { transform: 'scale(1)', opacity: 1 },
    { transform: 'scale(1.12) rotate(-3deg)', opacity: 0.9, offset: 0.25 },
    { transform: 'scale(.6) rotate(6deg)', opacity: 0 },
  ], { duration: 480 * speed, easing: 'ease-in', fill: 'forwards' })).then(() => el.remove());
  return Promise.all([body, ...shards]);
}

/** A big banner across the board ("Your turn", "Victory"). */
export function banner(layer, text, kind, { speed = 1, hold = 700 } = {}) {
  const el = h(`div.banner.${kind}`, h('div.banner-band'), h('div.banner-text', text));
  layer.append(el);
  const total = 260 * speed + hold * speed + 260 * speed;
  const animation = el.animate([
    { opacity: 0, transform: 'scaleY(.2)' },
    { opacity: 1, transform: 'scaleY(1)', offset: (260 * speed) / total },
    { opacity: 1, transform: 'scaleY(1)', offset: (260 * speed + hold * speed) / total },
    { opacity: 0, transform: 'scaleY(.6)' },
  ], { duration: total, easing: 'ease-out' });
  return done(animation).then(() => el.remove());
}

/** An element enters: a fade and rise (tokens and other new things). */
export function enter(el, { speed = 1, from = 'pop' } = {}) {
  const keyframes = from === 'pop'
    ? [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }]
    : [{ transform: 'translateY(12px)', opacity: 0 }, { transform: 'none', opacity: 1 }];
  return done(el.animate(keyframes, { duration: 300 * speed, easing: EASE_OUT, fill: 'backwards' }));
}

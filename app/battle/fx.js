/**
 * Battle effects. Everything animates only `transform` and `opacity`, so it runs
 * on the compositor and stays smooth on phones. `speed` scales durations (lower is
 * faster). Each function returns a promise for when it's done.
 */
import { h, reducedMotion } from '../dom.js';

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

/** Colors for effects, by a card's frame color (art.js frameOf). */
export const FX_COLORS = {
  white: '#fff3c4', blue: '#7fc4ff', black: '#c08cff', red: '#ff8a3c', green: '#9af07a',
  gold: '#ffd76a', colorless: '#dfe6f5', land: '#e4c18c', hit: '#ffb347', dust: '#d9c7a3', heal: '#7dffa7',
};

/**
 * A burst where something lands or is hit: a flash, a ring, and sparks flying out.
 * `strength` (about 0.5–2) scales its size; `color` tints it.
 */
export function impact(layer, x, y, { speed = 1, strength = 1, color = FX_COLORS.hit, sparks = 7 } = {}) {
  const parts = [];
  const place = (el) => {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--fx', color);
    layer.append(el);
    return el;
  };
  const size = 34 + 26 * strength;
  const flash = place(h('div.fx-flash'));
  flash.style.width = flash.style.height = `${size}px`;
  parts.push(done(flash.animate([
    { transform: 'translate(-50%,-50%) scale(.2)', opacity: 1 },
    { transform: 'translate(-50%,-50%) scale(1.25)', opacity: 0 },
  ], { duration: 340 * speed, easing: 'cubic-bezier(.1,.7,.3,1)' })).then(() => flash.remove()));
  const ring = place(h('div.fx-ring'));
  ring.style.width = ring.style.height = `${size * 1.2}px`;
  parts.push(done(ring.animate([
    { transform: 'translate(-50%,-50%) scale(.25)', opacity: 0.95 },
    { transform: 'translate(-50%,-50%) scale(1.5)', opacity: 0 },
  ], { duration: 460 * speed, easing: 'cubic-bezier(.1,.7,.3,1)' })).then(() => ring.remove()));
  for (let i = 0; i < sparks; i++) {
    const spark = place(h('div.fx-spark'));
    const angle = (i / sparks) * Math.PI * 2 + Math.random() * 0.6;
    const distance = (26 + Math.random() * 22) * (0.7 + strength * 0.4);
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    parts.push(done(spark.animate([
      { transform: `translate(-50%,-50%) rotate(${angle}rad) scaleX(1.6)`, opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${angle}rad) scaleX(.3)`, opacity: 0 },
    ], { duration: (380 + Math.random() * 160) * speed, easing: 'cubic-bezier(.1,.7,.3,1)' })).then(() => spark.remove()));
  }
  return Promise.all(parts);
}

/** Shakes the whole board, harder with `strength` (about 0.5–2). Not when asked for less motion. */
export function shakeScreen(el, { speed = 1, strength = 1 } = {}) {
  if (reducedMotion()) return Promise.resolve();
  const a = 2 + 3 * strength;
  return done(el.animate([
    { transform: 'none' },
    { transform: `translate(${-a}px, ${a * 0.6}px)` },
    { transform: `translate(${a * 0.8}px, ${-a * 0.5}px)` },
    { transform: `translate(${-a * 0.5}px, ${a * 0.3}px)` },
    { transform: `translate(${a * 0.25}px, 0)` },
    { transform: 'none' },
  ], { duration: 300 * Math.max(0.6, speed), easing: 'ease-out' }));
}

/** How long a lunge takes, and when in it the blow lands (ms, before `speed`). */
export const LUNGE_MS = 440;
export const LUNGE_HIT = 0.42;

/**
 * An attacker throws itself at a point and springs back. `reach` is how much of the
 * way it goes (1 is all the way). Resolves when it's back.
 */
export function lunge(el, from, to, { speed = 1, reach = 0.72, delay = 0 } = {}) {
  const dx = (to.cx - from.cx) * reach;
  const dy = (to.cy - from.cy) * reach;
  return done(el.animate([
    { transform: 'none', offset: 0, easing: 'cubic-bezier(.3,0,.2,1)' },
    { transform: `translate(${-dx * 0.08}px, ${-dy * 0.08}px) scale(1.06)`, offset: 0.16, easing: 'cubic-bezier(.6,0,1,.6)' },
    { transform: `translate(${dx}px, ${dy}px) scale(1.12)`, offset: LUNGE_HIT, easing: 'cubic-bezier(.2,.7,.2,1)' },
    { transform: 'none', offset: 1 },
  ], { duration: LUNGE_MS * speed, delay: delay * speed }));
}

/**
 * A bolt of magic from one point to another (a spell's or ability's damage). Resolves
 * when it arrives.
 */
export function projectile(layer, from, to, { speed = 1, color = FX_COLORS.red, duration = 300 } = {}) {
  const el = h('div.fx-bolt');
  el.style.left = `${from.cx}px`;
  el.style.top = `${from.cy}px`;
  el.style.setProperty('--fx', color);
  layer.append(el);
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const angle = Math.atan2(dy, dx);
  return done(el.animate([
    { transform: `translate(-50%,-50%) rotate(${angle}rad) scale(.4, .4)`, opacity: 0.4 },
    { transform: `translate(calc(-50% + ${dx * 0.15}px), calc(-50% + ${dy * 0.15}px)) rotate(${angle}rad) scale(1.6, 1)`, opacity: 1, offset: 0.25 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${angle}rad) scale(1.2, .9)`, opacity: 1 },
  ], { duration: duration * speed, easing: 'cubic-bezier(.5,0,.9,.6)' })).then(() => el.remove());
}

/** Motes rising over an element (a buff, life gained). */
export function sparkle(layer, rect, { speed = 1, color = FX_COLORS.gold, count = 6 } = {}) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const mote = h('div.fx-mote');
    mote.style.left = `${rect.x + rect.w * (0.15 + 0.7 * ((i + Math.random()) / count))}px`;
    mote.style.top = `${rect.y + rect.h * (0.55 + Math.random() * 0.35)}px`;
    mote.style.setProperty('--fx', color);
    layer.append(mote);
    const rise = 24 + Math.random() * 26;
    parts.push(done(mote.animate([
      { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.25 },
      { transform: `translate(-50%, calc(-50% - ${rise}px)) scale(.5)`, opacity: 0 },
    ], { duration: (620 + Math.random() * 240) * speed, delay: i * 40 * speed, easing: 'ease-out', fill: 'backwards' })).then(() => mote.remove()));
  }
  return Promise.all(parts);
}

/**
 * A card coming down onto the battlefield: from `from` (a rect relative to the same
 * root as `to`; or, without it, from above its place) it rises, then slams into its
 * place. `onLand` runs at the moment it hits.
 */
export function slam(el, from, to, { speed = 1, onLand, delay = 0, duration = 520 } = {}) {
  const start = from
    ? `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${to.w ? from.w / to.w : 1}, ${to.h ? from.h / to.h : 1})`
    : 'translate(0, -26px) scale(1.5)';
  el.style.willChange = 'transform';
  const animation = el.animate([
    { transform: start, transformOrigin: from ? '0 0' : '50% 50%', opacity: from ? 1 : 0, easing: 'cubic-bezier(.25,.6,.35,1)' },
    { transform: 'translate(0, -18px) scale(1.22)', transformOrigin: '50% 50%', opacity: 1, offset: 0.6, easing: 'cubic-bezier(.7,0,1,.5)' },
    { transform: 'translate(0, 2px) scale(.94, .97)', transformOrigin: '50% 100%', opacity: 1, offset: 0.8, easing: 'cubic-bezier(.2,.8,.3,1)' },
    { transform: 'none', transformOrigin: '50% 100%', opacity: 1 },
  ], { duration: duration * speed, delay: delay * speed, fill: 'backwards' });
  const landing = setTimeout(() => onLand?.(), (delay + duration * 0.8) * speed);
  return done(animation).then(() => {
    clearTimeout(landing);
    el.style.willChange = '';
  });
}

/**
 * A card shown big in the middle of the board on its way somewhere (an opponent's
 * spell, so you see what they cast): from `from` it grows into the middle (`center`,
 * a point), holds, then shrinks into its place `to`.
 */
export function showcase(el, from, to, center, { speed = 1, scale = 2, hold = 650 } = {}) {
  const at = (rect, s) => `translate(${rect.cx - to.cx}px, ${rect.cy - to.cy}px) scale(${s})`;
  const fromScale = to.w ? Math.max(0.2, from.w / to.w) : 0.3;
  const total = 300 + hold + 320;
  el.style.willChange = 'transform';
  const animation = el.animate([
    { transform: at(from, fromScale), opacity: 0, easing: 'cubic-bezier(.2,.8,.2,1)' },
    { transform: at(center, scale * 1.06), opacity: 1, offset: 300 / total },
    { transform: at(center, scale), opacity: 1, offset: (300 + hold) / total, easing: 'cubic-bezier(.6,0,.3,1)' },
    { transform: 'none', opacity: 1 },
  ], { duration: total * speed, fill: 'backwards' });
  return done(animation).then(() => {
    el.style.willChange = '';
  });
}

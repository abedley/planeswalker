/**
 * Card art: Scryfall images for imported cards (their `image` field), and
 * generated art for everything else (sample cards, tokens), so every card has a
 * picture without downloading anything.
 */
import { h } from './dom.js';
import { icon } from './icons.js';

const COLOR_NAMES = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
const NAME_COLORS = Object.fromEntries(Object.entries(COLOR_NAMES).map(([k, v]) => [v, k]));

/** The card's colors as letters (W/U/B/R/G), from `colors` or its mana cost. */
export function colorsOf(card) {
  if (Array.isArray(card.colors)) return card.colors.map((c) => NAME_COLORS[c] ?? c).filter((c) => COLOR_NAMES[c]);
  return Object.keys(card.manaCost ?? {}).filter((c) => COLOR_NAMES[c]);
}

/** A frame color name: white, blue, black, red, green, gold (several), colorless or land. */
export function frameOf(card) {
  if (card.types?.includes('Land')) return 'land';
  const colors = colorsOf(card);
  if (colors.length > 1) return 'gold';
  return colors.length ? COLOR_NAMES[colors[0]] : 'colorless';
}

/** The main type, for the generated art's emblem. */
export function mainType(card) {
  const types = card.types ?? [];
  if (card.token && !types.includes('Creature')) return 'token';
  for (const type of ['Creature', 'Land', 'Instant', 'Sorcery', 'Artifact', 'Enchantment']) {
    if (types.includes(type)) return type.toLowerCase();
  }
  return 'star';
}

/** A small stable hash of a string, for varying generated art. */
function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

/** The presentation fields for a card: the definition's (images, artist) over the instance. */
export const presentationOf = (card, definitions) => ({ ...card, ...(definitions?.[card.cardId] ?? {}), id: card.id });

/** Art for a card: its Scryfall art crop, or generated. */
export function cardArt(card) {
  const url = card.image?.art;
  if (url) {
    const img = h('img.art-img', { alt: '', draggable: 'false', decoding: 'async', src: url });
    return h('div.art', img);
  }
  return generatedArt(card);
}

/** Generated art: a gradient in the card's colors with its type's emblem, varied per name. */
export function generatedArt(card) {
  const seed = hash(card.name ?? card.cardId ?? '');
  return h(`div.art.gen.f-${frameOf(card)}`, {
    style: { '--a': `${seed % 360}deg`, '--x': `${20 + (seed >> 9) % 60}%`, '--y': `${20 + (seed >> 17) % 50}%` },
  }, icon(mainType(card), 'gen-glyph'));
}

const decoded = new Map();

/** Downloads and decodes images ahead of time, so cards appear without a flash. */
export function preloadImages(urls) {
  return Promise.all([...new Set(urls)].filter(Boolean).map((url) => {
    if (!decoded.has(url)) {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      decoded.set(url, img.decode().catch(() => {}));
    }
    return decoded.get(url);
  }));
}

/** A crest for a planeswalker or opponent: their art, or a monogram in their color. */
export function crest(person, { size = 'md' } = {}) {
  const color = person.color ?? ['green', 'blue', 'red', 'black', 'white'][hash(person.name ?? '') % 5];
  const inner = person.art
    ? h('img', { src: person.art, alt: '', draggable: 'false', decoding: 'async' })
    : h('span.monogram', (person.name ?? '?').replace(/^The /, '').slice(0, 1));
  return h(`div.crest.crest-${size}.f-${color}`, inner);
}

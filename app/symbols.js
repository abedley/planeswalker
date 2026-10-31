/**
 * Magic symbols, drawn with the Mana and Keyrune fonts (app/vendor/symbols.css):
 * mana costs, {T}, card types, keyword abilities and set symbols, plus rules text
 * with its {X} symbols turned into icons.
 */
import { h } from './dom.js';

const MANA_LETTERS = new Set(['W', 'U', 'B', 'R', 'G', 'C', 'X']);
const ORDER = ['X', 'generic', 'W', 'U', 'B', 'R', 'G', 'C'];

/**
 * One mana symbol, as on a card: `manaSymbol('G')`, `manaSymbol(3)`. With
 * `cost: false`, just the glyph (no colored circle).
 */
export function manaSymbol(symbol, { cost = true } = {}) {
  const name = String(symbol).toLowerCase();
  return h(`i.ms.ms-${name}${cost ? '.ms-cost' : ''}`, { 'aria-label': `{${String(symbol).toUpperCase()}}` });
}

/** A hybrid mana symbol, {W/B}: each color's symbol in its half of a split circle (107.4e). */
function hybridSymbol(colors) {
  const [a, b] = colors.map((c) => c.toLowerCase());
  return h(`i.ms.ms-cost.ms-hybrid.ha-${a}.hb-${b}`, { 'aria-label': `{${colors.join('/')}}` }, h(`i.ms.ms-${a}`), h(`i.ms.ms-${b}`));
}

/** The symbols of a mana cost, `{ generic: 2, G: 1 }` → {2}{G}. */
export function costSymbols(cost) {
  const symbols = [];
  for (const type of ORDER) {
    const n = cost?.[type] ?? 0;
    if (!n) continue;
    if (type === 'generic') symbols.push(manaSymbol(n));
    else for (let i = 0; i < n; i++) symbols.push(manaSymbol(type));
  }
  // Hybrid symbols ({W/B}), after the generic part as printed.
  const hybrid = (cost?.hybrid ?? []).map(hybridSymbol);
  if (hybrid.length) symbols.splice(cost?.generic ? 1 : 0, 0, ...hybrid);
  return symbols;
}

/** A card type's symbol: creature, instant, sorcery, artifact, enchantment, land, planeswalker. */
export const typeSymbol = (type) => h(`i.ms.ms-${type.toLowerCase()}`, { 'aria-hidden': 'true' });

/** A keyword ability's symbol, e.g. 'flying' or 'first strike'. */
export const abilitySymbol = (keyword) => h(`i.ms.ms-ability-${keyword.replace(/\s+/g, '-')}`, { 'aria-label': keyword });

const SETS = new Set(['m19', 'm20', 'm21', 'fdn', 'ltr']);

/** A set symbol in its rarity's color, or null for sets without a glyph. */
export function setSymbol(set, rarity = 'common') {
  if (!SETS.has(set)) return null;
  return h(`i.ss.ss-${set}.ss-${rarity}`, { 'aria-label': `${set.toUpperCase()} ${rarity}` });
}

/** Turns one {…} symbol into its icon, or null if it isn't one we draw. */
function symbolFor(token) {
  const inner = token.slice(1, -1).toUpperCase();
  if (inner === 'T') return h('i.ms.ms-tap.ms-cost', { 'aria-label': '{T}' });
  if (inner === 'Q') return h('i.ms.ms-untap.ms-cost', { 'aria-label': '{Q}' });
  if (MANA_LETTERS.has(inner) || /^\d+$/.test(inner)) return manaSymbol(inner);
  // Hybrid mana: {W/B}.
  if (/^[WUBRG]\/[WUBRG]$/.test(inner)) return hybridSymbol(inner.split('/'));
  return null;
}

/** A line of text with its {…} symbols as icons (no paragraphs). */
export function inlineSymbols(text = '') {
  return String(text).split(/(\{[^}]+\})/).filter(Boolean).map((piece) => (piece.startsWith('{') ? symbolFor(piece) ?? piece : piece));
}

/**
 * Rules text as nodes: "{T}: Add {G}." gets symbols, and reminder text in
 * parentheses is set in italics. Lines become separate paragraphs.
 */
export function symbolText(text = '') {
  return String(text).split('\n').filter(Boolean).map((line) => {
    const nodes = [];
    for (const part of line.split(/(\([^)]*\))/)) {
      if (!part) continue;
      const pieces = part.split(/(\{[^}]+\})/).filter(Boolean).map((piece) => (piece.startsWith('{') ? symbolFor(piece) ?? piece : piece));
      nodes.push(part.startsWith('(') ? h('i.reminder', pieces) : pieces);
    }
    return h('p', nodes);
  });
}

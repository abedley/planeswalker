/**
 * How cards look: the full card (hand, previews, rewards), the compact board card,
 * the round chip for small permanents, and the card back.
 */
import { h } from './dom.js';
import { icon, hasIcon } from './icons.js';
import { cardArt, frameOf, presentationOf } from './art.js';

const ORDER = ['generic', 'W', 'U', 'B', 'R', 'G', 'C'];

/** Mana symbols for a cost: `{ generic: 2, G: 1 }` → (2)(G). */
export function manaPips(cost, extraClass = '') {
  cost ??= {};
  const pips = [];
  for (const type of ORDER) {
    const n = cost[type] ?? 0;
    if (!n) continue;
    if (type === 'generic') pips.push(h('span.pip.pip-generic', String(n)));
    else for (let i = 0; i < n; i++) pips.push(h(`span.pip.pip-${type}`));
  }
  return h(`span.pips${extraClass ? `.${extraClass}` : ''}`, pips);
}

export function typeLine(card) {
  if (card.typeLine) return card.typeLine;
  const left = [...(card.supertypes ?? []), ...(card.types ?? [])].join(' ');
  return card.subtypes?.length ? `${left} — ${card.subtypes.join(' ')}` : left;
}

/** Rules text: the card's own, or its abilities' texts (e.g. basic lands). */
export function rulesText(card) {
  if (card.text) return card.text;
  const parts = [
    ...(card.keywords ?? []).map((k) => k[0].toUpperCase() + k.slice(1)),
    ...(card.abilities ?? []).map((a) => a.text),
    ...(card.triggeredAbilities ?? []).map((a) => a.text),
  ];
  return parts.join('\n');
}

const KEYWORD_ICONS = {
  flying: 'flying', 'first strike': 'firstStrike', 'double strike': 'doubleStrike', deathtouch: 'deathtouch',
  lifelink: 'lifelink', trample: 'trample', menace: 'menace', reach: 'reach', vigilance: 'vigilance',
  haste: 'haste', defender: 'defender',
};

export function keywordIcons(keywords = []) {
  return h('div.kws', keywords.filter((k) => hasIcon(KEYWORD_ICONS[k])).slice(0, 4).map((k) => icon(KEYWORD_ICONS[k], `kw kw-${KEYWORD_ICONS[k]}`)));
}

/** The full card: cost, art, name, type, text, power/toughness. `big` adds the text. */
export function fullCard(cardIn, definitions, { big = false } = {}) {
  const card = presentationOf(cardIn, definitions);
  if (big && card.image?.card) {
    return h('div.card-face.real', h('img', { src: card.image.card, alt: card.name, draggable: 'false', decoding: 'async' }));
  }
  const isCreature = card.types?.includes('Creature');
  return h(`div.card-face.f-${frameOf(card)}${big ? '.big' : ''}`,
    h('div.cf-top', h('span.cf-name', card.name), manaPips(card.manaCost)),
    cardArt(card),
    h('div.cf-type', typeLine(card)),
    big ? h('div.cf-text', rulesText(card)) : keywordIcons(card.keywords),
    isCreature ? h('div.cf-pt', `${card.power}/${card.toughness}`) : null,
    card.token ? h('div.cf-token', 'Token') : null);
}

/** What changes how a permanent looks; its board element is redrawn only when this changes. */
export function boardSignature(p, extra = '') {
  return [p.power, p.toughness, p.damage, JSON.stringify(p.counters ?? {}), (p.keywords ?? []).join(), p.base?.power, p.base?.toughness, extra].join('|');
}

/** A creature on the battlefield: art, keywords, power/toughness, damage and counters. */
export function boardCard(permanent, definitions, { attachments = [] } = {}) {
  const card = presentationOf(permanent, definitions);
  const powerClass = card.base && card.power > card.base.power ? 'up' : card.base && card.power < card.base.power ? 'down' : '';
  const toughness = card.toughness - (card.damage ?? 0);
  const toughnessClass = card.damage ? 'hurt' : card.base && card.toughness > card.base.toughness ? 'up' : '';
  const counters = Object.values(card.counters ?? {}).reduce((sum, n) => sum + n, 0);
  return h(`div.board-face.f-${frameOf(card)}`,
    cardArt(card),
    // Without real art, cards would look alike: name them.
    card.image?.art ? null : h('div.board-name', card.name),
    keywordIcons(card.keywords),
    attachments.length ? h('div.attach', attachments.map((a) => h(`span.tab.f-${frameOf(a)}`, icon(a.types.includes('Artifact') ? 'artifact' : 'enchantment')))) : null,
    counters ? h('div.counter', `+${counters}`) : null,
    h('div.stat.power', { class: powerClass }, String(card.power)),
    h('div.stat.tough', { class: toughnessClass }, String(toughness)));
}

/** A small permanent (artifact, enchantment, token) as a round chip. */
export function chipFace(permanent, definitions) {
  const card = presentationOf(permanent, definitions);
  return h(`div.chip-face.f-${frameOf(card)}`, cardArt(card));
}

export const cardBack = () => h('div.card-back', h('div.back-sigil', icon('star')));

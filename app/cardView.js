/**
 * How cards look: the full card (hand, previews, rewards), the compact board card,
 * the round chip for small permanents, and the card back.
 */
import { h } from './dom.js';
import { icon } from './icons.js';
import { cardArt, frameOf, presentationOf } from './art.js';
import { costSymbols, abilitySymbol, setSymbol, symbolText } from './symbols.js';

/** Mana symbols for a cost: `{ generic: 2, G: 1 }` → {2}{G}. */
export function manaPips(cost, extraClass = '') {
  return h(`span.pips${extraClass ? `.${extraClass}` : ''}`, costSymbols(cost ?? {}));
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

const KEYWORDS = new Set(['flying', 'first strike', 'double strike', 'deathtouch', 'lifelink', 'trample', 'menace',
  'reach', 'vigilance', 'haste', 'defender']);

/** Keyword ability symbols (at most four). */
export function keywordIcons(keywords = []) {
  return h('div.kws', keywords.filter((k) => KEYWORDS.has(k)).slice(0, 4).map((k) => h('span.kw', abilitySymbol(k))));
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
    h('div.cf-type', h('span.cf-typeline', typeLine(card)), card.set ? setSymbol(card.set, card.rarity) : null),
    big ? h('div.cf-text', symbolText(rulesText(card))) : keywordIcons(card.keywords),
    isCreature ? h('div.cf-pt', `${card.power}/${card.toughness}`) : null,
    card.token ? h('div.cf-token', 'Token') : null);
}

/** Blocking restrictions (509.1b), which have no ability symbol: their board badges. */
const RESTRICTIONS = [["can't block", "Can't block", 'no-block'], ["can't be blocked", 'Unblockable', 'unblockable']];

/**
 * Badges for a creature's blocking restrictions. One it has only this turn (not
 * printed: from a spell or ability) is marked `.now`.
 */
export function restrictionBadges(card) {
  const printed = new Set(card.base?.keywords ?? card.keywords ?? []);
  const badges = RESTRICTIONS.filter(([keyword]) => card.keywords?.includes(keyword))
    .map(([keyword, label, kind]) => h(`span.rb.${kind}${printed.has(keyword) ? '' : '.now'}`, label));
  return badges.length ? h('div.restrict', badges) : null;
}

/** What changes how a permanent looks; its board element is redrawn only when this changes. */
export function boardSignature(p, extra = '') {
  return [p.power, p.toughness, p.damage, JSON.stringify(p.counters ?? {}), (p.keywords ?? []).join(), p.base?.power, p.base?.toughness, extra].join('|');
}

/** A creature on the battlefield: art, keywords and blocking restrictions, power/toughness, damage and counters. */
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
    restrictionBadges(card),
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

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
  'reach', 'vigilance', 'haste', 'defender', 'indestructible', 'hexproof', 'ward']);

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
  // Names, type lines and rules text shrink to fit their boxes (fit.js) rather than being cut off.
  return h(`div.card-face.f-${frameOf(card)}${big ? '.big' : ''}`,
    h('div.cf-top', h('span.cf-name.fit', card.name), manaPips(card.manaCost)),
    cardArt(card),
    h('div.cf-type', h('span.cf-typeline.fit', typeLine(card)), card.set ? setSymbol(card.set, card.rarity) : null),
    big ? h('div.cf-text.fit', { dataset: { min: 7 } }, symbolText(rulesText(card))) : keywordIcons(card.keywords),
    isCreature ? h('div.cf-pt', `${card.power}/${card.toughness}`) : null,
    card.token ? h('div.cf-token', 'Token') : null);
}

/** Attacking and blocking restrictions (508.1c, 509.1b), which have no ability symbol: their board badges. */
const RESTRICTIONS = [
  ["can't attack", "Can't attack", 'no-attack'], ["can't block", "Can't block", 'no-block'],
  ["can't be blocked", 'Unblockable', 'unblockable'],
  ["can't be blocked except by flyers", 'Flyers only', 'unblockable'],
  ["can't be blocked by power 2 or less", 'Power 3+ only', 'unblockable'],
  ["can't be blocked by more than one creature", 'One blocker', 'unblockable'],
  ["can't be blocked except by three or more creatures", '3+ blockers', 'unblockable'],
  // The Ring, level 1: the Ring-bearer.
  ["can't be blocked by creatures with greater power", 'No bigger blockers', 'unblockable'],
  // Bewitching Leechcraft; Bill the Pony.
  ['untaps only by removing a +1/+1 counter', 'Stays tapped', 'no-attack'],
  ['assigns combat damage equal to its toughness', 'Hits with toughness', 'lure'],
  // Blocking requirements (509.1c).
  ['must be blocked', 'Block me', 'lure'],
  ['all creatures able to block it do so', 'Lure', 'lure'],
];

/**
 * Badges for a creature's attacking and blocking restrictions. One it has only this
 * turn (neither printed nor from an Aura or Equipment in `attachments`, but from a
 * spell or ability) is marked `.now`.
 */
export function restrictionBadges(card, attachments = []) {
  const lasting = new Set([
    ...(card.base?.keywords ?? card.keywords ?? []),
    ...attachments.flatMap((a) => (a.staticAbilities ?? []).flatMap((e) => e.keywords ?? [])),
  ]);
  const badges = RESTRICTIONS.filter(([keyword]) => card.keywords?.includes(keyword))
    .map(([keyword, label, kind]) => h(`span.rb.fit.${kind}${lasting.has(keyword) ? '' : '.now'}`, label));
  return badges.length ? h('div.restrict', badges) : null;
}

/** What changes how a permanent looks; its board element is redrawn only when this changes. */
export function boardSignature(p, extra = '') {
  return [p.power, p.toughness, p.damage, JSON.stringify(p.counters ?? {}), (p.keywords ?? []).join(), p.base?.power, p.base?.toughness,
    (p.types ?? []).join(), extra].join('|');
}

/**
 * A creature on the battlefield: art, keywords and blocking restrictions, power/toughness,
 * damage and +1/+1 counters, and the Ring if it's its player's Ring-bearer (`ringBearer`).
 */
export function boardCard(permanent, definitions, { attachments = [], ringBearer = false } = {}) {
  const card = presentationOf(permanent, definitions);
  const powerClass = card.base && card.power > card.base.power ? 'up' : card.base && card.power < card.base.power ? 'down' : '';
  const toughness = card.toughness - (card.damage ?? 0);
  const toughnessClass = card.damage ? 'hurt' : card.base && card.toughness > card.base.toughness ? 'up' : '';
  const counters = card.counters?.['+1/+1'] ?? 0;
  return h(`div.board-face.f-${frameOf(card)}`,
    cardArt(card),
    // Without real art, cards would look alike: name them.
    card.image?.art ? null : h('div.board-name.fit', card.name),
    keywordIcons(card.keywords),
    restrictionBadges(card, attachments),
    attachments.length ? h('div.attach', attachments.map((a) => h(`span.tab.f-${frameOf(a)}`, icon(a.types.includes('Artifact') ? 'artifact' : 'enchantment')))) : null,
    counters ? h('div.counter', `+${counters}`) : null,
    ringBearer ? h('div.ring-bearer', { title: 'Ring-bearer' }, icon('ring')) : null,
    h('div.stat.power', { class: powerClass }, String(card.power)),
    h('div.stat.tough', { class: toughnessClass }, String(toughness)));
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** A small permanent (artifact, enchantment, token) as a round chip; a Saga shows its chapter (714.2). */
export function chipFace(permanent, definitions) {
  const card = presentationOf(permanent, definitions);
  const lore = permanent.counters?.lore ?? 0;
  return h(`div.chip-face.f-${frameOf(card)}`, cardArt(card), lore ? h('div.chip-lore', ROMAN[lore] ?? String(lore)) : null);
}

export const cardBack = () => h('div.card-back', h('div.back-oval', h('div.back-sigil', icon('star'))));

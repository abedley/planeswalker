/**
 * How cards look: the full card (hand, previews, rewards), the compact board card,
 * the round chip for small permanents, and the card back.
 */
import { h } from './dom.js';
import { icon } from './icons.js';
import { cardArt, frameOf, presentationOf } from './art.js';
import {
  costSymbols, abilitySymbol, setSymbol, symbolText, inlineSymbols, manaSymbol, typeSymbol,
} from './symbols.js';

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
  // The Balrog; goad (701.15).
  ["can't be blocked except by legendary creatures", 'Legends only', 'unblockable'],
  ['attacks each combat if able', 'Goaded', 'lure'],
];

/** Counters other than +1/+1 and lore, as small badges: "Stun 9", "Verse 3" (keyword counters show as keywords). */
const BADGE_COUNTERS = ['stun', 'hope', 'verse', 'burden', 'influence'];

function counterBadges(counters = {}) {
  const badges = BADGE_COUNTERS.filter((kind) => counters[kind] > 0)
    .map((kind) => h(`span.cb.cb-${kind}`, `${kind[0].toUpperCase()}${kind.slice(1)} ${counters[kind]}`));
  return badges.length ? h('div.counter-badges', badges) : null;
}

/** 702.16: what a permanent has protection from, as badges: "Pro" and the color's or card type's symbol. */
function protectionBadges(card) {
  const symbols = (card.protections ?? []).flatMap((p) => [
    ...(p.colors ?? []).map((c) => manaSymbol(c, { cost: false })), ...(p.types ?? []).map((t) => typeSymbol(t)),
  ]);
  return symbols.map((symbol) => h('span.rb.protect.now', { title: 'Protection' }, 'Pro ', symbol));
}

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
  const badges = [
    ...RESTRICTIONS.filter(([keyword]) => card.keywords?.includes(keyword))
      .map(([keyword, label, kind]) => h(`span.rb.fit.${kind}${lasting.has(keyword) ? '' : '.now'}`, label)),
    ...protectionBadges(card),
  ];
  return badges.length ? h('div.restrict', badges) : null;
}

/** What changes how a permanent looks; its board element is redrawn only when this changes. */
export function boardSignature(p, extra = '') {
  return [p.power, p.toughness, p.damage, JSON.stringify(p.counters ?? {}), (p.keywords ?? []).join(), p.base?.power, p.base?.toughness,
    (p.types ?? []).join(), JSON.stringify(p.protections ?? []), extra].join('|');
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
    counterBadges(card.counters),
    ringBearer ? h('div.ring-bearer', { title: 'Ring-bearer' }, icon('ring')) : null,
    h('div.stat.power', { class: powerClass }, String(card.power)),
    h('div.stat.tough', { class: toughnessClass }, String(toughness)));
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** A small permanent (artifact, enchantment, token) as a round chip; a Saga shows its chapter (714.2). */
export function chipFace(permanent, definitions) {
  const card = presentationOf(permanent, definitions);
  const lore = permanent.counters?.lore ?? 0;
  // Hope, verse, burden and influence counters: the number, in the corner.
  const other = BADGE_COUNTERS.map((kind) => permanent.counters?.[kind] ?? 0).find((n) => n > 0);
  return h(`div.chip-face.f-${frameOf(card)}`, cardArt(card), lore ? h('div.chip-lore', ROMAN[lore] ?? String(lore)) : other ? h('div.chip-lore', String(other)) : null);
}

/**
 * An ability on the stack: not a card being cast, so not framed like one. A slim dark
 * plate with its source's art (`source`, a card, or `portrait`, a planeswalker's crest)
 * under a "Trigger" or "Ability" tag, the source's name, then the cost paid and the
 * effect. `big` for inspecting it.
 */
export function abilityFace(object, { source = null, portrait = null, definitions, big = false } = {}) {
  const card = source ? presentationOf(source, definitions) : null;
  const [, cost, effect] = object.text?.match(/^([^:]+):\s*(.*)$/s) ?? [null, null, object.text ?? ''];
  const triggered = object.kind === 'triggeredAbility';
  const frame = card ? frameOf(card) : 'colorless';
  return h(`div.ability-face.f-${frame}${big ? '.big' : ''}`,
    h('div.sa-art', portrait ? h('div.sa-crest', portrait) : cardArt(card ?? { name: object.sourceName })),
    h('div.sa-kind', icon(triggered ? 'bolt' : 'gear'), triggered ? 'Trigger' : 'Ability'),
    h('div.sa-name.fit', object.sourceName),
    h('div.sa-text.fit', withCost(symbolText(effect), cost)));
}

/** Rules-text paragraphs with an ability's cost as a badge at the start of the first. */
function withCost(paragraphs, cost) {
  if (!cost) return paragraphs;
  const badge = h('span.sa-cost', inlineSymbols(cost));
  if (paragraphs.length) paragraphs[0].prepend(badge);
  else paragraphs.push(h('p', badge));
  return paragraphs;
}

export const cardBack = () => h('div.card-back', h('div.back-oval', h('div.back-sigil', icon('star'))));

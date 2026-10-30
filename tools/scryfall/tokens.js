/**
 * Finds Scryfall's printed tokens for the tokens the game creates, so they can
 * show real art instead of generated art (see tools/import-tokens.js).
 */
import { TOKENS, creatureTokenName, tokenCardId, amassArmyToken } from '../../src/cards/cards.js';
import { presentation } from './convert.js';

const COLOR_LETTERS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

/**
 * Every token that `sources` (card definitions, campaigns, ... walked deeply) can
 * create, plus the predefined ones (Treasure, Food, Clue). Returns a Map from the
 * token's card id to `{ token, creators }`, `creators` being the ids of the cards
 * whose effects make it.
 */
export function collectTokens(sources) {
  const tokens = new Map(Object.keys(TOKENS).map((name) => [tokenCardId(name), { token: name, creators: new Set() }]));
  const seen = new Set();
  const walk = (value, creator) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    // Amass (701.47a) creates an Army token when there's none.
    const made = value.type === 'createToken' ? value.token : value.type === 'amass' ? amassArmyToken(value.subtype) : null;
    if (made) {
      const id = tokenCardId(made);
      if (!tokens.has(id)) tokens.set(id, { token: made, creators: new Set() });
      if (creator) tokens.get(id).creators.add(creator);
    }
    // A card definition (with an id) is the creator of the tokens inside it.
    const owner = typeof value.id === 'string' && value.name ? value.id : creator;
    for (const child of Object.values(value)) walk(child, owner);
  };
  for (const source of sources) walk(source, null);
  return tokens;
}

const normalizeText = (text) => (text ?? '').replace(/this (token|artifact)/gi, 'this artifact').trim();

/** Whether a Scryfall card is a printing of `token` (a TOKEN name or a creature token's description). */
export function tokenMatches(card, token) {
  if (card.layout !== 'token' || !card.image_uris || card.digital) return false;
  if (typeof token === 'string') {
    const definition = TOKENS[token];
    return card.name === definition.name
      && card.type_line === `Token Artifact — ${definition.subtypes.join(' ')}`
      && normalizeText(card.oracle_text) === normalizeText(definition.text);
  }
  const subtypes = token.subtypes ?? [];
  const name = token.name ?? subtypes.join(' ');
  const colors = (token.colors ?? []).map((c) => COLOR_LETTERS[c] ?? c).sort();
  const keywords = (token.keywords ?? []).map((k) => k.toLowerCase()).sort();
  // Rules text other than its keywords (and their reminder text) and its own abilities (Smaug's "When Smaug
  // dies, …") means it does something else.
  let text = (card.oracle_text ?? '').replace(/\([^)]*\)/g, '');
  const abilityTexts = (token.triggeredAbilities ?? []).map((a) => a.text.replace(name, 'this creature'));
  for (const ability of abilityTexts) text = text.replace(ability, '');
  // Scryfall lists keyword actions in an ability's text ("create … Treasure tokens") as keywords too.
  const cardKeywords = (card.keywords ?? []).map((k) => k.toLowerCase()).filter((k) => !abilityTexts.some((t) => t.toLowerCase().includes(k)));
  const textParts = text.split(/[\n,]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const types = [...(token.supertypes ?? []), ...(token.types ?? ['Creature'])];
  return card.name === name
    && card.type_line === `Token ${types.join(' ')} — ${subtypes.join(' ')}`
    && card.power === String(token.power) && card.toughness === String(token.toughness)
    && [...(card.colors ?? [])].sort().join() === colors.join()
    && cardKeywords.sort().join() === keywords.join()
    && textParts.every((part) => keywords.includes(part));
}

/**
 * How much a printing is preferred: a regular token from a token set, with the usual
 * frame and a high-resolution scan, over promos, full-art and Secret Lair ones.
 */
function printingScore(card) {
  return (card.set_type === 'token' ? 8 : 0) + (card.full_art ? 0 : 4) + (card.promo ? 0 : 2) + (card.highres_image ? 1 : 0);
}

/**
 * The best printing among `cards` that matches `token`, or null. `preferred` (in
 * order) are printings linked from the cards that create the token, which come first.
 */
export function pickTokenPrinting(cards, token, preferred = []) {
  const matching = cards.filter((card) => tokenMatches(card, token));
  const linked = preferred.map((id) => matching.find((card) => card.id === id)).filter(Boolean);
  if (linked.length) return linked[0];
  return matching.sort((a, b) => printingScore(b) - printingScore(a) || (b.released_at ?? '').localeCompare(a.released_at ?? ''))[0] ?? null;
}

/** A Scryfall search for printings of `token`. */
export function tokenQuery(token) {
  if (typeof token === 'string') {
    const definition = TOKENS[token];
    return `t:token t:artifact ${definition.subtypes.map((s) => `t:${s.toLowerCase()}`).join(' ')} !"${definition.name}"`;
  }
  const colors = (token.colors ?? []).map((c) => COLOR_LETTERS[c] ?? c).join('') || 'c';
  return [
    't:token', ...(token.types ?? ['Creature']).map((t) => `t:${t.toLowerCase()}`), ...(token.subtypes ?? []).map((s) => `t:${s.toLowerCase()}`),
    `pow=${token.power}`, `tou=${token.toughness}`, `c=${colors}`,
    ...(token.keywords ?? []).map((k) => `keyword:"${k}"`),
  ].join(' ');
}

/** What the app shows for a token: its art, artist, set and Scryfall's type line. */
export function tokenPresentation(card) {
  const { colors, ...fields } = presentation(card);
  return { ...fields, typeLine: card.type_line, scryfallId: card.id };
}

/** A readable description of a token, for reports. */
export function describeToken(token) {
  if (typeof token === 'string') return TOKENS[token].name;
  const keywords = token.keywords?.length ? ` with ${token.keywords.join(', ')}` : '';
  return `${token.power}/${token.toughness} ${(token.colors ?? []).join(' ')} ${creatureTokenName(token)}${keywords}`.replace(/\s+/g, ' ');
}

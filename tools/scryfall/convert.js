/**
 * Converts Scryfall card objects (https://scryfall.com/docs/api/cards) into this
 * game's card definitions, or explains why a card can't be imported yet.
 *
 * Only cards the engine fully supports are converted. Everything a card does must
 * be one of:
 * - a land or creature (no other card types, no supertypes except Basic)
 * - a mana cost of generic and/or W, U, B, R, G, C symbols
 * - numeric power and toughness
 * - supported keywords (see KEYWORD in src/cards/cards.js)
 * - mana abilities of the form "{T}: Add {G}." (any mix of W, U, B, R, G, C symbols)
 * Anything else, such as other rules text, is reported as unsupported.
 */
import { KEYWORD, CARD_TYPE, EFFECT } from '../../src/cards/cards.js';

const SUPPORTED_KEYWORDS = new Set(Object.values(KEYWORD));
const SUPPORTED_TYPES = new Set(Object.values(CARD_TYPE));
const SUPPORTED_SUPERTYPES = new Set(['Basic']);
const KNOWN_SUPERTYPES = new Set(['Basic', 'Legendary', 'Snow', 'World', 'Ongoing', 'Elite', 'Host']);
const MANA_SYMBOL = /\{([^}]+)\}/g;
const MANA_TYPES = new Set(['W', 'U', 'B', 'R', 'G', 'C']);

/** "Llanowar Elves" -> "llanowarElves" */
export function cardIdFromName(name) {
  const words = name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim().split(/\s+/);
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
}

/** Parses "{3}{G}{G}" into { generic: 3, G: 2 }, collecting unsupported symbols. */
function parseManaSymbols(text, problems, what) {
  const mana = {};
  for (const [, symbol] of text.matchAll(MANA_SYMBOL)) {
    if (/^\d+$/.test(symbol)) {
      if (Number(symbol) > 0) mana.generic = (mana.generic ?? 0) + Number(symbol);
    } else if (MANA_TYPES.has(symbol)) {
      mana[symbol] = (mana[symbol] ?? 0) + 1;
    } else {
      problems.push(`Unsupported mana symbol {${symbol}} in ${what}.`);
    }
  }
  return mana;
}

/** "Basic Land — Forest" -> { supertypes: ['Basic'], types: ['Land'], subtypes: ['Forest'] } */
function parseTypeLine(typeLine) {
  const [left, right = ''] = typeLine.split(/\s+—\s+/);
  const words = left.trim().split(/\s+/);
  return {
    supertypes: words.filter((w) => KNOWN_SUPERTYPES.has(w)),
    types: words.filter((w) => !KNOWN_SUPERTYPES.has(w)),
    subtypes: right.trim() ? right.trim().split(/\s+/) : [],
  };
}

const lower = (s) => s.toLowerCase();

/** "{T}: Add {G}." -> a mana ability definition, or null if the line isn't one. */
function parseManaAbility(line, problems) {
  const match = /^\{T\}: Add ((?:\{[^}]+\})+)\.$/.exec(line);
  if (!match) return null;
  const mana = parseManaSymbols(match[1], problems, `"${line}"`);
  if (mana.generic) {
    problems.push(`Unsupported mana ability "${line}".`);
    return null;
  }
  return {
    id: `tapFor${Object.entries(mana).map(([type, n]) => type.repeat(n)).join('')}`,
    text: line,
    cost: { tap: true },
    effect: { type: EFFECT.ADD_MANA, mana },
  };
}

/**
 * Splits rules text into keywords and abilities, reporting any line that isn't
 * a supported keyword list or mana ability.
 */
function parseOracleText(card, typeInfo, problems) {
  const keywords = [];
  const abilities = [];
  const lines = (card.oracle_text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Reminder text is in parentheses and has no rules meaning of its own...
    const withoutReminder = line.replace(/\s*\([^)]*\)/g, '').trim();
    if (!withoutReminder) {
      // ...except a basic land's reminder of its intrinsic mana ability (305.6).
      const inner = /^\((.*)\)$/.exec(line)?.[1];
      const ability = typeInfo.supertypes.includes('Basic') && inner ? parseManaAbility(inner, problems) : null;
      if (ability) abilities.push(ability);
      continue;
    }

    const ability = parseManaAbility(withoutReminder, problems);
    if (ability) {
      abilities.push(ability);
      continue;
    }

    // A keyword line: "Flying, vigilance" or "First strike".
    const parts = withoutReminder.split(/,\s*/).map(lower);
    const scryfallKeywords = new Set((card.keywords ?? []).map(lower));
    if (parts.every((p) => SUPPORTED_KEYWORDS.has(p))) {
      keywords.push(...parts);
    } else if (parts.every((p) => SUPPORTED_KEYWORDS.has(p) || scryfallKeywords.has(p))) {
      for (const p of parts.filter((x) => !SUPPORTED_KEYWORDS.has(x))) problems.push(`Unsupported keyword: ${p}.`);
    } else {
      problems.push(`Unsupported rules text: "${line}"`);
    }
  }

  // Scryfall also lists keywords and keyword actions separately; check them too.
  for (const keyword of card.keywords ?? []) {
    const k = lower(keyword);
    if (!SUPPORTED_KEYWORDS.has(k) && !problems.some((p) => p.toLowerCase().includes(k))) {
      problems.push(`Unsupported keyword: ${k}.`);
    }
  }
  return { keywords: [...new Set(keywords)], abilities };
}

/**
 * @param {object} card A Scryfall card object.
 * @returns {{ ok: true, id: string, definition: object } | { ok: false, name: string, problems: string[] }}
 */
export function convertScryfallCard(card) {
  const problems = [];
  const name = card.name;

  if (card.object !== 'card') return { ok: false, name: name ?? '(unknown)', problems: ['Not a Scryfall card object.'] };
  if (card.layout !== 'normal' || card.card_faces) {
    problems.push(`Unsupported layout "${card.layout}" (only single-faced "normal" cards are supported).`);
    return { ok: false, name, problems };
  }

  const typeInfo = parseTypeLine(card.type_line ?? '');
  for (const supertype of typeInfo.supertypes.filter((s) => !SUPPORTED_SUPERTYPES.has(s))) {
    problems.push(`Unsupported supertype: ${supertype}.`);
  }
  for (const type of typeInfo.types.filter((t) => !SUPPORTED_TYPES.has(t))) {
    problems.push(`Unsupported card type: ${type}.`);
  }
  if (typeInfo.types.length === 0) problems.push(`Couldn't read the type line "${card.type_line}".`);

  const isCreature = typeInfo.types.includes(CARD_TYPE.CREATURE);
  const isLand = typeInfo.types.includes(CARD_TYPE.LAND);
  if (isCreature && isLand) problems.push('Land creatures are not supported.');

  const manaCost = card.mana_cost ? parseManaSymbols(card.mana_cost, problems, 'the mana cost') : null;
  if (isLand && card.mana_cost) problems.push('A land with a mana cost is not supported.');

  let power;
  let toughness;
  if (isCreature) {
    power = Number(card.power);
    toughness = Number(card.toughness);
    if (!/^\d+$/.test(card.power ?? '') || !/^\d+$/.test(card.toughness ?? '')) {
      problems.push(`Unsupported power/toughness ${card.power}/${card.toughness} (only fixed numbers are supported).`);
    }
  }

  const { keywords, abilities } = parseOracleText(card, typeInfo, problems);
  if (keywords.length && !isCreature) problems.push('Keywords on non-creatures are not supported.');

  if (problems.length) return { ok: false, name, problems };

  const id = cardIdFromName(name);
  const definition = {
    id,
    name,
    ...(isCreature ? { manaCost: manaCost ?? {} } : {}),
    supertypes: typeInfo.supertypes,
    types: typeInfo.types,
    subtypes: typeInfo.subtypes,
    ...(isCreature ? { power, toughness } : {}),
    ...(keywords.length ? { keywords } : {}),
    ...(abilities.length ? { abilities } : {}),
    // Provenance, for reference only.
    typeLine: card.type_line,
    oracleText: card.oracle_text ?? '',
    scryfallId: card.id,
    scryfallUri: card.scryfall_uri,
  };
  return { ok: true, id, definition };
}

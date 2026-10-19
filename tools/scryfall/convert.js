/**
 * Converts Scryfall card objects (https://scryfall.com/docs/api/cards) into this
 * game's card definitions, or explains why a card can't be imported yet.
 *
 * Only cards the engine fully supports are converted. Everything a card does must
 * be one of:
 * - a land, creature, artifact, enchantment, instant or sorcery (no supertypes except Basic)
 * - a mana cost of generic and/or W, U, B, R, G, C symbols
 * - numeric power and toughness
 * - supported keywords (see KEYWORD in src/cards/cards.js)
 * - mana abilities of the form "{T}: Add {G}." (any mix of W, U, B, R, G, C symbols)
 * - Auras: "Enchant creature" and "Enchanted creature gets +N/+N and has <keywords>."
 * - Equipment: "Equipped creature gets +N/+N and has <keywords>." and "Equip {N}"
 * - Instants and sorceries made only of these sentences (at most one target):
 *   "CARDNAME deals N damage to any target." / "... to target creature.",
 *   "Destroy target creature.", "Target creature gets +N/+N [and gains <keywords>] until end of turn.",
 *   "You gain N life.", "Draw a card." / "Draw N cards."
 * Anything else, such as other rules text, is reported as unsupported.
 */
import {
  KEYWORD, CARD_TYPE, SUBTYPE, EFFECT, TARGET, AFFECTED, equipAbility,
} from '../../src/cards/cards.js';

const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
const toNumber = (word) => NUMBER_WORDS[word.toLowerCase()] ?? Number(word);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Parses one instant/sorcery sentence into `{ effect, target }`, or null if the
 * engine can't do it.
 */
function parseSpellSentence(sentence, cardName, problems) {
  const name = escapeRegExp(cardName);
  let match = new RegExp(`^${name} deals (\\d+) damage to (any target|target creature)\\.$`).exec(sentence);
  if (match) {
    return {
      effect: { type: EFFECT.DEAL_DAMAGE, amount: Number(match[1]) },
      target: match[2] === 'any target' ? TARGET.ANY : TARGET.CREATURE,
    };
  }
  if (sentence === 'Destroy target creature.') return { effect: { type: EFFECT.DESTROY }, target: TARGET.CREATURE };
  match = /^Target creature gets ([+-]\d+)\/([+-]\d+)(?: and gains (.+?))? until end of turn\.$/.exec(sentence);
  if (match) {
    const keywords = (match[3] ?? '').split(/,\s*(?:and\s+)?|\s+and\s+/).map(lower).filter(Boolean);
    const unsupported = keywords.filter((k) => !SUPPORTED_KEYWORDS.has(k));
    for (const k of unsupported) problems.push(`Unsupported keyword granted: ${k}.`);
    if (unsupported.length) return { effect: null, target: TARGET.CREATURE };
    return {
      effect: {
        type: EFFECT.PUMP, power: Number(match[1]), toughness: Number(match[2]), ...(keywords.length ? { keywords } : {}),
      },
      target: TARGET.CREATURE,
    };
  }
  match = /^You gain (\w+) life\.$/.exec(sentence);
  if (match && toNumber(match[1])) return { effect: { type: EFFECT.GAIN_LIFE, amount: toNumber(match[1]) }, target: null };
  match = /^Draw (a card|(\w+) cards)\.$/.exec(sentence);
  if (match) {
    const count = match[2] ? toNumber(match[2]) : 1;
    if (count) return { effect: { type: EFFECT.DRAW_CARDS, count }, target: null };
  }
  return null;
}

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
 * "Enchanted creature gets +2/+2 and has flying and trample." -> a static ability,
 * or null if the line isn't one.
 */
function parseAttachedBonus(line, problems) {
  const match = /^(Enchanted|Equipped) creature (?:gets ([+-]\d+)\/([+-]\d+))?(?: and )?(?:has (.+))?\.$/.exec(line);
  if (!match || (!match[2] && !match[4])) return null;
  const keywords = (match[4] ?? '').split(/,\s*(?:and\s+)?|\s+and\s+/).map(lower).filter(Boolean);
  const unsupported = keywords.filter((k) => !SUPPORTED_KEYWORDS.has(k));
  for (const k of unsupported) problems.push(`Unsupported keyword granted: ${k}.`);
  if (unsupported.length) return { kind: match[1], effect: null };
  return {
    kind: match[1],
    effect: {
      affected: AFFECTED.ATTACHED_PERMANENT,
      ...(match[2] && Number(match[2]) ? { power: Number(match[2]) } : {}),
      ...(match[3] && Number(match[3]) ? { toughness: Number(match[3]) } : {}),
      ...(keywords.length ? { keywords } : {}),
    },
  };
}

/**
 * Splits rules text into keywords and abilities, reporting any line that isn't
 * a supported keyword list, mana ability, or Aura/Equipment line.
 */
function parseOracleText(card, typeInfo, problems) {
  const keywords = [];
  const abilities = [];
  const staticAbilities = [];
  const effects = [];
  let spellTarget = null;
  let enchant = null;
  const isSpellCard = typeInfo.types.includes(CARD_TYPE.INSTANT) || typeInfo.types.includes(CARD_TYPE.SORCERY);
  const isAuraCard = typeInfo.subtypes.includes(SUBTYPE.AURA);
  const isEquipmentCard = typeInfo.subtypes.includes(SUBTYPE.EQUIPMENT);
  // Keywords handled below as Aura/Equipment rules rather than as creature keywords.
  const handledKeywords = new Set();
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

    if (isSpellCard) {
      // An instant or sorcery's rules text is its effect, one sentence at a time (608.2c).
      for (const sentence of withoutReminder.split(/(?<=\.)\s+/)) {
        const parsed = parseSpellSentence(sentence, card.name, problems);
        if (!parsed) {
          problems.push(`Unsupported rules text: "${sentence}"`);
        } else if (parsed.target && spellTarget && parsed.target !== spellTarget) {
          problems.push(`More than one target isn't supported: "${sentence}"`);
        } else {
          if (parsed.effect) effects.push(parsed.effect);
          spellTarget = parsed.target ?? spellTarget;
        }
      }
      continue;
    }

    const ability = parseManaAbility(withoutReminder, problems);
    if (ability) {
      abilities.push(ability);
      continue;
    }

    // 303.4a: "Enchant creature" on an Aura.
    if (/^Enchant /.test(withoutReminder)) {
      handledKeywords.add('enchant');
      if (withoutReminder === 'Enchant creature' && isAuraCard) enchant = TARGET.CREATURE;
      else problems.push(`Unsupported rules text: "${line}"`);
      continue;
    }

    // 702.6a: "Equip {N}" on Equipment.
    const equip = /^Equip ((?:\{[^}]+\})+)$/.exec(withoutReminder);
    if (equip) {
      handledKeywords.add('equip');
      const mana = parseManaSymbols(equip[1], problems, `"${withoutReminder}"`);
      if (isEquipmentCard) abilities.push(equipAbility(mana, withoutReminder));
      else problems.push(`Unsupported rules text: "${line}"`);
      continue;
    }

    const bonus = parseAttachedBonus(withoutReminder, problems);
    if (bonus) {
      const fits = bonus.kind === 'Enchanted' ? isAuraCard : isEquipmentCard;
      if (!fits) problems.push(`Unsupported rules text: "${line}"`);
      else if (bonus.effect) staticAbilities.push(bonus.effect);
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
    if (!SUPPORTED_KEYWORDS.has(k) && !handledKeywords.has(k) && !problems.some((p) => p.toLowerCase().includes(k))) {
      problems.push(`Unsupported keyword: ${k}.`);
    }
  }
  if (isAuraCard && !enchant && !problems.length) problems.push('An Aura needs "Enchant creature".');
  if (isSpellCard && effects.length === 0 && !problems.length) problems.push('An instant or sorcery needs rules text.');
  return { keywords: [...new Set(keywords)], abilities, staticAbilities, enchant, effects, spellTarget };
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

  const { keywords, abilities, staticAbilities, enchant, effects, spellTarget } = parseOracleText(card, typeInfo, problems);
  const knownSubtypes = { [SUBTYPE.AURA]: CARD_TYPE.ENCHANTMENT, [SUBTYPE.EQUIPMENT]: CARD_TYPE.ARTIFACT };
  for (const [subtype, type] of Object.entries(knownSubtypes)) {
    if (typeInfo.subtypes.includes(subtype) && !typeInfo.types.includes(type)) problems.push(`Unsupported: ${subtype} that isn't an ${type}.`);
  }
  if (keywords.length && !isCreature) problems.push('Keywords on non-creatures are not supported.');

  if (problems.length) return { ok: false, name, problems };

  const id = cardIdFromName(name);
  const definition = {
    id,
    name,
    ...(!isLand ? { manaCost: manaCost ?? {} } : {}),
    supertypes: typeInfo.supertypes,
    types: typeInfo.types,
    subtypes: typeInfo.subtypes,
    ...(isCreature ? { power, toughness } : {}),
    ...(keywords.length ? { keywords } : {}),
    ...(abilities.length ? { abilities } : {}),
    ...(enchant ? { enchant } : {}),
    ...(effects.length ? { effects } : {}),
    ...(spellTarget ? { target: spellTarget } : {}),
    ...(staticAbilities.length ? { staticAbilities } : {}),
    text: card.oracle_text ?? '',
    // Provenance, for reference only.
    typeLine: card.type_line,
    oracleText: card.oracle_text ?? '',
    scryfallId: card.id,
    scryfallUri: card.scryfall_uri,
  };
  return { ok: true, id, definition };
}

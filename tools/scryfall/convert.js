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
 * - activated abilities, "<cost>: <effect>", made of the costs and effect sentences
 *   in rulesText.js (including mana abilities such as "{T}: Add {G}."), optionally
 *   followed by "Activate only as a sorcery."
 * - Auras: "Enchant creature" and "Enchanted creature gets +N/+N and has <keywords>."
 * - Equipment: "Equipped creature gets +N/+N and has <keywords>." and "Equip {N}"
 * - Instants and sorceries made only of supported effect sentences (at most one
 *   target), optionally with "As an additional cost to cast this spell, <cost>."
 * Anything else, such as other rules text, is reported as unsupported.
 */
import {
  CARD_TYPE, SUBTYPE, EFFECT, TARGET, AFFECTED, ACTIVATION_TIMING, equipAbility,
} from '../../src/cards/cards.js';
import {
  normalizeSelfReferences, parseManaSymbols, parseKeywordList, parseEffects, parseCost, sentences, SUPPORTED_KEYWORDS,
} from './rulesText.js';

const SUPPORTED_TYPES = new Set(Object.values(CARD_TYPE));
const SUPPORTED_SUPERTYPES = new Set(['Basic']);
const KNOWN_SUPERTYPES = new Set(['Basic', 'Legendary', 'Snow', 'World', 'Ongoing', 'Elite', 'Host']);
/** Keyword actions (701) Scryfall lists under `keywords` whose rules text is parsed like any other. */
const SUPPORTED_KEYWORD_ACTIONS = new Set(['mill']);

/** "Llanowar Elves" -> "llanowarElves" */
export function cardIdFromName(name) {
  const words = name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim().split(/\s+/);
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
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

/**
 * "<cost>: <effect>" (602.1) -> an activated ability, or null if the line isn't
 * one. `number` numbers the card's abilities, for ids.
 */
function parseActivatedAbility(line, normalized, number, problems) {
  const match = /^([^:.]+): (.+)$/.exec(normalized);
  if (!match) return null;
  const cost = parseCost(match[1], problems);
  // "It" at the start of an ability's effect means its source, e.g. "Sacrifice ~: It deals 1 damage ...".
  let effectText = match[2].replace(/^It /, '~ ');
  let timing = null;
  if (/ Activate only as a sorcery\.$/.test(effectText)) {
    effectText = effectText.replace(/ Activate only as a sorcery\.$/, '');
    timing = ACTIVATION_TIMING.SORCERY;
  }
  const { effects, target, failed } = parseEffects(effectText, problems);
  if (failed) problems.push(`Unsupported rules text: "${line}"`);
  if (!cost || failed || effects.length === 0) return { ability: null };
  const manaOnly = effects.every((e) => e.type === EFFECT.ADD_MANA) && !target;
  const id = manaOnly && Object.keys(cost).join() === 'tap' && effects.length === 1
    ? `tapFor${Object.entries(effects[0].mana).map(([type, n]) => type.repeat(n)).join('')}`
    : `ability${number}`;
  return {
    ability: {
      id,
      text: line,
      cost,
      ...(effects.length === 1 ? { effect: effects[0] } : { effects }),
      ...(timing ? { timing } : {}),
      ...(target ? { target } : {}),
    },
  };
}

/**
 * "Enchanted creature gets +2/+2 and has flying and trample." -> a static ability,
 * or null if the line isn't one.
 */
function parseAttachedBonus(line, problems) {
  const match = /^(Enchanted|Equipped) creature (?:gets ([+-]\d+)\/([+-]\d+))?(?: and )?(?:has (.+))?\.$/.exec(line);
  if (!match || (!match[2] && !match[4])) return null;
  const keywords = match[4] ? parseKeywordList(match[4], problems) : [];
  if (!keywords) return { kind: match[1], effect: null };
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
  const spellTargets = [];
  let additionalCost = null;
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
      const ability = typeInfo.supertypes.includes('Basic') && inner
        ? parseActivatedAbility(inner, inner, abilities.length + 1, problems)?.ability : null;
      if (ability) abilities.push(ability);
      continue;
    }
    const normalized = normalizeSelfReferences(withoutReminder, card.name);

    if (isSpellCard) {
      // 601.2f: "As an additional cost to cast this spell, sacrifice a creature."
      const extra = /^As an additional cost to cast ~, (.+)\.$/.exec(normalized);
      if (extra) {
        additionalCost = parseCost(extra[1], problems);
        if (additionalCost && (additionalCost.tap || additionalCost.sacrificeSelf || additionalCost.mana)) {
          problems.push(`Unsupported additional cost: "${extra[1]}".`);
        }
        continue;
      }
      // An instant or sorcery's rules text is its effect, one sentence at a time (608.2c).
      for (const sentence of sentences(normalized)) {
        const parsed = parseEffects(sentence, problems);
        if (parsed.failed) {
          problems.push(`Unsupported rules text: "${sentence.replaceAll('~', card.name)}"`);
          continue;
        }
        effects.push(...parsed.effects);
        if (parsed.target) spellTargets.push(parsed.target);
      }
      continue;
    }

    const activated = parseActivatedAbility(withoutReminder, normalized, abilities.length + 1, problems);
    if (activated) {
      if (activated.ability) abilities.push(activated.ability);
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
    if (!SUPPORTED_KEYWORDS.has(k) && !SUPPORTED_KEYWORD_ACTIONS.has(k) && !handledKeywords.has(k) && !problems.some((p) => p.toLowerCase().includes(k))) {
      problems.push(`Unsupported keyword: ${k}.`);
    }
  }
  if (isAuraCard && !enchant && !problems.length) problems.push('An Aura needs "Enchant creature".');
  if (spellTargets.length > 1) problems.push(`More than one target isn't supported: "${card.oracle_text}"`);
  if (isSpellCard && effects.length === 0 && !problems.length) problems.push('An instant or sorcery needs rules text.');
  return {
    keywords: [...new Set(keywords)], abilities, staticAbilities, enchant, effects, spellTarget: spellTargets[0] ?? null, additionalCost,
  };
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

  const {
    keywords, abilities, staticAbilities, enchant, effects, spellTarget, additionalCost,
  } = parseOracleText(card, typeInfo, problems);
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
    ...(additionalCost ? { additionalCost } : {}),
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

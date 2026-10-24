/**
 * Converts Scryfall card objects (https://scryfall.com/docs/api/cards) into this
 * game's card definitions, or explains why a card can't be imported yet.
 *
 * Only cards the engine fully supports are converted. Everything a card does must
 * be one of:
 * - a land, creature, artifact, enchantment, instant or sorcery (no supertypes except Basic)
 * - a mana cost of generic and/or W, U, B, R, G, C symbols
 * - numeric power and toughness
 * - supported keywords (see KEYWORD in src/cards/cards.js), and "This creature can't
 *   block." / "This creature can't be blocked." 
 * - activated abilities, "<cost>: <effect>", made of the costs and effect sentences
 *   in rulesText.js (including mana abilities such as "{T}: Add {G}."), optionally
 *   followed by "Activate only as a sorcery."
 * - triggered abilities "When this creature enters, <effect>." and "When this creature
 *   dies, <effect>.", with the same effect sentences
 * - Auras: "Enchant creature" and "Enchanted creature gets +N/+N and has <keywords>.",
 *   optionally ending "and can't block" ("can't attack or block", "can't be blocked")
 * - Equipment: "Equipped creature gets +N/+N and has <keywords>." (likewise) and "Equip {N}"
 * - Instants and sorceries made only of supported effect sentences (at most one
 *   target), optionally with "As an additional cost to cast this spell, <cost>."
 * Anything else, such as other rules text, is reported as unsupported.
 */
import {
  CARD_TYPE, SUBTYPE, EFFECT, TARGET, AFFECTED, ACTIVATION_TIMING, TRIGGER, KEYWORD, equipAbility,
} from '../../src/cards/cards.js';
import {
  normalizeSelfReferences, parseManaSymbols, parseKeywordList, parseEffects, parseCost, sentences, SUPPORTED_KEYWORDS,
} from './rulesText.js';

const SUPPORTED_TYPES = new Set(Object.values(CARD_TYPE));
const SUPPORTED_SUPERTYPES = new Set(['Basic']);
const KNOWN_SUPERTYPES = new Set(['Basic', 'Legendary', 'Snow', 'World', 'Ongoing', 'Elite', 'Host']);
/** Keyword actions (701) Scryfall lists under `keywords` whose rules text is parsed like any other. */
const SUPPORTED_KEYWORD_ACTIONS = new Set(['mill', 'investigate', 'treasure', 'food', 'clue']);

/** "Llanowar Elves" -> "llanowarElves" */
export function cardIdFromName(name) {
  const words = name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '') // "Healer's Hawk" -> healersHawk
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
 * "When ~ enters, <effect>." / "When ~ dies, <effect>." (603.1) -> a triggered
 * ability, `{ ability: null }` if its effect isn't supported, or null if the line
 * isn't one.
 */
function parseTriggeredAbility(line, normalized, problems) {
  const match = /^When ~ (enters(?: the battlefield)?|dies), (.+)$/.exec(normalized);
  if (!match) return null;
  const trigger = match[1] === 'dies' ? TRIGGER.DIES : TRIGGER.ENTERS_BATTLEFIELD;
  // "When ~ enters, you gain 2 life." -> "You gain 2 life."; "it deals ..." means the permanent.
  const effectText = (match[2][0].toUpperCase() + match[2].slice(1)).replace(/^It /, '~ ');
  const { effects, target, failed } = parseEffects(effectText, problems);
  if (failed) problems.push(`Unsupported rules text: "${line}"`);
  if (failed || effects.length === 0) return { ability: null };
  return {
    ability: {
      id: trigger, text: line, trigger, ...(effects.length === 1 ? { effect: effects[0] } : { effects }), ...(target ? { target } : {}),
    },
  };
}

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
  const manaId = (mana) => (mana ? Object.entries(mana).map(([type, n]) => type.repeat(n)).join('') : 'AnyColor');
  const id = manaOnly && Object.keys(cost).join() === 'tap' && effects.length === 1
    ? `tapFor${manaId(effects[0].mana)}`
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

/** 508.1c, 509.1b: restrictions an Aura or Equipment can put on its creature, as keywords. */
const ATTACHED_RESTRICTIONS = {
  "can't attack or block": [KEYWORD.CANT_ATTACK, KEYWORD.CANT_BLOCK],
  "can't attack": [KEYWORD.CANT_ATTACK],
  "can't block": [KEYWORD.CANT_BLOCK],
  "can't be blocked": [KEYWORD.CANT_BE_BLOCKED],
};

/**
 * "Enchanted creature gets +2/+2 and has flying and trample." -> a static ability,
 * or null if the line isn't one. It may end in a restriction: "Enchanted creature
 * can't attack or block." (Pacifism), "Enchanted creature gets +2/+2 and can't block."
 */
function parseAttachedBonus(line, problems) {
  const head = /^(Enchanted|Equipped) creature (.+)\.$/.exec(line);
  if (!head) return null;
  const [, kind, body] = head;
  const restriction = /(?:^| and )(can't attack or block|can't attack|can't block|can't be blocked)$/.exec(body);
  const match = /^(?:gets ([+-]\d+)\/([+-]\d+))?(?: and )?(?:has (.+))?$/.exec(restriction ? body.slice(0, restriction.index) : body);
  if (!match) return null;
  const [, power, toughness, keywordText] = match;
  if (!power && !keywordText && !restriction) return null;
  const keywords = keywordText ? parseKeywordList(keywordText, problems) : [];
  if (!keywords) return { kind, effect: null };
  if (restriction) keywords.push(...ATTACHED_RESTRICTIONS[restriction[1]]);
  return {
    kind,
    effect: {
      affected: AFFECTED.ATTACHED_PERMANENT,
      ...(power && Number(power) ? { power: Number(power) } : {}),
      ...(toughness && Number(toughness) ? { toughness: Number(toughness) } : {}),
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
  const triggeredAbilities = [];
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

    const triggered = parseTriggeredAbility(withoutReminder, normalized, problems);
    if (triggered) {
      if (triggered.ability && triggeredAbilities.some((a) => a.id === triggered.ability.id)) {
        problems.push(`More than one ${triggered.ability.trigger} ability isn't supported: "${line}"`);
      } else if (triggered.ability) {
        triggeredAbilities.push(triggered.ability);
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

    // 509.1b: "This creature can't block." / "This creature can't be blocked.", which
    // this game writes as keywords.
    const restriction = /^~ (can't block|can't be blocked)\.$/.exec(normalized);
    if (restriction) {
      keywords.push(restriction[1] === "can't block" ? KEYWORD.CANT_BLOCK : KEYWORD.CANT_BE_BLOCKED);
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
    keywords: [...new Set(keywords)], abilities, triggeredAbilities, staticAbilities, enchant, effects, spellTarget: spellTargets[0] ?? null, additionalCost,
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
    keywords, abilities, triggeredAbilities, staticAbilities, enchant, effects, spellTarget, additionalCost,
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
    ...(triggeredAbilities.length ? { triggeredAbilities } : {}),
    ...(enchant ? { enchant } : {}),
    ...(effects.length ? { effects } : {}),
    ...(spellTarget ? { target: spellTarget } : {}),
    ...(additionalCost ? { additionalCost } : {}),
    ...(staticAbilities.length ? { staticAbilities } : {}),
    text: card.oracle_text ?? '',
    // Presentation (the app shows the art and credits the artist).
    ...presentation(card),
    // Provenance, for reference only.
    typeLine: card.type_line,
    oracleText: card.oracle_text ?? '',
    scryfallId: card.id,
    scryfallUri: card.scryfall_uri,
  };
  return { ok: true, id, definition };
}

/**
 * What the app needs to show a card: Scryfall's image URLs (`art`: the art crop for
 * the board and hand, `card`: the full card for inspecting it), the artist to
 * credit, colors (as W/U/B/R/G), rarity, set and collector number. Only the
 * fields Scryfall provides are kept.
 */
export function presentation(card) {
  const images = card.image_uris;
  return {
    ...(images ? { image: { art: images.art_crop, card: images.normal } } : {}),
    ...(card.artist ? { artist: card.artist } : {}),
    ...(card.colors ? { colors: card.colors } : {}),
    ...(card.rarity ? { rarity: card.rarity } : {}),
    ...(card.set ? { set: card.set } : {}),
    ...(card.collector_number ? { collectorNumber: card.collector_number } : {}),
  };
}

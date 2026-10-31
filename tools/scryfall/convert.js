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
 * - anthems and lords on any permanent: "[Other] [white | <Subtype>] creatures you control
 *   get +N/+N [and have <keywords>]."
 * - Instants and sorceries made only of supported effect sentences (at most one
 *   target), optionally with "As an additional cost to cast this spell, <cost>."
 * Anything else, such as other rules text, is reported as unsupported.
 */
import {
  CARD_TYPE, SUBTYPE, EFFECT, TARGET, AFFECTED, ACTIVATION_TIMING, TRIGGER, KEYWORD, equipAbility,
} from '../../src/cards/cards.js';
import {
  normalizeSelfReferences, parseManaSymbols, parseKeywordList, parseEffects, parseCost, sentences, SUPPORTED_KEYWORDS,
  parseCount, singularSubtype,
} from './rulesText.js';
import { OVERRIDES } from './overrides.js';

const SUPPORTED_TYPES = new Set(Object.values(CARD_TYPE));
// 704.5j: the legend rule is in the engine.
const SUPPORTED_SUPERTYPES = new Set(['Basic', 'Legendary']);
const KNOWN_SUPERTYPES = new Set(['Basic', 'Legendary', 'Snow', 'World', 'Ongoing', 'Elite', 'Host']);
/**
 * Keyword actions (701) and ability words (207.2c) Scryfall lists under `keywords`
 * whose rules text is parsed like any other.
 */
const SUPPORTED_KEYWORD_ACTIONS = new Set(['mill', 'investigate', 'treasure', 'food', 'clue', 'fight', 'landfall', 'scry', 'amass']);

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

const COLOR_LETTERS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const ENTERS = '(?:enters|enters the battlefield)';

/** Trigger conditions (603.1): a pattern, and the trigger (and filter) it means. */
const TRIGGER_CONDITIONS = [
  {
    pattern: /^When ~ enters or leaves the battlefield, (.+)$/,
    trigger: () => ({ trigger: [TRIGGER.ENTERS_BATTLEFIELD, TRIGGER.LEAVES_BATTLEFIELD] }),
  },
  { pattern: /^When ~ leaves the battlefield, (.+)$/, trigger: () => ({ trigger: TRIGGER.LEAVES_BATTLEFIELD }) },
  { pattern: new RegExp(`^When ~ ${ENTERS}, (.+)$`), trigger: () => ({ trigger: TRIGGER.ENTERS_BATTLEFIELD }) },
  { pattern: /^Whenever you scry, (.+)$/, trigger: () => ({ trigger: TRIGGER.SCRY }) },
  { pattern: /^Whenever the Ring tempts you, (.+)$/, trigger: () => ({ trigger: TRIGGER.RING_TEMPTS }) },
  { pattern: /^Whenever you draw your second card each turn, (.+)$/, trigger: () => ({ trigger: TRIGGER.DRAW_SECOND_CARD }) },
  { pattern: /^Whenever ~ becomes blocked, (.+)$/, trigger: () => ({ trigger: TRIGGER.BECOMES_BLOCKED }) },
  { pattern: /^Whenever ~ deals combat damage to a player, (.+)$/, trigger: () => ({ trigger: TRIGGER.DEALS_COMBAT_DAMAGE_TO_PLAYER }) },
  {
    pattern: /^Whenever you cast an instant or sorcery spell, (.+)$/,
    trigger: () => ({ trigger: TRIGGER.SPELL_CAST, filter: { types: [CARD_TYPE.INSTANT, CARD_TYPE.SORCERY] } }),
  },
  {
    pattern: /^Whenever a creature an opponent controls dies, (.+)$/,
    trigger: () => ({ trigger: TRIGGER.CREATURE_DIES, filter: { controller: 'opponent' } }),
  },
  {
    // "Whenever Elrond or another creature you control enters": itself included.
    pattern: new RegExp(`^Whenever ~ or another creature you control ${ENTERS}, (.+)$`),
    trigger: () => ({ trigger: TRIGGER.CREATURE_ENTERS, filter: {} }),
  },
  {
    pattern: new RegExp(`^Whenever ~ or another ([A-Z][a-z]+) you control ${ENTERS}, (.+)$`),
    trigger: ([, subtype]) => ({ trigger: TRIGGER.CREATURE_ENTERS, filter: { subtypes: [subtype] } }),
  },
  { pattern: /^At the beginning of combat on your turn, (.+)$/, trigger: () => ({ trigger: TRIGGER.BEGINNING_OF_COMBAT }) },
  { pattern: /^At the beginning of your end step, (.+)$/, trigger: () => ({ trigger: TRIGGER.END_STEP }) },
  { pattern: /^At the beginning of your upkeep, (.+)$/, trigger: () => ({ trigger: TRIGGER.UPKEEP }) },
  { pattern: /^When ~ dies, (.+)$/, trigger: () => ({ trigger: TRIGGER.DIES }) },
  { pattern: /^When ~ is put into a graveyard from the battlefield, (.+)$/, trigger: () => ({ trigger: TRIGGER.PUT_INTO_GRAVEYARD }) },
  { pattern: /^Whenever ~ attacks or blocks, (.+)$/, trigger: () => ({ trigger: TRIGGER.ATTACKS_OR_BLOCKS }) },
  { pattern: /^Whenever ~ attacks, (.+)$/, trigger: () => ({ trigger: TRIGGER.ATTACKS }) },
  {
    pattern: new RegExp(`^Whenever another creature you control ${ENTERS}, (.+)$`),
    trigger: () => ({ trigger: TRIGGER.CREATURE_ENTERS, filter: { other: true } }),
  },
  {
    // "Whenever another Elf enters": anyone's.
    pattern: new RegExp(`^Whenever another ([A-Z][a-z]+) ${ENTERS}, (.+)$`),
    trigger: ([, subtype]) => ({ trigger: TRIGGER.CREATURE_ENTERS, filter: { other: true, controller: 'any', subtypes: [subtype] } }),
  },
  {
    // Landfall (an ability word, 207.2c).
    pattern: new RegExp(`^(?:Landfall — )?Whenever a land you control ${ENTERS}, (.+)$`),
    trigger: () => ({ trigger: TRIGGER.LAND_ENTERS }),
  },
  {
    pattern: /^Whenever a player casts an? (white|blue|black|red|green) spell, (.+)$/,
    trigger: ([, color]) => ({ trigger: TRIGGER.SPELL_CAST, filter: { controller: 'any', colors: [COLOR_LETTERS[color]] } }),
  },
];

/** "you gain 3 life." -> "You gain 3 life."; "it deals ..." means the permanent. */
const effectSentence = (text) => (text[0].toUpperCase() + text.slice(1)).replace(/^It /, '~ ');

/**
 * A triggered ability (603.1): "When ~ enters, <effect>.", "When ~ dies, ...", "Whenever
 * ~ attacks, ...", "Whenever another creature you control enters, ..." and the others in
 * TRIGGER_CONDITIONS. The effect may start "you may" (optional), or be "choose one —"
 * followed by `bullets`, the mode lines (700.2). Returns `{ ability }` (null if its
 * effect isn't supported), or null if the line isn't one.
 */
function parseTriggeredAbility(line, normalized, problems, bullets = []) {
  const condition = TRIGGER_CONDITIONS.find(({ pattern }) => pattern.test(normalized));
  if (!condition) return null;
  const match = condition.pattern.exec(normalized);
  const { trigger, filter } = condition.trigger(match);
  const fail = () => {
    problems.push(`Unsupported rules text: "${line}"`);
    return { ability: null };
  };
  let rest = match.at(-1);
  // "This ability triggers only once each turn."
  const oncePerTurn = / This ability triggers only once each turn\.$/.test(rest);
  if (oncePerTurn) rest = rest.replace(/ This ability triggers only once each turn\.$/, '');
  const base = {
    id: Array.isArray(trigger) ? trigger.join('Or') : trigger,
    text: [line, ...bullets.map((b) => b.line)].join('\n'),
    trigger,
    ...(filter ? { filter } : {}),
    ...(oncePerTurn ? { oncePerTurn: true } : {}),
  };
  if (/^choose one —$/.test(rest)) {
    if (bullets.length < 2) return fail();
    const modes = [];
    for (const bullet of bullets) {
      // "• Bardic Inspiration — Target creature gets +2/+2 until end of turn." (the name is flavor).
      const text = bullet.normalized.replace(/^•\s*/, '').replace(/^[A-Z][\w' ]* — /, '');
      const { effects, target, failed } = parseEffects(effectSentence(text), problems);
      if (failed || effects.length === 0) {
        problems.push(`Unsupported rules text: "${bullet.line}"`);
        return { ability: null };
      }
      modes.push({ text: bullet.line.replace(/^•\s*/, ''), effects, ...(target ? { target } : {}) });
    }
    return { ability: { ...base, effects: [], modes } };
  }
  const optional = /^you may /.test(rest);
  if (optional) rest = rest.replace(/^you may /, '');
  const parsed = parseEffects(effectSentence(rest), problems);
  const { effects, targetOther, failed } = parsed;
  const target = parsed.targets ?? parsed.target;
  if (failed || effects.length === 0) return fail();
  // Once it has left the battlefield, "it" is a card in a graveyard, which effects on the
  // permanent itself can't follow (Rancor's "return Rancor to its owner's hand").
  const leaves = trigger === TRIGGER.DIES || trigger === TRIGGER.PUT_INTO_GRAVEYARD;
  if (leaves && effects.some((e) => e.affected === AFFECTED.SOURCE && e.type === EFFECT.RETURN_TO_HAND)) return fail();
  return {
    ability: {
      ...base,
      ...(effects.length === 1 ? { effect: effects[0] } : { effects }),
      ...(Array.isArray(target) ? { targets: target } : target ? { target } : {}),
      ...(targetOther ? { targetOther: true } : {}),
      ...(optional ? { optional: true } : {}),
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
  const parsed = parseEffects(effectText, problems);
  const { effects, failed } = parsed;
  const target = parsed.targets ?? parsed.target;
  if (failed) problems.push(`Unsupported rules text: "${line}"`);
  if (!cost || failed || effects.length === 0) return { ability: null };
  const manaOnly = effects.every((e) => e.type === EFFECT.ADD_MANA && !e.per) && !target;
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
      ...(Array.isArray(target) ? { targets: target } : target ? { target } : {}),
    },
  };
}

/** 509.1b-c: what a permanent says about blocking itself (normalized), as keywords. */
const SELF_RESTRICTIONS = {
  "~ can't block.": KEYWORD.CANT_BLOCK,
  "~ can't be blocked.": KEYWORD.CANT_BE_BLOCKED,
  "~ can't be blocked except by creatures with flying.": KEYWORD.BLOCKED_ONLY_BY_FLYERS,
  "~ can't be blocked by creatures with power 2 or less.": KEYWORD.CANT_BE_BLOCKED_BY_POWER_2_OR_LESS,
  "~ can't be blocked by more than one creature.": KEYWORD.MAX_ONE_BLOCKER,
  '~ must be blocked if able.': KEYWORD.MUST_BE_BLOCKED,
  "~ can't be blocked except by three or more creatures.": KEYWORD.MIN_THREE_BLOCKERS,
  'All creatures able to block ~ do so.': KEYWORD.LURE,
};

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
  // Alpha Status: "+2/+2 for each other creature on the battlefield that shares a creature type with it."
  const each = /^gets \+(\d+)\/\+(\d+) for each other creature on the battlefield that shares a creature type with it$/.exec(body);
  if (each) {
    return {
      kind,
      effect: {
        affected: AFFECTED.ATTACHED_PERMANENT, power: Number(each[1]), toughness: Number(each[2]),
        per: { of: 'creatures', controller: 'any', sharesTypeWith: true },
      },
    };
  }
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

const COLOR_WORDS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

/**
 * An anthem or lord (613.1): "Creatures you control get +1/+1." (Glorious Anthem),
 * "Other white creatures you control get +1/+1." or "Other Soldier creatures you
 * control get +1/+1 and have vigilance." -> a static ability, `{ effect: null }`
 * if it grants unsupported keywords, or null if the line isn't one.
 */
function parseAnthem(line, problems) {
  // "Creatures you control have haste.", "Creature tokens you control have deathtouch.",
  // "Other Birds you control have vigilance.": keywords only.
  const grants = /^(Other )?(?:(Legendary|[A-Z][a-z]+) creatures|Creatures|Creature tokens|([A-Z][a-z]+)) you control have (.+)\.$/.exec(line);
  if (grants) {
    const [, other, kind, plural, keywordText] = grants;
    const keywords = parseKeywordList(keywordText, problems);
    if (!keywords) return { effect: null };
    const filter = line.includes('Creature tokens') ? { token: true } : kind === 'Legendary' ? { supertypes: ['Legendary'] } : null;
    const subtype = plural ? singularSubtype(plural) : kind && kind !== 'Legendary' ? kind : null;
    return {
      effect: {
        affected: AFFECTED.EACH_CREATURE_YOU_CONTROL, keywords,
        ...(other ? { other: true } : {}), ...(subtype ? { subtypes: [subtype] } : {}), ...(filter ? { filter } : {}),
      },
    };
  }
  // "Legendary creatures you control get +1/+0." (Rising of the Day)
  const legendary = /^Legendary creatures you control get ([+-]\d+)\/([+-]\d+)\.$/.exec(line);
  if (legendary) {
    return {
      effect: {
        affected: AFFECTED.EACH_CREATURE_YOU_CONTROL, filter: { supertypes: ['Legendary'] },
        ...(Number(legendary[1]) ? { power: Number(legendary[1]) } : {}), ...(Number(legendary[2]) ? { toughness: Number(legendary[2]) } : {}),
      },
    };
  }
  // "Other Elves you control get +1/+1." names the creature type in the plural, without "creatures".
  const plural = /^(Other )?([A-Z][a-z]+) you control get ([+-]\d+)\/([+-]\d+)(?: and have (.+))?\.$/.exec(line);
  const match = plural && plural[2] !== 'Creatures'
    ? [plural[0], plural[1], singularSubtype(plural[2]), plural[3], plural[4], plural[5]]
    : /^(Other )?(?:(\w+) )?creatures you control get ([+-]\d+)\/([+-]\d+)(?: and have (.+))?\.$/i.exec(line);
  if (!match) return null;
  const [, other, kind, power, toughness, keywordText] = match;
  const color = kind && COLOR_WORDS[kind.toLowerCase()];
  // A creature type is capitalized ("Soldier"); anything else isn't an anthem we know.
  if (kind && !color && !/^[A-Z][a-z]+$/.test(kind)) return null;
  const keywords = keywordText ? parseKeywordList(keywordText, problems) : [];
  if (!keywords) return { effect: null };
  return {
    effect: {
      affected: AFFECTED.EACH_CREATURE_YOU_CONTROL,
      ...(Number(power) ? { power: Number(power) } : {}),
      ...(Number(toughness) ? { toughness: Number(toughness) } : {}),
      ...(keywords.length ? { keywords } : {}),
      ...(other ? { other: true } : {}),
      ...(color ? { colors: [color] } : {}),
      ...(kind && !color ? { subtypes: [kind] } : {}),
    },
  };
}

/**
 * 702.29a: "Cycling {G}" means "{G}, Discard this card: Draw a card.", from the hand.
 * 702.29e: typecycling ("Plainscycling {1}") searches for a card of that type instead:
 * "Search your library for a Plains card, reveal it, put it into your hand, then shuffle."
 * Returns the hand ability, or null if the line isn't cycling.
 */
function parseCycling(line, problems, handledKeywords) {
  const match = /^(Plains|Island|Swamp|Mountain|Forest)?[Cc]ycling ((?:\{[^}]+\})+)$/.exec(line);
  if (!match) return null;
  const [, type, cost] = match;
  handledKeywords.add('cycling');
  if (type) for (const k of ['landcycling', 'typecycling', `${type.toLowerCase()}cycling`]) handledKeywords.add(k);
  const mana = parseManaSymbols(cost, problems, `"${line}"`);
  const effect = type
    ? { type: EFFECT.SEARCH_LIBRARY, filter: { subtypes: [type] }, count: 1, destination: 'hand' }
    : { type: EFFECT.DRAW_CARDS, count: 1 };
  return { id: 'cycling', text: line, cost: { mana, discardSelf: true }, effect };
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
  const spellText = [];
  const handAbilities = [];
  let additionalCost = null;
  let enchant = null;
  let entersTapped = false;
  let costReduction = null;
  let wardCost = null;
  const isSpellCard = typeInfo.types.includes(CARD_TYPE.INSTANT) || typeInfo.types.includes(CARD_TYPE.SORCERY);
  const isAuraCard = typeInfo.subtypes.includes(SUBTYPE.AURA);
  const isEquipmentCard = typeInfo.subtypes.includes(SUBTYPE.EQUIPMENT);
  // Keywords handled below as Aura/Equipment rules rather than as creature keywords.
  const handledKeywords = new Set();
  const lines = (card.oracle_text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const stripReminder = (line) => line.replace(/\s*\([^)]*\)/g, '').trim();

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
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

    // Cycling works from the hand, on any card (702.29a).
    if (isSpellCard && /^(?:Plains|Island|Swamp|Mountain|Forest)?[Cc]ycling \{/.test(withoutReminder)) {
      const cycled = parseCycling(withoutReminder, problems, handledKeywords);
      if (cycled) handAbilities.push(cycled);
      continue;
    }

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
      // An instant or sorcery's rules text is its effect, one sentence at a time (608.2c); each
      // is checked alone, so every unsupported one is reported, then all together (below).
      for (const sentence of sentences(normalized)) {
        const parsed = parseEffects(sentence, []);
        if (parsed.failed) problems.push(`Unsupported rules text: "${sentence.replaceAll('~', card.name)}"`);
      }
      spellText.push(normalized);
      continue;
    }

    // "choose one —" takes the bullet lines after it as its modes (700.2).
    const bullets = [];
    if (/choose one —$/.test(withoutReminder)) {
      while (lines[index + 1]?.startsWith('•')) {
        const bullet = lines[++index];
        bullets.push({ line: bullet, normalized: normalizeSelfReferences(stripReminder(bullet), card.name) });
      }
    }
    const triggered = parseTriggeredAbility(withoutReminder, normalized, problems, bullets);
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

    const anthem = parseAnthem(withoutReminder, problems);
    if (anthem) {
      if (anthem.effect) staticAbilities.push(anthem.effect);
      continue;
    }

    const bonus = parseAttachedBonus(withoutReminder, problems);
    if (bonus) {
      const fits = bonus.kind === 'Enchanted' ? isAuraCard : isEquipmentCard;
      if (!fits) problems.push(`Unsupported rules text: "${line}"`);
      else if (bonus.effect) staticAbilities.push(bonus.effect);
      continue;
    }

    // 509.1b-c: restrictions and requirements on blocking, which this game writes as keywords.
    const restriction = SELF_RESTRICTIONS[normalized];
    if (restriction) {
      keywords.push(restriction);
      continue;
    }

    // 614.1c: "This land enters tapped."
    if (/^~ enters(?: the battlefield)? tapped\.$/.test(normalized)) {
      entersTapped = true;
      continue;
    }

    const cycled = parseCycling(withoutReminder, problems, handledKeywords);
    if (cycled) {
      handAbilities.push(cycled);
      continue;
    }

    // 702.21: "Ward {2}".
    const ward = /^Ward ((?:\{[^}]+\})+)$/.exec(withoutReminder);
    if (ward) {
      handledKeywords.add('ward');
      keywords.push(KEYWORD.WARD);
      wardCost = { mana: parseManaSymbols(ward[1], problems, `"${withoutReminder}"`) };
      continue;
    }

    // 601.2f: "This spell costs {X} less to cast, where X is the total power of creatures you control."
    const reduction = /^~ costs \{X\} less to cast, where X is (.+)\.$/.exec(normalized);
    if (reduction) {
      const per = parseCount(reduction[1]);
      if (per) costReduction = { per };
      else problems.push(`Unsupported rules text: "${line}"`);
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
  // The spell's whole text at once, so effects know which of its targets they're about.
  let spellTarget = null;
  if (isSpellCard && spellText.length && !problems.length) {
    const parsed = parseEffects(spellText.join(' '), problems);
    if (!parsed.failed) {
      effects.push(...parsed.effects);
      spellTarget = parsed.targets ?? parsed.target;
    }
  }
  if (isSpellCard && effects.length === 0 && !problems.length) problems.push('An instant or sorcery needs rules text.');
  return {
    keywords: [...new Set(keywords)], abilities, triggeredAbilities, staticAbilities, enchant, effects, spellTarget, additionalCost,
    handAbilities, entersTapped, costReduction, wardCost,
  };
}

/** Override fields convertScryfallCard reads itself; any others are copied into the definition as they are. */
const OVERRIDE_FIELDS = new Set([
  'keywords', 'abilities', 'triggeredAbilities', 'staticAbilities', 'enchant', 'effects', 'targets', 'target', 'additionalCost',
  'handAbilities', 'entersTapped', 'costReduction', 'ward', 'modes', 'graveyardAbilities', 'power', 'toughness',
]);

/** A hand-written card's rules (see overrides.js), in the shape parseOracleText returns. */
function overrideRules(override) {
  const named = (abilities, prefix) => (abilities ?? []).map((a, i) => ({ id: a.id ?? `${prefix}${i + 1}`, ...a }));
  const triggerName = (a) => (Array.isArray(a.trigger) ? a.trigger.join('Or') : a.trigger);
  return {
    keywords: override.keywords ?? [],
    abilities: named(override.abilities, 'ability'),
    triggeredAbilities: (override.triggeredAbilities ?? []).map((a, i) => ({ id: a.id ?? `${triggerName(a)}${i + 1}`, ...a })),
    staticAbilities: override.staticAbilities ?? [],
    enchant: override.enchant ?? null,
    effects: override.effects ?? [],
    spellTarget: override.targets ?? override.target ?? null,
    additionalCost: override.additionalCost ?? null,
    handAbilities: override.handAbilities ?? [],
    entersTapped: Boolean(override.entersTapped),
    costReduction: override.costReduction ?? null,
    wardCost: override.ward ?? null,
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
  // Cards whose rules are written by hand (tools/scryfall/overrides.js): their text isn't parsed.
  const override = OVERRIDES[name] ?? null;
  const sagaOverride = override && card.layout === 'saga';
  if ((card.layout !== 'normal' && !sagaOverride) || card.card_faces) {
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
  // A Vehicle has power and toughness too (301.7b).
  if (isCreature || (override && card.power !== undefined)) {
    power = override?.power ?? Number(card.power);
    toughness = override?.toughness ?? Number(card.toughness);
    if (override?.power === undefined && (!/^\d+$/.test(card.power ?? '') || !/^\d+$/.test(card.toughness ?? ''))) {
      problems.push(`Unsupported power/toughness ${card.power}/${card.toughness} (only fixed numbers are supported).`);
    }
  }

  const {
    keywords, abilities, triggeredAbilities, staticAbilities, enchant, effects, spellTarget, additionalCost,
    handAbilities, entersTapped, costReduction, wardCost,
  } = override ? overrideRules(override) : parseOracleText(card, typeInfo, problems);
  const knownSubtypes = { [SUBTYPE.AURA]: CARD_TYPE.ENCHANTMENT, [SUBTYPE.EQUIPMENT]: CARD_TYPE.ARTIFACT };
  for (const [subtype, type] of Object.entries(knownSubtypes)) {
    if (typeInfo.subtypes.includes(subtype) && !typeInfo.types.includes(type)) problems.push(`Unsupported: ${subtype} that isn't an ${type}.`);
  }
  // Flash (702.8) works on any spell; other keywords only mean something on creatures (or a Vehicle, by override).
  if (keywords.some((k) => k !== KEYWORD.FLASH) && !isCreature && !override) problems.push('Keywords on non-creatures are not supported.');

  if (problems.length) return { ok: false, name, problems };

  const id = cardIdFromName(name);
  const definition = {
    id,
    name,
    ...(!isLand ? { manaCost: manaCost ?? {} } : {}),
    supertypes: typeInfo.supertypes,
    types: typeInfo.types,
    subtypes: typeInfo.subtypes,
    ...(power !== undefined ? { power, toughness } : {}),
    ...(keywords.length ? { keywords } : {}),
    ...(abilities.length ? { abilities } : {}),
    ...(triggeredAbilities.length ? { triggeredAbilities } : {}),
    ...(enchant ? { enchant } : {}),
    ...(effects.length ? { effects } : {}),
    ...(Array.isArray(spellTarget) ? { targets: spellTarget } : spellTarget ? { target: spellTarget } : {}),
    ...(handAbilities.length ? { handAbilities } : {}),
    ...(entersTapped ? { entersTapped: true } : {}),
    ...(costReduction ? { costReduction } : {}),
    ...(additionalCost ? { additionalCost } : {}),
    ...(staticAbilities.length ? { staticAbilities } : {}),
    ...(wardCost ? { ward: wardCost } : {}),
    ...(override?.modes ? { modes: override.modes } : {}),
    ...(override?.graveyardAbilities ? { graveyardAbilities: override.graveyardAbilities.map((a, i) => ({ id: a.id ?? `graveyard${i + 1}`, ...a })) } : {}),
    // Anything else an override says (`entersTappedUnless`, `cantBeCountered`, `chooseTwo`, ...).
    ...Object.fromEntries(Object.entries(override ?? {}).filter(([key]) => !OVERRIDE_FIELDS.has(key))),
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

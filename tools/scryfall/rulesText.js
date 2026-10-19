/**
 * Parses pieces of Oracle rules text into this game's costs and effects.
 *
 * Before parsing, the card's own name (and "this creature", "this spell", ...) is
 * replaced by "~", so "Prodigal Sorcerer deals 1 damage to any target." reads
 * "~ deals 1 damage to any target.".
 *
 * Supported effect sentences (each may be a whole instant/sorcery or the effect of
 * an activated ability):
 * - "~ deals N damage to <any target | target creature | target player | each creature | each opponent | ...>."
 * - "<Destroy | Exile> <target creature | target artifact or enchantment | all creatures | ...>."
 * - "Return target creature to its owner's hand."
 * - "<Tap | Untap> target creature."
 * - "<Target creature | Creatures you control | ~> get(s) +N/+N [and gain(s) <keywords>] until end of turn."
 * - "Put a +1/+1 counter on <target creature | ~ | each creature you control>."
 * - "<You | Target player | Each opponent | ...> <gain(s) | lose(s)> N life."
 * - "[Target player] draw(s) N cards." / "[Target player] mill(s) N cards."
 * - "Create N P/T <colors> <subtypes> creature token(s) [with <keywords>]."
 * - "Counter target <spell | creature spell | noncreature spell>."
 * - "Add {G}{G}."
 *
 * Supported costs: {T}, mana symbols, "Pay N life", "Sacrifice ~",
 * "Sacrifice a creature" (artifact, enchantment, land, permanent), "Discard a card".
 */
import {
  EFFECT, TARGET, AFFECTED, KEYWORD, COUNTER, effectAffects,
} from '../../src/cards/cards.js';

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
/** "two" -> 2, "3" -> 3, anything else -> NaN. */
export const toNumber = (word) => NUMBER_WORDS[word.toLowerCase()] ?? (/^\d+$/.test(word) ? Number(word) : NaN);

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces the card's name and "this creature"-style self-references with "~". */
export function normalizeSelfReferences(text, cardName) {
  return text
    .replace(new RegExp(escapeRegExp(cardName), 'g'), '~')
    .replace(/\b[Tt]his (?:creature|artifact|enchantment|land|spell|permanent)\b/g, '~')
    // There are no planeswalkers or battles, so "or planeswalker" adds nothing.
    .replace(/ or planeswalker\b/g, '');
}

const MANA_SYMBOL = /\{([^}]+)\}/g;
const MANA_TYPES = new Set(['W', 'U', 'B', 'R', 'G', 'C']);

/** Parses "{3}{G}{G}" into { generic: 3, G: 2 }, collecting unsupported symbols. */
export function parseManaSymbols(text, problems, what) {
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

export const SUPPORTED_KEYWORDS = new Set(Object.values(KEYWORD));

/** "flying, vigilance, and trample" -> ['flying', 'vigilance', 'trample'], reporting unsupported ones. */
export function parseKeywordList(text, problems) {
  const keywords = text.split(/,\s*(?:and\s+)?|\s+and\s+/).map((k) => k.toLowerCase()).filter(Boolean);
  const unsupported = keywords.filter((k) => !SUPPORTED_KEYWORDS.has(k));
  for (const k of unsupported) problems.push(`Unsupported keyword granted: ${k}.`);
  return unsupported.length ? null : keywords;
}

// What a phrase refers to: [affected, target kind (only when it targets)].
const PERMANENT_SUBJECTS = {
  'target creature': [AFFECTED.TARGET, TARGET.CREATURE],
  'target creature you control': [AFFECTED.TARGET, TARGET.CREATURE_YOU_CONTROL],
  'target creature an opponent controls': [AFFECTED.TARGET, TARGET.CREATURE_OPPONENT_CONTROLS],
  "target creature you don't control": [AFFECTED.TARGET, TARGET.CREATURE_OPPONENT_CONTROLS],
  'target artifact': [AFFECTED.TARGET, TARGET.ARTIFACT],
  'target enchantment': [AFFECTED.TARGET, TARGET.ENCHANTMENT],
  'target artifact or enchantment': [AFFECTED.TARGET, TARGET.ARTIFACT_OR_ENCHANTMENT],
  'target land': [AFFECTED.TARGET, TARGET.LAND],
  'target nonland permanent': [AFFECTED.TARGET, TARGET.NONLAND_PERMANENT],
  'target permanent': [AFFECTED.TARGET, TARGET.PERMANENT],
  'all creatures': [AFFECTED.EACH_CREATURE],
  'each creature': [AFFECTED.EACH_CREATURE],
  'creatures you control': [AFFECTED.EACH_CREATURE_YOU_CONTROL],
  'each creature you control': [AFFECTED.EACH_CREATURE_YOU_CONTROL],
  '~': [AFFECTED.SOURCE],
};
const CREATURE_SUBJECTS = Object.fromEntries(Object.entries(PERMANENT_SUBJECTS).filter(([phrase]) => (
  phrase === '~' || phrase.includes('creature')
)));
const PLAYER_SUBJECTS = {
  you: [AFFECTED.YOU],
  'target player': [AFFECTED.TARGET, TARGET.PLAYER],
  'target opponent': [AFFECTED.TARGET, TARGET.OPPONENT],
  'each opponent': [AFFECTED.EACH_OPPONENT],
  'each player': [AFFECTED.EACH_PLAYER],
};
const DAMAGE_RECIPIENTS = {
  'any target': [AFFECTED.TARGET, TARGET.ANY],
  ...Object.fromEntries(Object.entries(CREATURE_SUBJECTS).filter(([phrase]) => phrase !== '~' && !phrase.endsWith('you control'))),
  ...PLAYER_SUBJECTS,
};

/** Looks a phrase up in a subject table, case-insensitively. */
const lookup = (table, phrase) => table[phrase.trim().toLowerCase()] ?? null;

/** An effect object, with `affected` only when it differs from the effect type's default. */
function effect(type, fields, [affected]) {
  const result = { type, ...fields };
  return affected === effectAffects(result) ? result : { ...result, affected };
}

const COLORS = ['white', 'blue', 'black', 'red', 'green', 'colorless'];

/**
 * Sentence patterns, tried in order. Each `parse` returns a list of
 * `[subject, effect]` pairs (subject being a table entry), or null.
 */
const SENTENCES = [
  {
    pattern: /^~ deals (\d+) damage to (.+)\.$/,
    parse: ([, amount, recipients], problems) => {
      const subjects = recipients.split(/ and (?=each |target |any |you)/).map((r) => lookup(DAMAGE_RECIPIENTS, r));
      if (subjects.some((s) => !s)) return null;
      return subjects.map((s) => [s, effect(EFFECT.DEAL_DAMAGE, { amount: Number(amount) }, s)]);
    },
  },
  {
    pattern: /^(Destroy|Exile) (.+)\.$/,
    parse: ([, verb, phrase]) => {
      const subject = lookup(PERMANENT_SUBJECTS, phrase);
      return subject && [[subject, effect(verb === 'Destroy' ? EFFECT.DESTROY : EFFECT.EXILE, {}, subject)]];
    },
  },
  {
    pattern: /^Return (.+?) to (?:its owner's|their owners') hands?\.$/,
    parse: ([, phrase]) => {
      const subject = lookup(PERMANENT_SUBJECTS, phrase);
      return subject && [[subject, effect(EFFECT.RETURN_TO_HAND, {}, subject)]];
    },
  },
  {
    pattern: /^(Tap|Untap) (.+)\.$/,
    parse: ([, verb, phrase]) => {
      const subject = lookup(PERMANENT_SUBJECTS, phrase);
      return subject && [[subject, effect(verb === 'Tap' ? EFFECT.TAP : EFFECT.UNTAP, {}, subject)]];
    },
  },
  {
    pattern: /^(.+?) gets? ([+-]\d+)\/([+-]\d+)(?: and gains? (.+?))? until end of turn\.$/,
    parse: ([, phrase, power, toughness, keywordText], problems) => {
      const subject = lookup(CREATURE_SUBJECTS, phrase);
      const keywords = keywordText ? parseKeywordList(keywordText, problems) : [];
      if (!subject || !keywords) return null;
      const fields = { power: Number(power), toughness: Number(toughness), ...(keywords.length ? { keywords } : {}) };
      return [[subject, effect(EFFECT.PUMP, fields, subject)]];
    },
  },
  {
    pattern: /^(.+?) gains? (.+) until end of turn\.$/,
    parse: ([, phrase, keywordText], problems) => {
      const subject = lookup(CREATURE_SUBJECTS, phrase);
      const keywords = parseKeywordList(keywordText, problems);
      return subject && keywords && [[subject, effect(EFFECT.PUMP, { keywords }, subject)]];
    },
  },
  {
    pattern: /^Put (\w+) \+1\/\+1 counters? on (.+)\.$/,
    parse: ([, count, phrase]) => {
      const subject = lookup(PERMANENT_SUBJECTS, phrase);
      if (!subject || !toNumber(count)) return null;
      return [[subject, effect(EFFECT.ADD_COUNTERS, { counter: COUNTER.PLUS_ONE, count: toNumber(count) }, subject)]];
    },
  },
  {
    pattern: /^(.+?) (gains?|loses?) (\w+) life\.$/,
    parse: ([, phrase, verb, amount]) => {
      const subject = lookup(PLAYER_SUBJECTS, phrase);
      if (!subject || !toNumber(amount)) return null;
      const type = verb.startsWith('gain') ? EFFECT.GAIN_LIFE : EFFECT.LOSE_LIFE;
      return [[subject, effect(type, { amount: toNumber(amount) }, subject)]];
    },
  },
  {
    // "Draw two cards." (you) or "Target player draws a card."
    pattern: /^(?:(.+?) )?([Dd]raws?|[Mm]ills?) (a card|(\w+) cards)\.$/,
    parse: ([, phrase = 'you', verb, , count = 'a']) => {
      const subject = lookup(PLAYER_SUBJECTS, phrase);
      if (!subject || !toNumber(count)) return null;
      const type = verb.toLowerCase().startsWith('draw') ? EFFECT.DRAW_CARDS : EFFECT.MILL;
      return [[subject, effect(type, { count: toNumber(count) }, subject)]];
    },
  },
  {
    pattern: /^Create (\w+) (\d+)\/(\d+) ([a-z ]+?) ((?:[A-Z][a-z]+ )+)creature tokens?(?: with (.+))?\.$/,
    parse: ([, count, power, toughness, colorText, subtypeText, keywordText], problems) => {
      const colors = colorText.split(/ and | /).filter(Boolean);
      const keywords = keywordText ? parseKeywordList(keywordText, problems) : [];
      if (!toNumber(count) || !keywords || colors.some((c) => !COLORS.includes(c))) return null;
      const token = {
        colors: colors.filter((c) => c !== 'colorless'),
        subtypes: subtypeText.trim().split(' '),
        power: Number(power),
        toughness: Number(toughness),
        ...(keywords.length ? { keywords } : {}),
      };
      const you = PLAYER_SUBJECTS.you;
      return [[you, effect(EFFECT.CREATE_TOKEN, { count: toNumber(count), token }, you)]];
    },
  },
  {
    pattern: /^Counter target (spell|creature spell|noncreature spell)\.$/,
    parse: ([, kind]) => {
      const subject = [AFFECTED.TARGET, { spell: TARGET.SPELL, 'creature spell': TARGET.CREATURE_SPELL, 'noncreature spell': TARGET.NONCREATURE_SPELL }[kind]];
      return [[subject, effect(EFFECT.COUNTER_SPELL, {}, subject)]];
    },
  },
  {
    pattern: /^Add ((?:\{[^}]+\})+)\.$/,
    parse: ([, symbols], problems) => {
      const mana = parseManaSymbols(symbols, problems, `"Add ${symbols}."`);
      if (mana.generic || Object.keys(mana).length === 0) return null;
      const you = PLAYER_SUBJECTS.you;
      return [[you, effect(EFFECT.ADD_MANA, { mana }, you)]];
    },
  },
  {
    // Regeneration doesn't exist in this game, so this changes nothing.
    pattern: /^(?:It|They) can't be regenerated\.$/,
    parse: () => [],
  },
];

/** Splits text into sentences. */
export const sentences = (text) => text.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);

/**
 * Parses effect sentences (already normalized with "~") into `{ effects, target }`,
 * or `{ failed: sentence }` for the first sentence that isn't supported. At most
 * one target is allowed across all of them.
 */
export function parseEffects(text, problems) {
  const effects = [];
  const targets = [];
  for (const sentence of sentences(text)) {
    const rule = SENTENCES.find(({ pattern }) => pattern.test(sentence));
    const parsed = rule?.parse(rule.pattern.exec(sentence), problems);
    if (!parsed) return { failed: sentence };
    for (const [[affected, targetKind], parsedEffect] of parsed) {
      if (affected === AFFECTED.TARGET) targets.push(targetKind);
      effects.push(parsedEffect);
    }
  }
  if (targets.length > 1) {
    problems.push(`More than one target isn't supported: "${text}"`);
    return { effects: [], target: null };
  }
  return { effects, target: targets[0] ?? null };
}

const SACRIFICE_KINDS = {
  creature: TARGET.CREATURE, artifact: TARGET.ARTIFACT, enchantment: TARGET.ENCHANTMENT, land: TARGET.LAND, permanent: TARGET.PERMANENT,
};

/**
 * Parses a cost such as "{1}, {T}, Sacrifice ~" into a cost object, reporting
 * unsupported parts. Returns null if any part is unsupported.
 */
export function parseCost(text, problems) {
  const cost = {};
  let ok = true;
  for (const part of text.split(/,\s*/)) {
    let match;
    if (part === '{T}') {
      cost.tap = true;
    } else if (/^(?:\{[^}]+\})+$/.test(part)) {
      const mana = parseManaSymbols(part, problems, `the cost "${text}"`);
      for (const [type, n] of Object.entries(mana)) cost.mana = { ...cost.mana, [type]: (cost.mana?.[type] ?? 0) + n };
    } else if ((match = /^[Pp]ay (\d+) life$/.exec(part))) {
      cost.life = Number(match[1]);
    } else if (/^[Ss]acrifice ~$/.test(part)) {
      cost.sacrificeSelf = true;
    } else if ((match = /^[Ss]acrifice an? (creature|artifact|enchantment|land|permanent)$/.exec(part))) {
      cost.sacrifice = SACRIFICE_KINDS[match[1]];
    } else if ((match = /^[Dd]iscard (a card|(\w+) cards)$/.exec(part))) {
      cost.discard = match[2] ? toNumber(match[2]) : 1;
      if (!cost.discard) ok = false;
    } else {
      problems.push(`Unsupported cost: "${part}".`);
      ok = false;
    }
  }
  return ok ? cost : null;
}

/**
 * Card definitions, keyed by card id. A card in a game is an instance that points
 * back to its definition through `cardId`.
 *
 * - `manaCost`: `{ G: 1, generic: 2, ... }` (lands have none)
 * - `power` / `toughness`: creatures only
 * - `keywords`: keyword abilities from KEYWORD, e.g. `['flying', 'lifelink']`
 * - `abilities`: activated abilities (602), written as `{ id, text, cost, effects }`
 *   (or `effect` for a single effect)
 *   - `cost`: any of
 *     - `tap: true` ({T})
 *     - `mana: { G: 1, generic: 2, ... }`
 *     - `life: n` (paying life, 119.4)
 *     - `sacrificeSelf: true` ("Sacrifice this creature")
 *     - `sacrifice: kind`, where kind is a TARGET permanent kind ("Sacrifice a creature")
 *     - `discard: n` ("Discard a card")
 *   - `effects`: see EFFECT, applied in order on resolution (608.2c)
 *   - `timing`: `'sorcery'` to allow activation only at sorcery speed (default: any time with priority)
 *   - `target`: a TARGET kind, for abilities that target (e.g. equip)
 * - `triggeredAbilities` (603): `{ id, text, trigger, effects, target? }`, where
 *   `trigger` is a TRIGGER value. Effects and targets work as for activated abilities.
 * - `enchant`: for Auras, the TARGET kind the Aura can enchant (303.4a)
 * - Instants and sorceries: `effects` (applied in order on resolution) and an
 *   optional `target` (a TARGET kind) that effects such as damage use
 * - `additionalCost`: a cost (same format as an ability's) paid on top of the mana
 *   cost to cast the spell (601.2f), e.g. `{ sacrifice: 'creature' }`
 *
 * Each effect applies to whatever its `affected` field (an AFFECTED value) says;
 * when it's missing, effects in TARGETED_EFFECTS apply to the target and the rest
 * to the controller ("you").
 * - `staticAbilities`: continuous effects, e.g. an Aura's or Equipment's
 *   `{ affected: 'attachedPermanent', power: 2, toughness: 0, keywords: ['flying'] }`
 * - `text`: rules text, for display
 */
import { IMPORTED_CARDS } from './importedCards.js';

export const CARD_TYPE = Object.freeze({
  LAND: 'Land',
  CREATURE: 'Creature',
  ARTIFACT: 'Artifact',
  ENCHANTMENT: 'Enchantment',
  INSTANT: 'Instant',
  SORCERY: 'Sorcery',
});

export const SUBTYPE = Object.freeze({
  AURA: 'Aura', // 303.4
  EQUIPMENT: 'Equipment', // 301.5
});

/**
 * What a spell or ability can target (115). The permanent kinds also say what a
 * "Sacrifice a ..." cost accepts.
 */
export const TARGET = Object.freeze({
  // Permanents
  CREATURE: 'creature',
  CREATURE_YOU_CONTROL: 'creatureYouControl',
  CREATURE_OPPONENT_CONTROLS: 'creatureOpponentControls',
  ARTIFACT: 'artifact',
  ENCHANTMENT: 'enchantment',
  ARTIFACT_OR_ENCHANTMENT: 'artifactOrEnchantment',
  LAND: 'land',
  NONLAND_PERMANENT: 'nonlandPermanent',
  PERMANENT: 'permanent',
  // Players
  PLAYER: 'player',
  OPPONENT: 'opponent',
  /** A creature or a player (115.4; there are no planeswalkers or battles here). */
  ANY: 'any',
  // Spells on the stack (115.1a)
  SPELL: 'spell',
  CREATURE_SPELL: 'creatureSpell',
  NONCREATURE_SPELL: 'noncreatureSpell',
});

/** Who or what a static ability or an effect applies to. */
export const AFFECTED = Object.freeze({
  /** The permanent this one is attached to: "enchanted creature", "equipped creature". */
  ATTACHED_PERMANENT: 'attachedPermanent',
  /** The spell's or ability's target. */
  TARGET: 'target',
  /** The spell's or ability's controller. */
  YOU: 'you',
  EACH_OPPONENT: 'eachOpponent',
  EACH_PLAYER: 'eachPlayer',
  EACH_CREATURE: 'eachCreature',
  EACH_CREATURE_YOU_CONTROL: 'eachCreatureYouControl',
  /** The ability's source, the permanent itself ("this creature"). */
  SOURCE: 'source',
});

/** Kinds of counters (122). */
export const COUNTER = Object.freeze({
  PLUS_ONE: '+1/+1',
});

/** Keyword abilities (702). */
export const KEYWORD = Object.freeze({
  DEATHTOUCH: 'deathtouch', // 702.2
  DEFENDER: 'defender', // 702.3
  DOUBLE_STRIKE: 'double strike', // 702.4
  FIRST_STRIKE: 'first strike', // 702.7
  FLYING: 'flying', // 702.9
  HASTE: 'haste', // 702.10
  LIFELINK: 'lifelink', // 702.15
  REACH: 'reach', // 702.17
  TRAMPLE: 'trample', // 702.19
  VIGILANCE: 'vigilance', // 702.20
  MENACE: 'menace', // 702.111
});

export const EFFECT = Object.freeze({
  // Players
  /**
   * `{ mana }` (106.4), or `{ anyColor: n }` for "Add n mana of any one color". The
   * color is chosen when the spell or ability is cast or activated: its action
   * carries `manaColor`.
   */
  ADD_MANA: 'addMana',
  /** `{ count }` (121). */
  DRAW_CARDS: 'drawCards',
  /** `{ amount }` (119.3). */
  GAIN_LIFE: 'gainLife',
  /** `{ amount }` (119.3). */
  LOSE_LIFE: 'loseLife',
  /** `{ count }`: the top cards of the library go to the graveyard (701.13). */
  MILL: 'mill',
  /**
   * `{ count, token }`: tokens (111). `token` is a TOKEN name such as `'treasure'`,
   * or a creature token: `{ name?, colors?, subtypes?, power, toughness, keywords? }`.
   */
  CREATE_TOKEN: 'createToken',
  // Players or creatures
  /** `{ amount }` damage (120). */
  DEAL_DAMAGE: 'dealDamage',
  // Permanents
  /** Attach the ability's source to its target (701.3), e.g. equip. */
  ATTACH: 'attach',
  /** Destroy (701.7). */
  DESTROY: 'destroy',
  /** Exile (701.5). */
  EXILE: 'exile',
  /** Return to its owner's hand. */
  RETURN_TO_HAND: 'returnToHand',
  /** Tap (701.21). */
  TAP: 'tap',
  /** Untap (701.21). */
  UNTAP: 'untap',
  /** `{ power, toughness, keywords? }` for a creature until end of turn (611.2). */
  PUMP: 'pump',
  /** `{ counter, count }`: put counters on a permanent (122). */
  ADD_COUNTERS: 'addCounters',
  // Spells
  /** Counter a spell (701.6). */
  COUNTER_SPELL: 'counterSpell',
});

/** Effects that apply to the spell's or ability's target (unless `affected` says otherwise). */
export const TARGETED_EFFECTS = Object.freeze(new Set([
  EFFECT.ATTACH, EFFECT.DEAL_DAMAGE, EFFECT.DESTROY, EFFECT.EXILE, EFFECT.RETURN_TO_HAND, EFFECT.TAP,
  EFFECT.UNTAP, EFFECT.PUMP, EFFECT.ADD_COUNTERS, EFFECT.COUNTER_SPELL,
]));
/** Effects that hurt whatever they affect, for AI decisions. */
export const HARMFUL_EFFECTS = Object.freeze(new Set([
  EFFECT.DEAL_DAMAGE, EFFECT.DESTROY, EFFECT.EXILE, EFFECT.RETURN_TO_HAND, EFFECT.TAP, EFFECT.LOSE_LIFE,
  EFFECT.MILL, EFFECT.COUNTER_SPELL,
]));

/** What an effect applies to: its `affected` field, or the default for its type. */
export const effectAffects = (effect) => effect.affected
  ?? (TARGETED_EFFECTS.has(effect.type) ? AFFECTED.TARGET : AFFECTED.YOU);

/** Whether an effect hurts what it affects, e.g. damage or -2/-2 (for AI decisions). */
export const isHarmfulEffect = (effect) => HARMFUL_EFFECTS.has(effect.type)
  || (effect.type === EFFECT.PUMP && (effect.power ?? 0) + (effect.toughness ?? 0) < 0);

/** An ability's effects, whether written as `effects` or a single `effect`. */
export const abilityEffects = (ability) => ability.effects ?? (ability.effect ? [ability.effect] : []);

/** What a triggered ability triggers on (603.1), always about the permanent itself. */
export const TRIGGER = Object.freeze({
  /** "When this permanent enters" (603.6a). */
  ENTERS_BATTLEFIELD: 'entersBattlefield',
  /** "When this creature dies": put into a graveyard from the battlefield (700.4, 603.10a). */
  DIES: 'dies',
});

export const ACTIVATION_TIMING = Object.freeze({
  /** Any time the player has priority (602.2). */
  INSTANT: 'instant',
  /** Only in the player's main phase with an empty stack, like loyalty abilities (606.3). */
  SORCERY: 'sorcery',
});

const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

const TAP_FOR_G = { id: 'tapForG', text: '{T}: Add {G}.', cost: { tap: true }, effect: { type: EFFECT.ADD_MANA, mana: { G: 1 } } };

/** Cards defined in this file. Imported cards can't replace these. */
export const HAND_WRITTEN_CARDS = deepFreeze({
  forest: {
    id: 'forest',
    name: 'Forest',
    supertypes: ['Basic'],
    types: [CARD_TYPE.LAND],
    subtypes: ['Forest'],
    // 305.6: a basic Forest has the intrinsic ability "{T}: Add {G}."
    abilities: [TAP_FOR_G],
  },
  llanowarElves: {
    id: 'llanowarElves',
    name: 'Llanowar Elves',
    manaCost: { G: 1 },
    types: [CARD_TYPE.CREATURE],
    subtypes: ['Elf', 'Druid'],
    power: 1,
    toughness: 1,
    abilities: [TAP_FOR_G],
  },
});

/** Predefined tokens (111.10), for `{ type: 'createToken', token: TOKEN.TREASURE }`. */
export const TOKEN = Object.freeze({
  TREASURE: 'treasure', // 111.10a
  FOOD: 'food', // 111.10b
  CLUE: 'clue', // 111.10f
});

/** Definitions of the predefined tokens, keyed by TOKEN name. They're colorless artifacts. */
export const TOKENS = deepFreeze({
  [TOKEN.TREASURE]: {
    name: 'Treasure',
    types: [CARD_TYPE.ARTIFACT],
    subtypes: ['Treasure'],
    abilities: [{
      id: 'treasureMana',
      text: '{T}, Sacrifice this artifact: Add one mana of any color.',
      cost: { tap: true, sacrificeSelf: true },
      effects: [{ type: EFFECT.ADD_MANA, anyColor: 1 }],
    }],
    text: '{T}, Sacrifice this artifact: Add one mana of any color.',
  },
  [TOKEN.FOOD]: {
    name: 'Food',
    types: [CARD_TYPE.ARTIFACT],
    subtypes: ['Food'],
    abilities: [{
      id: 'eat',
      text: '{2}, {T}, Sacrifice this artifact: You gain 3 life.',
      cost: { mana: { generic: 2 }, tap: true, sacrificeSelf: true },
      effects: [{ type: EFFECT.GAIN_LIFE, amount: 3 }],
    }],
    text: '{2}, {T}, Sacrifice this artifact: You gain 3 life.',
  },
  [TOKEN.CLUE]: {
    name: 'Clue',
    types: [CARD_TYPE.ARTIFACT],
    subtypes: ['Clue'],
    abilities: [{
      id: 'investigate',
      text: '{2}, Sacrifice this artifact: Draw a card.',
      cost: { mana: { generic: 2 }, sacrificeSelf: true },
      effects: [{ type: EFFECT.DRAW_CARDS, count: 1 }],
    }],
    text: '{2}, Sacrifice this artifact: Draw a card.',
  },
});

/** The colors "one mana of any color" can be (105.1). */
export const COLORS_OF_MANA = Object.freeze(['W', 'U', 'B', 'R', 'G']);

/** Whether a spell's or ability's effects need a mana color chosen (`anyColor`). */
export const needsManaColor = (effects) => effects.some((e) => e.type === EFFECT.ADD_MANA && e.anyColor);

/** Every card: imported from Scryfall (src/cards/importedCards.js) plus the hand-written ones. */
export const CARDS = deepFreeze({ ...structuredClone(IMPORTED_CARDS), ...HAND_WRITTEN_CARDS });

/** 40 cards: 20 Forests and 20 Llanowar Elves. */
export const DEFAULT_DECK = Object.freeze([...Array(20).fill('forest'), ...Array(20).fill('llanowarElves')]);

export const isLand = (card) => card.types.includes(CARD_TYPE.LAND);
export const isCreature = (card) => card.types.includes(CARD_TYPE.CREATURE);
export const isInstant = (card) => card.types.includes(CARD_TYPE.INSTANT);
export const isSorcery = (card) => card.types.includes(CARD_TYPE.SORCERY);
/** 110.4: instants and sorceries can't be permanents; everything else here is. */
export const isPermanentCard = (card) => !isInstant(card) && !isSorcery(card);
export const isArtifact = (card) => card.types.includes(CARD_TYPE.ARTIFACT);
export const isEnchantment = (card) => card.types.includes(CARD_TYPE.ENCHANTMENT);
export const isAura = (card) => isEnchantment(card) && (card.subtypes ?? []).includes(SUBTYPE.AURA);
export const isEquipment = (card) => isArtifact(card) && (card.subtypes ?? []).includes(SUBTYPE.EQUIPMENT);
export const hasKeyword = (card, keyword) => (card.keywords ?? []).includes(keyword);

/** Mana value (202.3): the total amount of mana in a mana cost. */
export const manaValue = (manaCost) => Object.values(manaCost ?? {}).reduce((sum, n) => sum + n, 0);

/** "Equip {N}" (702.6): attach to target creature you control, sorcery speed only. */
export const equipAbility = (mana, text = `Equip ${'{'}${mana.generic ?? 0}${'}'}`) => ({
  id: 'equip',
  text,
  cost: { mana },
  timing: ACTIVATION_TIMING.SORCERY,
  target: TARGET.CREATURE_YOU_CONTROL,
  effect: { type: EFFECT.ATTACH },
});

/**
 * 605.1a: an activated ability is a mana ability if it could add mana, has no
 * target, and isn't a loyalty ability. Mana abilities don't use the stack (605.3b).
 */
export const isManaAbility = (ability) => !ability.target
  && abilityEffects(ability).some((effect) => effect.type === EFFECT.ADD_MANA);

/** Target kinds that pick spells on the stack rather than permanents or players. */
export const SPELL_TARGETS = Object.freeze(new Set([TARGET.SPELL, TARGET.CREATURE_SPELL, TARGET.NONCREATURE_SPELL]));
/** Target kinds that pick players (TARGET.ANY picks players or creatures). */
export const PLAYER_TARGETS = Object.freeze(new Set([TARGET.PLAYER, TARGET.OPPONENT]));

/**
 * Whether a permanent is of a TARGET permanent kind, from the point of view of
 * `controllerId` (for "you control" and "an opponent controls").
 */
export function matchesPermanentKind(permanent, kind, controllerId) {
  switch (kind) {
    case TARGET.CREATURE:
    case TARGET.ANY:
      return isCreature(permanent);
    case TARGET.CREATURE_YOU_CONTROL: return isCreature(permanent) && permanent.controllerId === controllerId;
    case TARGET.CREATURE_OPPONENT_CONTROLS: return isCreature(permanent) && permanent.controllerId !== controllerId;
    case TARGET.ARTIFACT: return isArtifact(permanent);
    case TARGET.ENCHANTMENT: return isEnchantment(permanent);
    case TARGET.ARTIFACT_OR_ENCHANTMENT: return isArtifact(permanent) || isEnchantment(permanent);
    case TARGET.LAND: return isLand(permanent);
    case TARGET.NONLAND_PERMANENT: return !isLand(permanent);
    case TARGET.PERMANENT: return true;
    default: return false;
  }
}

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
 *   `{ affected: 'attachedPermanent', power: 2, toughness: 0, keywords: ['flying'] }`,
 *   or a creature's own `{ affected: 'source', condition: 'equipped', power: 1, ... }`
 *   ("As long as this creature is equipped, it gets +1/+1 ...")
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
  /** A creature in combat: "target attacking creature", "target attacking or blocking creature". */
  ATTACKING_CREATURE: 'attackingCreature',
  ATTACKING_OR_BLOCKING_CREATURE: 'attackingOrBlockingCreature',
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
  /** "target Elf you control". */
  ELF_YOU_CONTROL: 'elfYouControl',
  /** A card in a graveyard (115.1): "target permanent card from your graveyard". */
  PERMANENT_CARD_IN_YOUR_GRAVEYARD: 'permanentCardInYourGraveyard',
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
  /**
   * For spells and abilities, each creature you control. As a static ability (an
   * anthem: "Creatures you control get +1/+1.", 613.1), it can be narrowed with
   * `other: true` ("Other creatures"), `colors: ['W']` ("White creatures") and
   * `subtypes: ['Soldier']` ("Soldier creatures").
   */
  EACH_CREATURE_YOU_CONTROL: 'eachCreatureYouControl',
  EACH_CREATURE_OPPONENTS_CONTROL: 'eachCreatureOpponentsControl',
  /** The ability's source, the permanent itself ("this creature"). */
  SOURCE: 'source',
});

/** When a static ability applies ("As long as this creature is equipped, ..."); none means always. */
export const CONDITION = Object.freeze({
  /** An Equipment is attached to the source (301.5). */
  EQUIPPED: 'equipped',
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
  // Not keywords in the rules, but blocking restrictions (509.1b) written like them:
  // printed ("This creature can't block.") or for a turn ("Target creature can't block
  // this turn.", a PUMP that grants it).
  CANT_BLOCK: "can't block",
  CANT_BE_BLOCKED: "can't be blocked",
  /** 508.1c: "Enchanted creature can't attack or block." (Pacifism) grants this and CANT_BLOCK. */
  CANT_ATTACK: "can't attack",
  /** "This creature can't be blocked except by creatures with flying." (509.1b) */
  BLOCKED_ONLY_BY_FLYERS: "can't be blocked except by flyers",
  /** "This creature can't be blocked by creatures with power 2 or less." (509.1b) */
  CANT_BE_BLOCKED_BY_POWER_2_OR_LESS: "can't be blocked by power 2 or less",
  /** "This creature can't be blocked by more than one creature." (509.1b) */
  MAX_ONE_BLOCKER: "can't be blocked by more than one creature",
  /** Blocking requirements (509.1c): "This creature must be blocked if able." */
  MUST_BE_BLOCKED: 'must be blocked',
  /** "All creatures able to block this creature do so." (509.1c) */
  LURE: 'all creatures able to block it do so',
  /** 702.8: the spell can be cast any time its controller could cast an instant. */
  FLASH: 'flash',
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
  /**
   * 701.14: the first target fights the second: each deals damage equal to its power to
   * the other. Uses the spell's two `targets`.
   */
  FIGHT: 'fight',
  // Cards in graveyards
  /** Return the target card from a graveyard to its owner's hand. */
  RETURN_FROM_GRAVEYARD: 'returnFromGraveyard',
  // Spells
  /** Counter a spell (701.6). */
  COUNTER_SPELL: 'counterSpell',
});

/** Effects that apply to the spell's or ability's target (unless `affected` says otherwise). */
export const TARGETED_EFFECTS = Object.freeze(new Set([
  EFFECT.ATTACH, EFFECT.DEAL_DAMAGE, EFFECT.DESTROY, EFFECT.EXILE, EFFECT.RETURN_TO_HAND, EFFECT.TAP,
  EFFECT.UNTAP, EFFECT.PUMP, EFFECT.ADD_COUNTERS, EFFECT.COUNTER_SPELL, EFFECT.FIGHT, EFFECT.RETURN_FROM_GRAVEYARD,
]));
/** Effects that hurt whatever they affect, for AI decisions. */
export const HARMFUL_EFFECTS = Object.freeze(new Set([
  EFFECT.DEAL_DAMAGE, EFFECT.DESTROY, EFFECT.EXILE, EFFECT.RETURN_TO_HAND, EFFECT.TAP, EFFECT.LOSE_LIFE,
  EFFECT.MILL, EFFECT.COUNTER_SPELL, EFFECT.FIGHT,
]));

/** What an effect applies to: its `affected` field, or the default for its type. */
export const effectAffects = (effect) => effect.affected
  ?? (TARGETED_EFFECTS.has(effect.type) ? AFFECTED.TARGET : AFFECTED.YOU);

/** Whether an effect hurts what it affects, e.g. damage or -2/-2 (for AI decisions). */
export const isHarmfulEffect = (effect) => HARMFUL_EFFECTS.has(effect.type)
  || (effect.type === EFFECT.PUMP && ((effect.power ?? 0) + (effect.toughness ?? 0) < 0
    || (effect.keywords ?? []).some((k) => k === KEYWORD.CANT_BLOCK || k === KEYWORD.CANT_ATTACK)));

/**
 * Whether an Aura is a curse, for AI decisions: it shrinks the creature, or stops it
 * attacking (Weakness, Pacifism). "+2/+2 and can't block" (Maniacal Rage) is a bonus.
 */
export const isCurse = (card) => isAura(card) && (card.staticAbilities ?? []).some((e) => {
  const size = (e.power ?? 0) + (e.toughness ?? 0);
  const keywords = e.keywords ?? [];
  return size < 0 || keywords.includes(KEYWORD.CANT_ATTACK) || (size <= 0 && keywords.includes(KEYWORD.CANT_BLOCK));
});

/** An ability's effects, whether written as `effects` or a single `effect`. */
export const abilityEffects = (ability) => ability.effects ?? (ability.effect ? [ability.effect] : []);

/**
 * What a triggered ability triggers on (603.1). The first five are about the
 * permanent itself; the others watch other objects, narrowed by the ability's
 * `filter`: `{ other?: true, controller?: 'you' | 'any', subtypes?, colors? }`
 * (`controller` defaults to 'you').
 */
export const TRIGGER = Object.freeze({
  /** "When this permanent enters" (603.6a). */
  ENTERS_BATTLEFIELD: 'entersBattlefield',
  /** "When this creature dies": put into a graveyard from the battlefield (700.4, 603.10a). */
  DIES: 'dies',
  /** "When this Aura is put into a graveyard from the battlefield" (any permanent, 603.10a). */
  PUT_INTO_GRAVEYARD: 'putIntoGraveyard',
  /** "Whenever this creature attacks" (508.3a). */
  ATTACKS: 'attacks',
  /** "Whenever this creature attacks or blocks" (508.3a, 509.3c). */
  ATTACKS_OR_BLOCKS: 'attacksOrBlocks',
  /** "Whenever another creature you control enters", "Whenever another Elf enters". */
  CREATURE_ENTERS: 'creatureEnters',
  /** Landfall: "Whenever a land you control enters". */
  LAND_ENTERS: 'landEnters',
  /** "Whenever a player casts a green spell" (603.2, 601.2i). */
  SPELL_CAST: 'spellCast',
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
  // Auriok Glaivemaster, made a hobbit. The art is generated (app/art/, see tools/shire-bounder-art.svg).
  shireBounder: {
    id: 'shireBounder',
    name: 'Shire Bounder',
    manaCost: { W: 1 },
    types: [CARD_TYPE.CREATURE],
    subtypes: ['Halfling', 'Soldier'],
    power: 1,
    toughness: 1,
    staticAbilities: [{
      affected: AFFECTED.SOURCE, condition: CONDITION.EQUIPPED, power: 1, toughness: 1, keywords: [KEYWORD.FIRST_STRIKE],
    }],
    text: 'As long as Shire Bounder is equipped, it gets +1/+1 and has first strike.',
    image: { art: 'app/art/shire-bounder.jpg' },
    colors: ['W'],
    rarity: 'common',
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

/** A creature token's name: its own, or its subtypes ("Elf Warrior Token"). */
export function creatureTokenName(token) {
  return token.name ?? `${(token.subtypes ?? []).join(' ')} Token`.trim();
}

/**
 * The card id the game gives a token, from a `createToken` effect's `token`: a TOKEN
 * name (`'token:treasure'`) or a creature token's description. Tokens alike share it.
 */
export function tokenCardId(token) {
  if (typeof token === 'string') return `token:${token}`;
  const colors = token.colors ?? [];
  const keywords = token.keywords ?? [];
  return `token:${creatureTokenName(token)}:${token.power}/${token.toughness}:${colors.join(',')}:${keywords.join(',')}`;
}

const COLOR_LETTERS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

/**
 * A card's colors as W/U/B/R/G (105.1): its `colors` (letters, or words for creature
 * tokens), else those of the mana symbols in its cost (202.2).
 */
export const colorsOf = (card) => (card.colors
  ? card.colors.map((c) => COLOR_LETTERS[c] ?? c)
  : COLORS_OF_MANA.filter((c) => card.manaCost?.[c]));

/** Whether an anthem (a static ability affecting creatures you control) applies to `creature`. */
export function anthemApplies(effect, source, creature) {
  return effect.affected === AFFECTED.EACH_CREATURE_YOU_CONTROL && isCreature(creature)
    && creature.controllerId === source.controllerId
    && !(effect.other && creature.id === source.id)
    && (!effect.colors || effect.colors.some((c) => colorsOf(creature).includes(c)))
    && (!effect.subtypes || effect.subtypes.some((t) => (creature.subtypes ?? []).includes(t)));
}

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
export const hasSubtype = (card, subtype) => (card.subtypes ?? []).includes(subtype);
export const isLegendary = (card) => (card.supertypes ?? []).includes('Legendary');
/** 304.1, 702.8a: instants, and spells with flash, can be cast any time their controller has priority. */
export const castsAtInstantSpeed = (card) => isInstant(card) || hasKeyword(card, KEYWORD.FLASH);
/** 702.3b, 508.1c: a creature with defender or "can't attack" never attacks. */
export const cantAttack = (card) => hasKeyword(card, KEYWORD.DEFENDER) || hasKeyword(card, KEYWORD.CANT_ATTACK);

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
 * `controllerId` (for "you control" and "an opponent controls"). `combat` (the
 * game's) says which creatures are attacking or blocking.
 */
export function matchesPermanentKind(permanent, kind, controllerId, combat = null) {
  const attacking = () => combat?.attackers.some((a) => a.cardId === permanent.id) ?? false;
  switch (kind) {
    case TARGET.ATTACKING_CREATURE: return isCreature(permanent) && attacking();
    case TARGET.ATTACKING_OR_BLOCKING_CREATURE:
      return isCreature(permanent) && (attacking() || (combat?.attackers.some((a) => a.blockerIds.includes(permanent.id)) ?? false));
    case TARGET.CREATURE:
    case TARGET.ANY:
      return isCreature(permanent);
    case TARGET.CREATURE_YOU_CONTROL: return isCreature(permanent) && permanent.controllerId === controllerId;
    case TARGET.CREATURE_OPPONENT_CONTROLS: return isCreature(permanent) && permanent.controllerId !== controllerId;
    case TARGET.ELF_YOU_CONTROL: return permanent.controllerId === controllerId && hasSubtype(permanent, 'Elf');
    case TARGET.ARTIFACT: return isArtifact(permanent);
    case TARGET.ENCHANTMENT: return isEnchantment(permanent);
    case TARGET.ARTIFACT_OR_ENCHANTMENT: return isArtifact(permanent) || isEnchantment(permanent);
    case TARGET.LAND: return isLand(permanent);
    case TARGET.NONLAND_PERMANENT: return !isLand(permanent);
    case TARGET.PERMANENT: return true;
    default: return false;
  }
}

/**
 * Whether an object matches a filter: `{ other?, controller?, subtypes?, colors?,
 * enteredThisTurn? }`, from the point of view of `controllerId` and the source
 * `sourceId` ("another", "you control"). `controller` is 'you' (the default) or 'any'.
 */
export function matchesFilter(object, filter = {}, { controllerId, sourceId } = {}) {
  if (filter.other && object.id === sourceId) return false;
  if ((filter.controller ?? 'you') === 'you' && object.controllerId !== controllerId) return false;
  if (filter.subtypes && !filter.subtypes.some((t) => hasSubtype(object, t))) return false;
  if (filter.colors && !filter.colors.some((c) => colorsOf(object).includes(c))) return false;
  if (filter.enteredThisTurn && !object.enteredThisTurn) return false;
  return true;
}

/** Whether two creatures share a creature type (205.3m): any subtype in common. */
const sharesCreatureType = (a, b) => (a.subtypes ?? []).some((t) => hasSubtype(b, t));

/**
 * A number on the battlefield, for effects that say "for each" or "where X is"
 * (`per` on an effect, a static ability or a cost reduction):
 * `{ of: 'creatures' | 'power', controller?: 'you' | 'any', subtypes?, other?, attacking?, sharesTypeWith? }`
 * counts creatures (or adds up their power) that `controllerId` controls (or any
 * player, with 'any'). `other` leaves out `sourceId`; `attacking` keeps attacking
 * creatures (`combat` is the game's); `sharesTypeWith: true` keeps those that share a
 * creature type with `subject` (and leaves it out), for "each other creature that
 * shares a creature type with it".
 */
export function countOf(spec, { battlefield, controllerId, sourceId = null, subject = null, combat = null }) {
  let creatures = battlefield.filter((p) => isCreature(p)
    && matchesFilter(p, { other: spec.other, controller: spec.controller, subtypes: spec.subtypes }, { controllerId, sourceId }));
  if (spec.attacking) creatures = creatures.filter((p) => combat?.attackers.some((a) => a.cardId === p.id));
  if (spec.sharesTypeWith) creatures = creatures.filter((p) => p.id !== subject?.id && subject && sharesCreatureType(p, subject));
  return spec.of === 'power' ? creatures.reduce((sum, p) => sum + Math.max(0, p.power ?? 0), 0) : creatures.length;
}

/** An effect's amounts multiplied by `n` ("for each", 608.2h), without its `per`. */
export function scaleEffect(effect, n) {
  const { per, ...scaled } = effect;
  for (const field of ['amount', 'count', 'power', 'toughness']) {
    if (typeof scaled[field] === 'number') scaled[field] *= n;
  }
  if (scaled.mana) scaled.mana = Object.fromEntries(Object.entries(scaled.mana).map(([type, k]) => [type, k * n]));
  return scaled;
}

/**
 * What a spell costs to cast now (601.2f): its mana cost, less any cost reduction
 * (`costReduction: { per }`, "This spell costs {X} less to cast, where X is ...",
 * which only reduces the generic part).
 */
export function spellCost(card, { battlefield, controllerId, combat = null }) {
  if (!card.costReduction || !card.manaCost) return card.manaCost;
  const reduction = countOf(card.costReduction.per, { battlefield, controllerId, combat });
  const generic = Math.max(0, (card.manaCost.generic ?? 0) - reduction);
  const { generic: _, ...colored } = card.manaCost;
  return generic ? { ...colored, generic } : colored;
}

/**
 * Whether `blocker` may block `attacker` as far as each creature's own restrictions go
 * (509.1b): "can't block", "can't be blocked", flying (702.9b, reach 702.17b),
 * "except by creatures with flying" and "by creatures with power 2 or less". Restrictions
 * on the whole block (menace, "more than one creature") are checked separately.
 */
export function canBlockCreature(blocker, attacker) {
  if (hasKeyword(blocker, KEYWORD.CANT_BLOCK) || hasKeyword(attacker, KEYWORD.CANT_BE_BLOCKED)) return false;
  if (hasKeyword(attacker, KEYWORD.FLYING) && !hasKeyword(blocker, KEYWORD.FLYING) && !hasKeyword(blocker, KEYWORD.REACH)) return false;
  if (hasKeyword(attacker, KEYWORD.BLOCKED_ONLY_BY_FLYERS) && !hasKeyword(blocker, KEYWORD.FLYING)) return false;
  if (hasKeyword(attacker, KEYWORD.CANT_BE_BLOCKED_BY_POWER_2_OR_LESS) && (blocker.power ?? 0) <= 2) return false;
  return true;
}

/**
 * Card definitions, keyed by card id. A card in a game is an instance that points
 * back to its definition through `cardId`.
 *
 * - `manaCost`: `{ G: 1, generic: 2, ... }` (lands have none)
 * - `power` / `toughness`: creatures only
 * - `keywords`: keyword abilities from KEYWORD, e.g. `['flying', 'lifelink']`
 * - `abilities`: activated abilities (602), written as `{ id, text, cost, effect }`
 *   - `cost`: `{ tap?: true, mana?: { G: 1, ... } }`
 *   - `cost`: may also include `life: n` (paying life, 119.4)
 *   - `effect`: `{ type: 'addMana', mana }`, `{ type: 'drawCards', count }` or `{ type: 'gainLife', amount }`
 *   - `timing`: `'sorcery'` to allow activation only at sorcery speed (default: any time with priority)
 *   - `target`: a TARGET kind, for abilities that target (e.g. equip)
 * - `enchant`: for Auras, the TARGET kind the Aura can enchant (303.4a)
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
});

export const SUBTYPE = Object.freeze({
  AURA: 'Aura', // 303.4
  EQUIPMENT: 'Equipment', // 301.5
});

/** What a spell or ability can target (115). */
export const TARGET = Object.freeze({
  CREATURE: 'creature',
  CREATURE_YOU_CONTROL: 'creatureYouControl',
});

/** Who a static ability affects. */
export const AFFECTED = Object.freeze({
  /** The permanent this one is attached to: "enchanted creature", "equipped creature". */
  ATTACHED_PERMANENT: 'attachedPermanent',
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
  ADD_MANA: 'addMana',
  DRAW_CARDS: 'drawCards',
  GAIN_LIFE: 'gainLife',
  /** Attach the ability's source to its target (701.3), e.g. equip. */
  ATTACH: 'attach',
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

/** 40 cards: 20 Forests and 20 Llanowar Elves. */
/** Every card: imported from Scryfall (src/cards/importedCards.js) plus the hand-written ones. */
export const CARDS = deepFreeze({ ...structuredClone(IMPORTED_CARDS), ...HAND_WRITTEN_CARDS });

export const DEFAULT_DECK = Object.freeze([...Array(20).fill('forest'), ...Array(20).fill('llanowarElves')]);

export const isLand = (card) => card.types.includes(CARD_TYPE.LAND);
export const isCreature = (card) => card.types.includes(CARD_TYPE.CREATURE);
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
export const isManaAbility = (ability) => ability.effect.type === EFFECT.ADD_MANA;

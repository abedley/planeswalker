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
 */
import { IMPORTED_CARDS } from './importedCards.js';

export const CARD_TYPE = Object.freeze({
  LAND: 'Land',
  CREATURE: 'Creature',
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
export const hasKeyword = (card, keyword) => (card.keywords ?? []).includes(keyword);

/**
 * 605.1a: an activated ability is a mana ability if it could add mana, has no
 * target, and isn't a loyalty ability. Mana abilities don't use the stack (605.3b).
 */
export const isManaAbility = (ability) => ability.effect.type === EFFECT.ADD_MANA;

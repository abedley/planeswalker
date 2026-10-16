/**
 * Card definitions, keyed by card id. A card in a game is an instance that points
 * back to its definition through `cardId`.
 *
 * Activated abilities (602) are written as `{ id, text, cost, effect }`:
 * - `cost`: `{ tap?: true, mana?: { G: 1, generic: 1, ... } }`
 * - `effect`: `{ type: 'addMana', mana }` or `{ type: 'drawCards', count }`
 */
export const CARD_TYPE = Object.freeze({
  LAND: 'Land',
});

export const EFFECT = Object.freeze({
  ADD_MANA: 'addMana',
  DRAW_CARDS: 'drawCards',
});

const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

export const CARDS = deepFreeze({
  forest: {
    id: 'forest',
    name: 'Forest',
    supertypes: ['Basic'],
    types: [CARD_TYPE.LAND],
    subtypes: ['Forest'],
    // 305.6: a basic Forest has the intrinsic ability "{T}: Add {G}."
    abilities: [
      { id: 'tapForG', text: '{T}: Add {G}.', cost: { tap: true }, effect: { type: EFFECT.ADD_MANA, mana: { G: 1 } } },
    ],
  },
});

export const DEFAULT_DECK = Object.freeze(Array(10).fill('forest'));

export const isLand = (card) => card.types.includes(CARD_TYPE.LAND);

/**
 * 605.1a: an activated ability is a mana ability if it could add mana, has no
 * target, and isn't a loyalty ability. Mana abilities don't use the stack (605.3b).
 */
export const isManaAbility = (ability) => ability.effect.type === EFFECT.ADD_MANA;

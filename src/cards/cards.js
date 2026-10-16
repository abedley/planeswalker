/**
 * Card definitions, keyed by card id. A card in a game is an instance that points
 * back to its definition through `cardId`.
 */
export const CARD_TYPE = Object.freeze({
  LAND: 'Land',
});

export const CARDS = Object.freeze({
  forest: Object.freeze({
    id: 'forest',
    name: 'Forest',
    supertypes: Object.freeze(['Basic']),
    types: Object.freeze([CARD_TYPE.LAND]),
    subtypes: Object.freeze(['Forest']),
    // 305.6: basic land types have an intrinsic mana ability. Mana isn't implemented yet.
    text: '({T}: Add {G}.)',
  }),
});

export const DEFAULT_DECK = Object.freeze(Array(10).fill('forest'));

export const isLand = (card) => card.types.includes(CARD_TYPE.LAND);

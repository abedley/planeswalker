import { EFFECT, ACTIVATION_TIMING } from './cards.js';

/**
 * Emblem definitions.
 *
 * In this game every player starts with emblems in the command zone that grant
 * them planeswalker-style abilities. Real Magic emblems (114) only have static or
 * triggered abilities; here they can also have activated abilities, which work
 * like a planeswalker's loyalty abilities (606.3): sorcery timing, and a limited
 * number of activations per emblem each turn. Instead of loyalty, the costs are
 * life, mana, or nothing.
 *
 * Abilities use the same format as card abilities (see src/cards/cards.js).
 * `activationsPerTurn` limits how many of an emblem's abilities can be
 * activated each turn, in total.
 */
const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

export const EMBLEMS = deepFreeze({
  planeswalker: {
    id: 'planeswalker',
    name: 'Planeswalker',
    activationsPerTurn: 1,
    abilities: [
      {
        id: 'gainLife',
        text: '0: You gain 1 life.',
        cost: {},
        effect: { type: EFFECT.GAIN_LIFE, amount: 1 },
        timing: ACTIVATION_TIMING.SORCERY,
      },
    ],
  },
});

/** Emblems each player starts with unless the game is told otherwise. */
export const DEFAULT_EMBLEMS = Object.freeze(['planeswalker']);

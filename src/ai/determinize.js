import { Game, copyGameData } from '../engine/Game.js';
import { shuffle } from '../engine/random.js';
import { isLand, castsAtInstantSpeed, manaValue } from '../cards/cards.js';

/**
 * How much less likely a card is in a hidden hand slot, given what the opponent
 * did while holding it (the view's `handInfo`, see Game#getPlayerView):
 * - `noLand`: a land, in a slot held through a turn they played no land
 * - `heldCastable`: a non-instant spell they could have cast with the lands they
 *   left untapped at the end of a turn they held it through
 */
export const INFERENCE_WEIGHTS = Object.freeze({ noLand: 0.02, heldCastable: 0.3 });

/**
 * Turns a player view (Game#getPlayerView) into a complete game snapshot by
 * guessing what that player can't see: the unknown cards are dealt at random into
 * the opponents' hands (keeping their sizes, and the cards known to be there) and
 * into every library, in random order, and the random number generator gets a
 * fresh seed so future shuffles are guesses too. Hidden cards get new ids
 * (`<owner>-h<n>`), since their real ids aren't known either.
 *
 * With `inference` (true, or weights like INFERENCE_WEIGHTS), each hidden hand slot
 * is dealt with weights from what the opponent did while holding that card, as the
 * strongest Hearthstone agents do; otherwise every unknown card is equally likely.
 *
 * Every simulation should use its own determinization, so the AI never relies on
 * one particular guess.
 *
 * @param {object} view From game.getPlayerView(playerId).
 * @param {() => number} random A random number generator returning [0, 1).
 * @param {{ inference?: boolean | object }} [options]
 * @returns {object} A snapshot for Game.deserialize().
 */
export function determinize(view, random, { inference = false } = {}) {
  const snapshot = copyGameData(view);
  const { viewerId } = snapshot;
  const weights = inference ? { ...INFERENCE_WEIGHTS, ...(inference === true ? {} : inference) } : null;
  for (const [playerId, zone] of Object.entries(snapshot.zones)) {
    const cards = shuffle(snapshot.unknownCards[playerId].map((card, i) => ({ ...card, id: `${playerId}-h${i + 1}` })), random);
    if (playerId !== viewerId) {
      const hidden = zone.handSize - zone.hand.length;
      const dealt = weights ? dealWeighted(cards, zone.handInfo ?? [], weights, random) : [];
      zone.hand = [...zone.hand, ...dealt, ...cards.splice(0, hidden - dealt.length)];
      delete zone.handSize;
      delete zone.handInfo;
    }
    zone.library = cards;
    delete zone.librarySize;
  }
  delete snapshot.unknownCards;
  delete snapshot.viewerId;
  snapshot.randomState = Math.floor(random() * 2 ** 32);
  return snapshot;
}

/**
 * Deals a card for each slot of `info` that says something (the rest stay uniform),
 * taking it out of `cards`: weighted sampling without replacement.
 */
function dealWeighted(cards, info, weights, random) {
  const dealt = [];
  for (const slot of info) {
    if (!slot.noLand && !(slot.heldWithMana > 0)) continue;
    const odds = cards.map((card) => weightOf(card, slot, weights));
    const total = odds.reduce((sum, w) => sum + w, 0);
    if (total <= 0) continue;
    let r = random() * total;
    let i = 0;
    while (i < cards.length - 1 && (r -= odds[i]) >= 0) i++;
    dealt.push(...cards.splice(i, 1));
  }
  return dealt;
}

function weightOf(card, { noLand, heldWithMana }, weights) {
  if (isLand(card)) return noLand ? weights.noLand : 1;
  if (!castsAtInstantSpeed(card) && manaValue(card.manaCost ?? {}) <= heldWithMana) return weights.heldCastable;
  return 1;
}

/** A silent, playable game guessed from a player view. */
export function determinizedGame(view, random, options) {
  return Game.deserialize(determinize(view, random, options), { silent: true });
}

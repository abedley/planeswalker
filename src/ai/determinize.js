import { Game, copyGameData } from '../engine/Game.js';
import { shuffle } from '../engine/random.js';

/**
 * Turns a player view (Game#getPlayerView) into a complete game snapshot by
 * guessing what that player can't see: the unknown cards are dealt at random into
 * the opponents' hands (keeping their sizes) and into every library, in random
 * order, and the random number generator gets a fresh seed so future shuffles are
 * guesses too. Hidden cards get new ids (`<owner>-h<n>`), since their real ids
 * aren't known either.
 *
 * Every simulation should use its own determinization, so the AI never relies on
 * one particular guess.
 *
 * @param {object} view From game.getPlayerView(playerId).
 * @param {() => number} random A random number generator returning [0, 1).
 * @returns {object} A snapshot for Game.deserialize().
 */
export function determinize(view, random) {
  const snapshot = copyGameData(view);
  const { viewerId } = snapshot;
  for (const [playerId, zone] of Object.entries(snapshot.zones)) {
    const cards = shuffle(snapshot.unknownCards[playerId].map((card, i) => ({ ...card, id: `${playerId}-h${i + 1}` })), random);
    if (playerId !== viewerId) {
      zone.hand = cards.splice(0, zone.handSize);
      delete zone.handSize;
    }
    zone.library = cards;
    delete zone.librarySize;
  }
  delete snapshot.unknownCards;
  delete snapshot.viewerId;
  snapshot.randomState = Math.floor(random() * 2 ** 32);
  return snapshot;
}

/** A silent, playable game guessed from a player view. */
export function determinizedGame(view, random) {
  return Game.deserialize(determinize(view, random), { silent: true });
}

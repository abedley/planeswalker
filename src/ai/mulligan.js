/**
 * Mulligans (103.5, London): whether to keep an opening hand, and which cards to
 * put on the bottom. Rules of thumb from Limited (Frank Karsten's land counts, and
 * Forge's mulligan threshold): a seven-card hand wants 2 to 5 lands, a six-card
 * hand 2 to 4, and hands of four or fewer are kept whatever they hold.
 */
import { isLand, manaValue } from '../cards/cards.js';
import { permanentValue } from './scoring.js';

/** The hand size from which every hand is kept (Forge's MULLIGAN_THRESHOLD). */
export const KEEP_AT = 4;

/** The fewest and most lands a kept hand of `size` cards should hold. */
export function landRange(size) {
  if (size >= 6) return [2, size - 2];
  return [1, size - 1];
}

/** The share of lands in `me`'s deck (hand and library: their own deck list, not its order). */
export function landShare(state, me) {
  const player = state.players.find((p) => p.id === me);
  const cards = [...player.hand, ...(player.library ?? [])];
  return cards.length ? cards.filter(isLand).length / cards.length : 0;
}

/**
 * Whether to keep `hand` after `mulligans` mulligans (it will be cut to 7 - mulligans
 * cards): whether some choice of the cards to keep has enough lands, and spells.
 * A deck without lands keeps anything.
 */
export function keepsHand(hand, mulligans, share = 0.4) {
  const size = hand.length - mulligans;
  if (size <= KEEP_AT || share === 0) return true;
  const lands = hand.filter(isLand).length;
  const spells = hand.length - lands;
  const [low, high] = landRange(size);
  // The lands it could keep: all but those put on the bottom, and enough to fill the hand.
  const fewest = Math.max(0, size - spells);
  const most = Math.min(lands, size);
  return Math.max(fewest, low) <= Math.min(most, high);
}

/** How many lands a hand of `size` cards should keep, from the deck's share of lands. */
export function landTarget(size, share) {
  const [low, high] = landRange(size);
  return Math.min(high, Math.max(low, Math.round(size * share)));
}

/**
 * The card to put on the bottom next, so that `count` more leave `hand`: a land while
 * it holds more than the target, otherwise its most expensive spell (the least
 * valuable one on a tie).
 */
export function bottomCard(hand, count, share = 0.4) {
  const size = hand.length - count;
  const lands = hand.filter(isLand);
  const spells = hand.filter((c) => !isLand(c));
  if (spells.length === 0 || (lands.length > landTarget(size, share) && lands.length > 0)) return lands[0];
  return spells.reduce((worst, c) => {
    const d = manaValue(c.manaCost ?? {}) - manaValue(worst.manaCost ?? {});
    return d > 0 || (d === 0 && permanentValue(c) < permanentValue(worst)) ? c : worst;
  });
}

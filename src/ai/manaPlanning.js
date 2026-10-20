/**
 * Paying for things: which mana sources a player has, whether a cost is within
 * reach, and which source to tap next. Shared by the AIs.
 */
import { ACTION } from '../engine/actions.js';
import { isCreature, manaValue } from '../cards/cards.js';
import { manaPoolTotal, MANA_TYPES } from '../engine/mana.js';

/** The item with the highest score (the first one on ties). */
export function bestBy(items, score) {
  let best = items[0];
  let bestScore = -Infinity;
  for (const item of items) {
    const value = score(item);
    if (value > bestScore) [best, bestScore] = [item, value];
  }
  return best;
}

/** Untapped mana sources: `{ cardId, actions, colors, sacrifices }` from the valid mana actions. */
export function manaSources(state, mine) {
  const byCard = new Map();
  for (const action of mine) {
    if (action.type !== ACTION.ACTIVATE_ABILITY) continue;
    const source = state.battlefield.find((p) => p.id === action.cardId);
    const ability = source?.abilities.find((ab) => ab.id === action.abilityId);
    if (!ability?.isManaAbility) continue;
    if (!byCard.has(source.id)) {
      byCard.set(source.id, { cardId: source.id, actions: [], colors: new Set(), sacrifices: !!ability.cost.sacrificeSelf, creature: isCreature(source) });
    }
    const entry = byCard.get(source.id);
    entry.actions.push(action);
    for (const effect of ability.effects) {
      if (effect.anyColor) ['W', 'U', 'B', 'R', 'G'].forEach((c) => entry.colors.add(c));
      for (const type of Object.keys(effect.mana ?? {})) entry.colors.add(type);
    }
  }
  return [...byCard.values()];
}

/** Colored mana a cost still needs beyond the pool: `{ G: 1, ... }`. */
export function neededColors(cost, pool) {
  const needed = {};
  for (const type of MANA_TYPES) {
    const missing = (cost?.[type] ?? 0) - pool[type];
    if (missing > 0) needed[type] = missing;
  }
  return needed;
}

/** Whether the pool plus the untapped sources could pay a cost (approximately, per color). */
export function canReach(cost, pool, sources) {
  if (manaValue(cost) > manaPoolTotal(pool) + sources.length) return false;
  return Object.entries(neededColors(cost, pool))
    .every(([type, n]) => sources.filter((s) => s.colors.has(type)).length >= n);
}

/**
 * Picks a mana ability to activate: one making a color we still need, preferring
 * lands to creatures and anything to sacrificing a Treasure.
 */
export function chooseManaAction(sources, needed) {
  const rank = (source) => (source.sacrifices ? 10 : 0) + (source.creature ? 1 : 0);
  const wanted = Object.keys(needed);
  const useful = wanted.length ? sources.filter((s) => wanted.some((c) => s.colors.has(c))) : sources;
  const source = bestBy(useful.length ? useful : sources, (s) => -rank(s));
  return bestBy(source.actions, (a) => (a.manaColor ? needed[a.manaColor] ?? 0 : 0));
}

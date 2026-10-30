/**
 * Paying for things: which mana sources a player has, whether a cost is within
 * reach, and which source to tap next. Shared by the AIs.
 */
import { ACTION } from '../engine/actions.js';
import { isCreature, manaValue, countOf, spellCost } from '../cards/cards.js';
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

/** How much mana one activation of a mana ability adds (counting "for each", 608.2h). */
function manaAmount(state, ability, controllerId, sourceId) {
  return ability.effects.reduce((sum, effect) => {
    const each = effect.anyColor ?? Object.values(effect.mana ?? {}).reduce((a, n) => a + n, 0);
    const times = effect.per ? countOf(effect.per, { battlefield: state.battlefield, controllerId, sourceId, combat: state.combat }) : 1;
    return sum + each * times;
  }, 0);
}

/**
 * Untapped mana sources: `{ cardId, actions, colors, sacrifices, amount }` from the valid
 * mana actions, where `amount` is how much mana tapping it adds.
 */
export function manaSources(state, mine) {
  const byCard = new Map();
  for (const action of mine) {
    if (action.type !== ACTION.ACTIVATE_ABILITY) continue;
    const source = state.battlefield.find((p) => p.id === action.cardId);
    // Its own abilities, or one another permanent gives it (Elven Chorus).
    const ability = [...(source?.abilities ?? []), ...(source?.grantedAbilities ?? [])].find((ab) => ab.id === action.abilityId);
    if (!ability?.isManaAbility) continue;
    if (!byCard.has(source.id)) {
      byCard.set(source.id, {
        cardId: source.id, actions: [], colors: new Set(), sacrifices: !!ability.cost.sacrificeSelf, creature: isCreature(source), amount: 0,
      });
    }
    const entry = byCard.get(source.id);
    entry.actions.push(action);
    entry.amount = Math.max(entry.amount, manaAmount(state, ability, action.playerId, source.id));
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
  // A hybrid symbol the pool can't pay wants any of its colors.
  for (const colors of cost?.hybrid ?? []) {
    if (colors.some((c) => pool[c] > 0)) continue;
    for (const c of colors) needed[c] = (needed[c] ?? 0) + 1;
  }
  return needed;
}

/** The mana in the pool plus what the untapped sources could add. */
export const manaAvailable = (pool, sources) => manaPoolTotal(pool) + sources.reduce((sum, s) => sum + (s.amount ?? 1), 0);

/** Whether the pool plus the untapped sources could pay a cost (approximately, per color). */
export function canReach(cost, pool, sources) {
  if (manaValue(cost) > manaAvailable(pool, sources)) return false;
  // Hybrid symbols ({W/B}): enough mana of any of their colors, from the pool or the sources.
  const hybrid = cost?.hybrid ?? [];
  if (hybrid.length) {
    const colors = new Set(hybrid.flat());
    const have = [...colors].reduce((sum, c) => sum + (pool[c] ?? 0), 0)
      + sources.filter((s) => [...colors].some((c) => s.colors.has(c))).reduce((sum, s) => sum + (s.amount ?? 1), 0);
    if (have < hybrid.length) return false;
  }
  return Object.entries(neededColors(cost, pool))
    .every(([type, n]) => sources.filter((s) => s.colors.has(type)).reduce((sum, s) => sum + (s.amount ?? 1), 0) >= n);
}

/** What `card` in `me`'s hand costs to cast now (with cost reductions, spellCost). */
export const castCost = (state, me, card) => spellCost(card, { battlefield: state.battlefield, controllerId: me, combat: state.combat });

/**
 * Picks a mana ability to activate: one making a color we still need, preferring
 * lands to creatures and anything to sacrificing a Treasure.
 */
export function chooseManaAction(sources, needed) {
  if (!sources.length) return null;
  // Sources that make several mana come after those making one, so less goes to waste.
  const rank = (source) => (source.sacrifices ? 10 : 0) + (source.creature ? 1 : 0) + ((source.amount ?? 1) > 1 ? 2 : 0);
  const wanted = Object.keys(needed);
  const useful = wanted.length ? sources.filter((s) => wanted.some((c) => s.colors.has(c))) : sources;
  const source = bestBy(useful.length ? useful : sources, (s) => -rank(s));
  return bestBy(source.actions, (a) => (a.manaColor ? needed[a.manaColor] ?? 0 : 0));
}

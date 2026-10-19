/**
 * Mana pools and mana costs.
 *
 * A pool maps each mana type to an amount: { W, U, B, R, G, C }.
 * A mana cost maps colors (and C for colorless-only) to amounts, plus an
 * optional `generic` amount that can be paid with any type: { G: 1, generic: 2 }.
 */
export const MANA_TYPES = Object.freeze(['W', 'U', 'B', 'R', 'G', 'C']);

export const emptyManaPool = () => Object.fromEntries(MANA_TYPES.map((type) => [type, 0]));

export const manaPoolTotal = (pool) => MANA_TYPES.reduce((sum, type) => sum + pool[type], 0);

/** Adds `mana` (e.g. { G: 1 }) to `pool` in place. */
export function addMana(pool, mana) {
  for (const [type, amount] of Object.entries(mana)) {
    if (!MANA_TYPES.includes(type)) throw new Error(`Unknown mana type: ${type}`);
    pool[type] += amount;
  }
  return pool;
}

/**
 * Works out which mana from `pool` pays `cost`, or returns null if it can't be
 * paid. Specific types are paid first; generic is then paid from what's left,
 * colorless first, then colors in WUBRG order.
 */
export function planManaPayment(pool, cost = {}) {
  const remaining = { ...pool };
  const payment = emptyManaPool();
  for (const type of MANA_TYPES) {
    const needed = cost[type] ?? 0;
    if (remaining[type] < needed) return null;
    remaining[type] -= needed;
    payment[type] += needed;
  }
  let generic = cost.generic ?? 0;
  for (const type of ['C', 'W', 'U', 'B', 'R', 'G']) {
    const used = Math.min(generic, remaining[type]);
    remaining[type] -= used;
    payment[type] += used;
    generic -= used;
  }
  return generic === 0 ? payment : null;
}

/** Whether `pool` can pay `cost`: the same answer as planManaPayment, without building the plan. */
export function canPayMana(pool, cost) {
  if (!cost) return true;
  let spare = 0;
  for (const type of MANA_TYPES) {
    const left = pool[type] - (cost[type] ?? 0);
    if (left < 0) return false;
    spare += left;
  }
  return spare >= (cost.generic ?? 0);
}

/** Formats mana as symbols, e.g. { generic: 1, G: 2 } -> "{1}{G}{G}". */
export function formatMana(mana = {}) {
  const generic = mana.generic ? `{${mana.generic}}` : '';
  return generic + MANA_TYPES.map((type) => `{${type}}`.repeat(mana[type] ?? 0)).join('');
}

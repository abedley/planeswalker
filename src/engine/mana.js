/**
 * Mana pools and mana costs.
 *
 * A pool maps each mana type to an amount: { W, U, B, R, G, C }.
 * A mana cost maps colors (and C for colorless-only) to amounts, plus an
 * optional `generic` amount that can be paid with any type: { G: 1, generic: 2 }.
 *
 * A cost may also have `hybrid`: a list of hybrid symbols, each the colors that can pay it, as
 * `[['W', 'B'], ['W', 'B']]` for {W/B}{W/B} (107.4e). Paying it pays one of its colors.
 *
 * A pool being spent may also have `any`: mana that can be spent as any color, which is
 * how this game keeps mana "in any combination of colors" (Wizard's Rockets) and mana
 * that can only be spent on some spells (Pelargir Survivor) until it's spent: nothing
 * here cares which color mana was, only what it can pay for.
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
/** A cost with hybrid symbols as the plain costs it can be paid as (each symbol one of its colors). */
export function expandHybrid(cost) {
  if (!cost?.hybrid?.length) return [cost];
  const { hybrid, ...plain } = cost;
  let costs = [plain];
  for (const colors of hybrid) {
    costs = costs.flatMap((c) => colors.map((color) => ({ ...c, [color]: (c[color] ?? 0) + 1 })));
  }
  const seen = new Set();
  return costs.filter((c) => {
    const key = JSON.stringify(Object.entries(c).sort());
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function planManaPayment(pool, cost = {}) {
  if (cost?.hybrid?.length) {
    for (const plain of expandHybrid(cost)) {
      const payment = planManaPayment(pool, plain);
      if (payment) return payment;
    }
    return null;
  }
  const remaining = { ...pool };
  let any = pool.any ?? 0;
  const payment = emptyManaPool();
  if (pool.any !== undefined) payment.any = 0;
  for (const type of MANA_TYPES) {
    const needed = cost[type] ?? 0;
    const own = Math.min(needed, remaining[type]);
    // Colored mana the pool lacks comes out of mana that can be any color.
    if (needed - own > any) return null;
    remaining[type] -= own;
    payment[type] += own;
    any -= needed - own;
    if (needed - own) payment.any += needed - own;
  }
  let generic = cost.generic ?? 0;
  for (const type of ['C', 'W', 'U', 'B', 'R', 'G']) {
    const used = Math.min(generic, remaining[type]);
    remaining[type] -= used;
    payment[type] += used;
    generic -= used;
  }
  // Mana that could be any color is kept for last, as it's the most flexible.
  const flexible = Math.min(generic, any);
  if (flexible) payment.any += flexible;
  generic -= flexible;
  return generic === 0 ? payment : null;
}

/** Whether `pool` can pay `cost`: the same answer as planManaPayment, without building the plan. */
export function canPayMana(pool, cost) {
  if (!cost) return true;
  if (cost.hybrid?.length) return expandHybrid(cost).some((plain) => canPayMana(pool, plain));
  let spare = 0;
  let any = pool.any ?? 0;
  for (const type of MANA_TYPES) {
    const left = pool[type] - (cost[type] ?? 0);
    if (left < 0) {
      any += left;
      if (any < 0) return false;
    } else {
      spare += left;
    }
  }
  return spare + any >= (cost.generic ?? 0);
}

/** Formats mana as symbols, e.g. { generic: 1, G: 2 } -> "{1}{G}{G}". */
export function formatMana(mana = {}) {
  const generic = mana.generic ? `{${mana.generic}}` : '';
  const hybrid = (mana.hybrid ?? []).map((colors) => `{${colors.join('/')}}`).join('');
  return generic + hybrid + MANA_TYPES.map((type) => `{${type}}`.repeat(mana[type] ?? 0)).join('');
}

/**
 * Blocking plans: given the attackers, the blocks that survive the combat if any
 * can, and then do best by one of these (BLOCK_PLAN):
 * - `life`: the most life left
 * - `creatures`: the least creature value lost
 * - `kills`: the most attackers killed (then the most attacker value)
 * - `optimal`: the most kills, then the least lost, then the most life
 * - `value`: the most value: attacker value killed, minus blocker value lost, plus
 *   life kept (weighted as planBlocks weighs it, more when life is low)
 * Each plan breaks ties with the other counts (see PRIORITIES).
 *
 * It's exact (up to `maxGroup` blockers on one attacker) and built for the AI's
 * rollouts, which call it thousands of times a second:
 * - **Each fight once.** Combat is fought attacker by attacker, so a whole block's
 *   outcome is the sum of its fights. Each attacker's blocking groups are resolved
 *   once, with a flat copy of resolveCombat's rules (first and double strike,
 *   deathtouch, trample, lifelink, damage already marked).
 * - **Only useful groups.** A group grows only while a bigger one could still beat
 *   it (kill the attacker, save a blocker, soak trample, gain life), and is dropped
 *   when one of its subsets is at least as good: extra blockers are never free.
 *   When the defender survives even with no blocks, "at least as good" is the
 *   plan's priority order, which leaves only a handful of groups; otherwise it's
 *   every count at once, which keeps chump blocks for survival.
 * - **Identical blockers are one class.** Ten Soldier tokens are one blocker used
 *   up to ten times, so a group of them is fought once and the search never tries
 *   the same block with the tokens swapped. Identical attackers share their groups.
 * - **Memoized search.** The best blocks for the attackers still to come depend
 *   only on how many of each class are left, so the search over attackers
 *   memoizes them: exact however the attackers compete for blockers. If those
 *   blocks don't survive, a depth-first search over every group finds the best
 *   that do, bounded by the memoized bests and by the damage the unused blockers
 *   could still stop.
 *
 * Boards too big for its budgets (`stateLimit`, `nodeLimit`; well past the
 * campaign's 10 creatures a side) get its best effort, flagged `exact: false`.
 *
 * Like resolveCombat, it assumes the attacker divides its damage to kill the most
 * valuable blockers it can.
 */
import { hasKeyword, isCreature, KEYWORD } from '../cards/cards.js';
import { canBlock, creatureValue, damageWeight } from './combat.js';

const EPS = 1e-9;
/** Bitmasks are 32-bit ints, so at most this many blockers, and attackers to block, are considered. */
const MAX_BLOCKERS = 30;
const MAX_ATTACKERS = 30;

// Keyword flags.
const FS = 1;
const DS = 2;
const DT = 4;
const TR = 8;
const LL = 16;
const MENACE = 32;

/** The flags of combatFlags(). */
export const COMBAT_FLAG = Object.freeze({
  FIRST_STRIKE: FS, DOUBLE_STRIKE: DS, DEATHTOUCH: DT, TRAMPLE: TR, LIFELINK: LL, MENACE,
});

/** A creature's combat keywords, as flags. */
export function combatFlags(creature) {
  const has = (k) => hasKeyword(creature, k);
  return (has(KEYWORD.FIRST_STRIKE) ? FS : 0) | (has(KEYWORD.DOUBLE_STRIKE) ? DS : 0)
    | (has(KEYWORD.DEATHTOUCH) ? DT : 0) | (has(KEYWORD.TRAMPLE) ? TR : 0)
    | (has(KEYWORD.LIFELINK) ? LL : 0) | (has(KEYWORD.MENACE) ? MENACE : 0);
}

/**
 * A creature as the solver (and fight()) needs it: plain numbers and flags. A
 * creature can carry its value and flags, worked out once (`cachedValue`,
 * `cachedFlags`, as the lookahead's creatures do).
 */
export function record(creature, index) {
  return {
    creature,
    index,
    power: creature.power,
    toughness: creature.toughness,
    damage: creature.damage ?? 0,
    flags: creature.cachedFlags ?? combatFlags(creature),
    value: creature.cachedValue ?? creatureValue(creature),
  };
}

/** The damage a blocker could deal its attacker at most (Infinity: deathtouch). */
const potential = (b) => (b.power <= 0 ? 0 : b.flags & DT ? Infinity : b.power * (b.flags & DS ? 2 : 1));

/** All orderings of 0..n-1, in the order combat.js's permutations() lists them. */
function permutations(n) {
  const build = (items) => (items.length <= 1 ? [items]
    : items.flatMap((item, i) => build([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])));
  return build([...Array(n).keys()]).map((p) => Int8Array.from(p));
}
const PERMUTATIONS = [[], [], permutations(2), permutations(3), permutations(4)];

// Scratch space for fight(): slot 0 is the attacker, 1.. its blockers.
const SLOTS = 8;
const P = new Int32Array(SLOTS);
const T = new Int32Array(SLOTS);
const F = new Int32Array(SLOTS);
const V = new Float64Array(SLOTS);
const marked = new Int32Array(SLOTS);
const added = new Int32Array(SLOTS);
const living = new Int32Array(SLOTS);
const order = new Int32Array(SLOTS);
const bestOrder = new Int32Array(SLOTS);
const lethal = new Int32Array(SLOTS);

/**
 * Sorts the `count` living slots into the order to assign lethal damage in, into
 * `bestOrder`, as resolveCombat's bestKillOrder: cheapest first, or for 2-4
 * blockers the first order (in permutation order) that kills the most value.
 */
function killOrder(count, power) {
  for (let i = 0; i < count; i++) {
    const slot = living[i];
    let j = i;
    while (j > 0 && lethal[order[j - 1]] > lethal[slot]) {
      order[j] = order[j - 1];
      j--;
    }
    order[j] = slot;
  }
  for (let i = 0; i < count; i++) bestOrder[i] = order[i];
  if (count < 2 || count > 4) return;
  let bestValue = -1;
  for (const perm of PERMUTATIONS[count]) {
    let left = power;
    let value = 0;
    for (let i = 0; i < count; i++) {
      const slot = order[perm[i]];
      if (lethal[slot] > left) break;
      left -= lethal[slot];
      value += V[slot];
    }
    if (value > bestValue) {
      bestValue = value;
      for (let i = 0; i < count; i++) bestOrder[i] = order[perm[i]];
    }
  }
}

/** fight()'s result, reused between calls: read it before the next one. */
const outcome = { attackerDies: false, deadBlockers: 0, damage1: 0, gain1: 0, damage: 0, gain: 0, dealt: 0 };

/**
 * One attacker against its first `n` blockers in `group` (none: unblocked), by the
 * same rules as resolveCombat. Sets `outcome`: the attacker's death, the dead
 * blockers (bits of group positions), and the damage to the defending player and
 * the defender's lifelink gain, in the first-strike step and over the whole combat;
 * and `dealt`, all the damage the attacker deals (its lifelink, if it has it).
 */
export function fight(attacker, group, n = group.length) {
  const all = n + 1;
  let firstStrikeStep = false;
  for (let s = 0; s < all; s++) {
    const c = s === 0 ? attacker : group[s - 1];
    P[s] = c.power;
    T[s] = c.toughness;
    F[s] = c.flags;
    V[s] = c.value;
    marked[s] = c.damage;
    if (c.flags & (FS | DS)) firstStrikeStep = true;
  }
  const af = F[0];
  let deathtouched = 0;
  let dead = 0;
  outcome.damage1 = 0;
  outcome.gain1 = 0;
  outcome.damage = 0;
  outcome.gain = 0;
  outcome.dealt = 0;
  for (let step = firstStrikeStep ? 0 : 1; step < 2; step++) {
    // 510.4 / 702.4b: who deals damage in this step.
    const stepFlag = step === 0 ? FS : 0;
    let toPlayer = 0;
    let lifelink = 0;
    let hits = 0;
    for (let s = 0; s < all; s++) added[s] = 0;
    if (!(dead & 1) && P[0] > 0 && ((af & DS) || (af & FS) === stepFlag)) {
      let remaining = P[0];
      let count = 0;
      for (let s = 1; s < all; s++) if (!(dead & (1 << s))) living[count++] = s;
      // It deals all its damage, unless its blockers are all gone and it lacks trample.
      if (n === 0 || count > 0 || af & TR) outcome.dealt += P[0];
      if (n === 0) {
        toPlayer += remaining;
      } else if (count === 0) {
        // 702.19e: a trampler whose blockers are all gone hits the player.
        if (af & TR) toPlayer += remaining;
      } else {
        for (let i = 0; i < count; i++) {
          const s = living[i];
          const left = Math.max(0, T[s] - marked[s]);
          lethal[s] = af & DT ? Math.min(1, left) : left;
        }
        killOrder(count, remaining);
        for (let i = 0; i < count; i++) {
          const s = bestOrder[i];
          const amount = Math.min(remaining, lethal[s]);
          if (amount > 0) {
            added[s] += amount;
            hits |= 1 << s;
          }
          remaining -= amount;
        }
        if (remaining > 0) {
          if (af & TR) toPlayer += remaining;
          else {
            added[bestOrder[count - 1]] += remaining;
            hits |= 1 << bestOrder[count - 1];
          }
        }
      }
    }
    for (let s = 1; s < all; s++) {
      if ((dead & (1 << s)) || P[s] <= 0 || !((F[s] & DS) || (F[s] & FS) === stepFlag)) continue;
      added[0] += P[s];
      if (F[s] & DT) deathtouched |= 1;
      if (F[s] & LL) lifelink += P[s];
    }
    if (af & DT) deathtouched |= hits;
    // 510.2: all of the step's damage is dealt at once.
    for (let s = 0; s < all; s++) {
      marked[s] += added[s];
      if (!(dead & (1 << s)) && (marked[s] >= T[s] || ((deathtouched & (1 << s)) && marked[s] > 0) || T[s] <= 0)) dead |= 1 << s;
    }
    if (step === 0) {
      outcome.damage1 = toPlayer;
      outcome.gain1 = lifelink;
    }
    outcome.damage += toPlayer;
    outcome.gain += lifelink;
  }
  outcome.attackerDies = (dead & 1) !== 0;
  outcome.deadBlockers = dead >>> 1;
  return outcome;
}

/** Lexicographic comparison of two keys. */
function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    if (d > EPS) return 1;
    if (d < -EPS) return -1;
  }
  return 0;
}

/** The plans blockingPlans makes, each a different idea of the best blocks. */
export const BLOCK_PLAN = Object.freeze({
  /** The most life left. */
  LIFE: 'life',
  /** The least creature value lost. */
  CREATURES: 'creatures',
  /** The most attackers killed (then the most attacker value). */
  KILLS: 'kills',
  /** Kill the most, then lose the least, then keep the most life. */
  OPTIMAL: 'optimal',
  /**
   * The most value: attacker value killed, minus blocker value lost, plus life
   * kept, weighted by damageWeight (more when life is low), as planBlocks weighs them.
   */
  VALUE: 'value',
});

// An option's counts, `v`, each the more the better.
const KILLS = 0;
const KILLED_VALUE = 1;
const KEPT = 2; // minus the blocker value lost
const LIFE = 3; // minus the damage taken, net of lifelink
const VALUE = 4; // KILLED_VALUE + KEPT + LIFE * damageWeight(life)
const COUNTS = 5;

/** Each plan's priority order over the counts, after surviving, which always comes first. */
const PRIORITIES = Object.freeze({
  [BLOCK_PLAN.LIFE]: [LIFE, KILLS, KILLED_VALUE, KEPT],
  [BLOCK_PLAN.CREATURES]: [KEPT, KILLS, KILLED_VALUE, LIFE],
  [BLOCK_PLAN.KILLS]: [KILLS, KILLED_VALUE, LIFE, KEPT],
  [BLOCK_PLAN.OPTIMAL]: [KILLS, KILLED_VALUE, KEPT, LIFE],
  [BLOCK_PLAN.VALUE]: [VALUE, KEPT, LIFE, KILLS, KILLED_VALUE],
});

/** Counts a and b added up. */
const add = (a, b) => {
  const sum = new Array(COUNTS);
  for (let i = 0; i < COUNTS; i++) sum[i] = a[i] + b[i];
  return sum;
};
const NONE = Object.freeze(new Array(COUNTS).fill(0));

/** Whether counts p are at least as good as counts q in priority order `order`. */
function atLeastIn(order, p, q) {
  for (const i of order) {
    const d = p[i] - q[i];
    if (d > EPS) return true;
    if (d < -EPS) return false;
  }
  return true;
}
/** Whether option p is at least as good as option o on every count. */
const paretoAtLeast = (p, o) => p.v[KILLS] >= o.v[KILLS] && p.v[KILLED_VALUE] >= o.v[KILLED_VALUE] - EPS
  && p.v[KEPT] >= o.v[KEPT] - EPS && p.v[LIFE] >= o.v[LIFE] && p.net1 <= o.net1;

// The memo table for boards whose search fits in it.
const TABLE_SIZE = 1 << 17;
const tableStamps = new Int32Array(TABLE_SIZE);
const tableSlots = new Int32Array(TABLE_SIZE);
let tableStamp = 0;

// Scratch space for attackerOptions().
const topDamage = new Float64Array((MAX_BLOCKERS + 1) * 5);
const rescueFrom = new Uint8Array(MAX_BLOCKERS + 1);
const gainFrom = new Uint8Array(MAX_BLOCKERS + 1);
const top = new Float64Array(4);

/**
 * The options worth considering for one attacker: unblocked, and each blocking
 * group (legal, at most `groupMax` blockers) that might beat its subsets, `all`;
 * and unless survival is `safe`, `pareto`: those no subset is as good as on every count.
 * `legal` lists the blockers that may block it by class (identical blockers), and
 * a group takes the first ones of a class, so each group of classes is fought once.
 * An option's `classes` are its blockers' classes, and `delta` adds them to a state.
 */
function attackerOptions(a, legal, groupMax, safe, radix, lifeWeight) {
  const minSize = a.flags & MENACE ? 2 : 1;
  const toughnessLeft = a.toughness - a.damage;
  const options = [];
  const members = [];
  const add = () => {
    const result = fight(a, members, members.length);
    const classes = [];
    const ks = [];
    const ns = [];
    let delta = 0;
    let lost = 0;
    for (let i = 0; i < members.length; i++) {
      const k = members[i].cls;
      classes.push(k);
      delta += radix[k];
      if (ks.length && ks[ks.length - 1] === k) ns[ns.length - 1]++;
      else {
        ks.push(k);
        ns.push(1);
      }
      if (result.deadBlockers & (1 << i)) lost += members[i].value;
    }
    const option = {
      classes,
      ks,
      ns,
      delta,
      v: [
        result.attackerDies ? 1 : 0,
        result.attackerDies ? a.value : 0,
        -lost,
        result.gain - result.damage,
        (result.attackerDies ? a.value : 0) - lost + (result.gain - result.damage) * lifeWeight,
      ],
      kill: result.attackerDies,
      lost,
      net1: result.damage1 - result.gain1,
      through: result.damage,
      // Which of the group's blockers die, by position in `classes`.
      deaths: result.deadBlockers,
    };
    options.push(option);
    return option;
  };
  add();
  // For each start, what blockers from legal[start..] could add to a group: the
  // most damage k more of them could deal (topDamage[start * width + k]), and
  // whether any is a first or double striker, or a lifelinker.
  const count = legal.length;
  const width = groupMax + 1;
  topDamage.fill(0, count * width, (count + 1) * width);
  rescueFrom[count] = 0;
  gainFrom[count] = 0;
  top.fill(0);
  for (let i = count - 1; i >= 0; i--) {
    const b = legal[i];
    rescueFrom[i] = rescueFrom[i + 1] || (b.power > 0 && (b.flags & (FS | DS)) !== 0) ? 1 : 0;
    gainFrom[i] = gainFrom[i + 1] || (b.power > 0 && (b.flags & LL) !== 0) ? 1 : 0;
    let p = potential(b);
    for (let j = 0; j < groupMax && p > 0; j++) {
      if (p > top[j]) {
        const swap = top[j];
        top[j] = p;
        p = swap;
      }
    }
    for (let k = 1; k <= groupMax; k++) topDamage[i * width + k] = topDamage[i * width + k - 1] + top[k - 1];
  }
  // Whether a bigger group than `members` (adding from legal[start..]) could beat
  // it on some count; if not, every bigger one is dominated by it. Each reason
  // needs some blocker of a kind, but any blocker may come before that one.
  const worthGrowing = (option, start, dealt) => members.length < minSize
    || (!option.kill && dealt + topDamage[start * width + groupMax - members.length] >= toughnessLeft) // could still kill it
    // When it's killing ours: a first striker of ours could kill it first. And if
    // it strikes first, or twice (each strike assigned on its own), any other
    // target could draw its damage away from a blocker that would then kill it.
    || (option.lost > 0 && ((a.flags & (FS | DS)) !== 0 || rescueFrom[start] === 1))
    || option.through > 0 // trample damage still getting through
    || gainFrom[start] === 1; // a lifelinker could join
  const grow = (start, option, dealt) => {
    if (members.length === groupMax || !worthGrowing(option, start, dealt)) return;
    for (let i = start; i < count; i++) {
      // Of identical blockers, only the first ones: skip one whose twin before it is out.
      if (i > 0 && legal[i - 1].cls === legal[i].cls && members[members.length - 1] !== legal[i - 1]) continue;
      members.push(legal[i]);
      grow(i + 1, members.length >= minSize ? add() : option, dealt + potential(legal[i]));
      members.pop();
    }
  };
  grow(0, options[0], 0);
  return { all: options, pareto: safe ? null : undominated(options, paretoAtLeast) };
}

/** `options` best first in priority order `order`, so a good answer is found early. */
const sortIn = (order, options) => options.sort((x, y) => {
  for (const i of order) {
    const d = y.v[i] - x.v[i];
    if (Math.abs(d) > EPS) return d;
  }
  return 0;
});

/** A list of classes (sorted, at most 4, each below 255) as one number. */
const classesCode = (classes, mask = -1) => {
  let code = 0;
  for (let i = 0; i < classes.length; i++) if (mask & (1 << i)) code = code * 256 + classes[i] + 1;
  return code;
};

/** The options that no subset option (unblocked included) is at least as good as, by `atLeast(p, o)`. */
function undominated(options, atLeast) {
  // Each option by its classes, so an option's subsets (at most 7) are looked up, not searched for.
  if (!options.byClasses) options.byClasses = new Map(options.map((o) => [classesCode(o.classes), o]));
  const useful = [];
  for (const o of options) {
    const n = o.classes.length;
    let dominated = false;
    for (let mask = 0; mask < (1 << n) - 1 && !dominated; mask++) {
      const p = options.byClasses.get(classesCode(o.classes, mask));
      if (p && atLeast(p, o)) dominated = true;
    }
    if (!dominated) useful.push(o);
  }
  return useful;
}

/**
 * Several plans for blocking `attackers` with `blockers`, for a defender at `life`:
 * for each of BLOCK_PLAN, the blocks that survive the combat if any can, and then
 * do best in that plan's priority order.
 * - `life`: the most life left, then the most kills, then the least lost
 * - `creatures`: the least creature value lost, then the most kills, then the most life
 * - `kills`: the most attackers killed (then attacker value), then the most life, then the least lost
 * - `optimal`: the most kills, then the least lost, then the most life
 * - `value`: the most value (see BLOCK_PLAN.VALUE), then the least lost, then the most life
 *
 * Plans often agree; each is computed on its own. Groups are fought once for all of them.
 *
 * @param {object[]} attackers attacking creatures (permanents from a game state)
 * @param {object[]} blockers the defender's creatures that might block
 * @param {number} life the defender's life total
 * @param {object} [options]
 * @param {string[]} [options.plans] which of BLOCK_PLAN to make (default: all)
 * @param {(blocker: object, attacker: object) => boolean} [options.canBlockPair] which blocks are legal (default: canBlock)
 * @param {number} [options.maxGroup] the most blockers put on one attacker (default 3, at most 4)
 * @param {number} [options.stateLimit] a cap on each search's memo; past it, the attackers left take their best option in turn
 * @param {number} [options.nodeLimit] a cap on each search for blocks that survive; past it, the best found so far are returned
 * @returns {Object<string, {
 *   blocks: Object<string, string>, survives: boolean, lifeAfter: number,
 *   deadAttackers: string[], deadBlockers: string[],
 *   kills: number, killedValue: number, lostValue: number, value: number, exact: boolean, nodes: number,
 * }>} each plan by name. `blocks` maps blocker ids to attacker ids; the dead are the
 *   creatures the combat would kill, in the order given. `exact` is false when a cap was reached, and the
 *   blocks may then not be that plan's best.
 */
export function blockingPlans(attackers, blockers, life, {
  plans = Object.values(BLOCK_PLAN), canBlockPair = canBlock, maxGroup = 3, stateLimit = 5000, nodeLimit = 20000,
} = {}) {
  const atk = attackers.map(record);
  const blk = [];
  const blockMasks = [];
  for (const b of blockers) {
    if (blk.length === MAX_BLOCKERS) break;
    let mask = 0;
    for (let i = 0; i < Math.min(attackers.length, MAX_ATTACKERS); i++) if (canBlockPair(b, attackers[i])) mask |= 1 << i;
    if (mask) {
      blk.push(record(b, blk.length));
      blockMasks.push(mask);
    }
  }
  if (blk.length === 0) return unblockedPlans(atk, life, plans);
  const groupMax = Math.min(maxGroup, 4);

  // Identical blockers (the same in combat, and able to block the same attackers)
  // form a class. A state of the search is how many of each class are in use,
  // in mixed radix: `radix[k]` is the place value of class k's count.
  const same = (x, y) => x.power === y.power && x.toughness === y.toughness && x.damage === y.damage
    && x.flags === y.flags && x.value === y.value && blockMasks[x.index] === blockMasks[y.index];
  const classes = [];
  for (const b of blk) {
    let k = classes.findIndex((members) => same(members[0], b));
    if (k < 0) k = classes.push([]) - 1;
    classes[k].push(b);
    b.cls = k;
  }
  const sizes = classes.map((members) => members.length);
  const radix = [];
  let stateCount = 1;
  for (const size of sizes) {
    radix.push(stateCount);
    stateCount *= size + 1;
  }
  const usedOf = (state, k) => Math.floor(state / radix[k]) % (sizes[k] + 1);
  const fits = (o, state) => {
    for (let j = 0; j < o.ks.length; j++) if (usedOf(state, o.ks[j]) + o.ns[j] > sizes[o.ks[j]]) return false;
    return true;
  };

  // Blocks never let more damage through, so if no blocks survive, any blocks do.
  let unblocked1 = 0;
  let unblocked = 0;
  for (const a of atk) {
    if (a.power <= 0) continue;
    if (a.flags & (FS | DS)) unblocked1 += a.power;
    unblocked += a.power * (a.flags & DS ? 2 : 1);
  }
  const survives = (net1, net) => life - net1 > 0 && life - net > 0;
  const safe = survives(unblocked1, unblocked);
  // Each attacker's options, shared by identical attackers.
  const byClass = [...blk].sort((x, y) => x.cls - y.cls || x.index - y.index);
  const shared = new Map();
  const optionsOf = atk.map((a, i) => {
    let legalMask = 0;
    for (const b of blk) if (blockMasks[b.index] & (1 << i)) legalMask |= 1 << b.index;
    const key = `${a.power},${a.toughness},${a.damage},${a.flags},${a.value},${legalMask}`;
    if (!shared.has(key)) shared.set(key, attackerOptions(a, byClass.filter((b) => legalMask & (1 << b.index)), groupMax, safe, radix, damageWeight(life)));
    return shared.get(key);
  });

  // Search the attackers with the most at stake first.
  const most = (options, f) => options.reduce((m, o) => Math.max(m, f(o)), -Infinity);
  const sequence = atk.map((a, i) => i).sort((i, j) => most(optionsOf[j].all, (o) => o.v[KILLED_VALUE]) - most(optionsOf[i].all, (o) => o.v[KILLED_VALUE])
    || atk[j].power - atk[i].power);
  const depth = sequence.length;

  /** The best blocks in priority order `order`, as the options chosen for each attacker in `sequence`. */
  const search = (order) => {
    // Each attacker's options that no subset beats in this order.
    const levels = sequence.map((i) => sortIn(order, undominated(optionsOf[i].all, (p, o) => atLeastIn(order, p.v, o.v))));
    // The best the attackers from depth d on can do from `state`, survival aside,
    // memoized: exact however they compete for blockers. Each result is a slot in
    // these arrays (slot 0: past the last attacker, all zeros): its counts, its
    // first-strike damage, its option and the next slot. A flat table holds the
    // memo when it fits; stamps spare clearing it.
    const flat = depth * stateCount <= TABLE_SIZE;
    const memo = flat ? null : new Map();
    if (tableStamp === 0x7fffffff) {
      tableStamps.fill(0);
      tableStamp = 0;
    }
    const stamp = ++tableStamp;
    // Each count of each slot (sums[i][slot]), kept apart so the search allocates nothing.
    const sums = Array.from({ length: COUNTS }, () => [0]);
    const sNet1 = [0];
    const sChoice = [null];
    const sNext = [0];
    const store = (o, next) => {
      for (let i = 0; i < COUNTS; i++) sums[i].push(o.v[i] + sums[i][next]);
      sNet1.push(o.net1 + sNet1[next]);
      sChoice.push(o);
      sNext.push(next);
      return sNext.length - 1;
    };
    /** A slot's counts, as an array. */
    const countsOf = (slot) => sums.map((counts) => counts[slot]);
    /** Whether option o then slot c beats option b then slot bc, in this order. */
    const beats = (o, c, b, bc) => {
      for (const i of order) {
        const d = o.v[i] + sums[i][c] - (b.v[i] + sums[i][bc]);
        if (d > EPS) return true;
        if (d < -EPS) return false;
      }
      return false;
    };
    const remember = (key, slot) => {
      if (flat) {
        tableStamps[key] = stamp;
        tableSlots[key] = slot;
      } else memo.set(key, slot);
      return slot;
    };
    // Past the state budget: each attacker from depth d on takes its best option
    // that still fits, in turn.
    let exact = true;
    const greedyTail = (d, state) => {
      exact = false;
      const picks = [];
      for (let e = d; e < depth; e++) {
        const o = levels[e].find((option) => fits(option, state));
        picks.push(o);
        state += o.delta;
      }
      let slot = 0;
      for (let e = picks.length - 1; e >= 0; e--) slot = store(picks[e], slot);
      return slot;
    };
    const suffixBest = (d, state) => {
      if (d === depth) return 0;
      const key = d * stateCount + state;
      if (flat) {
        if (tableStamps[key] === stamp) return tableSlots[key];
      } else {
        const known = memo.get(key);
        if (known !== undefined) return known;
      }
      if (sNext.length > stateLimit) return remember(key, greedyTail(d, state));
      let best = null;
      let bestNext = 0;
      for (const o of levels[d]) {
        if (!fits(o, state)) continue;
        const child = suffixBest(d + 1, state + o.delta);
        if (!best || beats(o, child, best, bestNext)) {
          best = o;
          bestNext = child;
        }
      }
      return remember(key, store(best, bestNext));
    };
    const keyOf = (survive, v) => [survive, ...order.map((i) => v[i])];

    // The best blocks survival aside: the answer if they survive (always, when
    // survival is `safe`), or if nothing does.
    const root = suffixBest(0, 0);
    let choice = [];
    for (let slot = root; slot !== 0; slot = sNext[slot]) choice.push(sChoice[slot]);
    let bestKey = keyOf(survives(sNet1[root], -sums[LIFE][root]) ? 1 : 0, countsOf(root));
    let searched = 0;

    if (!bestKey[0]) {
      // Otherwise, the best blocks that survive: a depth-first search over every
      // option worth a thought for survival, pruned by the memoized bests and by a
      // bound on the damage the rest could still stop: each unused blocker stops at
      // most one attacker, and gains at most its own lifelink.
      const pareto = sequence.map((i) => sortIn(order, optionsOf[i].pareto));
      const hit = sequence.map((i) => (atk[i].power > 0 ? atk[i].power * (atk[i].flags & DS ? 2 : 1) : 0));
      const hit1 = sequence.map((i) => (atk[i].power > 0 && atk[i].flags & (FS | DS) ? atk[i].power : 0));
      // For each depth, the hits from there on, biggest first, as running sums.
      const topHits = (hits) => hits.map((h, d) => {
        const sorted = hits.slice(d).sort((x, y) => y - x);
        const sums = [0];
        for (const x of sorted) sums.push(sums[sums.length - 1] + x);
        return sums;
      });
      const tops = topHits(hit);
      const tops1 = topHits(hit1);
      const gainOf = classes.map(([b]) => (b.power > 0 && b.flags & LL ? b.power * (b.flags & DS ? 2 : 1) : 0));
      const gain1Of = classes.map(([b]) => (b.power > 0 && b.flags & LL && b.flags & (FS | DS) ? b.power : 0));
      const canSurvive = (d, state, net1, net) => {
        if (d === depth) return survives(net1, net);
        let free = 0;
        let gain = 0;
        let gain1 = 0;
        for (let k = 0; k < classes.length; k++) {
          const left = sizes[k] - usedOf(state, k);
          free += left;
          gain += left * gainOf[k];
          gain1 += left * gain1Of[k];
        }
        const sums = tops[d];
        const sums1 = tops1[d];
        const stopped = sums[Math.min(free, sums.length - 1)];
        const stopped1 = sums1[Math.min(free, sums1.length - 1)];
        return survives(net1 + sums1[sums1.length - 1] - stopped1 - gain1, net + sums[sums.length - 1] - stopped - gain);
      };
      if (canSurvive(0, 0, 0, 0)) {
        const chosen = new Array(depth);
        let found = false;
        const visit = (d, state, v, net1) => {
          if (++searched > nodeLimit) {
            exact = false;
            return;
          }
          if (d === depth) {
            const key = keyOf(1, v);
            if (!found || compareKeys(key, bestKey) > 0) {
              found = true;
              bestKey = key;
              choice = chosen.slice();
            }
            return;
          }
          for (const o of pareto[d]) {
            if (!fits(o, state)) continue;
            const after = state + o.delta;
            const n1 = net1 + o.net1;
            const w = add(v, o.v);
            if (!canSurvive(d + 1, after, n1, -w[LIFE])) continue;
            if (found) {
              const c = countsOf(suffixBest(d + 1, after));
              if (compareKeys(keyOf(1, add(w, c)), bestKey) <= 0) continue;
            }
            chosen[d] = o;
            visit(d + 1, after, w, n1);
          }
        };
        visit(0, 0, NONE, 0);
      }
    }
    return { choice, exact, nodes: sNext.length - 1 + searched };
  };

  /** With one attacker, nothing competes for blockers: its best option, surviving first. */
  const single = (order) => {
    let best = null;
    let bestKey = null;
    // As in search(), no bigger group than needed.
    for (const o of undominated(optionsOf[sequence[0]].all, (p, q) => paretoAtLeast(p, q) && atLeastIn(order, p.v, q.v))) {
      const key = [survives(o.net1, -o.v[LIFE]) ? 1 : 0, ...order.map((i) => o.v[i])];
      if (!best || compareKeys(key, bestKey) > 0) [best, bestKey] = [o, key];
    }
    return { choice: [best], exact: true, nodes: 0 };
  };

  // Each plan: hand out each class's blockers to the groups that use it, and read
  // off what dies.
  const result = {};
  for (const plan of plans) {
    const order = PRIORITIES[plan];
    if (!order) throw new Error(`Unknown block plan: ${plan}`);
    const { choice, exact, nodes } = depth === 1 ? single(order) : search(order);
    const blocks = {};
    const dead = new Set();
    const next = sizes.map(() => 0);
    const v = new Array(COUNTS).fill(0);
    let net1 = 0;
    for (let d = 0; d < depth; d++) {
      const o = choice[d];
      const attacker = atk[sequence[d]];
      o.classes.forEach((k, position) => {
        const blocker = classes[k][next[k]++];
        blocks[blocker.creature.id] = attacker.creature.id;
        if (o.deaths & (1 << position)) dead.add(blocker.creature);
      });
      if (o.kill) dead.add(attacker.creature);
      for (let i = 0; i < COUNTS; i++) v[i] += o.v[i];
      net1 += o.net1;
    }
    result[plan] = {
      blocks,
      survives: survives(net1, -v[LIFE]),
      lifeAfter: life + v[LIFE],
      deadAttackers: attackers.filter((c) => dead.has(c)).map((c) => c.id),
      deadBlockers: blockers.filter((c) => dead.has(c)).map((c) => c.id),
      kills: v[KILLS],
      killedValue: v[KILLED_VALUE],
      lostValue: 0 - v[KEPT], // not -v[KEPT], which makes -0 of 0
      value: v[VALUE],
      exact,
      nodes,
    };
  }
  return result;
}

/** blockingPlans when nothing can block: every plan lets everything through. */
function unblockedPlans(atk, life, plans) {
  let damage1 = 0;
  let damage = 0;
  for (const a of atk) {
    if (a.power <= 0) continue;
    if (a.flags & (FS | DS)) damage1 += a.power;
    damage += a.power * (a.flags & DS ? 2 : 1);
  }
  const result = {};
  for (const plan of plans) {
    if (!PRIORITIES[plan]) throw new Error(`Unknown block plan: ${plan}`);
    result[plan] = {
      blocks: {},
      survives: life - damage1 > 0 && life - damage > 0,
      lifeAfter: life - damage,
      deadAttackers: [],
      deadBlockers: [],
      kills: 0,
      killedValue: 0,
      lostValue: 0,
      value: -damage * damageWeight(life),
      exact: true,
      nodes: 0,
    };
  }
  return result;
}

/** The `optimal` plan of blockingPlans: kill the most, then lose the least, then keep the most life. */
export function optimalBlocks(attackers, blockers, life, options = {}) {
  return blockingPlans(attackers, blockers, life, { ...options, plans: [BLOCK_PLAN.OPTIMAL] })[BLOCK_PLAN.OPTIMAL];
}

/**
 * blockingPlans for the defending player `me` in a game state. `canBlockPair(blockerId,
 * attackerId)` says which blocks the engine allows.
 */
export function blockingPlansFor(state, me, canBlockPair, options = {}) {
  const byId = (id) => state.battlefield.find((p) => p.id === id);
  const attackers = state.combat.attackers.map((a) => byId(a.cardId)).filter(Boolean);
  const blockers = state.battlefield.filter((p) => p.controllerId === me && !p.tapped && isCreature(p));
  const life = state.players.find((p) => p.id === me).life;
  return blockingPlans(attackers, blockers, life, { ...options, canBlockPair: (b, a) => canBlockPair(b.id, a.id) });
}

/** The `optimal` plan's blocks, with planBlocks' signature: `{ blockerId: attackerId }`. */
export function planOptimalBlocks(state, me, canBlockPair, options = {}) {
  return blockingPlansFor(state, me, canBlockPair, { ...options, plans: [BLOCK_PLAN.OPTIMAL] })[BLOCK_PLAN.OPTIMAL].blocks;
}

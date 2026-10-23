/**
 * Attacks that look ahead. Each side can follow one of three strategies on its turns
 * (ATTACK_STRATEGY):
 * - `aggressive`: attack with everything that can, to race.
 * - `value`: attack for value: add attackers one at a time while the trade gets
 *   better against the defender's blocks: creature value killed minus value lost.
 *   Chip damage counts a little (more when the defender is low), but never pays
 *   for a lost creature: only an attack that loses no more than it kills earns it.
 *   Racing to a win is `aggressive`'s job.
 * - `hold`: the `value` attack, minus the creatures it will want as blockers when
 *   the opponent attacks with everything next turn.
 *
 * planLookaheadAttack plays each of our strategies out for a few turns against each
 * of the opponent's, with the creatures in play now (nobody casts another), and
 * takes the strategy whose worst case is best. Defenders block as the basic AI does
 * (blockingPlans' `value` plan), so a crack-back that kills us shows up, and so does
 * a race we win. A win scores more the sooner it comes; otherwise the score is board
 * value plus life, which counts for more when it's low.
 */
import { hasKeyword, isCreature, KEYWORD } from '../cards/cards.js';
import { creatureValue, damageWeight, canBlock } from './combat.js';
import {
  blockingPlans, BLOCK_PLAN, fight, record, combatFlags, COMBAT_FLAG,
} from './blocking.js';

const { FIRST_STRIKE, DOUBLE_STRIKE, MENACE: MENACE_FLAG } = COMBAT_FLAG;

export const ATTACK_STRATEGY = Object.freeze({
  AGGRESSIVE: 'aggressive',
  VALUE: 'value',
  HOLD: 'hold',
});

/** The score of a win (less the turns it takes), and minus it, of a loss. */
const WIN = 10000;
/** How much a point of chip damage counts in a `value` attack, times damageWeight. */
const CHIP = 0.5;

const has = hasKeyword;

/**
 * A side in the lookahead: `{ life, creatures }`, where creatures are copies of
 * permanents, with `sick` on those that can't attack this turn.
 */
const ready = (c) => !c.tapped && !c.sick && c.power > 0 && !has(c, KEYWORD.DEFENDER);

/**
 * The blocking search's budgets in the lookahead (see blockingPlans): lower than
 * for a real block, as the lookahead predicts thousands of combats, and on big
 * boards close is good enough.
 */
const STATE_LIMIT = 300;
const NODE_LIMIT = 2000;
/** And at most this many blockers on an attacker: triple blocks are rare. */
const MAX_GROUP = 2;

/** The damage an unblocked creature deals: in the first-strike step, and in all. */
const strikes1 = (c) => (c.power > 0 && c.cachedFlags & (FIRST_STRIKE | DOUBLE_STRIKE) ? c.power : 0);
const strikesAll = (c) => (c.power > 0 ? c.power * (c.cachedFlags & DOUBLE_STRIKE ? 2 : 1) : 0);

/**
 * A quick guess at how `defending` blocks `attackers`, for the later turns of a
 * playout, in the shape of a blocking plan: each attacker, the biggest threat
 * first, meets the free blocker that gains the defender most (the creature value
 * it kills, minus what it loses, plus the damage it stops, weighted as in the
 * `value` plan), if any gains; then, while the damage would kill the defender,
 * the biggest attacker still unblocked is chump-blocked by the cheapest blocker
 * that can. A fight per attacker and blocker, where the exact plan takes a search.
 */
function quickBlocks(attackers, defending) {
  const { life } = defending;
  const weight = damageWeight(life);
  const free = defending.creatures.filter((c) => !c.tapped);
  const records = new Map([...attackers, ...free].map((c) => [c, record(c)]));
  const blocks = {};
  const dead = new Set();
  const used = new Set();
  let net1 = 0;
  let net = 0;
  let killedValue = 0;
  let lostValue = 0;
  // Blocks `attacker` with `blocker` (or none), adding up what happens.
  const settle = (attacker, blocker) => {
    if (!blocker) {
      net1 += strikes1(attacker);
      net += strikesAll(attacker);
      return;
    }
    const result = fight(records.get(attacker), [records.get(blocker)]);
    blocks[blocker.id] = attacker.id;
    used.add(blocker);
    net1 += result.damage1 - result.gain1;
    net += result.damage - result.gain;
    if (result.attackerDies) {
      dead.add(attacker.id);
      killedValue += attacker.cachedValue;
    }
    if (result.deadBlockers & 1) {
      dead.add(blocker.id);
      lostValue += blocker.cachedValue;
    }
  };
  const threat = (c) => c.cachedValue + strikesAll(c);
  const unblocked = [];
  for (const attacker of [...attackers].sort((x, y) => threat(y) - threat(x))) {
    let best = null;
    let bestGain = 1e-9;
    if (!(attacker.cachedFlags & MENACE_FLAG)) {
      for (const blocker of free) {
        if (used.has(blocker) || !canBlock(blocker, attacker)) continue;
        const result = fight(records.get(attacker), [records.get(blocker)]);
        const gain = (result.attackerDies ? attacker.cachedValue : 0) - (result.deadBlockers & 1 ? blocker.cachedValue : 0)
          + weight * (strikesAll(attacker) - (result.damage - result.gain));
        if (gain > bestGain) [best, bestGain] = [blocker, gain];
      }
    }
    if (best) settle(attacker, best);
    else unblocked.push(attacker);
  }
  // Chump blocks while the damage getting through would be lethal.
  const through = () => unblocked.reduce((sum, a) => [sum[0] + strikes1(a), sum[1] + strikesAll(a)], [net1, net]);
  unblocked.sort((x, y) => strikesAll(y) - strikesAll(x));
  for (let i = 0; i < unblocked.length;) {
    const [all1, all] = through();
    if (life - all1 > 0 && life - all > 0) break;
    const attacker = unblocked[i];
    const chump = attacker.cachedFlags & MENACE_FLAG ? null : free.filter((b) => !used.has(b) && canBlock(b, attacker))
      .sort((x, y) => x.cachedValue - y.cachedValue)[0];
    if (chump) {
      unblocked.splice(i, 1);
      settle(attacker, chump);
    } else i++;
  }
  for (const attacker of unblocked) settle(attacker, null);
  return {
    blocks,
    survives: life - net1 > 0 && life - net > 0,
    lifeAfter: life - net,
    deadAttackers: attackers.filter((c) => dead.has(c.id)).map((c) => c.id),
    deadBlockers: free.filter((c) => dead.has(c.id)).map((c) => c.id),
    killedValue,
    lostValue,
  };
}

/**
 * How `defending` blocks `attackers`: the basic AI's blocks (the `value` plan),
 * or in a playout's later turns (`cache.quick`), quickBlocks' guess at them.
 * The same combats come up again and again in a lookahead, so they're kept in
 * `cache` (one per decision), by everything the blocks depend on.
 */
function blocksAgainst(attackers, defending, cache) {
  let key;
  if (cache?.bits) {
    // Bits for creatures (see planLookaheadAttack): a key of a few numbers.
    let attacking = 0;
    let untapped = 0;
    let damage = '';
    for (const c of attackers) {
      attacking |= c.bit;
      if (c.damage) damage += `,${c.id}:${c.damage}`;
    }
    for (const c of defending.creatures) {
      if (c.tapped) continue;
      untapped |= c.bit;
      if (c.damage) damage += `,${c.id}:${c.damage}`;
    }
    key = `${cache.quick ? 'q' : ''}${attackers[0]?.side}|${defending.life}|${attacking}|${untapped}${damage}`;
  } else {
    key = `${cache?.quick ? 'q' : ''}${defending.life}|`;
    for (const c of attackers) key += `${c.id}:${c.damage},`;
    key += '|';
    for (const c of defending.creatures) if (!c.tapped) key += `${c.id}:${c.damage},`;
  }
  let plan = cache?.get(key);
  if (!plan && cache?.quick) {
    plan = quickBlocks(attackers, defending);
    cache.set(key, plan);
  } else if (!plan) {
    plan = blockingPlans(attackers, defending.creatures.filter((c) => !c.tapped), defending.life,
      { plans: [BLOCK_PLAN.VALUE], stateLimit: STATE_LIMIT, nodeLimit: NODE_LIMIT, maxGroup: MAX_GROUP })[BLOCK_PLAN.VALUE];
    cache?.set(key, plan);
  }
  return plan;
}

/**
 * How good attacking with `attackers` is for the attacker: the creature value it
 * kills minus the value it loses, plus a little for damage when it loses no more
 * than it kills.
 */
function trade(attackers, defending, cache) {
  if (attackers.length === 0) return 0;
  const plan = blocksAgainst(attackers, defending, cache);
  if (!plan.survives) return WIN;
  const swing = plan.lostValue - plan.killedValue;
  return swing + (swing >= -1e-9 ? CHIP * damageWeight(defending.life) * (defending.life - plan.lifeAfter) : 0);
}

/** The sides after `attacking` attacks `defending` with `attackers`. */
function combat(attacking, defending, attackers, cache) {
  if (attackers.length === 0) return [attacking, defending];
  const plan = blocksAgainst(attackers, defending, cache);
  const dead = new Set([...plan.deadAttackers, ...plan.deadBlockers]);
  // 702.15b: an attacker with lifelink gains its controller the damage it deals.
  let gain = 0;
  for (const attacker of attackers) {
    if (!has(attacker, KEYWORD.LIFELINK)) continue;
    const group = defending.creatures.filter((b) => plan.blocks[b.id] === attacker.id);
    gain += fight(record(attacker), group.map((b) => record(b))).dealt;
  }
  const attacked = new Set(attackers.map((c) => c.id));
  return [{
    life: attacking.life + gain,
    creatures: attacking.creatures.filter((c) => !dead.has(c.id))
      .map((c) => (attacked.has(c.id) && !has(c, KEYWORD.VIGILANCE) ? { ...c, tapped: true } : c)),
  }, {
    life: plan.lifeAfter,
    creatures: defending.creatures.filter((c) => !dead.has(c.id)),
  }];
}

/**
 * The `value` attack: each attacker's trade alone, then the attackers that gain
 * alone added in that order, the best first, each kept if the whole attack's trade
 * improves. (Swarming with attackers that don't gain alone is `aggressive`'s job.)
 */
function valueAttack(attacking, defending, able, cache) {
  const ranked = able.map((attacker) => ({ attacker, alone: trade([attacker], defending, cache) }))
    .filter(({ alone }) => alone > 1e-9)
    .sort((x, y) => y.alone - x.alone);
  const chosen = [];
  let best = 0;
  for (const { attacker } of ranked) {
    const score = chosen.length ? trade([...chosen, attacker], defending, cache) : ranked[0].alone;
    if (score > best + 1e-9) {
      chosen.push(attacker);
      best = score;
    }
  }
  return chosen;
}

/** Each strategy's attack for `attacking` this turn, from the creatures `able` to attack. */
const STRATEGIES = {
  [ATTACK_STRATEGY.AGGRESSIVE]: (attacking, defending, able) => able,
  [ATTACK_STRATEGY.VALUE]: valueAttack,
  [ATTACK_STRATEGY.HOLD]: (attacking, defending, able, cache) => {
    // The blockers we'd use if they attacked with everything, with all of ours untapped.
    const theirs = defending.creatures.filter((c) => c.power > 0 && !has(c, KEYWORD.DEFENDER));
    const ours = { life: attacking.life, creatures: attacking.creatures.map((c) => ({ ...c, tapped: false })) };
    const needed = theirs.length ? blocksAgainst(theirs, ours, cache).blocks : {};
    return valueAttack(attacking, defending, able, cache).filter((c) => !needed[c.id] || has(c, KEYWORD.VIGILANCE));
  },
};

/** A side as a key: its life and its creatures' state (by their bits, if they have them). */
const sideKey = (side, bits) => {
  let key = `${side.life}:`;
  if (bits) {
    let alive = 0;
    let tapped = 0;
    let sick = 0;
    for (const c of side.creatures) {
      alive |= c.bit;
      if (c.tapped) tapped |= c.bit;
      if (c.sick) sick |= c.bit;
      if (c.damage) key += `${c.id}:${c.damage},`;
    }
    return `${key}${alive}:${tapped}:${sick}`;
  }
  for (const c of side.creatures) key += `${c.id}${c.tapped ? 't' : ''}${c.sick ? 's' : ''}${c.damage || ''},`;
  return key;
};

/**
 * Strategy `strategy`'s attack for `attacking` this turn. Plans meet the same
 * positions again and again, so these are kept in `cache` too.
 */
function strategyAttack(strategy, attacking, defending, cache) {
  const key = `${strategy}|${attacking.creatures[0]?.side ?? ''}|${sideKey(attacking, cache.bits)}|${sideKey(defending, cache.bits)}`;
  let attack = cache.get(key);
  if (!attack) {
    attack = STRATEGIES[strategy](attacking, defending, attacking.creatures.filter(ready), cache);
    cache.set(key, attack);
  }
  return attack;
}

/** A side's creatures at the start of its turn: untapped, able to attack, undamaged. */
const startTurn = (side) => ({ life: side.life, creatures: side.creatures.map((c) => ({ ...c, tapped: false, sick: false, damage: 0 })) });
/** The other side's creatures then: damage wears off at end of turn (514.2). */
const healed = (side) => ({ life: side.life, creatures: side.creatures.map((c) => (c.damage ? { ...c, damage: 0 } : c)) });

/** A side's worth: its creatures' value, plus its life (each point worth more when life is low). */
const worth = (side) => side.creatures.reduce((sum, c) => sum + c.cachedValue, 0) + 8 * Math.sqrt(Math.max(0, side.life));

/**
 * From the sides after our first attack (`first`), plays `halfTurns - 1` more
 * turns, us following strategy `ours` and them `theirs`. Our score at the end: ±WIN (less the turns taken) for a
 * win or loss, otherwise our worth minus theirs.
 */
function playOut(first, ours, theirs, halfTurns, cache) {
  let [us, them] = first;
  // The later turns are a guess anyway: quick blocks (see blocksAgainst).
  cache.quick = true;
  try {
    for (let turn = 1; ; turn++) {
      if (them.life <= 0) return WIN - turn;
      if (us.life <= 0) return -WIN + turn;
      if (turn === halfTurns) return worth(us) - worth(them);
      if (turn % 2 === 1) {
        them = startTurn(them);
        us = healed(us);
        [them, us] = combat(them, us, strategyAttack(theirs, them, us, cache), cache);
      } else {
        us = startTurn(us);
        them = healed(them);
        [us, them] = combat(us, them, strategyAttack(ours, us, them, cache), cache);
      }
    }
  } finally {
    cache.quick = false;
  }
}

/** With a thinking budget: how far ahead it may look, and up to how many attackers it tries every subset of. */
const MAX_TURNS = 8;
const SUBSETS_UP_TO = 6;

/**
 * Which of `candidates` (creatures that may attack) should attack, for the player
 * `me` in `state`.
 *
 * A plan is a first attack and the strategy we follow after it. Each is played out
 * against each of the opponent's strategies, and scored by its worst case.
 * - Without `budgetMs`, it plays each strategy (first attack and after) `turns` of
 *   ours ahead: fast enough for the AI's rollouts.
 * - With `budgetMs`, it thinks for about that long. It looks 1, 2, 3, ... turns
 *   ahead (up to MAX_TURNS), each time trying more plans while time allows: the
 *   strategies, then each strategy's first attack followed by any strategy (say,
 *   hold now and race later), then other first attacks (every subset of the
 *   attackers on small boards, or a strategy's attack with one more or one fewer).
 *   It answers from the deepest look whose strategies all finished.
 *
 * @returns {{ attackers: string[], strategy: string, later: string, turns: number,
 *   plans: number, scores: Object<string, number>, strategies: Object<string, string[]> }}
 *   the attackers' ids, the plan chosen (its first attack's strategy, or 'other', and
 *   the strategy after), how many turns it looked ahead, how many plans it scored at
 *   that depth, each strategy's worst-case score there, and each strategy's attack.
 */
export function planLookaheadAttack(state, me, candidates, { turns = 3, budgetMs = null } = {}) {
  const able = new Set(candidates.filter((c) => c.power > 0).map((c) => c.id));
  const side = (id) => ({
    life: state.players.find((p) => p.id === id).life,
    // Lean copies: only what combat needs, as they're copied every turn of every playout.
    creatures: state.battlefield.filter((p) => p.controllerId === id && isCreature(p)).map((c) => ({
      id: c.id, types: c.types, keywords: c.keywords ?? [], power: c.power, toughness: c.toughness,
      damage: c.damage ?? 0, tapped: c.tapped, sick: id === me && !able.has(c.id), cachedValue: creatureValue(c), cachedFlags: combatFlags(c),
    })),
  });
  const us = side(me);
  const them = side(state.players.find((p) => p.id !== me).id);
  const attackers = us.creatures.filter((c) => able.has(c.id));
  const cache = new Map();
  // Each creature gets a bit within its side, for cheap cache keys, if they fit.
  cache.bits = us.creatures.length <= 31 && them.creatures.length <= 31;
  [us, them].forEach(({ creatures }, index) => creatures.forEach((c, i) => {
    c.side = index;
    c.bit = cache.bits ? 1 << i : 0;
  }));
  const deadline = budgetMs === null ? Infinity : performance.now() + budgetMs;

  // On a tie, attacking for value comes first, then holding back.
  const order = [ATTACK_STRATEGY.VALUE, ATTACK_STRATEGY.HOLD, ATTACK_STRATEGY.AGGRESSIVE];
  const firsts = Object.fromEntries(order.map((strategy) => [strategy, STRATEGIES[strategy](us, them, attackers, cache)]));
  const plans = order.map((strategy) => ({ strategy, first: firsts[strategy], later: strategy }));
  if (budgetMs !== null) {
    // Each strategy's first attack, then any strategy.
    for (const strategy of order) {
      for (const later of order) if (later !== strategy) plans.push({ strategy, first: firsts[strategy], later });
    }
    // Other first attacks.
    const key = (group) => group.map((c) => c.id).sort().join();
    const seen = new Set(order.map((strategy) => key(firsts[strategy])));
    const others = [];
    const offer = (group) => {
      if (!seen.has(key(group))) {
        seen.add(key(group));
        others.push(group);
      }
    };
    if (attackers.length <= SUBSETS_UP_TO) {
      for (let mask = 0; mask < 2 ** attackers.length; mask++) offer(attackers.filter((c, i) => mask & (2 ** i)));
    } else {
      for (const strategy of order) {
        for (const c of attackers) {
          const group = firsts[strategy];
          offer(group.includes(c) ? group.filter((x) => x !== c) : [...group, c]);
        }
      }
    }
    for (const first of others) for (const later of order) plans.push({ strategy: 'other', first, later });
  }

  // Each plan's worst case `depth` turns ahead, as many as time allows (null: out of time).
  const score = (plan, depth) => {
    plan.after ??= combat(us, them, plan.first, cache);
    let worst = Infinity;
    for (const reply of order) {
      if (performance.now() > deadline) return null;
      worst = Math.min(worst, playOut(plan.after, plan.later, reply, 2 * depth, cache));
    }
    return worst;
  };
  const strategies = Object.fromEntries(order.map((strategy) => [strategy, firsts[strategy].map((c) => c.id)]));
  let answer = null;
  for (let depth = budgetMs === null ? turns : 1; depth <= (budgetMs === null ? turns : MAX_TURNS); depth++) {
    const scores = {};
    let best = null;
    let tried = 0;
    for (const plan of plans) {
      const value = score(plan, depth);
      if (value === null) break;
      tried++;
      if (plan.later === plan.strategy) scores[plan.strategy] = value;
      if (!best || value > best.value + 1e-9) best = { plan, value };
    }
    // A look counts only if its strategies all finished.
    if (tried < order.length) break;
    answer = {
      attackers: best.plan.first.map((c) => c.id), strategy: best.plan.strategy, later: best.plan.later,
      turns: depth, plans: tried, scores, strategies,
    };
    if (performance.now() > deadline) break;
  }
  // Out of time before even one look: the value attack.
  return answer ?? {
    attackers: firsts[ATTACK_STRATEGY.VALUE].map((c) => c.id), strategy: ATTACK_STRATEGY.VALUE,
    later: ATTACK_STRATEGY.VALUE, turns: 0, plans: 0, scores: {}, strategies,
  };
}

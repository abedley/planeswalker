import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYWORD, CARD_TYPE } from '../src/index.js';
import { resolveCombat, canBlock, creatureValue, damageWeight } from '../src/ai/combat.js';
import {
  fight, optimalBlocks, planOptimalBlocks, blockingPlans, blockingPlansFor, BLOCK_PLAN,
} from '../src/ai/blocking.js';

let nextId = 0;
const creature = (power, toughness, keywords = [], extra = {}) => ({
  id: `c${nextId++}`, name: `${power}/${toughness}`, types: [CARD_TYPE.CREATURE], power, toughness, keywords, damage: 0, tapped: false, ...extra,
});
const { FIRST_STRIKE, DOUBLE_STRIKE, DEATHTOUCH, TRAMPLE, LIFELINK, FLYING, REACH, MENACE } = KEYWORD;

/** A small seeded generator, so failures reproduce. */
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const KEYWORDS = [FIRST_STRIKE, DOUBLE_STRIKE, DEATHTOUCH, TRAMPLE, LIFELINK, FLYING, REACH, MENACE, KEYWORD.CANT_BLOCK, KEYWORD.CANT_BE_BLOCKED];
function randomCreature(random, rate = 0.12) {
  const toughness = 1 + Math.floor(random() * 6);
  const keywords = KEYWORDS.filter(() => random() < rate);
  const damage = random() < 0.15 ? Math.floor(random() * toughness) : 0;
  return creature(Math.floor(random() * 6), toughness, keywords, { damage });
}
/** fight() works on the solver's records; this builds one the way optimalBlocks does. */
const flagsOf = (c) => {
  const has = (k) => c.keywords.includes(k);
  return (has(FIRST_STRIKE) ? 1 : 0) | (has(DOUBLE_STRIKE) ? 2 : 0) | (has(DEATHTOUCH) ? 4 : 0)
    | (has(TRAMPLE) ? 8 : 0) | (has(LIFELINK) ? 16 : 0) | (has(MENACE) ? 32 : 0);
};
const rec = (c) => ({ power: c.power, toughness: c.toughness, damage: c.damage, flags: flagsOf(c), value: creatureValue(c) });
const keyOf = (result, life) => [result.survives ? 1 : 0, result.kills, result.killedValue, -result.lostValue, result.lifeAfter - life];

test('fight() agrees with resolveCombat on random combats', () => {
  const random = rng(1);
  for (let i = 0; i < 20000; i++) {
    const attacker = randomCreature(random);
    const blockers = Array.from({ length: Math.floor(random() * 4) }, () => randomCreature(random));
    const expected = resolveCombat(attacker, blockers);
    const got = fight(rec(attacker), blockers.map(rec));
    const dead = blockers.filter((b, j) => got.deadBlockers & (1 << j)).map((b) => b.id);
    assert.equal(got.attackerDies, expected.attackerDies, `combat ${i}`);
    assert.deepEqual(dead, expected.deadBlockers, `combat ${i}`);
    assert.equal(got.damage, expected.playerDamage, `combat ${i}`);
    assert.equal(got.gain, expected.blockerLifelink, `combat ${i}`);
    if (attacker.keywords.includes(LIFELINK)) assert.equal(got.dealt, expected.attackerLifelink, `combat ${i}`);
  }
});

/**
 * How blocks (`{ blockerId: attackerId }`) play out, by the solver's rules: whether
 * the defender survives, its counts (kills, killed value, minus value lost, minus
 * net damage, value), and what dies; null if a group breaks the rules (more than 3
 * blockers, or 1 on menace). Like the solver, a group lists identical blockers
 * alike (the attacker's tie-breaks depend on the order).
 */
function score(attackers, blockers, life, blocks) {
  const signature = (b) => [b.power, b.toughness, b.damage, flagsOf(b), creatureValue(b), attackers.map((a) => canBlock(b, a))].join();
  const lead = blockers.map((b) => blockers.findIndex((c) => signature(c) === signature(b)));
  const order = blockers.map((b, i) => i).sort((x, y) => lead[x] - lead[y] || x - y);
  let net1 = 0;
  const counts = [0, 0, 0, 0];
  const deadAttackers = [];
  const deadBlockers = [];
  for (const attacker of attackers) {
    const group = order.map((i) => blockers[i]).filter((b) => blocks[b.id] === attacker.id);
    if (group.length > 3 || (group.length === 1 && attacker.keywords.includes(MENACE))) return null;
    const result = fight(rec(attacker), group.map(rec));
    net1 += result.damage1 - result.gain1;
    counts[3] -= result.damage - result.gain;
    if (result.attackerDies) {
      counts[0] += 1;
      counts[1] += creatureValue(attacker);
      deadAttackers.push(attacker.id);
    }
    group.forEach((b, i) => {
      if (!(result.deadBlockers & (1 << i))) return;
      counts[2] -= creatureValue(b);
      deadBlockers.push(b.id);
    });
  }
  counts.push(counts[1] + counts[2] + counts[3] * damageWeight(life));
  return { survives: life - net1 > 0 && life + counts[3] > 0, counts, deadAttackers, deadBlockers };
}

/** The plans' priority orders over the counts, after survival: the behaviour under test. */
const ORDERS = {
  [BLOCK_PLAN.LIFE]: [3, 0, 1, 2],
  [BLOCK_PLAN.CREATURES]: [2, 0, 1, 3],
  [BLOCK_PLAN.KILLS]: [0, 1, 3, 2],
  [BLOCK_PLAN.OPTIMAL]: [0, 1, 2, 3],
  [BLOCK_PLAN.VALUE]: [4, 2, 3, 0, 1],
};
const keyIn = (order, { survives, counts }) => [survives ? 1 : 0, ...order.map((i) => counts[i])];
const compare = (a, b) => a.map((v, i) => v - b[i]).find((d) => Math.abs(d) > 1e-9) ?? 0;

/** Every legal block, scored in each plan's order: the reference the search must match. */
function bruteForce(attackers, blockers, life) {
  const best = {};
  const assignment = {};
  const visit = (j) => {
    if (j === blockers.length) {
      const scored = score(attackers, blockers, life, assignment);
      if (!scored) return;
      for (const [plan, order] of Object.entries(ORDERS)) {
        const key = keyIn(order, scored);
        if (!best[plan] || compare(key, best[plan]) > 0) best[plan] = key;
      }
      return;
    }
    visit(j + 1);
    for (const attacker of attackers) {
      if (!canBlock(blockers[j], attacker)) continue;
      assignment[blockers[j].id] = attacker.id;
      visit(j + 1);
      delete assignment[blockers[j].id];
    }
  };
  visit(0);
  return best;
}

test('each plan finds its best blocks on random boards', () => {
  for (const [seed, rate] of [[2, 0.12], [3, 0.3], [4, 0.04]]) {
    const random = rng(seed);
    for (let i = 0; i < 1000; i++) {
      const attackers = Array.from({ length: 1 + Math.floor(random() * 4) }, () => randomCreature(random, rate));
      const blockers = Array.from({ length: Math.floor(random() * 6) }, () => randomCreature(random, rate));
      // Some twins, to exercise the classes of identical blockers.
      if (blockers.length > 2 && random() < 0.4) blockers[2] = { ...blockers[0], id: `c${nextId++}` };
      const life = 1 + Math.floor(random() * 14);
      const expected = bruteForce(attackers, blockers, life);
      const plans = blockingPlans(attackers, blockers, life);
      const board = JSON.stringify({ attackers, blockers, life });
      for (const [plan, order] of Object.entries(ORDERS)) {
        const got = plans[plan];
        assert.ok(got.exact);
        for (const [b, a] of Object.entries(got.blocks)) {
          assert.ok(canBlock(blockers.find((c) => c.id === b), attackers.find((c) => c.id === a)), board);
        }
        // What it reports is what its blocks do, and nothing scores better in its order.
        const scored = score(attackers, blockers, life, got.blocks);
        assert.equal(compare([...keyOf(got, life), got.value], [scored.survives ? 1 : 0, ...scored.counts]), 0, `board ${seed}/${i} ${plan}\n${board}`);
        assert.deepEqual([got.deadAttackers, got.deadBlockers], [scored.deadAttackers, blockers.filter((b) => scored.deadBlockers.includes(b.id)).map((b) => b.id)]);
        const key = keyIn(order, scored);
        assert.equal(compare(key, expected[plan]), 0, `board ${seed}/${i} ${plan}: expected ${expected[plan]}, got ${key}\n${board}`);
      }
    }
  }
});

test('chump-blocks only when it has to, to survive', () => {
  const dragon = creature(6, 6);
  const goblin = creature(2, 2);
  const token = creature(1, 1);
  // At 20 life, losing the token to save 2 or 6 life isn't worth it.
  assert.deepEqual(optimalBlocks([dragon, goblin], [token], 20).blocks, {});
  const low = optimalBlocks([dragon, goblin], [token], 7);
  assert.deepEqual(low.blocks, { [token.id]: dragon.id });
  assert.equal(low.survives, true);
  assert.equal(low.lifeAfter, 5);
});

test('double-blocks to kill a big attacker', () => {
  const giant = creature(4, 4);
  const ogre = creature(3, 3);
  const bear = creature(2, 2);
  const result = optimalBlocks([giant], [ogre, bear], 20);
  assert.equal(result.kills, 1);
  assert.equal(Object.keys(result.blocks).length, 2);
  assert.equal(result.lostValue, creatureValue(ogre)); // the giant kills only one of them, the better one
});

test('preserves its creatures: no pointless blocks, and the cheapest kill', () => {
  const bear = creature(2, 2);
  const wall = creature(0, 5);
  const other = creature(2, 2);
  const knight = creature(2, 2, [FIRST_STRIKE]);
  // The first striker kills the bear and survives; the other bear would trade.
  const result = optimalBlocks([bear], [other, knight, wall], 20);
  assert.deepEqual(result.blocks, { [knight.id]: bear.id });
  assert.equal(result.lostValue, 0);
  // Nothing to kill: the wall takes the hit, nobody dies.
  const big = creature(4, 4);
  assert.deepEqual(optimalBlocks([big], [bear, wall], 20).blocks, { [wall.id]: big.id });
});

test('respects menace, flying, and first-strike damage before lifelink', () => {
  const menace = creature(3, 3, [MENACE]);
  const bear = creature(2, 2);
  assert.deepEqual(optimalBlocks([menace], [bear], 20).blocks, {});
  const flyer = creature(3, 3, [FLYING]);
  assert.deepEqual(optimalBlocks([flyer], [creature(5, 5)], 2).blocks, {});
  assert.equal(optimalBlocks([flyer], [creature(5, 5)], 2).survives, false);
  // At 3 life, a 3-power first striker kills before the lifelinker's damage gains life back.
  const striker = creature(3, 3, [FIRST_STRIKE]);
  const other = creature(3, 3);
  const healer = creature(2, 4, [LIFELINK]);
  const result = optimalBlocks([striker, other], [healer], 3);
  assert.deepEqual(result.blocks, { [healer.id]: striker.id });
  assert.equal(result.survives, true);
});

test('treats identical tokens as one class', () => {
  const tokens = Array.from({ length: 10 }, () => creature(1, 2));
  const ogres = Array.from({ length: 3 }, () => creature(3, 3));
  const result = optimalBlocks(ogres, tokens, 20);
  // Three tokens kill each ogre, which kills one of them.
  assert.equal(result.kills, 3);
  assert.equal(result.lostValue, 3 * creatureValue(tokens[0]));
  assert.equal(Object.keys(result.blocks).length, 9);
  assert.ok(result.nodes < 50, `${result.nodes} states`);
});

test('past its budgets, still gives legal blocks, flagged inexact', () => {
  const random = rng(5);
  const attackers = Array.from({ length: 10 }, () => randomCreature(random));
  const blockers = Array.from({ length: 10 }, () => randomCreature(random));
  const exact = optimalBlocks(attackers, blockers, 20);
  const capped = optimalBlocks(attackers, blockers, 20, { stateLimit: 5 });
  assert.equal(capped.exact, false);
  for (const [b, a] of Object.entries(capped.blocks)) {
    assert.ok(canBlock(blockers.find((c) => c.id === b), attackers.find((c) => c.id === a)));
  }
  const worse = keyOf(capped, 20).map((v, i) => v - keyOf(exact, 20)[i]).find((d) => Math.abs(d) > 1e-9) ?? 0;
  assert.ok(worse <= 0, 'never better than the exact answer');
});

test('planOptimalBlocks reads a game state', () => {
  const attacker = creature(2, 2, [], { controllerId: 'p1' });
  const blocker = creature(3, 3, [], { controllerId: 'p2' });
  const state = {
    battlefield: [attacker, blocker],
    players: [{ id: 'p1', life: 20 }, { id: 'p2', life: 20 }],
    combat: { attackers: [{ cardId: attacker.id, blockerIds: [] }] },
  };
  assert.deepEqual(planOptimalBlocks(state, 'p2', () => true), { [blocker.id]: attacker.id });
});

test('plans differ on what they give up', () => {
  // One ogre against a dragon and a bear: chump the dragon to save the most life,
  // or kill the bear, which the ogre survives.
  const dragon = creature(5, 5);
  const bear = creature(2, 2);
  const ogre = creature(3, 3);
  const plans = blockingPlans([dragon, bear], [ogre], 20);
  assert.deepEqual(plans.life.blocks, { [ogre.id]: dragon.id });
  assert.equal(plans.life.lifeAfter, 18);
  assert.deepEqual(plans.life.deadBlockers, [ogre.id]);
  for (const plan of [BLOCK_PLAN.KILLS, BLOCK_PLAN.CREATURES, BLOCK_PLAN.OPTIMAL]) {
    assert.deepEqual(plans[plan].blocks, { [ogre.id]: bear.id }, plan);
    assert.deepEqual(plans[plan].deadAttackers, [bear.id], plan);
    assert.equal(plans[plan].lifeAfter, 15, plan);
  }
  // A trade kills an attacker at the cost of a creature: every plan but `creatures` takes it.
  const theirs = creature(2, 2);
  const mine = creature(2, 2);
  const trade = blockingPlans([theirs], [mine], 20);
  assert.deepEqual(trade.creatures.blocks, {});
  for (const plan of [BLOCK_PLAN.LIFE, BLOCK_PLAN.KILLS, BLOCK_PLAN.OPTIMAL]) {
    assert.deepEqual(trade[plan].deadAttackers, [theirs.id], plan);
    assert.deepEqual(trade[plan].deadBlockers, [mine.id], plan);
  }
});

test('every plan survives when it can', () => {
  // At 5 life the dragon must be chumped, even by the plan that would rather keep its creatures.
  const dragon = creature(5, 5);
  const token = creature(1, 1);
  const plans = blockingPlans([dragon], [token], 5);
  for (const plan of Object.values(BLOCK_PLAN)) {
    assert.equal(plans[plan].survives, true, plan);
    assert.deepEqual(plans[plan].blocks, { [token.id]: dragon.id }, plan);
  }
});

test('blockingPlansFor reads a game state, and makes only the plans asked for', () => {
  const attacker = creature(2, 2, [], { controllerId: 'p1' });
  const blocker = creature(2, 2, [], { controllerId: 'p2' });
  const state = {
    battlefield: [attacker, blocker],
    players: [{ id: 'p1', life: 20 }, { id: 'p2', life: 20 }],
    combat: { attackers: [{ cardId: attacker.id, blockerIds: [] }] },
  };
  const plans = blockingPlansFor(state, 'p2', () => true, { plans: [BLOCK_PLAN.CREATURES, BLOCK_PLAN.KILLS] });
  assert.deepEqual(Object.keys(plans), [BLOCK_PLAN.CREATURES, BLOCK_PLAN.KILLS]);
  assert.deepEqual(plans.creatures.blocks, {});
  assert.deepEqual(plans.kills.blocks, { [blocker.id]: attacker.id });
});

test('the value plan trades only when it gains', () => {
  // Killing a 1/1 deathtoucher with a 5/5 kills the most, but loses more than it kills.
  const snake = creature(1, 1, [DEATHTOUCH]);
  const giant = creature(5, 5);
  const plans = blockingPlans([snake], [giant], 20);
  assert.deepEqual(plans.optimal.blocks, { [giant.id]: snake.id });
  assert.deepEqual(plans.value.blocks, {});
  // A chump block is worth its creature only when life is short.
  const dragon = creature(5, 5);
  const token = creature(1, 1);
  assert.deepEqual(blockingPlans([dragon], [token], 20).value.blocks, {});
  assert.deepEqual(blockingPlans([dragon], [token], 8).value.blocks, { [token.id]: dragon.id });
});

test('each AI module loads first, whatever imports it', async () => {
  const { execFileSync } = await import('node:child_process');
  for (const module of ['blocking', 'attacking', 'combat']) {
    execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL(`../src/ai/${module}.js`, import.meta.url).href)})`]);
  }
  const { BLOCKING } = await import('../src/ai/combat.js');
  assert.equal(BLOCKING.VALUE, BLOCK_PLAN.VALUE);
});

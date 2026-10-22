import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYWORD, CARD_TYPE } from '../src/index.js';
import { resolveCombat, canBlock, creatureValue } from '../src/ai/combat.js';
import { fight, optimalBlocks, planOptimalBlocks } from '../src/ai/blocking.js';

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
const KEYWORDS = [FIRST_STRIKE, DOUBLE_STRIKE, DEATHTOUCH, TRAMPLE, LIFELINK, FLYING, REACH, MENACE];
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
  }
});

/**
 * Every legal block (at most 3 blockers on an attacker), scored by the same rules:
 * the reference the search must match. Like the solver, a group lists identical
 * blockers alike (the attacker's tie-breaks depend on the order).
 */
function bruteForce(attackers, blockers, life) {
  const signature = (b) => [b.power, b.toughness, b.damage, flagsOf(b), creatureValue(b), attackers.map((a) => canBlock(b, a))].join();
  const lead = blockers.map((b) => blockers.findIndex((c) => signature(c) === signature(b)));
  const order = blockers.map((b, i) => i).sort((x, y) => lead[x] - lead[y] || x - y);
  let best = null;
  const assignment = new Array(blockers.length).fill(-1);
  const visit = (j) => {
    if (j === blockers.length) {
      let net1 = 0;
      let net = 0;
      let kills = 0;
      let killedValue = 0;
      let lost = 0;
      for (let a = 0; a < attackers.length; a++) {
        const group = order.filter((i) => assignment[i] === a).map((i) => blockers[i]);
        if (group.length > 3 || (group.length === 1 && attackers[a].keywords.includes(MENACE))) return;
        const result = fight(rec(attackers[a]), group.map(rec));
        net1 += result.damage1 - result.gain1;
        net += result.damage - result.gain;
        if (result.attackerDies) {
          kills += 1;
          killedValue += creatureValue(attackers[a]);
        }
        group.forEach((b, i) => { if (result.deadBlockers & (1 << i)) lost += creatureValue(b); });
      }
      const key = [life - net1 > 0 && life - net > 0 ? 1 : 0, kills, killedValue, -lost, -net];
      const better = !best || (key.map((v, i) => v - best[i]).find((d) => Math.abs(d) > 1e-9) ?? 0) > 0;
      if (better) best = key;
      return;
    }
    for (let a = -1; a < attackers.length; a++) {
      if (a >= 0 && !canBlock(blockers[j], attackers[a])) continue;
      assignment[j] = a;
      visit(j + 1);
    }
    assignment[j] = -1;
  };
  visit(0);
  return best;
}

test('optimalBlocks finds the best blocks on random boards', () => {
  for (const [seed, rate] of [[2, 0.12], [3, 0.3], [4, 0.04]]) {
    const random = rng(seed);
    for (let i = 0; i < 1000; i++) {
      const attackers = Array.from({ length: 1 + Math.floor(random() * 4) }, () => randomCreature(random, rate));
      const blockers = Array.from({ length: Math.floor(random() * 6) }, () => randomCreature(random, rate));
      // Some twins, to exercise the classes of identical blockers.
      if (blockers.length > 2 && random() < 0.4) blockers[2] = { ...blockers[0], id: `c${nextId++}` };
      const life = 1 + Math.floor(random() * 14);
      const expected = bruteForce(attackers, blockers, life);
      const got = optimalBlocks(attackers, blockers, life);
      const key = keyOf(got, life);
      const board = JSON.stringify({ attackers, blockers, life });
      assert.ok(got.exact);
      expected.forEach((v, k) => assert.ok(Math.abs(v - key[k]) < 1e-6, `board ${seed}/${i}: expected ${expected}, got ${key}\n${board}`));
      for (const [b, a] of Object.entries(got.blocks)) {
        assert.ok(canBlock(blockers.find((c) => c.id === b), attackers.find((c) => c.id === a)), board);
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

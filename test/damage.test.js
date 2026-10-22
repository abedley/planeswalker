import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECISION, ACTION } from '../src/index.js';
import { damagePlans } from '../app/battle/damage.js';

/** Every split of `power` over `ids`, as the engine lists them. */
function splits(power, ids) {
  if (ids.length === 1) return [{ [ids[0]]: power }];
  const out = [];
  for (let n = 0; n <= power; n++) for (const rest of splits(power - n, ids.slice(1))) out.push({ [ids[0]]: n, ...rest });
  return out;
}

const creature = (id, power, toughness, extra = {}) => ({ id, controllerId: 'x', types: ['Creature'], keywords: [], power, toughness, damage: 0, ...extra });

/** p1 attacks with `attacker`, blocked by `blockers`; `filter` drops illegal splits (trample). */
function combat(attacker, blockers, { trample = false, filter = () => true } = {}) {
  const ids = blockers.map((b) => b.id);
  const targets = trample ? [...ids, 'p2'] : ids;
  return {
    battlefield: [attacker, ...blockers],
    pendingDecision: { type: DECISION.ASSIGN_COMBAT_DAMAGE, playerId: 'p1', attackerId: attacker.id, power: attacker.power, blockerIds: ids, trample },
    validActions: splits(attacker.power, targets).filter(filter)
      .map((assignment) => ({ type: ACTION.ASSIGN_COMBAT_DAMAGE, playerId: 'p1', attackerId: attacker.id, assignment })),
  };
}

const summary = (plans) => plans.map((p) => `${p.kills.join('+') || 'none'}/${p.toPlayer}`);

test('damage plans are the choices of who dies', () => {
  const state = combat(creature('atk', 3, 3), [creature('a', 2, 2), creature('b', 2, 2)]);
  assert.deepEqual(summary(damagePlans(state, 'p1')), ['a/0', 'b/0'], 'only enough to kill one');
  const bigger = combat(creature('atk', 3, 3), [creature('a', 1, 1), creature('b', 2, 3)]);
  assert.deepEqual(summary(damagePlans(bigger, 'p1')), ['b/0', 'a/0'], 'the bigger kill first');
  assert.deepEqual(damagePlans(bigger, 'p1').map((p) => p.assignment), [{ a: 0, b: 3 }, { a: 1, b: 2 }], 'spare damage on the survivor');
});

test('a plan that kills everything leaves nothing to choose', () => {
  const state = combat(creature('atk', 4, 4), [creature('a', 2, 2), creature('b', 2, 2)]);
  const plans = damagePlans(state, 'p1');
  assert.deepEqual(summary(plans), ['a+b/0']);
  assert.deepEqual(plans[0].assignment, { a: 2, b: 2 });
});

test('trample sends the excess to the player', () => {
  const lethalFirst = (s) => s.p2 === 0 || s.a >= 2;
  const state = combat(creature('atk', 5, 5, { keywords: ['trample'] }), [creature('a', 2, 2)], { trample: true, filter: lethalFirst });
  const plans = damagePlans(state, 'p1');
  assert.deepEqual(summary(plans), ['a/3']);
  assert.deepEqual(plans[0].assignment, { a: 2, p2: 3 });
});

test('deathtouch makes one damage lethal, and marked damage counts', () => {
  const deathtouch = combat(creature('atk', 2, 2, { keywords: ['deathtouch'] }), [creature('a', 4, 4), creature('b', 4, 4)]);
  assert.deepEqual(summary(damagePlans(deathtouch, 'p1')), ['a+b/0']);
  const hurt = combat(creature('atk', 3, 3), [creature('a', 3, 3, { damage: 2 }), creature('b', 2, 2)]);
  assert.deepEqual(summary(damagePlans(hurt, 'p1')), ['a+b/0']);
});

test('no plans unless it is my damage to assign', () => {
  const state = combat(creature('atk', 3, 3), [creature('a', 2, 2), creature('b', 2, 2)]);
  assert.deepEqual(damagePlans(state, 'p2'), []);
  assert.deepEqual(damagePlans({ ...state, pendingDecision: null }, 'p1'), []);
});

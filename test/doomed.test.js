import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEP } from '../src/engine/turnStructure.js';
import { EFFECT } from '../src/cards/cards.js';
import { kills, doomedCreatures, savedByRemoving } from '../src/ai/doomed.js';

const creature = (id, controllerId, power, toughness) => ({
  id, controllerId, name: id, types: ['Creature'], power, toughness, keywords: [], damage: 0, tapped: false,
});

/** p1 attacks p2 with `attackers` (`[creature, blockerIds]`); `step` is the combat step. */
function combat(pairs, { step = STEP.DECLARE_BLOCKERS, others = [], stack = [] } = {}) {
  const battlefield = [...pairs.flatMap(([a]) => [a]), ...others];
  return {
    activePlayerId: 'p1',
    step,
    pendingDecision: null,
    stack,
    players: [{ id: 'p1', life: 20 }, { id: 'p2', life: 20 }],
    battlefield,
    combat: { attackers: pairs.map(([a, blockerIds]) => ({ cardId: a.id, blockerIds, blocked: blockerIds.length > 0 })) },
  };
}

test('what kills a creature', () => {
  const bear = creature('bear', 'p1', 2, 2);
  assert.equal(kills({ type: EFFECT.DESTROY }, bear), true);
  assert.equal(kills({ type: EFFECT.DEAL_DAMAGE, amount: 2 }, bear), true);
  assert.equal(kills({ type: EFFECT.DEAL_DAMAGE, amount: 1 }, bear), false);
  assert.equal(kills({ type: EFFECT.PUMP, power: -2, toughness: -2 }, bear), true);
  assert.equal(kills({ type: EFFECT.RETURN_TO_HAND }, bear), false);
});

test('an attacker its blocker kills is doomed, and removing it first saves nothing', () => {
  // p1's 2/2 attacks into p2's 4/4: the 2/2 dies, the 4/4 lives.
  const state = combat([[creature('bear', 'p1', 2, 2), ['wall']]], { others: [creature('wall', 'p2', 4, 4)] });
  const doomed = doomedCreatures(state, 'p2');
  assert.deepEqual([...doomed.keys()], ['bear']);
  assert.equal(savedByRemoving(state, 'p2', 'bear'), 0);
});

test('removing a doomed attacker in a trade saves the blocker', () => {
  // A 3/3 into a 3/3: both die; removing the attacker first saves p2's blocker.
  const state = combat([[creature('ox', 'p1', 3, 3), ['cow']]], { others: [creature('cow', 'p2', 3, 3)] });
  assert.deepEqual([...doomedCreatures(state, 'p2').keys()].sort(), ['cow', 'ox']);
  assert.ok(savedByRemoving(state, 'p2', 'ox') > 0);
});

test('while being attacked, the planned blocks count', () => {
  // Declared attackers, no blocks yet: p2 plans to block the 2/2 with its 4/4.
  const state = combat([[creature('bear', 'p1', 2, 2), []]], { step: STEP.DECLARE_ATTACKERS, others: [creature('wall', 'p2', 4, 4)] });
  assert.deepEqual([...doomedCreatures(state, 'p2').keys()], ['bear']);
  // The attacker doesn't plan p2's blocks.
  assert.equal(doomedCreatures(state, 'p1').size, 0);
});

test('a creature a spell on the stack will kill is doomed', () => {
  const bear = creature('bear', 'p2', 2, 2);
  const state = combat([], {
    step: null,
    others: [bear],
    stack: [{ id: 's1', kind: 'spell', controllerId: 'p1', targets: ['bear'], card: { spell: { effects: [{ type: EFFECT.DEAL_DAMAGE, amount: 3 }] } } }],
  });
  assert.deepEqual([...doomedCreatures(state, 'p1')], [['bear', { reason: 'stack' }]]);
});

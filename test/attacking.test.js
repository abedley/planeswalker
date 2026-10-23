import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_TYPE, KEYWORD } from '../src/index.js';
import { planLookaheadAttack, ATTACK_STRATEGY } from '../src/ai/attacking.js';

let nextId = 0;
const creature = (controllerId, power, toughness, keywords = [], extra = {}) => ({
  id: `${controllerId}-${nextId++}`, controllerId, types: [CARD_TYPE.CREATURE], power, toughness, keywords, damage: 0, tapped: false, ...extra,
});
const board = (mine, theirs, life, theirLife) => ({
  battlefield: [...mine, ...theirs], players: [{ id: 'me', life }, { id: 'them', life: theirLife }],
});
const plan = (mine, theirs, life, theirLife) => planLookaheadAttack(board(mine, theirs, life, theirLife), 'me', mine);

test('races when attacking with everything wins', () => {
  const mine = [creature('me', 3, 3), creature('me', 3, 3), creature('me', 3, 3)];
  const result = plan(mine, [creature('them', 2, 2)], 20, 12);
  assert.deepEqual(result.attackers.toSorted(), mine.map((c) => c.id).toSorted());
  assert.ok(result.scores[result.strategy] > 9000, 'a sure win');
});

test('holds back when the crack-back would kill it', () => {
  // Their bears are tapped, so ours could hit for 4; but then their bears hit back for lethal.
  const mine = [creature('me', 3, 3), creature('me', 3, 3)];
  const theirs = [creature('them', 2, 2, [], { tapped: true }), creature('them', 2, 2, [], { tapped: true })];
  const result = plan(mine, theirs, 3, 20);
  assert.equal(result.strategy, ATTACK_STRATEGY.HOLD);
  assert.deepEqual(result.attackers, []);
  assert.ok(result.scores[ATTACK_STRATEGY.VALUE] < -9000, 'chip damage loses');
});

test('attacks for value with what they can\'t block well, and keeps the rest home', () => {
  const ogre = creature('me', 4, 4);
  const token = creature('me', 1, 1);
  const result = plan([ogre, token], [creature('them', 2, 2)], 20, 20);
  assert.equal(result.strategy, ATTACK_STRATEGY.VALUE);
  assert.deepEqual(result.attackers, [ogre.id]);
});

test('attacks with no one when nothing can attack', () => {
  const wall = creature('me', 0, 5, [KEYWORD.DEFENDER]);
  assert.deepEqual(plan([wall], [creature('them', 2, 2)], 20, 20).attackers, []);
});

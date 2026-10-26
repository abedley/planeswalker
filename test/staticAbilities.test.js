import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYWORD, AFFECTED, colorsOf, anthemApplies } from '../src/cards/cards.js';
import { creatureValue, curseValue, anthemValue } from '../src/ai/combat.js';

test('a curse is worth what it takes from the creature, or all of it if it kills', () => {
  const bear = { id: 'bear', types: ['Creature'], power: 2, toughness: 2, keywords: [], damage: 0 };
  const curse = (bonus) => ({ staticAbilities: [{ affected: AFFECTED.ATTACHED_PERMANENT, ...bonus }] });
  const pacified = curseValue(bear, curse({ keywords: [KEYWORD.CANT_ATTACK, KEYWORD.CANT_BLOCK] }));
  assert.ok(pacified > 0 && pacified < creatureValue(bear));
  assert.equal(curseValue(bear, curse({ power: -2, toughness: -2 })), creatureValue(bear));
  assert.ok(curseValue(bear, curse({ power: -1 })) < pacified);
});

test('colors: letters, words on creature tokens, or the mana cost', () => {
  assert.deepEqual(colorsOf({ colors: ['W'] }), ['W']);
  assert.deepEqual(colorsOf({ colors: ['white'], token: true }), ['W']);
  assert.deepEqual(colorsOf({ manaCost: { generic: 1, G: 1, W: 1 } }), ['W', 'G']);
  assert.deepEqual(colorsOf({ manaCost: { generic: 3 } }), []);
});

test('an anthem applies to its controller\'s matching creatures, and is worth what it adds', () => {
  const creature = (id, controllerId, extra = {}) => ({
    id, controllerId, types: ['Creature'], power: 2, toughness: 2, keywords: [], damage: 0, ...extra,
  });
  const lord = { id: 'lord', controllerId: 'p1', types: ['Creature'], subtypes: ['Soldier'] };
  const soldiers = { affected: AFFECTED.EACH_CREATURE_YOU_CONTROL, power: 1, toughness: 1, other: true, subtypes: ['Soldier'] };
  assert.equal(anthemApplies(soldiers, lord, creature('a', 'p1', { subtypes: ['Soldier'] })), true);
  assert.equal(anthemApplies(soldiers, lord, creature('b', 'p1', { subtypes: ['Cat'] })), false);
  assert.equal(anthemApplies(soldiers, lord, creature('c', 'p2', { subtypes: ['Soldier'] })), false);
  assert.equal(anthemApplies(soldiers, lord, { ...lord, power: 3, toughness: 3 }), false); // "other"

  const anthem = { staticAbilities: [{ affected: AFFECTED.EACH_CREATURE_YOU_CONTROL, power: 1, toughness: 1 }] };
  const bear = creature('bear', 'p1');
  const state = (battlefield) => ({ battlefield });
  assert.equal(anthemValue(state([]), 'p1', anthem), 0);
  const one = anthemValue(state([bear]), 'p1', anthem);
  assert.equal(one, creatureValue({ ...bear, power: 3, toughness: 3 }) - creatureValue(bear));
  assert.equal(anthemValue(state([bear, creature('elk', 'p1'), creature('foe', 'p2')]), 'p1', anthem), 2 * one);
  assert.equal(anthemValue(state([bear]), 'p1', { staticAbilities: [{ affected: AFFECTED.ATTACHED_PERMANENT, power: 2 }] }), 0);
});

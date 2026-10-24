import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYWORD, AFFECTED } from '../src/cards/cards.js';
import { creatureValue, curseValue } from '../src/ai/combat.js';

test('a curse is worth what it takes from the creature, or all of it if it kills', () => {
  const bear = { id: 'bear', types: ['Creature'], power: 2, toughness: 2, keywords: [], damage: 0 };
  const curse = (bonus) => ({ staticAbilities: [{ affected: AFFECTED.ATTACHED_PERMANENT, ...bonus }] });
  const pacified = curseValue(bear, curse({ keywords: [KEYWORD.CANT_ATTACK, KEYWORD.CANT_BLOCK] }));
  assert.ok(pacified > 0 && pacified < creatureValue(bear));
  assert.equal(curseValue(bear, curse({ power: -2, toughness: -2 })), creatureValue(bear));
  assert.ok(curseValue(bear, curse({ power: -1 })) < pacified);
});

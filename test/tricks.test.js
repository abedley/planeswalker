import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, SAMPLE_SPELLS } from '../src/index.js';
import { emptyManaPool } from '../src/engine/mana.js';
import {
  trickOf, trickThreat, playAroundTricks, baitWithTricks,
} from '../src/ai/tricks.js';

const defs = { ...CARDS, ...SAMPLE_SPELLS };
// The +3/+3 instant among the sample spells.
const [trickId] = Object.keys(SAMPLE_SPELLS).filter((id) => trickOf(SAMPLE_SPELLS[id])?.power === 3);
const card = (cardId, extra = {}) => ({ ...defs[cardId], cardId, id: `${cardId}-${Math.random()}`, ...extra });
const creature = (id, controllerId, power, toughness, extra = {}) => ({
  id, controllerId, name: id, types: ['Creature'], power, toughness, keywords: [], damage: 0, tapped: false, ...extra,
});
const lands = (controllerId, n) => Array.from({ length: n }, (_, i) => ({ ...card('forest'), id: `${controllerId}-land${i}`, controllerId, tapped: false }));

/** p1 attacks p2; each has `hand` and a library of Forests (with `libraryTricks` tricks). */
function board({ p1Hand = [], p2Hand = [], p2Library = 30, libraryTricks = 0, mine = [], theirs = [], p1Lands = 3, p2Lands = 3 }) {
  const library = [...Array(p2Library - libraryTricks).fill('forest'), ...Array(libraryTricks).fill(trickId)].map((id) => card(id));
  return {
    players: [
      { id: 'p1', life: 20, hand: p1Hand.map((id) => card(id)), library: [], manaPool: emptyManaPool() },
      { id: 'p2', life: 20, hand: p2Hand.map((id) => card(id)), library, manaPool: emptyManaPool() },
    ],
    battlefield: [...mine, ...theirs, ...lands('p1', p1Lands), ...lands('p2', p2Lands)],
  };
}

test('a trick is an instant that pumps its target', () => {
  assert.deepEqual(trickOf(SAMPLE_SPELLS[trickId]), { power: 3, toughness: 3, keywords: [], manaValue: 1 });
  assert.equal(trickOf(defs.forest), null);
  assert.equal(trickOf(defs.llanowarElves), null);
});

test('the chance of a trick comes from the deck list and the hand size', () => {
  // 3 cards in hand from 33, 3 of them tricks: 1 - (30·29·28)/(33·32·31).
  const state = board({ p2Hand: ['forest', 'forest', 'forest'], libraryTricks: 3 });
  const { chance, trick } = trickThreat(state, 'p2');
  assert.ok(Math.abs(chance - (1 - (30 * 29 * 28) / (33 * 32 * 31))) < 1e-9);
  assert.equal(trick.power, 3);
  // Without the mana up, nothing.
  assert.equal(trickThreat(board({ p2Hand: ['forest'], libraryTricks: 3, p2Lands: 0 }), 'p2').chance, 0);
});

test('playing around tricks: no attack into a block a trick turns into a blowout', () => {
  // A 3/3 into a 2/2: safe, unless the 2/2 gets +3/+3.
  const state = board({ p2Hand: ['forest', 'forest', 'forest'], libraryTricks: 10, mine: [creature('bear', 'p1', 3, 3)], theirs: [creature('cub', 'p2', 2, 2)] });
  assert.deepEqual(playAroundTricks(state, 'p1', ['bear'], 0.3), []);
  assert.deepEqual(playAroundTricks(state, 'p1', ['bear'], 0.99), ['bear']);
  // Lethal anyway (one blocker can't stop both): attack.
  state.battlefield.push(creature('ox', 'p1', 3, 3));
  state.players[1].life = 3;
  assert.deepEqual(playAroundTricks(state, 'p1', ['bear', 'ox'], 0.3), ['bear', 'ox']);
});

test('baiting with a trick: attack into a block that our trick wins', () => {
  // A 2/2 into a 3/3 looks like a free block for them; +3/+3 makes it a 5/5.
  const state = board({ p1Hand: [trickId], mine: [creature('cub', 'p1', 2, 2)], theirs: [creature('bear', 'p2', 3, 3)] });
  const cub = state.battlefield[0];
  assert.deepEqual(baitWithTricks(state, 'p1', [], [cub]), ['cub']);
  // No mana for it: no bait.
  for (const land of state.battlefield.filter((p) => p.controllerId === 'p1' && p.types.includes('Land'))) land.tapped = true;
  assert.deepEqual(baitWithTricks(state, 'p1', [], [cub]), []);
});

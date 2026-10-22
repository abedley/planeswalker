import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, REAL_DECKS, GAME_STATUS } from '../src/index.js';
import { actingPlayerId } from '../src/ai/simulate.js';
import { listMacros } from '../src/ai/macroActions.js';
import { worthSearching } from '../src/ai/search.js';
import { determinize } from '../src/ai/determinize.js';
import { evaluateTiered, TIERS } from '../src/ai/evaluate.js';
import { simulateLookahead, basicPolicies, horizonOf } from '../src/ai/lookahead.js';
import { seededRandom } from '../src/engine/random.js';

const players = [{ id: 'p1' }, { id: 'p2' }];

/** A real-deck game played by basic AIs until p1 has a choice, from turn `fromTurn`. */
function position(seed = 5, fromTurn = 6) {
  const game = new Game({ players, seed, decks: { p1: REAL_DECKS.greenStompy, p2: REAL_DECKS.redBurn }, silent: true });
  game.start();
  const policies = basicPolicies(players);
  for (let i = 0; i < 4000; i++) {
    const s = game.peekState();
    if (s.status !== GAME_STATUS.IN_PROGRESS) break;
    if (s.turn >= fromTurn && actingPlayerId(s) === 'p1' && worthSearching(s, 'p1') && listMacros(s, 'p1').length > 2) return game;
    game.applyTrusted(policies[actingPlayerId(s)](s));
  }
  throw new Error('no position');
}

test('the horizon is a turn number, the same for every branch', () => {
  const game = position();
  const { turn, activePlayerId } = game.peekState();
  const until = horizonOf(game, 'p1', 2);
  const target = turn + (activePlayerId === 'p1' ? 2 : 1) + 2;
  assert.equal(until({ turn: target - 1 }), false);
  assert.equal(until({ turn: target }), true);
  // Asking about a later state first doesn't change the answer for an earlier one.
  assert.equal(until({ turn: target - 1 }), false);
});

test('lookahead values every candidate, and searches more nodes when deeper', () => {
  const game = position();
  const view = game.getPlayerView('p1');
  const macros = listMacros(game.peekState(), 'p1');
  const snapshot = determinize(view, seededRandom(1));
  const policies = basicPolicies(players);
  const nodes = [1, 3].map((depth) => {
    const counter = { nodes: 0 };
    for (const macro of macros) {
      const value = simulateLookahead(snapshot, 'p1', macro, policies, { evaluate: evaluateTiered, depth, beam: 2, counter });
      assert.ok(value === null || Number.isFinite(value));
    }
    return counter.nodes;
  });
  assert.ok(nodes[1] > nodes[0], `${nodes[1]} > ${nodes[0]}`);
});

test('the tiered evaluation puts not losing above creatures, and winning above all', () => {
  const game = position(5, 8);
  const state = structuredClone(game.peekState());
  // A huge creature advantage for p1...
  const big = { ...state.battlefield.find((p) => p.types.includes('Creature')) ?? {}, types: ['Creature'], keywords: [], power: 8, toughness: 8, damage: 0, tapped: false, summoningSick: false };
  const ahead = { ...state, battlefield: [...state.battlefield, ...[1, 2, 3].map((i) => ({ ...big, id: `big${i}`, controllerId: 'p1' }))] };
  // ...but at 1 life on p2's turn, facing an unblockable-enough attack: dead on board.
  const dead = structuredClone(ahead);
  dead.players.find((p) => p.id === 'p1').life = 1;
  dead.activePlayerId = 'p2';
  dead.battlefield.push({ ...big, id: 'flyer', controllerId: 'p2', keywords: ['flying'], power: 2, toughness: 2 });
  for (const c of dead.battlefield) if (c.controllerId === 'p1') c.tapped = true;
  assert.ok(evaluateTiered(dead, 'p1') < evaluateTiered(state, 'p1'), 'dead on board is worse than an even board');
  // Lethal on our own turn beats anything short of winning.
  const lethal = structuredClone(ahead);
  lethal.activePlayerId = 'p1';
  lethal.players.find((p) => p.id === 'p2').life = 1;
  for (const c of lethal.battlefield) if (c.controllerId === 'p2') c.tapped = true;
  assert.ok(evaluateTiered(lethal, 'p1') > TIERS.lethalNow / 2);
});

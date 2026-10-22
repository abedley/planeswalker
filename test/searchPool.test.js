import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, BasicAIController, DECISION, REAL_DECKS } from '../src/index.js';
import { actingPlayerId } from '../src/ai/simulate.js';
import { listMacros } from '../src/ai/macroActions.js';
import { worthSearching } from '../src/ai/search.js';
import { SearchPool, SearchScheduler } from '../src/ai/searchPool.js';
import { ponderTargets } from '../src/ai/ponder.js';
import { viewKey } from '../src/ai/SearchAIController.js';

const players = [{ id: 'p1' }, { id: 'p2' }];
const newGame = (seed = 2) => {
  const game = new Game({ players, seed, decks: { p1: REAL_DECKS.greenStompy, p2: REAL_DECKS.redBurn }, silent: true });
  game.start();
  return game;
};
const basic = Object.fromEntries(players.map(({ id }) => [id, new BasicAIController({ game: null, playerId: id })]));
const play = (game) => game.applyTrusted(basic[actingPlayerId(game.peekState())].chooseAction(game.peekState()));

/** Plays basic AIs on until `found(state)`. */
function advanceUntil(game, found, maxSteps = 4000) {
  for (let i = 0; i < maxSteps && game.peekState().status === 'inProgress'; i++) {
    if (found(game.peekState())) return game.peekState();
    play(game);
  }
  throw new Error('position not found');
}

/** A request for `me`'s decision in `game`'s current position. */
function requestFor(game, me, budgetMs) {
  const view = game.getPlayerView(me);
  return { key: viewKey(view), view, me, macros: listMacros(game.peekState(), me), budgetMs, seed: 5 };
}

const hasChoice = (me) => (state) => actingPlayerId(state) === me && worthSearching(state, me) && listMacros(state, me).length > 2;
const now = () => performance.now();
const until = async (condition, ms = 5000) => {
  const deadline = now() + ms;
  while (!condition()) {
    if (now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test('a search for a position met again carries on from where it got to', () => {
  const game = newGame();
  advanceUntil(game, hasChoice('p2'));
  const pool = new SearchPool();
  const request = requestFor(game, 'p2', 10_000);
  pool.work(request, 30, now);
  const first = pool.result(request.key);
  // The same position from a fresh view: the same key, the same search.
  pool.work({ ...requestFor(game, 'p2', 10_000), seed: 99 }, 30, now);
  const second = pool.result(request.key);
  assert.ok(second.iterations > first.iterations, `${second.iterations} > ${first.iterations}`);
  assert.ok(pool.spent(request.key) >= 50);
  assert.equal(pool.ready({ ...request, budgetMs: 40 }), true, 'had its budget');
});

test('least recently used searches are dropped, pondered ones are kept', () => {
  const game = newGame();
  advanceUntil(game, hasChoice('p2'));
  const pool = new SearchPool({ limit: 2 });
  const base = requestFor(game, 'p2', 100);
  pool.setPonder([{ ...base, key: 'pondered' }]);
  for (const key of ['pondered', 'a', 'b', 'c']) pool.work({ ...base, key }, 1, now);
  assert.deepEqual(['pondered', 'a', 'b', 'c'].map((key) => pool.has(key)), [true, false, false, true]);
});

test('a pondered position is answered without searching it again', async () => {
  const game = newGame();
  advanceUntil(game, hasChoice('p2'));
  const results = [];
  const scheduler = new SearchScheduler({ onResult: (id, result) => results.push({ id, result }) });
  const request = requestFor(game, 'p2', 80);
  scheduler.ponder([request]);
  await until(() => scheduler.pool.ready(request));
  const spent = scheduler.pool.spent(request.key);
  const started = now();
  scheduler.search(1, request);
  await until(() => results.length === 1);
  assert.ok(now() - started < 40, `answered in ${Math.round(now() - started)} ms`);
  assert.equal(scheduler.pool.spent(request.key), spent, 'no more work on it');
  assert.ok(results[0].result.best);
  scheduler.dispose();
});

test('a newer search replaces the running one', async () => {
  const game = newGame();
  advanceUntil(game, hasChoice('p2'));
  const results = [];
  const scheduler = new SearchScheduler({ onResult: (id, result) => results.push({ id, result }) });
  const request = requestFor(game, 'p2', 60);
  scheduler.search(1, request);
  scheduler.search(2, { ...request, key: 'other' });
  await until(() => results.length === 2);
  assert.deepEqual(results.map((r) => [r.id, r.result === null]), [[1, true], [2, false]]);
  scheduler.dispose();
});

test('pondering predicts the position the AI meets if the opponent passes', () => {
  for (const seed of [2, 3, 4]) {
    const game = newGame(seed);
    // p1 (the player) in their main phase, with the AI (p2) waiting.
    advanceUntil(game, (s) => s.turn >= 5 && s.activePlayerId === 'p1' && actingPlayerId(s) === 'p1' && !s.pendingDecision && !s.stack.length);
    const version = game.peekState().version;
    const targets = ponderTargets(game.clone(), 'p2');
    assert.equal(game.peekState().version, version, 'the real game is untouched');
    assert.ok(targets.length > 0);
    // Now p1 really passes (making no attack), and the AI plays as the basic AI would.
    for (let i = 0; i < 400; i++) {
      const state = game.peekState();
      if (hasChoice('p2')(state) || (actingPlayerId(state) === 'p2' && worthSearching(state, 'p2') && listMacros(state, 'p2').length > 1)) break;
      const acting = actingPlayerId(state);
      const confirm = state.validActions.find((a) => a.playerId === acting && a.type === 'CONFIRM_ATTACKERS');
      if (acting === 'p1') game.applyTrusted(state.pendingDecision ? confirm : state.validActions.find((a) => a.playerId === 'p1' && a.type === 'PASS_PRIORITY'));
      else play(game);
    }
    assert.equal(viewKey(game.getPlayerView('p2')), viewKey(targets[0].view), `seed ${seed}: the first pondered position is the one reached`);
  }
});

test('while the player picks attackers, the AI ponders its blocks against them', () => {
  const picking = (s) => s.pendingDecision?.type === DECISION.DECLARE_ATTACKERS && s.pendingDecision.playerId === 'p1'
    && s.pendingDecision.attackers.length > 0 && s.battlefield.some((p) => p.controllerId === 'p2' && p.types.includes('Creature') && !p.tapped);
  let game;
  let state;
  for (let seed = 1; !state && seed < 20; seed++) {
    game = newGame(seed);
    try { state = advanceUntil(game, picking); } catch { /* next seed */ }
  }
  const attackers = [...state.pendingDecision.attackers];
  // (Before its blocks it may have a decision while being attacked, e.g. burn an attacker.)
  const blocks = ponderTargets(game.clone(), 'p2').find((t) => t.view.pendingDecision?.type === DECISION.DECLARE_BLOCKERS);
  assert.ok(blocks, 'its blocks are among the positions pondered');
  assert.deepEqual(blocks.view.combat.attackers.map((a) => a.cardId), attackers);
});

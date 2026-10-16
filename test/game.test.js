import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, ACTION, PHASE, STEP, passPriority, AutoPassController } from '../src/index.js';

const players = [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }];

function startGame(options = {}) {
  const game = new Game({ players, ...options });
  const events = [];
  game.onAny((name, payload) => events.push({ name, payload }));
  game.start();
  return { game, events };
}

/** Both players pass once, starting with whoever has priority. */
function passRound(game) {
  for (let i = 0; i < players.length; i++) {
    const { priorityPlayerId } = game.getState();
    assert.deepEqual(game.dispatch(passPriority(priorityPlayerId)), { ok: true });
  }
}

const where = (game) => {
  const { turn, phase, step } = game.getState();
  return { turn, phase, step };
};

test('requires at least two players with unique ids', () => {
  assert.throws(() => new Game({ players: [{ id: 'p1' }] }));
  assert.throws(() => new Game({ players: [{ id: 'p1' }, { id: 'p1' }] }));
  assert.throws(() => new Game({ players, startingPlayerId: 'nobody' }));
});

test('starting the game skips the untap step for priority and lands in upkeep', () => {
  const { game, events } = startGame();
  const state = game.getState();
  assert.equal(state.turn, 1);
  assert.equal(state.activePlayerId, 'p1');
  assert.equal(state.priorityPlayerId, 'p1');
  assert.equal(state.phase, PHASE.BEGINNING);
  assert.equal(state.step, STEP.UPKEEP);
  assert.deepEqual(state.validActions, [{ type: ACTION.PASS_PRIORITY, playerId: 'p1' }]);

  const names = events.map((e) => e.name);
  assert.deepEqual(names, [
    'gameStarted', 'turnStarted', 'phaseStarted', 'stepStarted', 'stepEnded',
    'stepStarted', 'priorityGranted', 'state',
  ]);
  assert.equal(events.at(-1).payload.validActions.length, 1);
});

test('passing priority goes to the next player; the step only ends when all pass', () => {
  const { game } = startGame();
  game.dispatch(passPriority('p1'));
  let state = game.getState();
  assert.equal(state.step, STEP.UPKEEP);
  assert.equal(state.priorityPlayerId, 'p2');
  assert.deepEqual(state.playersPassed, ['p1']);
  assert.deepEqual(state.validActions, [{ type: ACTION.PASS_PRIORITY, playerId: 'p2' }]);

  game.dispatch(passPriority('p2'));
  state = game.getState();
  // Turn 1: the starting player skips their draw step.
  assert.equal(state.phase, PHASE.PRECOMBAT_MAIN);
  assert.equal(state.step, null);
  assert.equal(state.priorityPlayerId, 'p1');
  assert.deepEqual(state.playersPassed, []);
});

test('walks the full turn structure, skipping blockers and damage without attackers', () => {
  const { game } = startGame();
  const visited = [where(game)];
  while (game.getState().turn < 3) {
    passRound(game);
    visited.push(where(game));
  }
  const turn1 = [
    [PHASE.BEGINNING, STEP.UPKEEP],
    [PHASE.PRECOMBAT_MAIN, null],
    [PHASE.COMBAT, STEP.BEGINNING_OF_COMBAT],
    [PHASE.COMBAT, STEP.DECLARE_ATTACKERS],
    [PHASE.COMBAT, STEP.END_OF_COMBAT],
    [PHASE.POSTCOMBAT_MAIN, null],
    [PHASE.ENDING, STEP.END],
  ].map(([phase, step]) => ({ turn: 1, phase, step }));
  const turn2 = [
    [PHASE.BEGINNING, STEP.UPKEEP],
    [PHASE.BEGINNING, STEP.DRAW],
    [PHASE.PRECOMBAT_MAIN, null],
    [PHASE.COMBAT, STEP.BEGINNING_OF_COMBAT],
    [PHASE.COMBAT, STEP.DECLARE_ATTACKERS],
    [PHASE.COMBAT, STEP.END_OF_COMBAT],
    [PHASE.POSTCOMBAT_MAIN, null],
    [PHASE.ENDING, STEP.END],
  ].map(([phase, step]) => ({ turn: 2, phase, step }));
  assert.deepEqual(visited, [...turn1, ...turn2, { turn: 3, phase: PHASE.BEGINNING, step: STEP.UPKEEP }]);
});

test('the active player alternates and receives priority first each step', () => {
  const { game } = startGame({ startingPlayerId: 'p2' });
  assert.equal(game.getState().activePlayerId, 'p2');
  while (game.getState().turn === 1) passRound(game);
  const state = game.getState();
  assert.equal(state.turn, 2);
  assert.equal(state.activePlayerId, 'p1');
  assert.equal(state.priorityPlayerId, 'p1');
});

test('emits turn, phase and step transitions in order', () => {
  const { game, events } = startGame();
  while (game.getState().phase !== PHASE.POSTCOMBAT_MAIN) passRound(game);
  const transitions = events
    .filter((e) => /^(turn|phase|step)/.test(e.name))
    .map((e) => `${e.name}:${e.payload.step ?? e.payload.phase ?? e.payload.turn}`);
  assert.deepEqual(transitions, [
    'turnStarted:1',
    'phaseStarted:beginning', 'stepStarted:untap', 'stepEnded:untap',
    'stepStarted:upkeep', 'stepEnded:upkeep', 'phaseEnded:beginning', 'stepSkipped:draw',
    'phaseStarted:precombatMain', 'phaseEnded:precombatMain',
    'phaseStarted:combat', 'stepStarted:beginningOfCombat', 'stepEnded:beginningOfCombat',
    'stepStarted:declareAttackers', 'stepEnded:declareAttackers',
    'stepSkipped:declareBlockers', 'stepSkipped:combatDamage',
    'stepStarted:endOfCombat', 'stepEnded:endOfCombat', 'phaseEnded:combat',
    'phaseStarted:postcombatMain',
  ]);
});

test('rejects actions from players without priority and unknown actions', () => {
  const { game, events } = startGame();
  const before = game.getState();

  const outOfTurn = game.dispatch(passPriority('p2'));
  assert.equal(outOfTurn.ok, false);
  assert.match(outOfTurn.reason, /not a valid action/);
  assert.equal(game.dispatch({ type: 'CAST_SPELL', playerId: 'p1' }).ok, false);
  assert.equal(game.dispatch(passPriority('ghost')).ok, false);
  assert.equal(game.dispatch(null).ok, false);

  assert.deepEqual(game.getState(), before);
  assert.equal(events.filter((e) => e.name === 'actionRejected').length, 4);
});

test('rejects actions before the game starts', () => {
  const game = new Game({ players });
  assert.equal(game.dispatch(passPriority('p1')).ok, false);
  assert.deepEqual(game.getState().validActions, []);
});

test('state snapshots are copies that cannot mutate the game', () => {
  const { game } = startGame();
  const state = game.getState();
  state.players.push({ id: 'p3' });
  state.playersPassed.push('p1');
  assert.equal(game.getState().players.length, 2);
  assert.deepEqual(game.getState().playersPassed, []);
});

test('the game listens to action events from other emitters', () => {
  const { game } = startGame();
  const ai = new AutoPassController({ game, playerId: 'p2', delayMs: null });
  game.dispatch(passPriority('p1'));
  // p2 auto-passed in response to the state event, so upkeep ended.
  assert.equal(game.getState().phase, PHASE.PRECOMBAT_MAIN);
  assert.equal(game.getState().priorityPlayerId, 'p1');
  ai.detach();
  game.dispatch(passPriority('p1'));
  assert.equal(game.getState().priorityPlayerId, 'p2');
});

test('actions dispatched from inside listeners are queued, not re-entrant', () => {
  const { game } = startGame();
  const order = [];
  game.on('state', (state) => {
    order.push(`state:${state.version}`);
    if (state.priorityPlayerId === 'p2') {
      assert.deepEqual(game.dispatch(passPriority('p2')), { ok: true, queued: true });
      order.push('dispatched');
    }
  });
  game.dispatch(passPriority('p1'));
  assert.deepEqual(order, ['state:2', 'dispatched', 'state:3']);
});

test('the auto-pass controller can act asynchronously', async () => {
  const { game } = startGame();
  new AutoPassController({ game, playerId: 'p2', delayMs: 0 });
  game.dispatch(passPriority('p1'));
  assert.equal(game.getState().priorityPlayerId, 'p2');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(game.getState().phase, PHASE.PRECOMBAT_MAIN);
});

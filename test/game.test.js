import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, GAME_STATUS, ACTION, PHASE, STEP, passPriority, playLand, discard, BasicAIController,
} from '../src/index.js';

const players = [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }];

function startGame(options = {}) {
  const game = new Game({ players, seed: 1, ...options });
  const events = [];
  game.onAny((name, payload) => events.push({ name, payload }));
  game.start();
  return { game, events };
}

const player = (game, id) => game.getState().players.find((p) => p.id === id);

/** Every player passes once, starting with whoever has priority. */
function passRound(game) {
  for (let i = 0; i < players.length; i++) {
    const { priorityPlayerId } = game.getState();
    assert.deepEqual(game.dispatch(passPriority(priorityPlayerId)), { ok: true });
  }
}

/** Pass priority, or discard the first card when a discard decision is pending. */
function proceed(game) {
  const { pendingDecision, validActions } = game.getState();
  if (pendingDecision) {
    assert.deepEqual(game.dispatch(validActions[0]), { ok: true });
  } else {
    passRound(game);
  }
}

function advanceTo(game, { turn, phase }) {
  while (game.getState().turn < turn || game.getState().phase !== phase) proceed(game);
}

const where = (game) => {
  const { turn, phase, step } = game.getState();
  return { turn, phase, step };
};

// -----------------------------------------------------------------------------
// Setup

test('requires at least two players with unique ids and known cards', () => {
  assert.throws(() => new Game({ players: [{ id: 'p1' }] }));
  assert.throws(() => new Game({ players: [{ id: 'p1' }, { id: 'p1' }] }));
  assert.throws(() => new Game({ players, startingPlayerId: 'nobody' }));
  assert.throws(() => new Game({ players, decks: { p1: ['black-lotus'] } }));
});

test('each player starts with 10 Forests, shuffles and draws 7', () => {
  const { game, events } = startGame();
  for (const id of ['p1', 'p2']) {
    const p = player(game, id);
    assert.equal(p.hand.length, 7);
    assert.equal(p.library.length, 3);
    assert.ok([...p.hand, ...p.library].every((c) => c.cardId === 'forest' && c.name === 'Forest'));
    assert.equal(new Set([...p.hand, ...p.library].map((c) => c.id)).size, 10);
    assert.deepEqual(p.graveyard, []);
  }
  assert.deepEqual(game.getState().battlefield, []);

  assert.deepEqual(events.map((e) => e.name).slice(0, 5), [
    'gameStarted', 'libraryShuffled', 'cardsDrawn', 'libraryShuffled', 'cardsDrawn',
  ]);
  assert.equal(events[2].payload.cardIds.length, 7);
});

test('starting the game lands in upkeep with the active player holding priority', () => {
  const { game, events } = startGame();
  const state = game.getState();
  assert.equal(state.turn, 1);
  assert.equal(state.activePlayerId, 'p1');
  assert.equal(state.priorityPlayerId, 'p1');
  assert.equal(state.phase, PHASE.BEGINNING);
  assert.equal(state.step, STEP.UPKEEP);
  // No land plays outside a main phase.
  assert.deepEqual(state.validActions, [{ type: ACTION.PASS_PRIORITY, playerId: 'p1' }]);

  assert.deepEqual(events.map((e) => e.name).slice(5), [
    'turnStarted', 'phaseStarted', 'stepStarted', 'stepEnded',
    'stepStarted', 'priorityGranted', 'state',
  ]);
});

// -----------------------------------------------------------------------------
// Priority and turn structure

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
  assert.equal(state.phase, PHASE.PRECOMBAT_MAIN);
  assert.equal(state.step, null);
  assert.equal(state.priorityPlayerId, 'p1');
  assert.deepEqual(state.playersPassed, []);
});

test('walks the full turn structure, skipping blockers and damage without attackers', () => {
  const { game } = startGame();
  const visited = [where(game)];
  while (game.getState().turn < 3) {
    proceed(game);
    visited.push(where(game));
  }
  const steps = (turn, segments) => segments.map(([phase, step]) => ({ turn, phase, step }));
  const rest = [
    [PHASE.PRECOMBAT_MAIN, null],
    [PHASE.COMBAT, STEP.BEGINNING_OF_COMBAT],
    [PHASE.COMBAT, STEP.DECLARE_ATTACKERS],
    [PHASE.COMBAT, STEP.END_OF_COMBAT],
    [PHASE.POSTCOMBAT_MAIN, null],
    [PHASE.ENDING, STEP.END],
  ];
  assert.deepEqual(visited, [
    // Turn 1: the starting player skips their draw step.
    ...steps(1, [[PHASE.BEGINNING, STEP.UPKEEP], ...rest]),
    // Turn 2: p2 ends with 8 cards, so the game stops in cleanup for a discard.
    ...steps(2, [[PHASE.BEGINNING, STEP.UPKEEP], [PHASE.BEGINNING, STEP.DRAW], ...rest,
      [PHASE.ENDING, STEP.CLEANUP]]),
    { turn: 3, phase: PHASE.BEGINNING, step: STEP.UPKEEP },
  ]);
});

test('the active player alternates and receives priority first each step', () => {
  const { game } = startGame({ startingPlayerId: 'p2' });
  assert.equal(game.getState().activePlayerId, 'p2');
  while (game.getState().turn === 1) proceed(game);
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

// -----------------------------------------------------------------------------
// Drawing

test('the active player draws a card in their draw step', () => {
  const { game, events } = startGame();
  advanceTo(game, { turn: 2, phase: PHASE.BEGINNING });
  assert.equal(game.getState().step, STEP.UPKEEP);
  passRound(game);

  assert.equal(game.getState().step, STEP.DRAW);
  assert.equal(player(game, 'p2').hand.length, 8);
  assert.equal(player(game, 'p2').library.length, 2);
  assert.equal(player(game, 'p1').hand.length, 7);
  const draw = events.findLast((e) => e.name === 'cardsDrawn');
  assert.equal(draw.payload.playerId, 'p2');
  assert.equal(draw.payload.cardIds.length, 1);
  // The card is drawn before anyone gets priority in the draw step.
  assert.ok(events.indexOf(draw) < events.findLastIndex((e) => e.name === 'priorityGranted'));
});

test('drawing from an empty library loses the game', () => {
  const { game, events } = startGame({ decks: { p1: Array(7).fill('forest') } });
  assert.equal(player(game, 'p1').library.length, 0);
  advanceTo(game, { turn: 3, phase: PHASE.BEGINNING });
  passRound(game); // leave upkeep; p1 attempts to draw

  const state = game.getState();
  assert.equal(state.status, GAME_STATUS.GAME_OVER);
  assert.equal(state.winnerId, 'p2');
  assert.equal(player(game, 'p1').hasLost, true);
  assert.equal(state.priorityPlayerId, null);
  assert.deepEqual(state.validActions, []);
  assert.equal(game.dispatch(passPriority('p1')).ok, false);
  assert.deepEqual(
    events.filter((e) => ['drawFromEmptyLibrary', 'playerLost', 'gameEnded'].includes(e.name))
      .map((e) => e.name),
    ['drawFromEmptyLibrary', 'playerLost', 'gameEnded'],
  );
});

// -----------------------------------------------------------------------------
// Playing lands

test('the active player can play a land from hand in their main phase', () => {
  const { game, events } = startGame();
  passRound(game);
  const state = game.getState();
  assert.equal(state.phase, PHASE.PRECOMBAT_MAIN);
  const plays = state.validActions.filter((a) => a.type === ACTION.PLAY_LAND);
  assert.deepEqual(plays.map((a) => a.cardId), player(game, 'p1').hand.map((c) => c.id));
  assert.ok(plays.every((a) => a.playerId === 'p1'));

  const cardId = plays[0].cardId;
  assert.deepEqual(game.dispatch(playLand('p1', cardId)), { ok: true });
  const after = game.getState();
  assert.equal(player(game, 'p1').hand.length, 6);
  assert.deepEqual(after.battlefield.map((p) => [p.id, p.controllerId, p.tapped]), [[cardId, 'p1', false]]);
  assert.equal(player(game, 'p1').landsPlayedThisTurn, 1);
  // Playing a land doesn't use the stack, and p1 keeps priority.
  assert.deepEqual(after.stack, []);
  assert.equal(after.priorityPlayerId, 'p1');
  assert.equal(after.phase, PHASE.PRECOMBAT_MAIN);
  assert.ok(events.some((e) => e.name === 'landPlayed' && e.payload.card.id === cardId));
});

test('only one land may be played per turn', () => {
  const { game } = startGame();
  passRound(game);
  const [first, second] = player(game, 'p1').hand;
  game.dispatch(playLand('p1', first.id));
  assert.deepEqual(game.getState().validActions, [{ type: ACTION.PASS_PRIORITY, playerId: 'p1' }]);
  const rejected = game.dispatch(playLand('p1', second.id));
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /not a valid action/);

  advanceTo(game, { turn: 1, phase: PHASE.POSTCOMBAT_MAIN });
  assert.equal(game.dispatch(playLand('p1', second.id)).ok, false);

  // The land play comes back on p1's next turn.
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  assert.equal(player(game, 'p1').landsPlayedThisTurn, 0);
  assert.deepEqual(game.dispatch(playLand('p1', second.id)), { ok: true });
  assert.equal(game.getState().battlefield.length, 2);
});

test('lands can be played in the postcombat main phase', () => {
  const { game } = startGame();
  advanceTo(game, { turn: 1, phase: PHASE.POSTCOMBAT_MAIN });
  const cardId = player(game, 'p1').hand[0].id;
  assert.deepEqual(game.dispatch(playLand('p1', cardId)), { ok: true });
});

test('lands cannot be played outside your own main phase or without priority', () => {
  const { game } = startGame();
  const p1Card = player(game, 'p1').hand[0].id;
  const p2Card = player(game, 'p2').hand[0].id;
  assert.equal(game.dispatch(playLand('p1', p1Card)).ok, false); // upkeep

  passRound(game); // precombat main, p1 has priority
  assert.equal(game.dispatch(playLand('p2', p2Card)).ok, false); // not p2's turn

  game.dispatch(passPriority('p1'));
  assert.equal(game.getState().priorityPlayerId, 'p2');
  assert.equal(game.dispatch(playLand('p1', p1Card)).ok, false); // p1 doesn't have priority
  assert.equal(game.dispatch(playLand('p2', p2Card)).ok, false);
  assert.deepEqual(game.getState().validActions, [{ type: ACTION.PASS_PRIORITY, playerId: 'p2' }]);
});

test('a land play must name a land in the player\'s own hand', () => {
  const { game } = startGame();
  passRound(game);
  assert.equal(game.dispatch(playLand('p1', player(game, 'p2').hand[0].id)).ok, false);
  assert.equal(game.dispatch(playLand('p1', player(game, 'p1').library[0].id)).ok, false);
  assert.equal(game.dispatch(playLand('p1', 'nope')).ok, false);
  assert.equal(game.dispatch({ type: ACTION.PLAY_LAND, playerId: 'p1' }).ok, false);
  assert.equal(game.getState().battlefield.length, 0);
});

test('playing a land resets the run of passes', () => {
  const { game } = startGame({ startingPlayerId: 'p1' });
  passRound(game);
  game.dispatch(passPriority('p1'));
  game.dispatch(passPriority('p2'));
  // Both passed with an empty stack: the main phase ended.
  assert.equal(game.getState().phase, PHASE.COMBAT);

  advanceTo(game, { turn: 1, phase: PHASE.POSTCOMBAT_MAIN });
  game.dispatch(playLand('p1', player(game, 'p1').hand[0].id));
  assert.deepEqual(game.getState().playersPassed, []);
  game.dispatch(passPriority('p1'));
  assert.equal(game.getState().phase, PHASE.POSTCOMBAT_MAIN);
});

// -----------------------------------------------------------------------------
// Cleanup

test('the active player discards down to 7 in the cleanup step', () => {
  const { game, events } = startGame();
  advanceTo(game, { turn: 2, phase: PHASE.ENDING });
  passRound(game); // leave the end step with 8 cards in hand

  const state = game.getState();
  assert.equal(state.step, STEP.CLEANUP);
  assert.equal(state.priorityPlayerId, null);
  assert.deepEqual(state.pendingDecision, { type: 'discardToHandSize', playerId: 'p2', count: 1 });
  assert.equal(state.validActions.length, 8);
  assert.ok(state.validActions.every((a) => a.type === ACTION.DISCARD && a.playerId === 'p2'));
  assert.equal(game.dispatch(passPriority('p2')).ok, false);
  assert.equal(game.dispatch(discard('p1', player(game, 'p1').hand[0].id)).ok, false);

  const cardId = state.validActions[3].cardId;
  assert.deepEqual(game.dispatch(discard('p2', cardId)), { ok: true });
  assert.deepEqual(player(game, 'p2').graveyard.map((c) => c.id), [cardId]);
  assert.equal(player(game, 'p2').hand.length, 7);
  assert.equal(game.getState().turn, 3);
  assert.ok(events.some((e) => e.name === 'cardDiscarded' && e.payload.cardId === cardId));
});

test('no discard is needed after playing a land', () => {
  const { game } = startGame();
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  game.dispatch(playLand('p2', player(game, 'p2').hand[0].id));
  advanceTo(game, { turn: 3, phase: PHASE.BEGINNING });
  assert.deepEqual(player(game, 'p2').graveyard, []);
});

// -----------------------------------------------------------------------------
// Validation and engine mechanics

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
  state.players[0].hand.pop();
  state.playersPassed.push('p1');
  assert.equal(game.getState().players.length, 2);
  assert.equal(player(game, 'p1').hand.length, 7);
  assert.deepEqual(game.getState().playersPassed, []);
});

test('the same seed gives the same shuffle', () => {
  const ids = (seed) => player(startGame({ seed }).game, 'p1').library.map((c) => c.id);
  assert.deepEqual(ids(42), ids(42));
  assert.notDeepEqual(ids(1), ids(2));
});

test('the game listens to action events from other emitters', () => {
  const { game } = startGame();
  const ai = new BasicAIController({ game, playerId: 'p2', delayMs: null });
  game.dispatch(passPriority('p1'));
  // p2 passed in response to the state event, so upkeep ended.
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

test('the AI plays a land each turn and can act asynchronously', async () => {
  const { game } = startGame();
  new BasicAIController({ game, playerId: 'p2', delayMs: 0 });
  // p1 keeps passing; p2 should play a land in its main phase on turn 2.
  for (let i = 0; i < 100 && game.getState().battlefield.length === 0; i++) {
    const { priorityPlayerId } = game.getState();
    if (priorityPlayerId === 'p1') game.dispatch(passPriority('p1'));
    else await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(game.getState().turn, 2);
  assert.deepEqual(game.getState().battlefield.map((p) => p.controllerId), ['p2']);
});

test('two AIs play a whole game until a player runs out of cards', () => {
  const game = new Game({ players, seed: 7 });
  const ais = players.map(({ id }) => new BasicAIController({ game, playerId: id, delayMs: null }));
  game.start();
  ais.forEach((ai) => ai.detach());

  const state = game.getState();
  assert.equal(state.status, GAME_STATUS.GAME_OVER);
  // p2 draws on turns 2, 4 and 6, then can't draw on turn 8.
  assert.equal(state.turn, 8);
  assert.equal(state.step, STEP.DRAW);
  assert.equal(state.winnerId, 'p1');
  const lands = (id) => state.battlefield.filter((p) => p.controllerId === id).length;
  assert.equal(lands('p1'), 4); // turns 1, 3, 5, 7
  assert.equal(lands('p2'), 3); // turns 2, 4, 6
});

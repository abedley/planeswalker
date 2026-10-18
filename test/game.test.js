import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, GAME_STATUS, DECISION, ACTION, PHASE, STEP, EFFECT, CARD_TYPE, AI_STRATEGY,
  passPriority, playLand, castSpell, activateAbility, toggleAttacker, confirmAttackers,
  setBlocker, confirmBlockers, assignCombatDamage, discard, BasicAIController, SAMPLE_DECK, SAMPLE_CARDS,
} from '../src/index.js';

const players = [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }];
const FORESTS = Array(10).fill('forest');

const NO_EMBLEMS = { p1: [], p2: [] };

/**
 * Starts a game. Unless told otherwise, both players get 10 Forests and no emblems
 * (emblem abilities have their own tests below).
 */
function startGame({ decks, ...options } = {}) {
  const game = new Game({
    players, seed: 1, decks: { p1: FORESTS, p2: FORESTS, ...decks }, emblems: NO_EMBLEMS, ...options,
  });
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

/** Pass priority; for decisions, confirm (no attackers/blockers) or take the first choice. */
function proceed(game) {
  const { pendingDecision, validActions } = game.getState();
  if (pendingDecision) {
    const confirm = validActions.find((a) => a.type.startsWith('CONFIRM_'));
    assert.deepEqual(game.dispatch(confirm ?? validActions[0]), { ok: true });
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

test('by default each player has 20 Forests and 20 Llanowar Elves, shuffles and draws 7', () => {
  const game = new Game({ players, seed: 1 });
  game.start();
  for (const id of ['p1', 'p2']) {
    const p = player(game, id);
    const cards = [...p.hand, ...p.library];
    assert.equal(p.hand.length, 7);
    assert.equal(p.library.length, 33);
    assert.equal(p.life, 20);
    assert.equal(cards.filter((c) => c.name === 'Forest').length, 20);
    assert.equal(cards.filter((c) => c.name === 'Llanowar Elves').length, 20);
    assert.equal(new Set(cards.map((c) => c.id)).size, 40);
    assert.deepEqual(p.graveyard, []);
  }
});

test('shuffles and draws are reported as events', () => {
  const { game, events } = startGame();
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
    'stepSkipped:declareBlockers', 'stepSkipped:firstStrikeDamage', 'stepSkipped:combatDamage',
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
  assert.deepEqual(game.getState().validActions.filter((a) => a.type === ACTION.PLAY_LAND), []);
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

test('two land-only AIs play a whole game until a player runs out of cards', () => {
  const game = new Game({ players, seed: 7, decks: { p1: FORESTS, p2: FORESTS } });
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

// -----------------------------------------------------------------------------
// Activated abilities, the stack and mana

const tapForest = (game, playerId) => {
  const forest = game.getState().battlefield
    .find((p) => p.controllerId === playerId && p.cardId === 'forest' && !p.tapped);
  return game.dispatch(activateAbility(playerId, forest.id, 'tapForG'));
};

/** Starts a game and plays a Forest for p1 in their first main phase. */
function startWithForest(options) {
  const setup = startGame(options);
  passRound(setup.game);
  setup.game.dispatch(playLand('p1', player(setup.game, 'p1').hand[0].id));
  return setup;
}

test('a Forest on the battlefield offers its mana ability', () => {
  const { game } = startWithForest();
  const forest = game.getState().battlefield[0];
  assert.deepEqual(forest.abilities, [{ id: 'tapForG', text: '{T}: Add {G}.', isManaAbility: true }]);
  assert.deepEqual(
    game.getState().validActions.filter((a) => a.type === ACTION.ACTIVATE_ABILITY),
    [{ type: ACTION.ACTIVATE_ABILITY, playerId: 'p1', cardId: forest.id, abilityId: 'tapForG' }],
  );
  // Cards in hand have no activatable abilities.
  assert.equal(game.dispatch(activateAbility('p1', player(game, 'p1').hand[0].id, 'tapForG')).ok, false);
});

test('tapping a Forest adds {G} immediately without using the stack', () => {
  const { game, events } = startWithForest();
  game.dispatch(passPriority('p1'));
  game.dispatch(passPriority('p2'));
  assert.equal(game.getState().step, STEP.BEGINNING_OF_COMBAT);

  assert.deepEqual(tapForest(game, 'p1'), { ok: true });
  const state = game.getState();
  assert.equal(state.battlefield[0].tapped, true);
  assert.deepEqual(player(game, 'p1').manaPool, { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 });
  assert.deepEqual(state.stack, []);
  // The player keeps priority, and the step continues.
  assert.equal(state.priorityPlayerId, 'p1');
  assert.equal(state.step, STEP.BEGINNING_OF_COMBAT);
  const activated = events.findLast((e) => e.name === 'abilityActivated').payload;
  assert.equal(activated.usesStack, false);
  assert.deepEqual(activated.costPaid, { tap: true });
  assert.ok(events.some((e) => e.name === 'manaAdded'));
});

test('a tapped Forest cannot be activated again until it untaps', () => {
  const { game } = startWithForest();
  const forestId = game.getState().battlefield[0].id;
  tapForest(game, 'p1');
  assert.equal(game.dispatch(activateAbility('p1', forestId, 'tapForG')).ok, false);
  assert.ok(!game.getState().validActions.some((a) => a.type === ACTION.ACTIVATE_ABILITY));

  // p2's untap step doesn't untap p1's Forest; p1's does.
  advanceTo(game, { turn: 2, phase: PHASE.BEGINNING });
  assert.equal(game.getState().battlefield[0].tapped, true);
  advanceTo(game, { turn: 3, phase: PHASE.BEGINNING });
  assert.equal(game.getState().battlefield[0].tapped, false);
  assert.deepEqual(tapForest(game, 'p1'), { ok: true });
});

test('only the controller can activate a permanent\'s abilities, and only with priority', () => {
  const { game } = startWithForest();
  const forestId = game.getState().battlefield[0].id;
  assert.equal(game.dispatch(activateAbility('p2', forestId, 'tapForG')).ok, false);
  game.dispatch(passPriority('p1'));
  assert.equal(game.dispatch(activateAbility('p1', forestId, 'tapForG')).ok, false);
  assert.equal(game.dispatch(activateAbility('p1', forestId, 'madeUp')).ok, false);
});

test('mana pools empty as each step and phase ends', () => {
  const { game, events } = startWithForest();
  tapForest(game, 'p1');
  assert.equal(player(game, 'p1').manaPool.G, 1);
  // Mana stays while the phase continues, including after passing.
  game.dispatch(passPriority('p1'));
  assert.equal(player(game, 'p1').manaPool.G, 1);
  game.dispatch(passPriority('p2'));

  assert.equal(game.getState().phase, PHASE.COMBAT);
  assert.equal(player(game, 'p1').manaPool.G, 0);
  const emptied = events.findLast((e) => e.name === 'manaPoolsEmptied').payload;
  assert.deepEqual(emptied.pools, [{ playerId: 'p1', lost: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 } }]);
  // The pool emptied before the precombat main phase ended.
  const index = (name) => events.findLastIndex((e) => e.name === name);
  assert.ok(index('manaPoolsEmptied') < index('phaseEnded'));
});

test('activating a mana ability resets the run of passes', () => {
  const { game } = startWithForest();
  game.dispatch(passPriority('p1'));
  game.dispatch(passPriority('p2'));
  // Beginning of combat: p1 has priority again.
  game.dispatch(passPriority('p1'));
  assert.deepEqual(game.getState().playersPassed, ['p1']);
  game.dispatch(passPriority('p2'));
  assert.equal(game.getState().step, STEP.DECLARE_ATTACKERS);
  tapForest(game, 'p1');
  assert.deepEqual(game.getState().playersPassed, []);
});

// A test-only card whose ability uses the stack: "{T}, {G}: Draw a card."
const LIBRARY_GROVE = {
  id: 'libraryGrove',
  name: 'Library Grove',
  types: [CARD_TYPE.LAND],
  abilities: [{
    id: 'draw',
    text: '{T}, {G}: Draw a card.',
    cost: { tap: true, mana: { G: 1 } },
    effect: { type: EFFECT.DRAW_CARDS, count: 1 },
  }],
};

function startWithGrove() {
  const deck = [...Array(8).fill('forest'), 'libraryGrove', 'libraryGrove'];
  const setup = startGame({
    cards: { libraryGrove: LIBRARY_GROVE },
    decks: { p1: deck },
    seed: 3,
  });
  const { game } = setup;
  // Put a Forest and a Grove onto p1's battlefield over turns 1 and 3.
  const find = (cardId) => player(game, 'p1').hand.find((c) => c.cardId === cardId);
  passRound(game);
  game.dispatch(playLand('p1', find('libraryGrove').id));
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  game.dispatch(playLand('p1', find('forest').id));
  return setup;
}

test('a non-mana ability needs its mana cost paid', () => {
  const { game } = startWithGrove();
  const grove = game.getState().battlefield.find((p) => p.cardId === 'libraryGrove');
  const activations = () => game.getState().validActions.filter((a) => a.type === ACTION.ACTIVATE_ABILITY);
  // No {G} in the pool yet: only the Forest's ability is available.
  assert.deepEqual(activations().map((a) => a.abilityId), ['tapForG']);
  assert.equal(game.dispatch(activateAbility('p1', grove.id, 'draw')).ok, false);

  tapForest(game, 'p1');
  assert.deepEqual(activations().map((a) => a.cardId), [grove.id]);
});

test('a non-mana ability goes on the stack and resolves when all players pass', () => {
  const { game, events } = startWithGrove();
  const grove = game.getState().battlefield.find((p) => p.cardId === 'libraryGrove');
  const handBefore = player(game, 'p1').hand.length;
  tapForest(game, 'p1');
  assert.deepEqual(game.dispatch(activateAbility('p1', grove.id, 'draw')), { ok: true });

  let state = game.getState();
  assert.equal(player(game, 'p1').manaPool.G, 0); // {G} paid
  assert.equal(state.battlefield.find((p) => p.id === grove.id).tapped, true);
  assert.equal(state.stack.length, 1);
  assert.deepEqual(
    { ...state.stack[0], id: undefined },
    {
      id: undefined, kind: 'activatedAbility', controllerId: 'p1', sourceId: grove.id,
      sourceName: 'Library Grove', abilityId: 'draw', text: '{T}, {G}: Draw a card.',
      effect: { type: EFFECT.DRAW_CARDS, count: 1 },
    },
  );
  assert.equal(state.priorityPlayerId, 'p1'); // 117.3c
  assert.equal(player(game, 'p1').hand.length, handBefore); // not resolved yet
  // Lands can't be played while the stack isn't empty.
  assert.ok(!state.validActions.some((a) => a.type === ACTION.PLAY_LAND));

  game.dispatch(passPriority('p1'));
  game.dispatch(passPriority('p2'));
  state = game.getState();
  assert.deepEqual(state.stack, []);
  assert.equal(player(game, 'p1').hand.length, handBefore + 1);
  // Still the same main phase; the active player gets priority after resolution.
  assert.equal(state.phase, PHASE.PRECOMBAT_MAIN);
  assert.equal(state.priorityPlayerId, 'p1');
  assert.deepEqual(state.playersPassed, []);
  assert.deepEqual(
    events.filter((e) => ['abilityActivated', 'stackObjectResolving', 'cardsDrawn', 'stackObjectResolved']
      .includes(e.name)).slice(-4).map((e) => e.name),
    ['abilityActivated', 'stackObjectResolving', 'cardsDrawn', 'stackObjectResolved'],
  );

  // With the stack empty, passing again ends the phase as usual.
  passRound(game);
  assert.equal(game.getState().phase, PHASE.COMBAT);
});

test('the opponent can respond while an ability is on the stack', () => {
  const { game } = startWithGrove();
  const grove = game.getState().battlefield.find((p) => p.cardId === 'libraryGrove');
  tapForest(game, 'p1');
  game.dispatch(activateAbility('p1', grove.id, 'draw'));
  game.dispatch(passPriority('p1'));
  const state = game.getState();
  assert.equal(state.priorityPlayerId, 'p2');
  assert.equal(state.stack.length, 1);
  assert.deepEqual(state.playersPassed, ['p1']);
});

// -----------------------------------------------------------------------------
// Creatures

const ELF_DECK = [...Array(5).fill('forest'), ...Array(5).fill('llanowarElves')];
const card = (game, playerId, name) => player(game, playerId).hand.find((c) => c.name === name);
const permanent = (game, id) => game.getState().battlefield.find((p) => p.id === id);

/**
 * In the player's main phase: make {G} (playing a Forest if none is untapped),
 * cast a creature, and let it resolve. Returns the creature's id.
 */
function castCreature(game, playerId, name = 'Llanowar Elves') {
  const untappedForest = () => game.getState().battlefield
    .find((p) => p.controllerId === playerId && p.cardId === 'forest' && !p.tapped);
  if (!untappedForest()) assert.deepEqual(game.dispatch(playLand(playerId, card(game, playerId, 'Forest').id)), { ok: true });
  game.dispatch(activateAbility(playerId, untappedForest().id, 'tapForG'));
  const { id } = card(game, playerId, name);
  assert.deepEqual(game.dispatch(castSpell(playerId, id)), { ok: true });
  passRound(game); // both pass: the spell resolves
  assert.ok(permanent(game, id), `${name} should be on the battlefield`);
  return id;
}

/** p1 casts a creature on turn 1, p2 on turn 2; returns at p1's turn 3 precombat main. */
function creaturesOnBothSides({ p1 = 'Llanowar Elves', p2 = 'Llanowar Elves', decks, cards } = {}) {
  const setup = startGame({ decks: { p1: ELF_DECK, p2: ELF_DECK, ...decks }, cards });
  const { game } = setup;
  passRound(game);
  const attacker = castCreature(game, 'p1', p1);
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  const defender = p2 ? castCreature(game, 'p2', p2) : null;
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  return { ...setup, attacker, defender };
}

/** From a main phase, pass into the declare attackers step. */
function toDeclareAttackers(game) {
  passRound(game); // -> beginning of combat
  passRound(game); // -> declare attackers
  assert.equal(game.getState().step, STEP.DECLARE_ATTACKERS);
}

test('Llanowar Elves is a 1/1 for {G} with "{T}: Add {G}."', () => {
  const { game } = startGame({ decks: { p1: ELF_DECK } });
  const elves = card(game, 'p1', 'Llanowar Elves');
  assert.deepEqual(
    { manaCost: elves.manaCost, types: elves.types, subtypes: elves.subtypes, power: elves.power, toughness: elves.toughness },
    { manaCost: { G: 1 }, types: ['Creature'], subtypes: ['Elf', 'Druid'], power: 1, toughness: 1 },
  );
  assert.deepEqual(elves.abilities, [{ id: 'tapForG', text: '{T}: Add {G}.', isManaAbility: true }]);
});

test('casting a creature needs {G} in the pool and sorcery timing', () => {
  const { game } = startGame({ decks: { p1: ELF_DECK, p2: ELF_DECK } });
  const elves = card(game, 'p1', 'Llanowar Elves');
  const casts = () => game.getState().validActions.filter((a) => a.type === ACTION.CAST_SPELL);
  assert.deepEqual(casts(), []); // upkeep
  passRound(game);
  assert.deepEqual(casts(), []); // main phase, but no mana
  assert.equal(game.dispatch(castSpell('p1', elves.id)).ok, false);

  game.dispatch(playLand('p1', card(game, 'p1', 'Forest').id));
  game.dispatch(activateAbility('p1', game.getState().battlefield[0].id, 'tapForG'));
  assert.ok(casts().length > 0);
  assert.ok(casts().every((a) => player(game, 'p1').hand.find((c) => c.id === a.cardId).name === 'Llanowar Elves'));

  // Not while the opponent has priority, even with mana.
  game.dispatch(passPriority('p1'));
  assert.equal(game.dispatch(castSpell('p2', card(game, 'p2', 'Llanowar Elves').id)).ok, false);
});

test('a creature spell goes on the stack and enters the battlefield when it resolves', () => {
  const { game, events } = startGame({ decks: { p1: ELF_DECK } });
  passRound(game);
  game.dispatch(playLand('p1', card(game, 'p1', 'Forest').id));
  game.dispatch(activateAbility('p1', game.getState().battlefield[0].id, 'tapForG'));
  const elves = card(game, 'p1', 'Llanowar Elves');
  game.dispatch(castSpell('p1', elves.id));

  let state = game.getState();
  assert.equal(player(game, 'p1').manaPool.G, 0);
  assert.ok(!player(game, 'p1').hand.some((c) => c.id === elves.id));
  assert.deepEqual(
    state.stack.map((o) => [o.kind, o.sourceId, o.controllerId]),
    [['spell', elves.id, 'p1']],
  );
  assert.equal(state.priorityPlayerId, 'p1');
  assert.ok(!permanent(game, elves.id));
  // Can't cast another spell or play a land while the stack isn't empty.
  assert.ok(!state.validActions.some((a) => [ACTION.CAST_SPELL, ACTION.PLAY_LAND].includes(a.type)));

  passRound(game);
  state = game.getState();
  assert.deepEqual(state.stack, []);
  assert.equal(state.phase, PHASE.PRECOMBAT_MAIN);
  const creature = permanent(game, elves.id);
  assert.deepEqual(
    [creature.controllerId, creature.tapped, creature.summoningSick, creature.damage],
    ['p1', false, true, 0],
  );
  assert.ok(events.some((e) => e.name === 'spellCast' && e.payload.cardId === elves.id));
  assert.ok(events.some((e) => e.name === 'permanentEntered' && e.payload.card.id === elves.id));
});

test('summoning sickness stops a new creature tapping for mana until its controller\'s next turn', () => {
  const { game, attacker } = creaturesOnBothSides();
  // Turn 3: p1's Elves have been under p1's control since the turn began.
  assert.equal(permanent(game, attacker).summoningSick, false);
  assert.deepEqual(game.dispatch(activateAbility('p1', attacker, 'tapForG')), { ok: true });
});

test('a creature that just arrived can\'t tap for mana', () => {
  const { game } = startGame({ decks: { p1: ELF_DECK } });
  passRound(game);
  const elves = castCreature(game, 'p1');
  assert.equal(game.dispatch(activateAbility('p1', elves, 'tapForG')).ok, false);
  // Still sick during the opponent's turn.
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  assert.equal(permanent(game, elves).summoningSick, true);
});

// -----------------------------------------------------------------------------
// Combat

test('creatures with summoning sickness can\'t attack, so there is no declaration', () => {
  const { game, events } = startGame({ decks: { p1: ELF_DECK } });
  passRound(game);
  castCreature(game, 'p1');
  toDeclareAttackers(game);
  const state = game.getState();
  assert.equal(state.pendingDecision, null);
  assert.equal(state.priorityPlayerId, 'p1');
  assert.deepEqual(events.findLast((e) => e.name === 'attackersDeclared').payload.attackers, []);
});

test('declaring attackers: toggle creatures, then confirm', () => {
  const { game, attacker } = creaturesOnBothSides();
  toDeclareAttackers(game);
  let state = game.getState();
  assert.deepEqual(state.pendingDecision, { type: DECISION.DECLARE_ATTACKERS, playerId: 'p1', attackers: [] });
  assert.equal(state.priorityPlayerId, null);
  assert.deepEqual(state.validActions, [
    { type: ACTION.TOGGLE_ATTACKER, playerId: 'p1', cardId: attacker },
    { type: ACTION.CONFIRM_ATTACKERS, playerId: 'p1' },
  ]);

  game.dispatch(toggleAttacker('p1', attacker));
  assert.deepEqual(game.getState().pendingDecision.attackers, [attacker]);
  game.dispatch(toggleAttacker('p1', attacker));
  assert.deepEqual(game.getState().pendingDecision.attackers, []);
  game.dispatch(toggleAttacker('p1', attacker));
  assert.equal(game.dispatch(confirmAttackers('p2')).ok, false);
  assert.deepEqual(game.dispatch(confirmAttackers('p1')), { ok: true });

  state = game.getState();
  assert.equal(permanent(game, attacker).tapped, true);
  assert.deepEqual(state.combat.attackers, [
    { cardId: attacker, defendingPlayerId: 'p2', blocked: false, blockerIds: [], damageAssignment: null },
  ]);
  assert.equal(state.step, STEP.DECLARE_ATTACKERS);
  assert.equal(state.priorityPlayerId, 'p1');
});

test('declaring no attackers skips the blockers and damage steps', () => {
  const { game } = creaturesOnBothSides();
  toDeclareAttackers(game);
  game.dispatch(confirmAttackers('p1'));
  passRound(game);
  assert.equal(game.getState().step, STEP.END_OF_COMBAT);
});

test('an unblocked attacker deals damage to the defending player', () => {
  const { game, attacker, events } = creaturesOnBothSides({ p2: null });
  toDeclareAttackers(game);
  game.dispatch(toggleAttacker('p1', attacker));
  game.dispatch(confirmAttackers('p1'));
  passRound(game); // -> declare blockers: p2 has no creatures, so no declaration
  assert.equal(game.getState().step, STEP.DECLARE_BLOCKERS);
  assert.equal(game.getState().pendingDecision, null);
  passRound(game); // -> combat damage

  assert.equal(game.getState().step, STEP.COMBAT_DAMAGE);
  assert.equal(player(game, 'p2').life, 19);
  assert.deepEqual(events.findLast((e) => e.name === 'combatDamageDealt').payload.damage,
    [{ sourceId: attacker, targetPlayerId: 'p2', amount: 1 }]);

  // Creatures leave combat when the end of combat step ends; the attacker stays tapped.
  advanceTo(game, { turn: 3, phase: PHASE.POSTCOMBAT_MAIN });
  assert.deepEqual(game.getState().combat.attackers, []);
  assert.equal(permanent(game, attacker).tapped, true);
  // It untaps in p1's next untap step.
  advanceTo(game, { turn: 5, phase: PHASE.BEGINNING });
  assert.equal(permanent(game, attacker).tapped, false);
});

test('declaring blockers: the defending player assigns blockers, then confirms', () => {
  const { game, attacker, defender } = creaturesOnBothSides();
  toDeclareAttackers(game);
  game.dispatch(toggleAttacker('p1', attacker));
  game.dispatch(confirmAttackers('p1'));
  passRound(game);

  let state = game.getState();
  assert.equal(state.step, STEP.DECLARE_BLOCKERS);
  assert.deepEqual(state.pendingDecision, { type: DECISION.DECLARE_BLOCKERS, playerId: 'p2', blocks: {} });
  assert.deepEqual(state.validActions, [
    { type: ACTION.SET_BLOCKER, playerId: 'p2', cardId: defender, attackerId: attacker },
    { type: ACTION.CONFIRM_BLOCKERS, playerId: 'p2' },
  ]);
  game.dispatch(setBlocker('p2', defender, attacker));
  assert.deepEqual(game.getState().pendingDecision.blocks, { [defender]: attacker });
  // The block can be undone before confirming.
  assert.ok(game.getState().validActions.some((a) => a.type === ACTION.SET_BLOCKER && a.attackerId === null));
  game.dispatch(confirmBlockers('p2'));

  state = game.getState();
  assert.deepEqual(state.combat.attackers[0].blockerIds, [defender]);
  assert.equal(state.combat.attackers[0].blocked, true);
  assert.equal(state.priorityPlayerId, 'p1');
});

test('blocked creatures trade damage, and lethal damage puts them in the graveyard', () => {
  const { game, attacker, defender, events } = creaturesOnBothSides();
  toDeclareAttackers(game);
  game.dispatch(toggleAttacker('p1', attacker));
  game.dispatch(confirmAttackers('p1'));
  passRound(game);
  game.dispatch(setBlocker('p2', defender, attacker));
  game.dispatch(confirmBlockers('p2'));
  passRound(game); // -> combat damage

  const state = game.getState();
  assert.equal(state.step, STEP.COMBAT_DAMAGE);
  assert.equal(player(game, 'p2').life, 20);
  assert.ok(!permanent(game, attacker));
  assert.ok(!permanent(game, defender));
  assert.ok(player(game, 'p1').graveyard.some((c) => c.id === attacker));
  assert.ok(player(game, 'p2').graveyard.some((c) => c.id === defender));
  // Cards in the graveyard lose battlefield-only state.
  assert.equal(player(game, 'p1').graveyard.find((c) => c.id === attacker).damage, undefined);
  assert.deepEqual(state.combat.attackers, []);
  assert.deepEqual(events.filter((e) => e.name === 'creatureDied').map((e) => e.payload.cardId).sort(),
    [attacker, defender].sort());
});

test('an attacker blocked by two creatures divides its damage as its controller chooses', () => {
  const { game, attacker, defender } = creaturesOnBothSides();
  // p2 gets a second Elves on turn 4; p1 attacks on turn 5.
  advanceTo(game, { turn: 4, phase: PHASE.PRECOMBAT_MAIN });
  const second = castCreature(game, 'p2');
  advanceTo(game, { turn: 5, phase: PHASE.PRECOMBAT_MAIN });
  toDeclareAttackers(game);
  game.dispatch(toggleAttacker('p1', attacker));
  game.dispatch(confirmAttackers('p1'));
  passRound(game);
  game.dispatch(setBlocker('p2', defender, attacker));
  game.dispatch(setBlocker('p2', second, attacker));
  game.dispatch(confirmBlockers('p2'));
  passRound(game); // -> combat damage: p1 must divide 1 damage

  const state = game.getState();
  assert.deepEqual(state.pendingDecision, {
    type: DECISION.ASSIGN_COMBAT_DAMAGE,
    playerId: 'p1',
    attackerId: attacker,
    power: 1,
    blockerIds: [defender, second],
    trample: false,
  });
  assert.deepEqual(state.validActions.map((a) => a.assignment), [
    { [defender]: 1, [second]: 0 },
    { [defender]: 0, [second]: 1 },
  ]);
  assert.equal(game.dispatch(assignCombatDamage('p1', attacker, { [defender]: 1, [second]: 1 })).ok, false);
  assert.deepEqual(game.dispatch(assignCombatDamage('p1', attacker, { [defender]: 0, [second]: 1 })), { ok: true });

  assert.ok(!permanent(game, attacker)); // took 2
  assert.ok(permanent(game, defender)); // took none
  assert.ok(!permanent(game, second)); // took 1
  assert.equal(game.getState().priorityPlayerId, 'p1');
});

const WALL = {
  id: 'testWall', name: 'Test Wall', manaCost: { G: 1 }, types: [CARD_TYPE.CREATURE], power: 0, toughness: 3,
};
const GIANT = {
  id: 'testGiant', name: 'Test Giant', manaCost: { G: 1 }, types: [CARD_TYPE.CREATURE], power: 20, toughness: 20,
};

test('damage that isn\'t lethal stays marked until the cleanup step', () => {
  const { game, attacker, defender } = creaturesOnBothSides({
    p2: 'Test Wall',
    cards: { testWall: WALL },
    decks: { p2: [...Array(5).fill('forest'), ...Array(5).fill('testWall')] },
  });
  toDeclareAttackers(game);
  game.dispatch(toggleAttacker('p1', attacker));
  game.dispatch(confirmAttackers('p1'));
  passRound(game);
  game.dispatch(setBlocker('p2', defender, attacker));
  game.dispatch(confirmBlockers('p2'));
  passRound(game);

  assert.equal(permanent(game, defender).damage, 1);
  assert.equal(permanent(game, attacker).damage, 0); // a 0-power blocker deals no damage
  advanceTo(game, { turn: 3, phase: PHASE.ENDING });
  assert.equal(permanent(game, defender).damage, 1);
  advanceTo(game, { turn: 4, phase: PHASE.BEGINNING });
  assert.equal(permanent(game, defender).damage, 0);
});

test('a player at 0 life loses', () => {
  const { game, attacker, events } = creaturesOnBothSides({
    p1: 'Test Giant',
    p2: null,
    cards: { testGiant: GIANT },
    decks: { p1: [...Array(5).fill('forest'), ...Array(5).fill('testGiant')] },
  });
  toDeclareAttackers(game);
  game.dispatch(toggleAttacker('p1', attacker));
  game.dispatch(confirmAttackers('p1'));
  passRound(game);
  passRound(game);

  const state = game.getState();
  assert.equal(player(game, 'p2').life, 0);
  assert.equal(state.status, GAME_STATUS.GAME_OVER);
  assert.equal(state.winnerId, 'p1');
  assert.equal(events.findLast((e) => e.name === 'playerLost').payload.reason, 'Life total reached 0.');
});

test('two basic AIs with the default decks play a game to the end', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const game = new Game({ players, seed });
    const ais = players.map(({ id }) => new BasicAIController({ game, playerId: id, delayMs: null }));
    const events = [];
    game.onAny((name) => events.push(name));
    game.start();
    ais.forEach((ai) => ai.detach());

    const state = game.getState();
    assert.equal(state.status, GAME_STATUS.GAME_OVER, `seed ${seed}`);
    assert.ok(state.winnerId, `seed ${seed}`);
    assert.ok(events.includes('spellCast'), `seed ${seed}: the AIs cast creatures`);
  }
});

test('a passive AI never casts, attacks or blocks', () => {
  const game = new Game({ players, seed: 1 });
  const ais = players.map(({ id }) => new BasicAIController({
    game, playerId: id, delayMs: null, strategy: AI_STRATEGY.PASSIVE,
  }));
  game.start();
  ais.forEach((ai) => ai.detach());
  const state = game.getState();
  assert.equal(state.status, GAME_STATUS.GAME_OVER);
  assert.deepEqual(state.battlefield, []);
});

// -----------------------------------------------------------------------------
// Combat keywords

/** Free test creatures, so a whole board can be cast in one main phase. */
const KEYWORD_CARDS = Object.fromEntries([
  ['Bear', 2, 2], ['Ox', 4, 4], ['Mouse', 1, 1], ['Giant', 5, 5],
  ['Haste Wolf', 2, 1, 'haste'], ['Defender Wall', 0, 4, 'defender'], ['Vigilance Bear', 2, 2, 'vigilance'],
  ['Flying Owl', 1, 1, 'flying'], ['Reach Spider', 1, 3, 'reach'], ['Menace Lynx', 2, 1, 'menace'],
  ['Deathtouch Asp', 1, 1, 'deathtouch'], ['Lifelink Bat', 2, 2, 'lifelink'],
  ['First Strike Elk', 2, 2, 'first strike'], ['First Strike Mouse', 1, 1, 'first strike'],
  ['Trample Rhino', 3, 3, 'trample'], ['Deathtouch Trampler', 3, 3, 'trample', 'deathtouch'],
  ['Double Striker', 2, 2, 'double strike'], ['Double Strike Mouse', 1, 1, 'double strike'],
  ['Double Strike Trampler', 3, 3, 'double strike', 'trample'],
].map(([name, power, toughness, ...keywords]) => [name, {
  id: name, name, manaCost: {}, types: [CARD_TYPE.CREATURE], power, toughness, keywords,
}]));
KEYWORD_CARDS['Haste Druid'] = {
  ...KEYWORD_CARDS.Bear, id: 'Haste Druid', name: 'Haste Druid', keywords: ['haste'],
  abilities: [{ id: 'tapForG', text: '{T}: Add {G}.', cost: { tap: true }, effect: { type: EFFECT.ADD_MANA, mana: { G: 1 } } }],
};

const deckOf = (names) => [...names, ...Array(10 - names.length).fill('forest')];

/** Casts every creature in the player's hand (they're free). Returns name -> id. */
function castAll(game, playerId) {
  const ids = {};
  for (const c of player(game, playerId).hand.filter((x) => x.cardId !== 'forest')) {
    assert.deepEqual(game.dispatch(castSpell(playerId, c.id)), { ok: true }, `cast ${c.name}`);
    passRound(game);
    ids[c.name] = c.id;
  }
  return ids;
}

/**
 * p1 casts `p1` creatures on turn 1 and p2 casts `p2` on turn 2. Returns at p1's
 * turn 3 precombat main (or turn 1 when `stopOnTurn1`), with name -> id maps.
 */
function battle({ p1 = [], p2 = [], stopOnTurn1 = false }) {
  const game = new Game({
    players, seed: 1, cards: KEYWORD_CARDS, shuffleLibraries: false, decks: { p1: deckOf(p1), p2: deckOf(p2) },
    emblems: NO_EMBLEMS,
  });
  const events = [];
  game.onAny((name, payload) => events.push({ name, payload }));
  game.start();
  passRound(game);
  const mine = castAll(game, 'p1');
  if (stopOnTurn1) return { game, events, mine, theirs: {} };
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  const theirs = castAll(game, 'p2');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  return { game, events, mine, theirs };
}

function attackWith(game, ids) {
  toDeclareAttackers(game);
  for (const id of ids) assert.deepEqual(game.dispatch(toggleAttacker('p1', id)), { ok: true });
  assert.deepEqual(game.dispatch(confirmAttackers('p1')), { ok: true });
  passRound(game); // -> declare blockers
}

/** Declares blocks as [blockerId, attackerId] pairs, then passes into the next damage step. */
function blockWith(game, pairs) {
  for (const [blocker, attacker] of pairs) {
    assert.deepEqual(game.dispatch(setBlocker('p2', blocker, attacker)), { ok: true });
  }
  assert.deepEqual(game.dispatch(confirmBlockers('p2')), { ok: true });
  passRound(game);
}

const blockOptions = (game, blockerId) => game.getState().validActions
  .filter((a) => a.type === ACTION.SET_BLOCKER && a.cardId === blockerId).map((a) => a.attackerId);
const canConfirmBlocks = (game) => game.getState().validActions.some((a) => a.type === ACTION.CONFIRM_BLOCKERS);
const life = (game, id) => player(game, id).life;

test('keywords are part of the card', () => {
  const { game, mine } = battle({ p1: ['Deathtouch Trampler'], stopOnTurn1: true });
  assert.deepEqual(permanent(game, mine['Deathtouch Trampler']).keywords, ['trample', 'deathtouch']);
});

test('haste: attacks and taps for mana the turn it arrives', () => {
  const { game, mine } = battle({ p1: ['Haste Druid', 'Bear'], stopOnTurn1: true });
  assert.ok(game.getState().validActions.some((a) => a.type === ACTION.ACTIVATE_ABILITY && a.cardId === mine['Haste Druid']));
  toDeclareAttackers(game);
  // The Bear arrived this turn too, but only the Haste Druid can attack.
  assert.deepEqual(
    game.getState().validActions.filter((a) => a.type === ACTION.TOGGLE_ATTACKER).map((a) => a.cardId),
    [mine['Haste Druid']],
  );
});

test('defender: can\'t attack, but can block', () => {
  const { game, mine, theirs } = battle({ p1: ['Defender Wall', 'Bear'], p2: ['Defender Wall'] });
  toDeclareAttackers(game);
  assert.deepEqual(
    game.getState().validActions.filter((a) => a.type === ACTION.TOGGLE_ATTACKER).map((a) => a.cardId),
    [mine.Bear],
  );
  game.dispatch(toggleAttacker('p1', mine.Bear));
  game.dispatch(confirmAttackers('p1'));
  passRound(game);
  assert.deepEqual(blockOptions(game, theirs['Defender Wall']), [mine.Bear]);
});

test('vigilance: attacking doesn\'t tap the creature', () => {
  const { game, mine } = battle({ p1: ['Vigilance Bear', 'Bear'] });
  attackWith(game, [mine['Vigilance Bear'], mine.Bear]);
  assert.equal(permanent(game, mine['Vigilance Bear']).tapped, false);
  assert.equal(permanent(game, mine.Bear).tapped, true);
});

test('flying: only creatures with flying or reach can block it', () => {
  const { game, mine, theirs } = battle({
    p1: ['Flying Owl', 'Bear'], p2: ['Bear', 'Flying Owl', 'Reach Spider'],
  });
  attackWith(game, [mine['Flying Owl'], mine.Bear]);
  assert.deepEqual(blockOptions(game, theirs.Bear), [mine.Bear]);
  assert.deepEqual(blockOptions(game, theirs['Flying Owl']), [mine['Flying Owl'], mine.Bear]);
  assert.deepEqual(blockOptions(game, theirs['Reach Spider']), [mine['Flying Owl'], mine.Bear]);
  assert.equal(game.dispatch(setBlocker('p2', theirs.Bear, mine['Flying Owl'])).ok, false);
});

test('flying: no blocker declaration when nothing can block the flyers', () => {
  const { game, mine } = battle({ p1: ['Flying Owl'], p2: ['Bear'] });
  attackWith(game, [mine['Flying Owl']]);
  assert.equal(game.getState().pendingDecision, null);
  passRound(game);
  assert.equal(life(game, 'p2'), 19);
});

test('menace: can\'t be blocked by just one creature', () => {
  const { game, mine, theirs } = battle({ p1: ['Menace Lynx'], p2: ['Bear', 'Mouse'] });
  attackWith(game, [mine['Menace Lynx']]);
  assert.ok(canConfirmBlocks(game)); // no blockers is fine
  game.dispatch(setBlocker('p2', theirs.Bear, mine['Menace Lynx']));
  assert.ok(!canConfirmBlocks(game));
  assert.equal(game.dispatch(confirmBlockers('p2')).ok, false);
  game.dispatch(setBlocker('p2', theirs.Mouse, mine['Menace Lynx']));
  assert.ok(canConfirmBlocks(game));
  blockWith(game, []);
  // Two blockers: p1 divides 2 damage between them.
  assert.equal(game.getState().pendingDecision.type, DECISION.ASSIGN_COMBAT_DAMAGE);
});

test('deathtouch: any damage it deals to a creature is lethal', () => {
  const { game, mine, theirs, events } = battle({ p1: ['Deathtouch Asp'], p2: ['Ox'] });
  attackWith(game, [mine['Deathtouch Asp']]);
  blockWith(game, [[theirs.Ox, mine['Deathtouch Asp']]]);
  assert.ok(!permanent(game, theirs.Ox));
  assert.ok(!permanent(game, mine['Deathtouch Asp']));
  assert.equal(events.find((e) => e.name === 'creatureDied' && e.payload.cardId === theirs.Ox).payload.reason, 'deathtouch');
});

test('deathtouch: works when blocking too', () => {
  const { game, mine, theirs } = battle({ p1: ['Giant'], p2: ['Deathtouch Asp'] });
  attackWith(game, [mine.Giant]);
  blockWith(game, [[theirs['Deathtouch Asp'], mine.Giant]]);
  assert.ok(!permanent(game, mine.Giant));
});

test('lifelink: its controller gains life equal to the damage it deals', () => {
  const { game, theirs, events } = battle({ p1: ['Lifelink Bat', 'Lifelink Bat'], p2: ['Ox'] });
  // Both Bats share a name, so look them up on the battlefield.
  const bats = game.getState().battlefield.filter((p) => p.name === 'Lifelink Bat').map((p) => p.id);
  attackWith(game, bats);
  blockWith(game, [[theirs.Ox, bats[0]]]);
  // One Bat hits p2 for 2, the other hits the Ox for 2: p1 gains 4.
  assert.equal(life(game, 'p2'), 18);
  assert.equal(life(game, 'p1'), 24);
  assert.deepEqual(events.findLast((e) => e.name === 'combatDamageDealt').payload.lifeGained, { p1: 4 });
});

test('first strike: deals damage in its own step, before regular damage', () => {
  const { game, mine, theirs, events } = battle({ p1: ['First Strike Elk'], p2: ['Bear'] });
  attackWith(game, [mine['First Strike Elk']]);
  blockWith(game, [[theirs.Bear, mine['First Strike Elk']]]);

  let state = game.getState();
  assert.equal(state.step, STEP.FIRST_STRIKE_DAMAGE);
  assert.equal(state.priorityPlayerId, 'p1'); // players get priority between the two steps
  assert.ok(!permanent(game, theirs.Bear)); // died before it could deal damage
  assert.equal(permanent(game, mine['First Strike Elk']).damage, 0);

  passRound(game);
  state = game.getState();
  assert.equal(state.step, STEP.COMBAT_DAMAGE);
  assert.equal(permanent(game, mine['First Strike Elk']).damage, 0);
  assert.deepEqual(
    events.filter((e) => e.name === 'combatDamageDealt').map((e) => [e.payload.step, e.payload.damage.length]),
    [[STEP.FIRST_STRIKE_DAMAGE, 1], [STEP.COMBAT_DAMAGE, 0]],
  );
});

test('first strike: a first-strike blocker kills an attacker before it deals damage', () => {
  const { game, mine, theirs } = battle({ p1: ['Mouse'], p2: ['First Strike Mouse'] });
  attackWith(game, [mine.Mouse]);
  blockWith(game, [[theirs['First Strike Mouse'], mine.Mouse]]);
  assert.ok(!permanent(game, mine.Mouse));
  passRound(game);
  assert.ok(permanent(game, theirs['First Strike Mouse']));
});

test('first strike: creatures without it still deal damage in the regular step', () => {
  const { game, mine, theirs } = battle({ p1: ['First Strike Mouse'], p2: ['Ox'] });
  attackWith(game, [mine['First Strike Mouse']]);
  blockWith(game, [[theirs.Ox, mine['First Strike Mouse']]]);
  assert.equal(permanent(game, theirs.Ox).damage, 1);
  assert.ok(permanent(game, mine['First Strike Mouse']));
  passRound(game);
  assert.ok(!permanent(game, mine['First Strike Mouse']));
});

test('trample: excess damage beyond lethal can go to the defending player', () => {
  const { game, mine, theirs } = battle({ p1: ['Trample Rhino'], p2: ['Mouse'] });
  attackWith(game, [mine['Trample Rhino']]);
  blockWith(game, [[theirs.Mouse, mine['Trample Rhino']]]);

  const state = game.getState();
  assert.equal(state.pendingDecision.type, DECISION.ASSIGN_COMBAT_DAMAGE);
  assert.equal(state.pendingDecision.trample, true);
  assert.deepEqual(state.validActions.map((a) => a.assignment), [
    { [theirs.Mouse]: 3, p2: 0 },
    { [theirs.Mouse]: 2, p2: 1 },
    { [theirs.Mouse]: 1, p2: 2 },
  ]);
  game.dispatch(assignCombatDamage('p1', mine['Trample Rhino'], { [theirs.Mouse]: 1, p2: 2 }));
  assert.equal(life(game, 'p2'), 18);
  assert.ok(!permanent(game, theirs.Mouse));
});

test('trample: no choice when power doesn\'t exceed lethal damage', () => {
  const { game, mine, theirs } = battle({ p1: ['Trample Rhino'], p2: ['Ox'] });
  attackWith(game, [mine['Trample Rhino']]);
  blockWith(game, [[theirs.Ox, mine['Trample Rhino']]]);
  assert.equal(game.getState().pendingDecision, null);
  assert.equal(permanent(game, theirs.Ox).damage, 3);
  assert.equal(life(game, 'p2'), 20);
});

test('trample with deathtouch: 1 damage counts as lethal', () => {
  const { game, mine, theirs } = battle({ p1: ['Deathtouch Trampler'], p2: ['Ox'] });
  attackWith(game, [mine['Deathtouch Trampler']]);
  blockWith(game, [[theirs.Ox, mine['Deathtouch Trampler']]]);
  const options = game.getState().validActions.map((a) => a.assignment);
  assert.deepEqual(options.at(-1), { [theirs.Ox]: 1, p2: 2 });
  game.dispatch(assignCombatDamage('p1', mine['Deathtouch Trampler'], options.at(-1)));
  assert.ok(!permanent(game, theirs.Ox));
  assert.equal(life(game, 'p2'), 18);
});

const damageSteps = (events) => events.filter((e) => e.name === 'combatDamageDealt')
  .map((e) => [e.payload.step, e.payload.damage.map((d) => [d.sourceId, d.targetPlayerId ?? d.targetCardId, d.amount])]);

test('double strike: deals damage in both the first-strike and regular damage steps', () => {
  const { game, mine, events } = battle({ p1: ['Double Striker'] });
  attackWith(game, [mine['Double Striker']]);
  passRound(game); // p2 has no creatures, so nothing to declare in the blockers step
  assert.equal(game.getState().step, STEP.FIRST_STRIKE_DAMAGE);
  assert.equal(life(game, 'p2'), 18);
  passRound(game);
  assert.equal(game.getState().step, STEP.COMBAT_DAMAGE);
  assert.equal(life(game, 'p2'), 16);
  assert.deepEqual(damageSteps(events), [
    [STEP.FIRST_STRIKE_DAMAGE, [[mine['Double Striker'], 'p2', 2]]],
    [STEP.COMBAT_DAMAGE, [[mine['Double Striker'], 'p2', 2]]],
  ]);
});

test('double strike: a blocker that dies in the first step deals no damage back', () => {
  const { game, mine, theirs } = battle({ p1: ['Double Striker'], p2: ['Bear'] });
  attackWith(game, [mine['Double Striker']]);
  blockWith(game, [[theirs.Bear, mine['Double Striker']]]);
  assert.ok(!permanent(game, theirs.Bear));
  passRound(game);
  // Still blocked, with no blocker left and no trample: no damage to anyone.
  assert.equal(permanent(game, mine['Double Striker']).damage, 0);
  assert.equal(life(game, 'p2'), 20);
});

test('double strike: a double-strike blocker hits in both steps', () => {
  const { game, mine, theirs } = battle({ p1: ['Bear'], p2: ['Double Strike Mouse'] });
  attackWith(game, [mine.Bear]);
  blockWith(game, [[theirs['Double Strike Mouse'], mine.Bear]]);
  assert.equal(permanent(game, mine.Bear).damage, 1);
  passRound(game);
  // Regular step: the Bear and the Mouse hit each other at the same time.
  assert.ok(!permanent(game, mine.Bear));
  assert.ok(!permanent(game, theirs['Double Strike Mouse']));
});

test('double strike with trample: with its blocker gone, all its damage goes to the player', () => {
  const { game, mine, theirs } = battle({ p1: ['Double Strike Trampler'], p2: ['Bear'] });
  const trampler = mine['Double Strike Trampler'];
  attackWith(game, [trampler]);
  blockWith(game, [[theirs.Bear, trampler]]);
  // First-strike step: 2 is lethal for the Bear, so up to 1 can trample over.
  assert.deepEqual(game.getState().validActions.map((a) => a.assignment), [
    { [theirs.Bear]: 3, p2: 0 },
    { [theirs.Bear]: 2, p2: 1 },
  ]);
  game.dispatch(assignCombatDamage('p1', trampler, { [theirs.Bear]: 2, p2: 1 }));
  assert.ok(!permanent(game, theirs.Bear));
  assert.equal(life(game, 'p2'), 19);
  passRound(game);
  // Regular step: no blockers left, so all 3 trample through (702.19e) without a choice.
  assert.equal(game.getState().pendingDecision, null);
  assert.equal(life(game, 'p2'), 16);
});

test('trample counts damage already marked on a blocker', () => {
  const { game, mine, theirs } = battle({ p1: ['Double Strike Trampler'], p2: ['Ox'] });
  const trampler = mine['Double Strike Trampler'];
  attackWith(game, [trampler]);
  blockWith(game, [[theirs.Ox, trampler]]);
  // First-strike step: 3 isn't lethal for a 4/4, so it all goes to the Ox automatically.
  assert.equal(game.getState().pendingDecision, null);
  assert.equal(permanent(game, theirs.Ox).damage, 3);
  passRound(game);
  // Regular step: the Ox needs only 1 more, so up to 2 can trample over.
  assert.deepEqual(game.getState().validActions.map((a) => a.assignment), [
    { [theirs.Ox]: 3, p2: 0 },
    { [theirs.Ox]: 2, p2: 1 },
    { [theirs.Ox]: 1, p2: 2 },
  ]);
  game.dispatch(assignCombatDamage('p1', trampler, { [theirs.Ox]: 1, p2: 2 }));
  assert.ok(!permanent(game, theirs.Ox));
  assert.equal(life(game, 'p2'), 18);
  // The Ox hit back in the regular step: 4 damage kills the 3/3 trampler.
  assert.ok(!permanent(game, trampler));
});

test('the AI makes legal blocks against flying and menace', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const game = new Game({ players, seed, cards: SAMPLE_CARDS, decks: { p1: SAMPLE_DECK, p2: SAMPLE_DECK } });
    const ais = players.map(({ id }) => new BasicAIController({ game, playerId: id, delayMs: null }));
    const rejected = [];
    game.on('actionRejected', (e) => rejected.push(e));
    game.start();
    ais.forEach((ai) => ai.detach());
    assert.equal(game.getState().status, GAME_STATUS.GAME_OVER, `seed ${seed}`);
    assert.deepEqual(rejected, [], `seed ${seed}`);
  }
});

// -----------------------------------------------------------------------------
// Emblems: planeswalker-style player abilities

const emblemOf = (game, playerId) => player(game, playerId).emblems[0];
const emblemActions = (game) => game.getState().validActions
  .filter((a) => a.type === ACTION.ACTIVATE_ABILITY && a.cardId.includes('-emblem-'));

/** Starts a game where both players have their default emblems. */
const startWithEmblems = (options = {}) => startGame({ emblems: {}, ...options });

test('each player starts with a Planeswalker emblem in the command zone', () => {
  const game = new Game({ players, seed: 1 });
  game.start();
  for (const id of ['p1', 'p2']) {
    assert.deepEqual(player(game, id).emblems, [{
      id: `${id}-emblem-1`,
      emblemId: 'planeswalker',
      name: 'Planeswalker',
      ownerId: id,
      controllerId: id,
      abilities: [{ id: 'gainLife', text: '0: You gain 1 life.', cost: {}, timing: 'sorcery' }],
      activationsPerTurn: 1,
      activationsThisTurn: 0,
    }]);
  }
});

test('emblem abilities have sorcery timing', () => {
  const { game } = startWithEmblems();
  assert.deepEqual(emblemActions(game), []); // upkeep
  passRound(game);
  assert.deepEqual(emblemActions(game), [
    { type: ACTION.ACTIVATE_ABILITY, playerId: 'p1', cardId: 'p1-emblem-1', abilityId: 'gainLife' },
  ]);
  // Not for the non-active player, even with priority in a main phase.
  game.dispatch(passPriority('p1'));
  assert.deepEqual(emblemActions(game), []);
  assert.equal(game.dispatch(activateAbility('p2', 'p2-emblem-1', 'gainLife')).ok, false);
});

test('the gain-life ability uses the stack, then gains 1 life', () => {
  const { game, events } = startWithEmblems();
  passRound(game);
  assert.deepEqual(game.dispatch(activateAbility('p1', 'p1-emblem-1', 'gainLife')), { ok: true });

  let state = game.getState();
  assert.equal(player(game, 'p1').life, 20);
  assert.deepEqual(
    state.stack.map((o) => [o.kind, o.sourceId, o.sourceName, o.text]),
    [['activatedAbility', 'p1-emblem-1', 'Planeswalker', '0: You gain 1 life.']],
  );
  assert.equal(state.priorityPlayerId, 'p1');

  passRound(game);
  state = game.getState();
  assert.equal(player(game, 'p1').life, 21);
  assert.deepEqual(state.stack, []);
  assert.equal(state.phase, PHASE.PRECOMBAT_MAIN);
  assert.deepEqual(events.findLast((e) => e.name === 'lifeGained').payload,
    { seq: events.findLast((e) => e.name === 'lifeGained').payload.seq, playerId: 'p1', amount: 1, life: 21 });
});

test('an emblem\'s abilities can be activated once per turn', () => {
  const { game } = startWithEmblems();
  passRound(game);
  game.dispatch(activateAbility('p1', 'p1-emblem-1', 'gainLife'));
  passRound(game);
  assert.equal(emblemOf(game, 'p1').activationsThisTurn, 1);
  assert.deepEqual(emblemActions(game), []);
  assert.equal(game.dispatch(activateAbility('p1', 'p1-emblem-1', 'gainLife')).ok, false);
  advanceTo(game, { turn: 1, phase: PHASE.POSTCOMBAT_MAIN });
  assert.deepEqual(emblemActions(game), []);

  // p2 can use theirs on their turn, and p1 again on turn 3.
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  assert.deepEqual(emblemActions(game).map((a) => a.cardId), ['p2-emblem-1']);
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  assert.equal(emblemOf(game, 'p1').activationsThisTurn, 0);
  assert.deepEqual(emblemActions(game).map((a) => a.cardId), ['p1-emblem-1']);
});

// A test-only emblem with several abilities and costs: life, mana, or nothing.
const TEST_EMBLEM = {
  id: 'testWalker',
  name: 'Test Walker',
  activationsPerTurn: 1,
  abilities: [
    { id: 'draw', text: 'Pay 2 life: Draw a card.', cost: { life: 2 }, effect: { type: EFFECT.DRAW_CARDS, count: 1 }, timing: 'sorcery' },
    { id: 'bigGain', text: '{G}: You gain 3 life.', cost: { mana: { G: 1 } }, effect: { type: EFFECT.GAIN_LIFE, amount: 3 }, timing: 'sorcery' },
    { id: 'instantGain', text: '0: You gain 1 life. Activate any time.', cost: {}, effect: { type: EFFECT.GAIN_LIFE, amount: 1 } },
  ],
};
const startWithTestEmblem = (options) => startGame({
  emblems: { p1: ['testWalker'], p2: [] }, emblemDefinitions: { testWalker: TEST_EMBLEM }, ...options,
});

test('emblem abilities can cost life', () => {
  const { game, events } = startWithTestEmblem();
  passRound(game);
  const hand = player(game, 'p1').hand.length;
  game.dispatch(activateAbility('p1', 'p1-emblem-1', 'draw'));
  assert.equal(player(game, 'p1').life, 18); // paid on activation
  assert.deepEqual(events.findLast((e) => e.name === 'abilityActivated').payload.costPaid, { life: 2 });
  passRound(game);
  assert.equal(player(game, 'p1').hand.length, hand + 1);
});

test('a life cost can\'t be paid with less life than it costs', () => {
  const pricey = {
    id: 'pricey', name: 'Pricey', activationsPerTurn: 1,
    abilities: [{ id: 'big', text: 'Pay 21 life: Draw a card.', cost: { life: 21 }, effect: { type: EFFECT.DRAW_CARDS, count: 1 } }],
  };
  const { game } = startGame({ emblems: { p1: ['pricey'], p2: [] }, emblemDefinitions: { pricey } });
  assert.equal(player(game, 'p1').life, 20);
  assert.deepEqual(emblemActions(game), []);
  assert.equal(game.dispatch(activateAbility('p1', 'p1-emblem-1', 'big')).ok, false);
});

test('emblem abilities can cost mana, and only one ability per emblem per turn', () => {
  const { game } = startWithTestEmblem();
  passRound(game);
  const abilities = () => emblemActions(game).map((a) => a.abilityId);
  assert.deepEqual(abilities(), ['draw', 'instantGain']); // no {G} yet
  game.dispatch(playLand('p1', player(game, 'p1').hand[0].id));
  game.dispatch(activateAbility('p1', game.getState().battlefield[0].id, 'tapForG'));
  assert.deepEqual(abilities(), ['draw', 'bigGain', 'instantGain']);
  game.dispatch(activateAbility('p1', 'p1-emblem-1', 'bigGain'));
  passRound(game);
  assert.equal(player(game, 'p1').life, 23);
  assert.deepEqual(abilities(), []); // the emblem's one activation this turn is used
});

test('an emblem ability without sorcery timing can be activated with priority any time', () => {
  const { game } = startWithTestEmblem();
  // Upkeep: only the instant-speed ability is available.
  assert.deepEqual(emblemActions(game).map((a) => a.abilityId), ['instantGain']);
});

test('the basic AI uses its free emblem ability', () => {
  const game = new Game({ players, seed: 3 });
  const ais = players.map(({ id }) => new BasicAIController({ game, playerId: id, delayMs: null }));
  const gains = [];
  game.on('lifeGained', (e) => gains.push(e.playerId));
  game.start();
  ais.forEach((ai) => ai.detach());
  assert.equal(game.getState().status, GAME_STATUS.GAME_OVER);
  assert.ok(gains.includes('p1') && gains.includes('p2'));
});

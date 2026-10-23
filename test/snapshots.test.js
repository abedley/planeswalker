import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, GAME_STATUS, BasicAIController, SAMPLE_EFFECTS, SAMPLE_EFFECTS_DECK, SAMPLE_TRIGGERS, SAMPLE_TRIGGERS_DECK,
  passPriority, seededRandom,
} from '../src/index.js';
import { playout } from '../src/ai/simulate.js';
import { determinize, determinizedGame } from '../src/ai/determinize.js';
import { STEP } from '../src/engine/turnStructure.js';
import { isLand } from '../src/cards/cards.js';

const players = [{ id: 'p1' }, { id: 'p2' }];
const cards = { ...SAMPLE_EFFECTS, ...SAMPLE_TRIGGERS };
const newGame = (seed, options = {}) => new Game({
  players, seed, cards, decks: { p1: SAMPLE_EFFECTS_DECK, p2: SAMPLE_TRIGGERS_DECK }, ...options,
});
const basicPolicies = () => Object.fromEntries(players.map(({ id }) => {
  const ai = new BasicAIController({ game: null, playerId: id });
  return [id, (state) => ai.chooseAction(state)];
}));
// The parts of a state that describe the game itself (not event bookkeeping).
const gameOf = (state) => {
  const { version, ...rest } = state;
  return JSON.parse(JSON.stringify(rest));
};

test('serialize and deserialize round-trip, and the copy plays on identically', () => {
  const game = newGame(1, { silent: true });
  game.start();
  playout(game, basicPolicies(), { until: (s) => s.turn >= 6 });
  const copy = Game.deserialize(game.serialize(), { silent: true });
  assert.deepEqual(gameOf(copy.getState()), gameOf(game.getState()));
  const policies = basicPolicies();
  const a = playout(game, policies);
  const b = playout(copy, basicPolicies());
  assert.deepEqual(gameOf(structuredClone(b)), gameOf(structuredClone(a)));
  assert.equal(a.status, GAME_STATUS.GAME_OVER);
});

test('the random number generator is part of the snapshot', () => {
  const random = seededRandom(42);
  random();
  const saved = random.getState();
  const next = [random(), random()];
  random.setState(saved);
  assert.deepEqual([random(), random()], next);
});

test('a clone is independent of the original', () => {
  const game = newGame(2);
  game.start();
  const before = game.getState();
  const clone = game.clone();
  let events = 0;
  game.onAny(() => { events += 1; });
  playout(clone, basicPolicies(), { until: (s) => s.turn >= 4 });
  assert.deepEqual(game.getState(), before);
  assert.equal(events, 0); // the clone is silent and has no listeners
  assert.ok(clone.getState().turn >= 4);
  // And the original still works.
  assert.deepEqual(game.dispatch(passPriority('p1')), { ok: true });
});

test('silent games with trusted actions end exactly like normal ones', () => {
  for (const seed of [3, 4]) {
    const loud = newGame(seed);
    for (const { id } of players) new BasicAIController({ game: loud, playerId: id, delayMs: null });
    loud.start();
    const silent = newGame(seed, { silent: true });
    silent.start();
    const final = playout(silent, basicPolicies());
    const expected = loud.getState();
    assert.deepEqual(
      [final.winnerId, final.turn, final.players.map((p) => p.life)],
      [expected.winnerId, expected.turn, expected.players.map((p) => p.life)],
    );
  }
});

test('a player view hides the opponent\'s hand, every library\'s order and the random state', () => {
  const game = newGame(5);
  game.start();
  const view = game.getPlayerView('p1');
  const real = game.serialize();
  assert.equal(view.randomState, undefined);
  assert.deepEqual(view.zones.p1.hand, real.zones.p1.hand); // your own hand is yours to see
  assert.deepEqual([view.zones.p2.hand, view.zones.p2.handSize], [[], real.zones.p2.hand.length]);
  for (const id of ['p1', 'p2']) {
    assert.deepEqual([view.zones[id].library, view.zones[id].librarySize], [[], real.zones[id].library.length]);
  }
  // The unknown cards are what's missing, with no ids and in no telling order.
  assert.equal(view.unknownCards.p1.length, real.zones.p1.library.length);
  assert.equal(view.unknownCards.p2.length, real.zones.p2.library.length + real.zones.p2.hand.length);
  for (const cardsOf of Object.values(view.unknownCards)) {
    assert.ok(cardsOf.every((c) => c.id === null));
    assert.deepEqual(cardsOf.map((c) => c.cardId), cardsOf.map((c) => c.cardId).sort());
  }
  // Nothing in the view mentions a hidden card's id.
  const hiddenIds = [...real.zones.p2.hand, ...real.zones.p2.library, ...real.zones.p1.library].map((c) => c.id);
  const text = JSON.stringify(view);
  assert.ok(hiddenIds.every((id) => !text.includes(`"${id}"`)));
});

test('the view is the same whatever the seed', () => {
  const view = (seed) => {
    const game = new Game({
      players, seed, cards, shuffleLibraries: false,
      decks: { p1: SAMPLE_EFFECTS_DECK, p2: [...SAMPLE_TRIGGERS_DECK].reverse() },
    });
    game.start();
    return game.getPlayerView('p1');
  };
  // Same cards everywhere (no shuffling); only the random number generator's state differs.
  const a = view(1);
  const b = view(99);
  assert.deepEqual(a, b);
});

test('determinize deals the unknown cards into a playable game', () => {
  const game = newGame(6);
  game.start();
  const view = game.getPlayerView('p2');
  const random = seededRandom(7);
  const guess = determinize(view, random);
  assert.equal(guess.zones.p1.hand.length, view.zones.p1.handSize);
  assert.deepEqual(guess.zones.p2.hand, view.zones.p2.hand);
  assert.equal(guess.zones.p1.library.length + guess.zones.p1.hand.length, view.unknownCards.p1.length);
  assert.equal(typeof guess.randomState, 'number');
  // Different guesses differ.
  const other = determinize(view, random);
  assert.notDeepEqual(other.zones.p1.hand.map((c) => c.cardId), guess.zones.p1.hand.map((c) => c.cardId));
  // And they play to the end.
  const final = playout(determinizedGame(view, random), basicPolicies());
  assert.equal(final.status, GAME_STATUS.GAME_OVER);
});

test('reordering hidden cards doesn\'t change a player\'s view', () => {
  const game = newGame(8);
  game.start();
  const snapshot = game.serialize();
  snapshot.zones.p2.library.reverse();
  snapshot.zones.p1.library.reverse();
  // Swap a card between p2's hand and library: p1 can't tell the difference.
  [snapshot.zones.p2.hand[0], snapshot.zones.p2.library[0]] = [snapshot.zones.p2.library[0], snapshot.zones.p2.hand[0]];
  const shuffled = Game.deserialize(snapshot);
  assert.deepEqual(shuffled.getPlayerView('p1'), game.getPlayerView('p1'));
});

/** Plays basic AIs from `game` until `found(game)`, or fails. */
const playUntil = (game, found, steps = 6000) => {
  const policies = basicPolicies();
  for (let step = 0; step < steps && game.peekState().status === GAME_STATUS.IN_PROGRESS; step++) {
    if (found(game)) return true;
    const state = game.peekState();
    const id = state.pendingDecision?.playerId ?? state.priorityPlayerId;
    game.applyTrusted(policies[id](state) ?? state.validActions.find((a) => a.playerId === id));
  }
  return false;
};

test('a card returned to an opponent\'s hand stays known, and every guess keeps it there', () => {
  let checked = 0;
  for (let seed = 1; seed <= 40 && checked < 2; seed++) {
    const game = new Game({ players, seed, cards: SAMPLE_EFFECTS, decks: { p1: SAMPLE_EFFECTS_DECK, p2: SAMPLE_EFFECTS_DECK }, silent: true });
    game.start();
    const bounced = () => Object.values(game.serialize().zones.p2.handNotes).some((n) => n.revealed);
    if (!playUntil(game, bounced)) continue;
    const real = game.serialize().zones.p2;
    const known = real.hand.filter((c) => real.handNotes[c.id]?.revealed);
    const view = game.getPlayerView('p1');
    assert.deepEqual(view.zones.p2.hand, known);
    assert.equal(view.zones.p2.handSize, real.hand.length);
    assert.equal(view.zones.p2.handInfo.length, real.hand.length - known.length);
    assert.equal(view.unknownCards.p2.length, real.library.length + real.hand.length - known.length);
    const random = seededRandom(seed);
    for (const inference of [false, true]) {
      const guess = determinize(view, random, { inference });
      assert.equal(guess.zones.p2.hand.length, real.hand.length);
      for (const card of known) assert.ok(guess.zones.p2.hand.some((c) => c.id === card.id), card.name);
    }
    checked += 1;
  }
  assert.equal(checked, 2);
});

test('hands are noted at the end of each turn, before the next draw', () => {
  const game = newGame(9, { silent: true });
  game.start();
  let turns = 0;
  let before = new Set();
  playUntil(game, (g) => {
    const state = g.peekState();
    if (state.step !== STEP.DRAW || state.activePlayerId !== 'p2' || state.playersPassed.length > 0) return false;
    const zone = g.serialize().zones.p2;
    // Just drawn: the newest card in hand has no notes; those in hand at its last
    // draw were held through its turn.
    const drawn = zone.hand.at(-1);
    assert.equal(zone.handNotes[drawn.id], undefined);
    for (const card of zone.hand.filter((c) => before.has(c.id))) assert.equal(typeof zone.handNotes[card.id]?.heldWithMana, 'number', card.name);
    before = new Set(zone.hand.map((c) => c.id));
    return ++turns >= 6;
  });
  assert.equal(turns, 6);
});

test('with inference, slots held through a turn without a land drop get no lands', () => {
  let checked = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const game = newGame(seed, { silent: true });
    game.start();
    const view = () => game.getPlayerView('p1');
    if (!playUntil(game, () => view().zones.p2.handInfo.some((slot) => slot.noLand))) continue;
    // The basic AI always plays a land when it can, so those cards really are spells.
    const real = game.serialize().zones.p2;
    for (const card of real.hand) if (real.handNotes[card.id]?.noLand) assert.ok(!isLand(card), card.name);
    const v = view();
    const flagged = v.zones.p2.handInfo.filter((slot) => slot.noLand).length;
    const random = seededRandom(seed);
    for (let i = 0; i < 20; i++) {
      const hand = determinize(v, random, { inference: { noLand: 0 } }).zones.p2.hand;
      assert.ok(hand.filter((c) => !isLand(c)).length >= flagged);
    }
    checked += 1;
  }
  assert.ok(checked >= 3, `${checked} games with a missed land drop`);
});

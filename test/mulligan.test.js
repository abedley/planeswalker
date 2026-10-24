import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, GAME_STATUS, DECISION, ACTION, BasicAIController, CARDS, keepHand, mulligan, putOnBottom,
  SAMPLE_EFFECTS, SAMPLE_EFFECTS_DECK,
} from '../src/index.js';
import { playout } from '../src/ai/simulate.js';
import { keepsHand, bottomCard, landTarget } from '../src/ai/mulligan.js';
import { searchPolicy } from '../src/ai/search.js';

const players = [{ id: 'p1' }, { id: 'p2' }];
const newGame = (options = {}) => new Game({ players, seed: 3, mulligans: true, ...options });
const zone = (game, id) => game.serialize().zones[id];
const card = (cardId) => ({ ...CARDS[cardId], cardId });
const basic = () => Object.fromEntries(players.map(({ id }) => {
  const ai = new BasicAIController({ game: null, playerId: id });
  return [id, (state) => ai.chooseAction(state)];
}));

test('without mulligans the game starts at once', () => {
  const game = new Game({ players, seed: 3 });
  game.start();
  assert.equal(game.getState().pendingDecision, null);
  assert.equal(game.getState().turn, 1);
});

test('each player in turn order keeps or mulligans, then puts a card on the bottom per mulligan', () => {
  const game = newGame({ startingPlayerId: 'p2' });
  game.start();
  let state = game.getState();
  assert.equal(state.turn, 0);
  assert.deepEqual(state.pendingDecision, { type: DECISION.MULLIGAN, playerId: 'p2', mulligans: 0, waiting: ['p1'] });
  assert.deepEqual(state.validActions, [keepHand('p2'), mulligan('p2')]);
  assert.equal(game.dispatch(keepHand('p1')).ok, false); // not their turn to decide

  for (let i = 0; i < 2; i++) assert.deepEqual(game.dispatch(mulligan('p2')), { ok: true });
  assert.equal(zone(game, 'p2').hand.length, 7); // a new seven each time
  assert.equal(zone(game, 'p2').library.length, 33);
  game.dispatch(keepHand('p2'));
  state = game.getState();
  assert.equal(state.pendingDecision.type, DECISION.PUT_ON_BOTTOM);
  assert.equal(state.pendingDecision.count, 2);
  const [a, b] = zone(game, 'p2').hand;
  game.dispatch(putOnBottom('p2', a.id));
  game.dispatch(putOnBottom('p2', b.id));
  assert.deepEqual(zone(game, 'p2').library.slice(-2).map((c) => c.id), [a.id, b.id]);
  assert.equal(zone(game, 'p2').hand.length, 5);

  // Then p1, who keeps seven, and the first turn begins.
  assert.equal(game.getState().pendingDecision.playerId, 'p1');
  game.dispatch(keepHand('p1'));
  state = game.getState();
  assert.deepEqual([state.turn, state.activePlayerId, state.pendingDecision], [1, 'p2', null]);
  assert.equal(state.players.find((p) => p.id === 'p1').hand.length, 7);
});

test('a player can mulligan down to nothing', () => {
  const game = newGame();
  game.start();
  for (let i = 0; i < 7; i++) game.dispatch(mulligan('p1'));
  assert.deepEqual(game.getState().validActions.map((a) => a.type), [ACTION.KEEP_HAND]);
  game.dispatch(keepHand('p1'));
  for (let i = 0; i < 7; i++) game.dispatch(game.getState().validActions[0]);
  assert.equal(zone(game, 'p1').hand.length, 0);
  assert.equal(game.getState().pendingDecision.playerId, 'p2');
});

test('a game saved during mulligans plays on the same', () => {
  const game = newGame({ silent: true });
  game.start();
  game.dispatch(mulligan('p1'));
  const copy = Game.deserialize(game.serialize(), { silent: true });
  const a = playout(game, basic());
  const b = playout(copy, basic());
  assert.deepEqual([b.winnerId, b.turn], [a.winnerId, a.turn]);
  assert.equal(a.status, GAME_STATUS.GAME_OVER);
});

test('the AI keeps hands with a sensible number of lands', () => {
  const hand = (lands) => [...Array(lands).fill('forest'), ...Array(7 - lands).fill('llanowarElves')].map(card);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((n) => keepsHand(hand(n), 0)), [false, false, true, true, true, true, false, false]);
  // At six cards it can bottom a land or a spell first.
  assert.deepEqual([0, 1, 2, 5, 6, 7].map((n) => keepsHand(hand(n), 1)), [false, false, true, true, false, false]);
  // Four cards or fewer: kept whatever they hold.
  assert.equal(keepsHand(hand(7), 3), true);
  // A deck without lands keeps anything.
  assert.equal(keepsHand(hand(0), 0, 0), true);
});

test('the AI bottoms extra lands first, then its most expensive spells', () => {
  const cards = { ...CARDS, ...SAMPLE_EFFECTS };
  const of = (ids) => ids.map((id) => ({ ...cards[id], cardId: id, id }));
  assert.equal(landTarget(6, 0.4), 2);
  assert.equal(bottomCard(of(['forest', 'forest', 'forest', 'forest', 'llanowarElves', 'llanowarElves', 'llanowarElves']), 1, 0.4).cardId, 'forest');
  const expensive = Object.values(SAMPLE_EFFECTS).reduce((a, b) => ((b.manaCost?.generic ?? 0) > (a.manaCost?.generic ?? 0) ? b : a));
  assert.equal(bottomCard(of(['forest', 'forest', 'llanowarElves', expensive.id, 'llanowarElves', 'llanowarElves', 'llanowarElves']), 1, 0.4).cardId, expensive.id);
});

test('basic and search AIs play games with mulligans to the end', () => {
  for (const seed of [1, 2, 3, 4]) {
    const game = new Game({ players, seed, cards: SAMPLE_EFFECTS, decks: { p1: SAMPLE_EFFECTS_DECK, p2: SAMPLE_EFFECTS_DECK }, mulligans: true, silent: true });
    game.start();
    const search = searchPolicy('p1', { algorithm: 'greedy', determinizations: 1 });
    const ai = new BasicAIController({ game: null, playerId: 'p2' });
    const final = playout(game, { p1: (s) => search(s, game), p2: (s) => ai.chooseAction(s) });
    assert.equal(final.status, GAME_STATUS.GAME_OVER);
  }
});

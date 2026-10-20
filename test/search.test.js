import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, GAME_STATUS, BasicAIController, SAMPLE_EFFECTS, SAMPLE_EFFECTS_DECK, SAMPLE_TRIGGERS, SAMPLE_TRIGGERS_DECK,
  SAMPLE_CARDS, SAMPLE_DECK,
} from '../src/index.js';
import { playout, actingPlayerId } from '../src/ai/simulate.js';
import { listMacros, nextAction } from '../src/ai/macroActions.js';
import { evaluate } from '../src/ai/evaluate.js';
import { searchPolicy, worthSearching } from '../src/ai/search.js';

const players = [{ id: 'p1' }, { id: 'p2' }];
const cards = { ...SAMPLE_EFFECTS, ...SAMPLE_TRIGGERS, ...SAMPLE_CARDS };
const basic = () => Object.fromEntries(players.map(({ id }) => {
  const ai = new BasicAIController({ game: null, playerId: id });
  return [id, (state) => ai.chooseAction(state)];
}));

test('every macro action expands into actions the engine accepts', () => {
  let checked = 0;
  for (const [seed, decks] of [[1, [SAMPLE_EFFECTS_DECK, SAMPLE_TRIGGERS_DECK]], [2, [SAMPLE_DECK, SAMPLE_EFFECTS_DECK]]]) {
    const game = new Game({ players, seed, cards, decks: { p1: decks[0], p2: decks[1] }, silent: true });
    game.start();
    const policies = basic();
    for (let step = 0; step < 4000 && game.peekState().status === GAME_STATUS.IN_PROGRESS; step++) {
      const state = game.getState();
      const me = actingPlayerId(state);
      if (step % 7 === 0 && worthSearching(state, me)) {
        for (const macro of listMacros(state, me)) {
          // Play the macro out on a copy that validates every action.
          const copy = Game.deserialize(game.serialize());
          let done = false;
          for (let i = 0; i < 60 && !done; i++) {
            const next = nextAction(copy.getState(), me, macro);
            if (!next) break; // e.g. an illegal partial block; the search treats it as failed
            assert.deepEqual(copy.dispatch(next.action), { ok: true }, `${macro.key}: ${JSON.stringify(next.action)}`);
            done = next.done;
          }
          checked += 1;
        }
      }
      game.applyTrusted(policies[me](game.peekState()) ?? game.peekState().validActions.find((a) => a.playerId === me));
    }
  }
  assert.ok(checked > 50, `checked ${checked} macros`);
});

test('evaluate prefers more life, more creatures, and winning', () => {
  const game = new Game({ players, seed: 3, cards, decks: { p1: SAMPLE_EFFECTS_DECK, p2: SAMPLE_EFFECTS_DECK } });
  game.start();
  const state = game.getState();
  const base = evaluate(state, 'p1');
  assert.ok(Math.abs(base) < 5, 'an even start is about even');
  const lowLife = structuredClone(state);
  lowLife.players[0].life = 5;
  assert.ok(evaluate(lowLife, 'p1') < base);
  assert.ok(evaluate(lowLife, 'p2') > evaluate(state, 'p2'));
  const won = { ...structuredClone(state), status: GAME_STATUS.GAME_OVER, winnerId: 'p1' };
  assert.ok(evaluate(won, 'p1') > 1000 && evaluate(won, 'p2') < -1000);
});

/** The first decision the search AI would make at or after `fromStep` steps of a basic game. */
function decisionAfter(game, me, fromStep) {
  const policies = basic();
  for (let step = 0; step < 4000; step++) {
    const state = game.peekState();
    if (step >= fromStep && actingPlayerId(state) === me && worthSearching(state, me) && listMacros(state, me).length > 2) return;
    game.applyTrusted(policies[actingPlayerId(state)](state));
  }
  throw new Error('no decision found');
}

test('the search\'s choice doesn\'t depend on anything it can\'t know', () => {
  for (const fromStep of [40, 300]) {
    const game = new Game({ players, seed: 4, cards, decks: { p1: SAMPLE_EFFECTS_DECK, p2: SAMPLE_TRIGGERS_DECK }, silent: true });
    game.start();
    decisionAfter(game, 'p1', fromStep);
    // The same position, but with the opponent's hand and library shuffled together,
    // both libraries in a new order, and a different random number generator state.
    const snapshot = game.serialize();
    const theirs = [...snapshot.zones.p2.hand, ...snapshot.zones.p2.library].reverse();
    snapshot.zones.p2.hand = theirs.splice(0, snapshot.zones.p2.hand.length);
    snapshot.zones.p2.library = theirs;
    snapshot.zones.p1.library.reverse();
    snapshot.randomState = 12345;
    const other = Game.deserialize(snapshot, { silent: true });
    const choose = (g) => searchPolicy('p1', { algorithm: 'greedy', determinizations: 2, seed: 9 })(g.peekState(), g);
    assert.deepEqual(choose(other), choose(game), `decision after ${fromStep} steps`);
  }
});

test('greedy and ismcts policies play complete games', () => {
  for (const algorithm of ['greedy', 'ismcts']) {
    const game = new Game({ players, seed: 5, cards, decks: { p1: SAMPLE_EFFECTS_DECK, p2: SAMPLE_EFFECTS_DECK }, silent: true });
    game.start();
    const search = searchPolicy('p1', { algorithm, determinizations: 1, budgetMs: 5 });
    const ai = new BasicAIController({ game: null, playerId: 'p2' });
    const final = playout(game, { p1: (s) => search(s, game), p2: (s) => ai.chooseAction(s) });
    assert.equal(final.status, GAME_STATUS.GAME_OVER, algorithm);
  }
});

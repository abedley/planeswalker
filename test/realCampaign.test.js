import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, GAME_STATUS, GAME_LIMITS, BasicAIController, CARDS, CAMPAIGN, REAL_DECKS, REWARD_ONLY_CARDS, REWARD, RUN_PHASE,
  validateCampaign, startRun, recordResult, poolFor, CARD_PRESENTATION,
} from '../src/index.js';
import { playout } from '../src/ai/simulate.js';

const colorsOf = (card) => card.colors ?? Object.keys(card.manaCost ?? {}).filter((c) => 'WUBRG'.includes(c));

test('the real campaign is consistent, and every card in it is real', () => {
  assert.deepEqual(validateCampaign(CAMPAIGN), []);
  for (const [name, deck] of Object.entries(REAL_DECKS)) {
    assert.equal(deck.length, 40, name);
    for (const id of deck) assert.ok(CARDS[id], `${name}: ${id}`);
  }
  for (const id of REWARD_ONLY_CARDS) assert.ok(CARDS[id]?.image, id);
  // Imported cards carry their art; the hand-written ones get it from CARD_PRESENTATION.
  for (const id of new Set(Object.values(REAL_DECKS).flat())) {
    assert.ok(CARDS[id].image ?? CARD_PRESENTATION[id]?.image, `${id} has art`);
  }
});

test('each real deck is one color', () => {
  for (const [name, deck] of Object.entries(REAL_DECKS)) {
    const colors = new Set(deck.flatMap((id) => colorsOf(CARDS[id])));
    assert.equal(colors.size, 1, `${name}: ${[...colors]}`);
  }
});

test('rewards stay in the planeswalker\'s colors', () => {
  for (const [walker, color] of [['warden', 'G'], ['sage', 'U']]) {
    for (const pool of ['early', 'late']) {
      const cards = poolFor(CAMPAIGN, walker, pool);
      assert.ok(cards.length >= 5, `${walker} ${pool}`);
      for (const id of cards) assert.ok(colorsOf(CARDS[id]).every((c) => c === color), `${walker} offered ${id}`);
    }
    for (let seed = 1; seed <= 20; seed++) {
      const run = recordResult(startRun(CAMPAIGN, { planeswalkerId: walker, deckId: CAMPAIGN.planeswalkers[walker].decks[0], seed }), CAMPAIGN, { won: true });
      assert.equal(run.phase, RUN_PHASE.REWARD);
      for (const offer of run.offers.filter((o) => o.kind === REWARD.CARD)) {
        assert.ok(colorsOf(CARDS[offer.cardId]).every((c) => c === color), `${walker} offered ${offer.cardId}`);
      }
    }
  }
});

test('every pair of real decks plays to the end', () => {
  const names = ['whiteWeenie', 'blueSkies', 'blackRemoval', 'redBurn', 'greenStompy', 'dragonlord'];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const game = new Game({
        players: [{ id: 'p1' }, { id: 'p2' }], seed: i * 10 + j, silent: true, limits: GAME_LIMITS,
        decks: { p1: REAL_DECKS[names[i]], p2: REAL_DECKS[names[j]] },
      });
      game.start();
      const policies = Object.fromEntries(['p1', 'p2'].map((id) => {
        const ai = new BasicAIController({ game: null, playerId: id });
        return [id, (state) => ai.chooseAction(state)];
      }));
      const final = playout(game, policies, { until: (state) => state.turn > 150 });
      assert.equal(final.status, GAME_STATUS.GAME_OVER, `${names[i]} vs ${names[j]}`);
    }
  }
});

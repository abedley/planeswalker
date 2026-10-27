import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, CAMPAIGN, REAL_DECKS, matchSetup, startRun, validateCampaign } from '../src/index.js';
import {
  BANTER, BANTER_KINDS, SwingWatch, outlook, pickLine, banterProblems,
} from '../src/campaign/banter.js';

test('every real opponent has its own lines for every kind of banter', () => {
  const seen = new Map();
  for (const [id, opponent] of Object.entries(CAMPAIGN.opponents)) {
    assert.deepEqual(banterProblems(id, opponent.banter), []);
    for (const kind of BANTER_KINDS) {
      assert.ok(opponent.banter?.[kind]?.length >= 2, `${id}: ${kind}`);
      for (const line of opponent.banter[kind]) {
        assert.ok(!seen.has(line), `"${line}" is said by both ${seen.get(line)} and ${id}`);
        seen.set(line, id);
      }
    }
  }
});

test('matchSetup hands the opponent\'s banter to the CPU', () => {
  const run = startRun(CAMPAIGN, { planeswalkerId: 'warden', deckId: 'greenStompy', seed: 3 });
  const { cpu } = matchSetup(run, CAMPAIGN);
  assert.equal(cpu.banter, CAMPAIGN.opponents[run.encounter.opponentId].banter);
});

test('validateCampaign catches malformed banter', () => {
  const opponents = { ...CAMPAIGN.opponents, raider: { ...CAMPAIGN.opponents.raider, banter: { start: [], gloat: ['Ha!'] } } };
  const problems = validateCampaign({ ...CAMPAIGN, opponents });
  assert.ok(problems.includes('opponent raider: banter "start" needs lines'));
  assert.ok(problems.includes('opponent raider: unknown banter kind "gloat"'));
});

test('SwingWatch reports a swing only after a confident mood flips', () => {
  const watch = new SwingWatch({ threshold: 10, window: 2 });
  // Even, then winning: no swing yet, only a mood.
  assert.deepEqual([0, 5, 20, 20].map((s) => watch.observe(s)), [null, null, null, null]);
  assert.equal(watch.mood, 'winning');
  // Slipping back to even is no swing; losing is a collapse, once.
  assert.deepEqual([0, -5, -20, -25].map((s) => watch.observe(s)), [null, null, BANTER.COLLAPSE, null]);
  assert.equal(watch.mood, 'losing');
  // And back again: a comeback.
  assert.deepEqual([30, 30].map((s) => watch.observe(s)), [null, BANTER.COMEBACK]);
});

test('SwingWatch averages out the bounce between turns', () => {
  const watch = new SwingWatch({ threshold: 10, window: 2 });
  // Alternating +12/-12 (whose turn it is) averages to even: never a mood.
  for (let i = 0; i < 10; i++) assert.equal(watch.observe(i % 2 ? 12 : -12), null);
  assert.equal(watch.mood, null);
});

test('pickLine says each line once before repeating, and nothing without lines', () => {
  const banter = { start: ['a', 'b', 'c'] };
  const used = new Set();
  const said = [0, 1, 2].map(() => pickLine(banter, BANTER.START, { used, random: () => 0 }));
  assert.deepEqual(said.sort(), ['a', 'b', 'c']);
  assert.ok(['a', 'b', 'c'].includes(pickLine(banter, BANTER.START, { used })));
  assert.equal(pickLine(banter, BANTER.WIN), null);
  assert.equal(pickLine(null, BANTER.START), null);
});

test('outlook is even at the start, and doesn\'t look at the other hand', () => {
  const game = new Game({ players: [{ id: 'p1' }, { id: 'p2' }], seed: 7, decks: { p1: REAL_DECKS.redBurn, p2: REAL_DECKS.blueSkies } });
  game.start();
  const state = game.getState();
  assert.ok(Math.abs(outlook(state, 'p2')) < 15);
  // Swapping p1's hand for all lands doesn't change p2's outlook.
  const lands = state.players[0].hand.map((c) => ({ ...c, cardId: 'mountain', types: ['land'] }));
  const swapped = { ...state, players: [{ ...state.players[0], hand: lands }, state.players[1]] };
  assert.equal(outlook(swapped, 'p2'), outlook(state, 'p2'));
});

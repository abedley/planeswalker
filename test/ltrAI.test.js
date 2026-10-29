// The AIs with The Lord of the Rings: Tales of Middle-earth: its choices, and whole games.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, GAME_STATUS, DECISION, CHOICE, PHASE, CARDS, KEYWORD, BasicAIController, LTR_DECKS, passPriority, castSpell,
} from '../src/index.js';
import { playout } from '../src/ai/simulate.js';
import { determinize } from '../src/ai/determinize.js';
import { seededRandom } from '../src/engine/random.js';

const players = [{ id: 'p1' }, { id: 'p2' }];
const free = (ids) => Object.fromEntries(ids.map((id) => [id, { ...CARDS[id], manaCost: {} }]));
const creature = (id, power, toughness, extra = {}) => ({ id, name: id, manaCost: {}, types: ['Creature'], power, toughness, ...extra });

function game({ hand, library = [], cards = {} }) {
  const deck = [...hand, ...Array(7 - hand.length).fill('forest'), ...library, ...Array(30).fill('forest')];
  const g = new Game({ players, cards, shuffleLibraries: false, emblems: { p1: [], p2: [] }, decks: { p1: deck, p2: Array(40).fill('forest') } });
  g.start();
  while (g.getState().phase !== PHASE.PRECOMBAT_MAIN) g.dispatch(passPriority(g.getState().priorityPlayerId));
  return g;
}

/** Lets the basic AI make every decision until none is pending or it passes priority. */
function aiDecides(g, playerId = 'p1') {
  const ai = new BasicAIController({ game: null, playerId });
  for (let i = 0; i < 50 && g.getState().pendingDecision?.playerId === playerId; i++) g.dispatch(ai.chooseAction(g.getState()));
}

/** Passes until the stack is empty or a player must choose. */
const resolve = (g) => {
  for (let i = 0; i < 20 && g.getState().stack.length && !g.getState().pendingDecision; i++) g.dispatch(passPriority(g.getState().priorityPlayerId));
};

const castAndResolve = (g, cardId, targets) => {
  const id = g.getState().players[0].hand.find((c) => c.cardId === cardId).id;
  g.dispatch(castSpell('p1', id, targets));
  resolve(g);
};

test('scrying: short of lands, the basic AI keeps a land on top and bottoms an expensive spell', () => {
  const big = creature('big', 8, 8, { manaCost: { generic: 9 } });
  const g = game({ hand: ['galadhrimGuide', ...Array(6).fill('big')], library: ['big', 'forest'], cards: { ...free(['galadhrimGuide']), big } });
  castAndResolve(g, 'galadhrimGuide');
  assert.equal(g.getState().pendingDecision.kind, CHOICE.SCRY);
  aiDecides(g);
  const library = g.serialize().zones.p1.library;
  assert.equal(library[0].cardId, 'forest');
  assert.equal(library.at(-1).cardId, 'big');
});

test('the Ring-bearer: the basic AI picks an evasive creature over a bigger one that can\'t attack', () => {
  const flyer = creature('flyer', 2, 2, { keywords: [KEYWORD.FLYING] });
  const wall = creature('wall', 0, 6, { keywords: [KEYWORD.DEFENDER] });
  const g = game({ hand: ['flyer', 'wall', 'birthdayEscape'], cards: { flyer, wall, ...free(['birthdayEscape']) } });
  castAndResolve(g, 'flyer');
  castAndResolve(g, 'wall');
  castAndResolve(g, 'birthdayEscape');
  assert.equal(g.getState().pendingDecision.kind, CHOICE.RING_BEARER);
  aiDecides(g);
  const { ring } = g.getState().players[0];
  assert.equal(g.getState().battlefield.find((p) => p.id === ring.bearerId).cardId, 'flyer');
});

test('sacrificing: the basic AI gives up its least valuable creature', () => {
  const g = new Game({
    players, shuffleLibraries: false, emblems: { p1: [], p2: [] },
    cards: { ...free(['voraciousFellBeast']), small: creature('small', 1, 1), large: creature('large', 5, 5) },
    decks: { p1: ['voraciousFellBeast', ...Array(39).fill('forest')], p2: ['small', 'large', ...Array(38).fill('forest')] },
  });
  g.start();
  const pass = () => g.dispatch(passPriority(g.getState().priorityPlayerId));
  while (!(g.getState().turn === 2 && g.getState().phase === PHASE.PRECOMBAT_MAIN)) pass();
  for (const id of ['small', 'large']) {
    g.dispatch(castSpell('p2', g.getState().players[1].hand.find((c) => c.cardId === id).id));
    pass(); pass();
  }
  while (!(g.getState().turn === 3 && g.getState().phase === PHASE.PRECOMBAT_MAIN)) pass();
  g.dispatch(castSpell('p1', g.getState().players[0].hand.find((c) => c.cardId === 'voraciousFellBeast').id));
  resolve(g);
  assert.equal(g.getState().pendingDecision.kind, CHOICE.SACRIFICE);
  aiDecides(g, 'p2');
  assert.deepEqual(g.getState().battlefield.filter((p) => p.controllerId === 'p2' && p.types.includes('Creature')).map((p) => p.cardId), ['large']);
});

test('determinize keeps the cards a scrying player is looking at, and guesses the rest', () => {
  const g = game({ hand: ['galadhrimGuide'], library: ['island', 'swamp'], cards: free(['galadhrimGuide']) });
  castAndResolve(g, 'galadhrimGuide');
  const looked = g.getState().pendingDecision.options;
  const mine = determinize(g.getPlayerView('p1'), seededRandom(3));
  assert.deepEqual(mine.zones.p1.library.slice(0, 2).map((c) => c.id), looked);
  // The opponent doesn't know those cards: in its guess, the decision is about its guessed library.
  const theirs = determinize(g.getPlayerView('p2'), seededRandom(3));
  assert.deepEqual(theirs.pendingDecision.options, theirs.zones.p1.library.slice(0, 2).map((c) => c.id));
  const copy = Game.deserialize(theirs, { silent: true });
  copy.applyTrusted({ type: 'CONFIRM_CHOICE', playerId: 'p1' });
  assert.equal(copy.peekState().pendingDecision, null);
});

test('the LTR sampler decks play out between basic AIs', () => {
  for (const seed of [1, 2]) {
    const g = new Game({ players, seed, silent: true, decks: { p1: LTR_DECKS.fellowship, p2: LTR_DECKS.mordor } });
    g.start();
    const ais = { p1: new BasicAIController({ game: null, playerId: 'p1' }), p2: new BasicAIController({ game: null, playerId: 'p2' }) };
    const final = playout(g, { p1: (s) => ais.p1.chooseAction(s), p2: (s) => ais.p2.chooseAction(s) }, { until: (s) => s.turn > 60 });
    assert.equal(final.status, GAME_STATUS.GAME_OVER, `seed ${seed}`);
  }
});

test('every LTR card in the list was imported', async () => {
  const { readFileSync } = await import('node:fs');
  const names = readFileSync(new URL('../cards/ltr-cards.txt', import.meta.url), 'utf8').split('\n')
    .filter((line) => line.endsWith('(LTR)')).map((line) => line.replace(/ \(LTR\)$/, ''));
  assert.ok(names.length >= 181);
  const imported = new Set(Object.values(CARDS).filter((c) => c.set === 'ltr').map((c) => c.name));
  assert.deepEqual(names.filter((name) => !imported.has(name)), []);
  assert.ok(DECISION.CHOOSE);
});

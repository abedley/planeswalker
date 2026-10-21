import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, ACTION, CARD_TYPE, EFFECT, TOKEN, TARGET, GAME_LIMITS, passPriority, castSpell,
} from '../src/index.js';

const players = [{ id: 'p1' }, { id: 'p2' }];

// Free test cards.
const spell = (id, effects, extra = {}) => ({ id, name: id, manaCost: {}, types: [CARD_TYPE.SORCERY], effects, ...extra });
const CARDS = {
  Bear: { id: 'Bear', name: 'Bear', manaCost: {}, types: [CARD_TYPE.CREATURE], power: 2, toughness: 2 },
  Relic: { id: 'Relic', name: 'Relic', manaCost: {}, types: [CARD_TYPE.ARTIFACT] },
  Draw: spell('Draw', [{ type: EFFECT.DRAW_CARDS, count: 2 }]),
  Saprolings: spell('Saprolings', [{ type: EFFECT.CREATE_TOKEN, count: 3, token: { colors: ['green'], subtypes: ['Saproling'], power: 1, toughness: 1 } }]),
  Hoard: spell('Hoard', [{ type: EFFECT.CREATE_TOKEN, count: 3, token: TOKEN.TREASURE }]),
  // Draws first, so the hand is full again when the creature comes back.
  Bounce: spell('Bounce', [{ type: EFFECT.DRAW_CARDS, count: 1 }, { type: EFFECT.RETURN_TO_HAND }], { target: TARGET.CREATURE }),
};

/** p1 in their first main phase, with `hand` as the opening hand and `limits`. */
function setup(hand, limits = GAME_LIMITS, library = []) {
  const deck = [...hand, ...library, ...Array(30).fill('forest')];
  const game = new Game({
    players, cards: CARDS, shuffleLibraries: false, emblems: { p1: [], p2: [] }, decks: { p1: deck, p2: deck }, limits,
  });
  const events = [];
  game.onAny((name, payload) => events.push({ name, payload }));
  game.start();
  passRound(game);
  return { game, events };
}

const state = (game) => game.getState();
const p1 = (game) => state(game).players[0];
const castable = (game, name) => state(game).validActions
  .some((a) => a.type === ACTION.CAST_SPELL && p1(game).hand.find((c) => c.id === a.cardId)?.name === name);

function passRound(game) {
  for (let i = 0; i < 2; i++) assert.deepEqual(game.dispatch(passPriority(state(game).priorityPlayerId)), { ok: true });
}

function cast(game, name, targets) {
  const card = p1(game).hand.find((c) => c.name === name);
  assert.deepEqual(game.dispatch(castSpell('p1', card.id, targets)), { ok: true }, `cast ${name}`);
  passRound(game);
}

test('a card drawn into a full hand is burned', () => {
  // 7 cards in hand after casting Draw: 6 left + 2 drawn = 8, so the second is burned.
  const { game, events } = setup(['Draw', 'Bear', 'Bear', 'Bear', 'Bear', 'Bear', 'Bear'], GAME_LIMITS, ['Relic', 'Relic']);
  cast(game, 'Draw');
  assert.equal(p1(game).hand.length, 7);
  const burned = events.filter((e) => e.name === 'cardBurned');
  assert.equal(burned.length, 1);
  assert.equal(burned[0].payload.reason, 'draw');
  assert.equal(burned[0].payload.cardName, 'Relic');
  assert.ok(p1(game).graveyard.some((c) => c.id === burned[0].payload.cardId));
  // Without limits, nothing burns.
  const free = setup(['Draw', 'Bear', 'Bear', 'Bear', 'Bear', 'Bear', 'Bear'], {}, ['Relic', 'Relic']);
  cast(free.game, 'Draw');
  assert.equal(p1(free.game).hand.length, 8);
});

test('a creature returned to a full hand is burned', () => {
  const { game, events } = setup(['Bear', 'Bounce', 'Draw'], { hand: 3 });
  assert.deepEqual(p1(game).hand.map((c) => c.name), ['Bear', 'Bounce', 'Draw']); // the rest of the 7 burned
  cast(game, 'Bear');
  cast(game, 'Draw');
  assert.equal(p1(game).hand.length, 3);
  const bear = state(game).battlefield.find((p) => p.name === 'Bear');
  cast(game, 'Bounce', [bear.id]);
  assert.equal(events.filter((e) => e.name === 'cardBurned').at(-1).payload.reason, 'returnToHand');
  assert.ok(p1(game).graveyard.some((c) => c.id === bear.id));
  assert.ok(!p1(game).hand.some((c) => c.id === bear.id));
});

test('creature and other permanent spells stop at their caps', () => {
  const { game } = setup(['Bear', 'Bear', 'Bear', 'Relic', 'Relic'], { creatures: 2, permanents: 1 });
  cast(game, 'Bear');
  // A creature spell on the stack counts too.
  const second = p1(game).hand.find((c) => c.name === 'Bear');
  game.dispatch(castSpell('p1', second.id));
  assert.equal(game.getState().priorityPlayerId, 'p1');
  assert.ok(!castable(game, 'Bear'));
  passRound(game);
  assert.ok(castable(game, 'Relic'));
  cast(game, 'Relic');
  assert.ok(!castable(game, 'Relic'));
  assert.ok(!castable(game, 'Bear'));
});

test('token creation stops at the caps', () => {
  const { game, events } = setup(['Saprolings', 'Hoard'], { creatures: 2, permanents: 2 });
  cast(game, 'Saprolings');
  cast(game, 'Hoard');
  const mine = state(game).battlefield.filter((p) => p.controllerId === 'p1');
  assert.equal(mine.filter((p) => p.name.includes('Saproling')).length, 2);
  assert.equal(mine.filter((p) => p.name === 'Treasure').length, 2);
  assert.deepEqual(events.filter((e) => e.name === 'tokensLimited').map((e) => e.payload.count), [1, 1]);
});

test('snapshots and clones keep the limits', () => {
  const { game } = setup(['Bear', 'Bear'], { creatures: 1 });
  cast(game, 'Bear');
  for (const copy of [game.clone(), Game.deserialize(game.serialize())]) {
    assert.ok(!copy.getState().validActions.some((a) => a.type === ACTION.CAST_SPELL));
  }
  assert.deepEqual(game.getPlayerView('p2').limits, { creatures: 1 });
});

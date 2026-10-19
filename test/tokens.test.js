import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, ACTION, CARD_TYPE, EFFECT, TOKEN, TOKENS, GAME_STATUS,
  passPriority, castSpell, activateAbility, BasicAIController,
} from '../src/index.js';

const players = [{ id: 'p1' }, { id: 'p2' }];

// Free test cards.
const spell = (id, effects) => ({ id, name: id, manaCost: {}, types: [CARD_TYPE.SORCERY], effects });
const CARDS = {
  Hoard: spell('Hoard', [{ type: EFFECT.CREATE_TOKEN, count: 2, token: TOKEN.TREASURE }]),
  Picnic: spell('Picnic', [{ type: EFFECT.CREATE_TOKEN, count: 1, token: TOKEN.FOOD }]),
  Investigate: spell('Investigate', [{ type: EFFECT.CREATE_TOKEN, count: 1, token: TOKEN.CLUE }]),
  Ritual: spell('Ritual', [{ type: EFFECT.ADD_MANA, mana: { G: 3 } }]),
  Big: { id: 'Big', name: 'Big', manaCost: { R: 1 }, types: [CARD_TYPE.CREATURE], power: 3, toughness: 3 },
  Sleuth: {
    id: 'Sleuth', name: 'Sleuth', manaCost: {}, types: [CARD_TYPE.ARTIFACT],
    abilities: [{
      id: 'clue', text: '{T}: Create a Clue token.', cost: { tap: true },
      effects: [{ type: EFFECT.CREATE_TOKEN, count: 1, token: TOKEN.CLUE }],
    }],
  },
};

/** p1 is in their first main phase with `hand` as their opening hand. */
function setup(hand) {
  const deck = [...hand, ...Array(40 - hand.length).fill('forest')];
  const game = new Game({
    players, cards: CARDS, shuffleLibraries: false, emblems: { p1: [], p2: [] }, decks: { p1: deck, p2: deck },
  });
  const events = [];
  game.onAny((name, payload) => events.push({ name, payload }));
  game.start();
  passRound(game);
  return { game, events };
}

const state = (game) => game.getState();
const p1 = (game) => state(game).players[0];
const named = (game, name) => state(game).battlefield.filter((p) => p.name === name);
const inHand = (game, name) => p1(game).hand.find((c) => c.name === name).id;
const abilityActions = (game, cardId) => state(game).validActions
  .filter((a) => a.type === ACTION.ACTIVATE_ABILITY && a.cardId === cardId);

function passRound(game) {
  for (let i = 0; i < 2; i++) assert.deepEqual(game.dispatch(passPriority(state(game).priorityPlayerId)), { ok: true });
}

function cast(game, name) {
  assert.deepEqual(game.dispatch(castSpell('p1', inHand(game, name))), { ok: true }, `cast ${name}`);
  passRound(game);
}

test('Treasure, Food and Clue tokens are colorless artifacts with their abilities', () => {
  const { game, events } = setup(['Hoard', 'Picnic', 'Investigate']);
  cast(game, 'Hoard');
  cast(game, 'Picnic');
  cast(game, 'Investigate');
  for (const [token, count] of [[TOKEN.TREASURE, 2], [TOKEN.FOOD, 1], [TOKEN.CLUE, 1]]) {
    const permanents = named(game, TOKENS[token].name);
    assert.equal(permanents.length, count, token);
    for (const permanent of permanents) {
      assert.deepEqual(
        [permanent.token, permanent.types, permanent.subtypes, permanent.colors, permanent.ownerId, permanent.text],
        [true, ['Artifact'], [TOKENS[token].name], [], 'p1', TOKENS[token].text],
      );
      assert.equal(permanent.power, undefined); // not creatures
      assert.deepEqual(permanent.abilities.map((a) => a.text), TOKENS[token].abilities.map((a) => a.text));
    }
  }
  assert.equal(events.filter((e) => e.name === 'tokenCreated').length, 4);
});

test('a Treasure offers one mana ability action per color and adds the chosen one', () => {
  const { game, events } = setup(['Hoard', 'Big']);
  cast(game, 'Hoard');
  const [treasure, other] = named(game, 'Treasure');
  // Artifacts aren't affected by summoning sickness, so it works right away.
  assert.deepEqual(abilityActions(game, treasure.id).map((a) => a.manaColor), ['W', 'U', 'B', 'R', 'G']);
  assert.deepEqual(game.dispatch(activateAbility('p1', treasure.id, 'treasureMana', undefined, undefined, 'R')), { ok: true });
  // A mana ability: no stack, the player keeps priority.
  assert.deepEqual(state(game).stack, []);
  assert.equal(state(game).priorityPlayerId, 'p1');
  assert.equal(p1(game).manaPool.R, 1);
  // It was sacrificed, and as a token it doesn't go to the graveyard.
  assert.deepEqual(named(game, 'Treasure').map((t) => t.id), [other.id]);
  assert.equal(p1(game).graveyard.some((c) => c.token), false);
  assert.deepEqual(events.find((e) => e.name === 'abilityActivated').payload.costPaid, { tap: true, sacrificed: [treasure.id] });
  // The red mana pays for a red spell.
  cast(game, 'Big');
  assert.equal(named(game, 'Big').length, 1);
  // A mana color is required.
  assert.equal(game.dispatch(activateAbility('p1', other.id, 'treasureMana')).ok, false);
});

test('a Clue costs {2} and sacrifice to draw a card, using the stack', () => {
  const { game } = setup(['Investigate', 'Ritual']);
  cast(game, 'Investigate');
  const [clue] = named(game, 'Clue');
  assert.deepEqual(abilityActions(game, clue.id), []); // no mana yet
  cast(game, 'Ritual');
  const handBefore = p1(game).hand.length;
  assert.deepEqual(game.dispatch(activateAbility('p1', clue.id, 'investigate')), { ok: true });
  assert.equal(state(game).stack.length, 1);
  assert.equal(named(game, 'Clue').length, 0);
  passRound(game);
  assert.equal(p1(game).hand.length, handBefore + 1);
  assert.equal(p1(game).manaPool.G, 1);
});

test('a Food costs {2}, {T} and sacrifice to gain 3 life', () => {
  const { game } = setup(['Picnic', 'Ritual']);
  cast(game, 'Picnic');
  cast(game, 'Ritual');
  const [food] = named(game, 'Food');
  assert.deepEqual(game.dispatch(activateAbility('p1', food.id, 'eat')), { ok: true });
  passRound(game);
  assert.equal(p1(game).life, 23);
  assert.equal(named(game, 'Food').length, 0);
});

test('abilities can create these tokens too', () => {
  const { game } = setup(['Sleuth']);
  cast(game, 'Sleuth');
  const [sleuth] = named(game, 'Sleuth');
  assert.deepEqual(game.dispatch(activateAbility('p1', sleuth.id, 'clue')), { ok: true });
  passRound(game);
  assert.equal(named(game, 'Clue').length, 1);
});

test('an unknown token name is an error in the card data', () => {
  const game = new Game({
    players,
    cards: { Oops: spell('Oops', [{ type: EFFECT.CREATE_TOKEN, count: 1, token: 'gold' }]) },
    shuffleLibraries: false,
    emblems: { p1: [], p2: [] },
    decks: { p1: ['Oops', ...Array(39).fill('forest')] },
  });
  game.start();
  passRound(game);
  game.dispatch(castSpell('p1', 'p1-1'));
  game.dispatch(passPriority('p1'));
  assert.throws(() => game.dispatch(passPriority('p2')), /Unknown token: gold/);
});

test('two basic AIs play a full game with Treasures, Food and Clues', () => {
  const tokenMaker = (id, token) => ({
    id, name: id, manaCost: { G: 1 }, types: [CARD_TYPE.SORCERY],
    effects: [{ type: EFFECT.CREATE_TOKEN, count: 2, token }],
  });
  const cards = {
    hoard: tokenMaker('hoard', TOKEN.TREASURE), picnic: tokenMaker('picnic', TOKEN.FOOD), clues: tokenMaker('clues', TOKEN.CLUE),
  };
  const deck = [...Array(16).fill('forest'), ...Array(12).fill('llanowarElves'), ...['hoard', 'picnic', 'clues'].flatMap((id) => Array(4).fill(id))];
  const game = new Game({ players, seed: 3, cards, decks: { p1: deck, p2: deck } });
  const seen = new Set();
  game.onAny((name, payload) => {
    seen.add(name);
    if (name === 'abilityActivated') seen.add(`activated:${payload.cardName}`);
  });
  for (const { id } of players) new BasicAIController({ game, playerId: id, delayMs: null });
  game.start();
  assert.equal(state(game).status, GAME_STATUS.GAME_OVER);
  assert.ok(!seen.has('actionRejected'));
  for (const name of ['activated:Treasure', 'activated:Clue']) assert.ok(seen.has(name), name);
});

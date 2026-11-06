// When the AIs cast instants and permanents with flash: at the last moment they're needed, never in
// their own main phase (src/ai/timing.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, PHASE, STEP, ACTION, BasicAIController, passPriority,
} from '../src/index.js';
import { listMacros } from '../src/ai/macroActions.js';

const players = [{ id: 'p1' }, { id: 'p2' }];
const CARDS = {
  bear: { id: 'bear', name: 'Bear', manaCost: { generic: 1 }, types: ['Creature'], power: 2, toughness: 2 },
  ox: { id: 'ox', name: 'Ox', manaCost: { generic: 1 }, types: ['Creature'], power: 1, toughness: 4 },
  zap: { id: 'zap', name: 'Zap', manaCost: { generic: 1 }, types: ['Instant'], target: 'any', effects: [{ type: 'dealDamage', amount: 2 }] },
  salve: { id: 'salve', name: 'Salve', manaCost: { generic: 1 }, types: ['Instant'], effects: [{ type: 'gainLife', amount: 3 }] },
  ambusher: { id: 'ambusher', name: 'Ambusher', manaCost: { generic: 1 }, types: ['Creature'], keywords: ['flash'], power: 3, toughness: 3 },
};

/**
 * A game where p2 cast `p2Board` on turn 1 and it's now p1's turn 2 main phase with `p1Hand`
 * (infinite mana, no libraries, as in Pai Gow).
 */
function setup({ p1Hand, p2Board = [], p2Life }) {
  const game = new Game({
    players, cards: CARDS, shuffleLibraries: false, emblems: { p1: [], p2: [] }, startingPlayerId: 'p2',
    decks: { p1: p1Hand, p2: p2Board }, openingHandSize: 3, deckingLoss: false, infiniteMana: true,
    ...(p2Life ? { startingLife: { p2: p2Life } } : {}),
  });
  game.start();
  passTo(game, (s) => s.activePlayerId === 'p2' && s.phase === PHASE.PRECOMBAT_MAIN);
  for (const cardId of p2Board) {
    const card = game.getState().players[1].hand.find((c) => c.cardId === cardId);
    assert.equal(game.dispatch({ type: ACTION.CAST_SPELL, playerId: 'p2', cardId: card.id }).ok, true);
    passTo(game, (s) => s.stack.length === 0);
  }
  passTo(game, (s) => s.activePlayerId === 'p1' && s.phase === PHASE.PRECOMBAT_MAIN);
  return game;
}

/** Passes (or confirms empty declarations) until `until(state)`. */
function passTo(game, until) {
  for (let i = 0; i < 200; i++) {
    const s = game.getState();
    if (until(s)) return s;
    const actor = s.pendingDecision?.playerId ?? s.priorityPlayerId;
    const mine = s.validActions.filter((a) => a.playerId === actor);
    game.dispatch(mine.find((a) => a.type === ACTION.PASS_PRIORITY) ?? mine.find((a) => a.type.startsWith('CONFIRM')) ?? mine[0]);
  }
  throw new Error('never got there');
}

/**
 * Lets the basic AI play p1 (and p2 pass, or attack with everything when `p2Attacks`) until p1 casts a
 * spell; returns the state then and the cast, or null if it never does by `maxTurn`.
 */
function firstCast(game, { p2Attacks = false, maxTurn = 4 } = {}) {
  const ai = new BasicAIController({ game: null, playerId: 'p1' });
  for (let i = 0; i < 400; i++) {
    const s = game.getState();
    if (s.turn > maxTurn) return null;
    const actor = s.pendingDecision?.playerId ?? s.priorityPlayerId;
    let action;
    if (actor === 'p1') {
      action = ai.chooseAction(s);
      if (action?.type === ACTION.CAST_SPELL) return { state: s, action };
    } else {
      const mine = s.validActions.filter((a) => a.playerId === actor);
      const toggle = p2Attacks && s.pendingDecision?.type === 'declareAttackers'
        && mine.find((a) => a.type === ACTION.TOGGLE_ATTACKER && !s.pendingDecision.attackers.includes(a.cardId));
      action = toggle || mine.find((a) => a.type === ACTION.PASS_PRIORITY) || mine.find((a) => a.type.startsWith('CONFIRM')) || mine[0];
    }
    game.dispatch(action);
  }
  return null;
}

const castsIn = (state, cardId) => listMacros(state, 'p1').filter((m) => m.kind === 'cast'
  && state.players[0].hand.find((c) => c.id === m.cardId)?.cardId === cardId);

test('removal waits for the start of combat, not the main phase', () => {
  const game = setup({ p1Hand: ['bear', 'zap'], p2Board: ['bear'] });
  const theirBear = game.getState().battlefield.find((p) => p.controllerId === 'p2').id;
  assert.deepEqual(castsIn(game.getState(), 'zap'), [], 'the search AI keeps it in the main phase');
  const { state, action } = firstCast(game);
  // Its own Bear first, at sorcery speed.
  assert.equal(state.phase, PHASE.PRECOMBAT_MAIN);
  game.dispatch(action);
  passTo(game, (s) => s.stack.length === 0 && s.priorityPlayerId === 'p1');
  const zap = firstCast(game);
  assert.equal(zap.state.step, STEP.BEGINNING_OF_COMBAT);
  assert.deepEqual(zap.action.targets, [theirBear]);
  assert.equal(castsIn(zap.state, 'zap').length > 0, true, 'the search AI considers it then');
});

test('a creature with flash waits to ambush an attacker', () => {
  const game = setup({ p1Hand: ['ambusher'], p2Board: ['bear'] });
  assert.deepEqual(castsIn(game.getState(), 'ambusher'), []);
  const cast = firstCast(game, { p2Attacks: true });
  assert.equal(cast.state.activePlayerId, 'p2');
  assert.equal(cast.state.step, STEP.DECLARE_ATTACKERS);
  assert.ok(cast.state.combat.attackers.length > 0);
});

test('a creature with flash comes in at the end of the opponent\'s turn when nobody attacks', () => {
  const game = setup({ p1Hand: ['ambusher'] });
  const cast = firstCast(game);
  assert.equal(cast.state.activePlayerId, 'p2');
  assert.equal(cast.state.step, STEP.END);
});

test('other instants wait for the end of the opponent\'s turn', () => {
  const game = setup({ p1Hand: ['salve'] });
  assert.deepEqual(castsIn(game.getState(), 'salve'), []);
  const cast = firstCast(game);
  assert.equal(cast.state.activePlayerId, 'p2');
  assert.equal(cast.state.step, STEP.END);
  assert.equal(castsIn(cast.state, 'salve').length, 1);
});

test('burn that wins the game is cast at once', () => {
  const game = setup({ p1Hand: ['zap'], p2Board: ['ox'], p2Life: 2 });
  const { state, action } = firstCast(game);
  assert.equal(state.phase, PHASE.PRECOMBAT_MAIN);
  assert.deepEqual(action.targets, ['p2']);
  assert.deepEqual(castsIn(state, 'zap').map((m) => m.targetId), ['p2']);
});

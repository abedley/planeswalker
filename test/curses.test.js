// Curse Auras: the AI puts them on the opponent's creatures, never its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, PHASE, ACTION, CARDS, isCurse, BasicAIController, passPriority } from '../src/index.js';
import { listMacros } from '../src/ai/macroActions.js';
import { creatureValue } from '../src/ai/combat.js';

const players = [{ id: 'p1' }, { id: 'p2' }];
const BEAR = { id: 'bear', name: 'Bear', manaCost: {}, types: ['Creature'], power: 2, toughness: 2 };

/** p1's main phase with a Bear on each side (or only p1's, `theirBear: false`) and Bewitching Leechcraft in p1's hand. */
function setup({ theirBear = true } = {}) {
  const game = new Game({
    players, cards: { bear: BEAR }, shuffleLibraries: false, emblems: { p1: [], p2: [] }, startingPlayerId: 'p2',
    decks: { p1: ['bear', 'bewitchingLeechcraft'], p2: theirBear ? ['bear'] : [] },
    openingHandSize: 3, deckingLoss: false, infiniteMana: true,
  });
  game.start();
  const castBear = (playerId) => {
    const state = game.getState();
    const bear = state.players.find((p) => p.id === playerId).hand.find((c) => c.cardId === 'bear');
    assert.equal(game.dispatch({ type: ACTION.CAST_SPELL, playerId, cardId: bear.id }).ok, true);
    while (game.getState().stack.length) game.dispatch(passPriority(game.getState().priorityPlayerId));
  };
  const toMain = (playerId) => {
    for (let i = 0; i < 100; i++) {
      const s = game.getState();
      if (s.activePlayerId === playerId && s.phase === PHASE.PRECOMBAT_MAIN && s.priorityPlayerId === playerId && !s.stack.length) return;
      const actor = s.pendingDecision?.playerId ?? s.priorityPlayerId;
      const mine = s.validActions.filter((a) => a.playerId === actor);
      game.dispatch(mine.find((a) => a.type === ACTION.PASS_PRIORITY) ?? mine.find((a) => a.type.startsWith('CONFIRM')) ?? mine[0]);
    }
    throw new Error('never reached the main phase');
  };
  toMain('p2');
  if (theirBear) castBear('p2');
  toMain('p1');
  castBear('p1');
  const state = game.getState();
  const leechcraft = state.players[0].hand.find((c) => c.cardId === 'bewitchingLeechcraft').id;
  const bearOf = (id) => state.battlefield.find((p) => p.controllerId === id && p.cardId === 'bear')?.id;
  return { game, leechcraft, mine: bearOf('p1'), theirs: bearOf('p2') };
}

test('Bewitching Leechcraft is a curse', () => {
  assert.equal(isCurse(CARDS.bewitchingLeechcraft), true);
  assert.equal(isCurse(CARDS.oakenform), false);
});

test('a creature that stays tapped is worth little, unless it has +1/+1 counters to untap with', () => {
  const bear = { ...BEAR, keywords: [] };
  const stuck = { ...bear, keywords: ['untaps only by removing a +1/+1 counter'] };
  assert.ok(creatureValue(stuck) < creatureValue(bear) / 3);
  assert.equal(creatureValue({ ...stuck, counters: { '+1/+1': 1 } }), creatureValue({ ...bear, counters: { '+1/+1': 1 } }));
});

test("the basic AI casts Bewitching Leechcraft on the opponent's creature, not its own", () => {
  const { game, leechcraft, theirs } = setup();
  const action = new BasicAIController({ game: null, playerId: 'p1' }).chooseAction(game.getState());
  assert.equal(action.type, ACTION.CAST_SPELL);
  assert.equal(action.cardId, leechcraft);
  assert.deepEqual(action.targets, [theirs]);
});

test('with only its own creature, the basic AI keeps Bewitching Leechcraft', () => {
  const { game, leechcraft } = setup({ theirBear: false });
  const ai = new BasicAIController({ game: null, playerId: 'p1' });
  const action = ai.chooseAction(game.getState());
  assert.ok(!(action.type === ACTION.CAST_SPELL && action.cardId === leechcraft), JSON.stringify(action));
});

test("the search AI only considers Bewitching Leechcraft on the opponent's creature", () => {
  for (const theirBear of [true, false]) {
    const { game, leechcraft, theirs } = setup({ theirBear });
    const casts = listMacros(game.getState(), 'p1').filter((m) => m.kind === 'cast' && m.cardId === leechcraft);
    assert.deepEqual(casts.map((m) => m.targetId), theirBear ? [theirs] : []);
  }
});

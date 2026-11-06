import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, GAME_STATUS, DECISION, INFINITE_MANA_MAX_X,
} from '../src/engine/Game.js';
import { ACTION, passPriority } from '../src/engine/actions.js';
import { CARDS } from '../src/cards/cards.js';
import { BasicAIController } from '../src/ai/BasicAIController.js';
import { AI_ACTIVATIONS_PER_TURN } from '../src/ai/manaPlanning.js';
import { playout } from '../src/ai/simulate.js';
import { CAMPAIGN } from '../src/campaign/realCampaign.js';
import {
  PAIGOW_POOL, POOL_BY_RARITY, PAIGOW_RULES, openBooster, createMatch, setDecks, validDecks, recordRound, roundSetup, nextRound, outcome, score,
  arrangeCpuDecks, playerStartsRound, ROUND_RESULT, MATCH_OUTCOME, PLAYER_ID, CPU_ID,
} from '../src/paigow/paigow.js';
import { seededRandom } from '../src/engine/random.js';
import { outOfActions, canFastForward, planFastForward } from '../src/paigow/fastForward.js';

const players = [{ id: 'p1' }, { id: 'p2' }];
const VARIANT = { openingHandSize: 3, deckingLoss: false, infiniteMana: true, emblems: { p1: [], p2: [] } };
const BEAR = { id: 'bear', name: 'Bear', manaCost: { generic: 1 }, types: ['Creature'], power: 2, toughness: 2 };

function newGame(decks, options = {}) {
  const game = new Game({ players, decks, shuffleLibraries: false, cards: { bear: BEAR }, ...VARIANT, ...options });
  game.start();
  return game;
}

/** Passes priority (and takes the first option of any decision) until `until(state)` or the game ends. */
function passUntil(game, until, maxSteps = 2000) {
  for (let i = 0; i < maxSteps; i++) {
    const state = game.getState();
    if (state.status !== GAME_STATUS.IN_PROGRESS || until(state)) return state;
    const actor = state.pendingDecision?.playerId ?? state.priorityPlayerId;
    const mine = state.validActions.filter((a) => a.playerId === actor);
    const action = mine.find((a) => a.type === ACTION.PASS_PRIORITY)
      ?? mine.find((a) => a.type === ACTION.CONFIRM_ATTACKERS || a.type === ACTION.CONFIRM_BLOCKERS)
      ?? mine[0];
    assert.equal(game.dispatch(action).ok, true);
  }
  throw new Error('Too many steps.');
}

const mainPhase = (playerId) => (s) => s.activePlayerId === playerId && s.phase === 'precombatMain' && s.priorityPlayerId === playerId;

test('the opening hand can be the whole deck, and drawing from an empty library loses nothing', () => {
  const game = newGame({ p1: ['bear', 'bear', 'bear'], p2: ['bear', 'bear', 'bear'] });
  let state = game.getState();
  assert.equal(state.players[0].hand.length, 3);
  assert.equal(state.players[0].library.length, 0);
  // p2's draw step, then p1's: both draw from an empty library.
  state = passUntil(game, (s) => s.turn === 3 && mainPhase('p1')(s));
  assert.equal(state.status, GAME_STATUS.IN_PROGRESS);
  assert.ok(state.players.every((p) => !p.hasLost));
});

test('decking still loses by default', () => {
  const game = new Game({ players, decks: { p1: ['bear'], p2: ['bear'] }, cards: { bear: BEAR }, emblems: { p1: [], p2: [] } });
  game.start();
  const state = passUntil(game, () => false);
  assert.equal(state.status, GAME_STATUS.GAME_OVER);
  assert.equal(state.endReason, 'playerLost');
});

test('infinite mana pays colored, hybrid and {X} costs, and abilities as often as you like', () => {
  const game = newGame({ p1: ['goblinFireleaper', 'fearFireFoes', 'frodoSauronsBane'], p2: ['bear', 'bear', 'bear'] });
  const state = passUntil(game, mainPhase('p1'));
  assert.equal(state.infiniteMana, true);
  const casts = state.validActions.filter((a) => a.type === ACTION.CAST_SPELL);
  const hand = Object.fromEntries(state.players[0].hand.map((c) => [c.cardId, c.id]));
  assert.ok(casts.some((a) => a.cardId === hand.goblinFireleaper));
  assert.ok(casts.some((a) => a.cardId === hand.frodoSauronsBane));

  for (const cardId of [hand.goblinFireleaper, hand.frodoSauronsBane]) {
    assert.equal(game.dispatch({ type: ACTION.CAST_SPELL, playerId: 'p1', cardId }).ok, true);
    passUntil(game, (s) => s.stack.length === 0 && s.priorityPlayerId === 'p1');
  }
  // {X}, now that there's a creature to aim it at: up to INFINITE_MANA_MAX_X.
  const xs = game.getState().validActions.filter((a) => a.type === ACTION.CAST_SPELL && a.cardId === hand.fearFireFoes).map((a) => a.x);
  assert.equal(Math.max(...xs), INFINITE_MANA_MAX_X);
  // Frodo's hybrid {W/B}{W/B} ability.
  assert.ok(game.getState().validActions.some((a) => a.type === ACTION.ACTIVATE_ABILITY && a.cardId === hand.frodoSauronsBane));
  // Goblin Fireleaper's pump, more times than the AI would bother with: no rule stops it.
  const times = AI_ACTIVATIONS_PER_TURN + 3;
  for (let i = 0; i < times; i++) {
    const pump = game.getState().validActions.find((a) => a.type === ACTION.ACTIVATE_ABILITY && a.cardId === hand.goblinFireleaper);
    assert.ok(pump, `activation ${i + 1}`);
    game.dispatch(pump);
    passUntil(game, (s) => s.stack.length === 0 && s.priorityPlayerId === 'p1');
  }
  const goblin = game.getState().battlefield.find((p) => p.id === hand.goblinFireleaper);
  assert.equal(goblin.power, 1 + times);
  assert.deepEqual(game.getState().players[0].manaPool, { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, any: 999 });
});

test('a full turn cycle with nothing changed is a draw', () => {
  const game = newGame({ p1: ['bear'], p2: ['bear'] }, { stallDraw: true });
  // Turn 1: p1 casts its Bear; turn 2: p2 casts its Bear; then neither attacks into the other.
  const state = passUntil(game, () => false);
  assert.equal(state.status, GAME_STATUS.GAME_OVER);
  assert.equal(state.winnerId, null);
  assert.equal(state.endReason, 'stall');
  assert.equal(state.turn, 3);
});

test('a board that keeps changing is no stall', () => {
  const game = newGame({ p1: ['bear'], p2: [] }, { stallDraw: true, startingLife: { p1: 5, p2: 5 } });
  const ais = { p1: new BasicAIController({ game: null, playerId: 'p1' }), p2: new BasicAIController({ game: null, playerId: 'p2' }) };
  const state = playout(game, { p1: (s) => ais.p1.chooseAction(s), p2: (s) => ais.p2.chooseAction(s) });
  assert.equal(state.winnerId, 'p1');
  assert.equal(state.endReason, 'playerLost');
});

test('the turn limit ends the game in a draw', () => {
  const game = newGame({ p1: [], p2: [] }, { turnLimit: 4 });
  const state = passUntil(game, () => false);
  assert.equal(state.endReason, 'turnLimit');
  assert.equal(state.winnerId, null);
  assert.equal(state.turn, 4);
});

test('the variant rules survive clone() and serialize()', () => {
  const game = newGame({ p1: ['goblinFireleaper'], p2: [] }, { stallDraw: true, turnLimit: 9 });
  passUntil(game, mainPhase('p1'));
  for (const copy of [game.clone(), Game.deserialize(game.serialize())]) {
    const state = copy.getState();
    assert.equal(state.infiniteMana, true);
    assert.ok(state.validActions.some((a) => a.type === ACTION.CAST_SPELL));
    const end = passUntil(copy, () => false);
    assert.equal(end.endReason, 'stall');
  }
});

test('the AI stops pumping after a few activations and finishes its turn', () => {
  const game = newGame({ p1: ['goblinFireleaper'], p2: [] }, { stallDraw: true, turnLimit: 40 });
  const ais = { p1: new BasicAIController({ game: null, playerId: 'p1' }), p2: new BasicAIController({ game: null, playerId: 'p2' }) };
  let most = 0;
  const state = playout(game, {
    p1: (s) => {
      most = Math.max(most, ...Object.values(s.players[0].turnTally.activations ?? {}), 0);
      return ais.p1.chooseAction(s);
    },
    p2: (s) => ais.p2.chooseAction(s),
  }, { maxSteps: 5000 });
  assert.equal(state.status, GAME_STATUS.GAME_OVER);
  assert.equal(state.winnerId, 'p1');
  assert.ok(most <= AI_ACTIVATIONS_PER_TURN, `activated ${most} times`);
});

test('the pool is every LTR card in the game', () => {
  assert.ok(PAIGOW_POOL.length > 240);
  assert.ok(PAIGOW_POOL.every((id) => CARDS[id].set === 'ltr'));
  assert.equal(Object.values(POOL_BY_RARITY).flat().length, PAIGOW_POOL.length);
});

test('a booster: 10 different commons, 3 different uncommons, a rare or mythic, and any LTR card', () => {
  const rarity = (id) => CARDS[id].rarity;
  const wildcards = new Map();
  let mythics = 0;
  const packs = 3000;
  for (let seed = 1; seed <= packs; seed++) {
    const pack = openBooster(seededRandom(seed));
    assert.equal(pack.length, 15);
    const commons = pack.slice(0, 10);
    const uncommons = pack.slice(10, 13);
    assert.ok(commons.every((id) => rarity(id) === 'common'));
    assert.equal(new Set(commons).size, 10);
    assert.ok(uncommons.every((id) => rarity(id) === 'uncommon'));
    assert.equal(new Set(uncommons).size, 3);
    assert.ok(['rare', 'mythic'].includes(rarity(pack[13])));
    if (rarity(pack[13]) === 'mythic') mythics += 1;
    assert.ok(PAIGOW_POOL.includes(pack[14]));
    wildcards.set(pack[14], (wildcards.get(pack[14]) ?? 0) + 1);
  }
  // Each rare twice as likely as each mythic: about one mythic in seven packs.
  const { rare, mythic, common } = POOL_BY_RARITY;
  const expected = mythic.length / (2 * rare.length + mythic.length);
  assert.ok(Math.abs(mythics / packs - expected) < 0.025, `mythics ${mythics / packs} vs ${expected}`);
  // The wildcard: every card equally likely, so its rarities follow the pool's.
  const wildCommons = [...wildcards].filter(([id]) => rarity(id) === 'common').reduce((sum, [, n]) => sum + n, 0);
  assert.ok(Math.abs(wildCommons / packs - common.length / PAIGOW_POOL.length) < 0.03);
  assert.ok(wildcards.size > PAIGOW_POOL.length * 0.9, `${wildcards.size} different wildcards`);
});

test('a match opens a booster for each side and makes five CPU decks of three', () => {
  const match = createMatch(CAMPAIGN, { seed: 42 });
  assert.equal(match.cards.length, PAIGOW_RULES.cardsDealt);
  assert.ok(match.cards.every((id) => PAIGOW_POOL.includes(id)));
  assert.equal(match.cpuDecks.length, 5);
  assert.ok(match.cpuDecks.every((deck) => deck.length === 3));
  assert.equal(match.cpuDecks.flat().length, 15);
  assert.equal(CAMPAIGN.opponents[match.opponentId].ai.kind, 'search');
  assert.deepEqual(createMatch(CAMPAIGN, { seed: 42 }), match);
});

test('a booster with two of a card can still be split into decks', () => {
  const base = createMatch(CAMPAIGN, { seed: 1 });
  const match = { ...base, cards: [...base.cards.slice(0, 14), base.cards[0]] };
  const decks = [0, 1, 2, 3, 4].map((i) => match.cards.slice(i * 3, i * 3 + 3));
  assert.equal(validDecks(match, decks), true);
  const wrong = decks.map((deck) => [...deck]);
  wrong[4][2] = base.cards[1];
  assert.equal(validDecks(match, wrong), false);
});

test('the CPU spreads its strongest cards across its decks', () => {
  const cards = [...PAIGOW_POOL].slice(0, 15);
  const decks = arrangeCpuDecks(cards, seededRandom(1));
  assert.deepEqual(decks.flat().sort(), [...cards].sort());
  assert.ok(decks.every((deck) => deck.length === 3));
});

test('the player must use each card once, in five decks of three', () => {
  const match = createMatch(CAMPAIGN, { seed: 7 });
  const decks = [0, 1, 2, 3, 4].map((i) => match.cards.slice(i * 3, i * 3 + 3));
  assert.equal(validDecks(match, decks), true);
  assert.equal(validDecks(match, [...decks.slice(0, 4), [decks[4][0], decks[4][1], decks[0][0]]]), false);
  assert.equal(validDecks(match, decks.slice(0, 4)), false);
  assert.throws(() => setDecks(match, decks.slice(0, 4)));
  assert.equal(nextRound(match), null);
  assert.equal(nextRound(setDecks(match, decks)), 0);
});

const ready = (seed = 3) => {
  const match = createMatch(CAMPAIGN, { seed });
  return setDecks(match, [0, 1, 2, 3, 4].map((i) => match.cards.slice(i * 3, i * 3 + 3)));
};
const play = (match, results) => results.reduce((m, r) => recordRound(m, r), match);

test('round setups: each deck against its counterpart, the variant rules, and turns to start', () => {
  const match = ready();
  const first = roundSetup(match, CAMPAIGN);
  assert.deepEqual(first.game.decks[PLAYER_ID], match.decks[0]);
  assert.deepEqual(first.game.decks[CPU_ID], match.cpuDecks[0]);
  assert.deepEqual(first.game.startingLife, { [PLAYER_ID]: 5, [CPU_ID]: 5 });
  assert.equal(first.game.openingHandSize, 3);
  assert.equal(first.game.infiniteMana, true);
  assert.equal(first.game.deckingLoss, false);
  assert.equal(first.game.stallDraw, true);
  const second = roundSetup(recordRound(match, ROUND_RESULT.DRAWN), CAMPAIGN);
  assert.deepEqual(second.game.decks[PLAYER_ID], match.decks[1]);
  assert.notEqual(second.game.startingPlayerId, first.game.startingPlayerId);
  assert.equal(playerStartsRound(match, 2), playerStartsRound(match, 0));
  // A real game from it starts.
  const game = new Game(first.game);
  game.start();
  assert.equal(game.getState().players[0].hand.length, 3);
  assert.notEqual(game.getState().pendingDecision?.type, DECISION.MULLIGAN);
});

test('the match ends at three wins, or after five rounds on the most wins', () => {
  const { WON, LOST, DRAWN } = ROUND_RESULT;
  assert.equal(outcome(play(ready(), [WON, WON, WON])), MATCH_OUTCOME.WON);
  assert.equal(outcome(play(ready(), [LOST, WON, LOST, DRAWN, LOST])), MATCH_OUTCOME.LOST);
  assert.equal(outcome(play(ready(), [WON, LOST, LOST, LOST])), MATCH_OUTCOME.LOST);
  assert.equal(outcome(play(ready(), [WON, DRAWN, LOST, WON, DRAWN])), MATCH_OUTCOME.WON);
  assert.equal(outcome(play(ready(), [WON, DRAWN, LOST, DRAWN, DRAWN])), MATCH_OUTCOME.TIE);
  assert.equal(outcome(play(ready(), [WON, DRAWN, LOST, DRAWN])), null);
  assert.deepEqual(score(play(ready(), [WON, DRAWN, LOST])), { won: 1, lost: 1, drawn: 1 });
  assert.throws(() => recordRound(play(ready(), [WON, WON, WON]), WON));
});

// Fast forward.

const RELIC = { id: 'relic', name: 'Relic', manaCost: {}, types: ['Artifact'], abilities: [{ id: 'life', text: '{1}: You gain 1 life.', cost: { mana: { generic: 1 } }, effect: { type: 'gainLife', amount: 1 } }] };
const ROCK = { id: 'rock', name: 'Rock', manaCost: {}, types: ['Artifact'], abilities: [{ id: 'mana', text: '{T}: Add {C}.', cost: { tap: true }, effect: { type: 'addMana', mana: { C: 1 } } }] };

/** A game where p1 has cast `p1Plays` (and kept the rest of `p1`) and p2 has nothing, in p1's main phase. */
function ffGame(p1, p1Plays = p1, p2 = []) {
  const game = new Game({
    players, decks: { p1, p2 }, shuffleLibraries: false, cards: { bear: BEAR, relic: RELIC, rock: ROCK }, ...VARIANT, stallDraw: true, turnLimit: 40,
  });
  game.start();
  passUntil(game, mainPhase('p1'));
  for (const cardId of p1Plays) {
    const card = game.getState().players[0].hand.find((c) => c.cardId === cardId);
    assert.equal(game.dispatch({ type: ACTION.CAST_SPELL, playerId: 'p1', cardId: card.id }).ok, true);
    passUntil(game, (s) => s.stack.length === 0 && s.priorityPlayerId === 'p1');
  }
  return game;
}

test('a player is out of actions with no hand, no creatures and no abilities but mana abilities', () => {
  assert.equal(outOfActions(ffGame(['bear'], []).getState(), 'p1'), false, 'a card in hand');
  assert.equal(outOfActions(ffGame(['bear']).getState(), 'p1'), false, 'a creature');
  assert.equal(outOfActions(ffGame(['relic']).getState(), 'p1'), false, 'an ability');
  assert.equal(outOfActions(ffGame(['rock']).getState(), 'p1'), true, 'only a mana ability');
  const game = ffGame(['bear']);
  assert.equal(outOfActions(game.getState(), 'p2'), true);
  assert.equal(canFastForward(game.getState()), true);
  assert.equal(canFastForward(ffGame(['bear'], [], ['bear']).getState()), false);
});

test('fast forward plays out the best line for the side with actions', () => {
  const game = ffGame(['bear']);
  const plan = planFastForward(game);
  assert.equal(plan.winnerId, 'p1');
  assert.equal(plan.endReason, 'playerLost');
  // Replaying it on the real game ends the same way.
  for (const action of plan.actions) assert.equal(game.dispatch(action).ok, true);
  const end = game.getState();
  assert.equal(end.status, GAME_STATUS.GAME_OVER);
  assert.equal(end.winnerId, 'p1');
  assert.equal(end.turn, plan.turns);
});

test('fast forward with nothing on either side is a draw', () => {
  const plan = planFastForward(ffGame(['rock']));
  assert.equal(plan.winnerId, null);
  assert.equal(plan.endReason, 'stall');
});

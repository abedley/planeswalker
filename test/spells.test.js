import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, GAME_STATUS, ACTION, PHASE, STEP, CARD_TYPE, SUBTYPE, TARGET, AFFECTED, EFFECT, KEYWORD,
  passPriority, castSpell, toggleAttacker, confirmAttackers, setBlocker, confirmBlockers,
  BasicAIController, matchesPermanentKind,
} from '../src/index.js';

const players = [{ id: 'p1' }, { id: 'p2' }];

// Free test cards, so tests can focus on timing and effects.
const spell = (id, type, effects, target) => ({
  id, name: id, manaCost: {}, types: [type], effects, ...(target ? { target } : {}),
});
const CARDS = {
  Bear: { id: 'Bear', name: 'Bear', manaCost: {}, types: [CARD_TYPE.CREATURE], power: 2, toughness: 2 },
  Ox: { id: 'Ox', name: 'Ox', manaCost: {}, types: [CARD_TYPE.CREATURE], power: 4, toughness: 4 },
  Shock: spell('Shock', CARD_TYPE.INSTANT, [{ type: EFFECT.DEAL_DAMAGE, amount: 2 }], TARGET.ANY),
  Blaze: spell('Blaze', CARD_TYPE.SORCERY, [{ type: EFFECT.DEAL_DAMAGE, amount: 18 }], TARGET.ANY),
  Growth: spell('Growth', CARD_TYPE.INSTANT, [{ type: EFFECT.PUMP, power: 3, toughness: 3, keywords: [KEYWORD.TRAMPLE] }], TARGET.CREATURE),
  Remedy: spell('Remedy', CARD_TYPE.INSTANT, [{ type: EFFECT.GAIN_LIFE, amount: 3 }]),
  Doom: spell('Doom', CARD_TYPE.SORCERY, [{ type: EFFECT.DESTROY }], TARGET.CREATURE),
  Insight: spell('Insight', CARD_TYPE.SORCERY, [{ type: EFFECT.DRAW_CARDS, count: 2 }]),
  Might: {
    id: 'Might', name: 'Might', manaCost: {}, types: [CARD_TYPE.ENCHANTMENT], subtypes: [SUBTYPE.AURA], enchant: TARGET.CREATURE,
    staticAbilities: [{ affected: AFFECTED.ATTACHED_PERMANENT, power: 2, toughness: 2 }],
  },
};

function setup({ p1 = [], p2 = [] } = {}) {
  const deck = (names) => [...names, ...Array(40 - names.length).fill('forest')];
  const game = new Game({
    players, cards: CARDS, shuffleLibraries: false, emblems: { p1: [], p2: [] }, decks: { p1: deck(p1), p2: deck(p2) },
  });
  const events = [];
  game.onAny((name, payload) => events.push({ name, payload }));
  game.start();
  return { game, events };
}

const state = (game) => game.getState();
const player = (game, id) => state(game).players.find((p) => p.id === id);
const permanent = (game, id) => state(game).battlefield.find((p) => p.id === id);
const inHand = (game, playerId, name) => player(game, playerId).hand.find((c) => c.name === name);
const inHandOrGrave = (game, playerId, name) => [...player(game, playerId).hand, ...player(game, playerId).graveyard]
  .find((c) => c.name === name).id;
const castActions = (game, name) => state(game).validActions
  .filter((a) => a.type === ACTION.CAST_SPELL && player(game, a.playerId).hand.find((c) => c.id === a.cardId)?.name === name);

function passRound(game) {
  for (let i = 0; i < 2; i++) assert.deepEqual(game.dispatch(passPriority(state(game).priorityPlayerId)), { ok: true });
}

function advanceTo(game, { turn, phase }) {
  while (state(game).turn < turn || state(game).phase !== phase) {
    const { pendingDecision, validActions } = state(game);
    if (pendingDecision) game.dispatch(validActions.find((a) => a.type.startsWith('CONFIRM_')) ?? validActions[0]);
    else passRound(game);
  }
}

/** Casts a card from hand and lets it (and anything above it) resolve. */
function cast(game, playerId, name, targets) {
  const { id } = inHand(game, playerId, name);
  assert.deepEqual(game.dispatch(castSpell(playerId, id, targets)), { ok: true }, `cast ${name}`);
  passRound(game);
  return id;
}

/** p1 has `p1` creatures from turn 1 and p2 has `p2` from turn 2; returns at p1's turn 3 main. */
function withCreatures({ p1 = [], p2 = [], p1Hand = [], p2Hand = [] }) {
  const setupResult = setup({ p1: [...p1, ...p1Hand], p2: [...p2, ...p2Hand] });
  const { game } = setupResult;
  passRound(game);
  const mine = p1.map((name) => cast(game, 'p1', name));
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  const theirs = p2.map((name) => cast(game, 'p2', name));
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  return { ...setupResult, mine, theirs };
}

// -----------------------------------------------------------------------------
// Timing

test('a sorcery can only be cast at sorcery speed', () => {
  const { game } = setup({ p1: ['Insight'], p2: ['Insight'] });
  assert.deepEqual(castActions(game, 'Insight'), []); // upkeep
  passRound(game);
  assert.equal(castActions(game, 'Insight').length, 1);
  game.dispatch(passPriority('p1'));
  assert.deepEqual(castActions(game, 'Insight'), []); // p2 has priority, but it's p1's turn
});

test('an instant can be cast whenever its owner has priority', () => {
  const { game } = setup({ p1: ['Remedy'], p2: ['Remedy'] });
  assert.equal(castActions(game, 'Remedy').length, 1); // p1's upkeep
  game.dispatch(passPriority('p1'));
  assert.deepEqual(castActions(game, 'Remedy').map((a) => a.playerId), ['p2']); // p2, on p1's turn
});

test('a sorcery resolves, applies its effects, and goes to the graveyard', () => {
  const { game, events } = setup({ p1: ['Insight'] });
  passRound(game);
  const id = inHand(game, 'p1', 'Insight').id;
  const hand = player(game, 'p1').hand.length;
  game.dispatch(castSpell('p1', id));
  assert.deepEqual(state(game).stack.map((o) => o.sourceId), [id]);
  passRound(game);
  assert.equal(player(game, 'p1').hand.length, hand - 1 + 2);
  assert.deepEqual(player(game, 'p1').graveyard.map((c) => c.id), [id]);
  assert.ok(!state(game).battlefield.some((p) => p.id === id));
  assert.equal(state(game).phase, PHASE.PRECOMBAT_MAIN);
  assert.ok(events.some((e) => e.name === 'cardsDrawn' && e.payload.cardIds.length === 2));
});

test('instants can respond to spells; the stack resolves last in, first out', () => {
  const { game, events } = setup({ p1: ['Insight', 'Remedy'], p2: ['Remedy'] });
  passRound(game);
  const insight = inHand(game, 'p1', 'Insight').id;
  game.dispatch(castSpell('p1', insight));
  // p1 holds priority and responds to their own sorcery; then p2 responds too.
  game.dispatch(castSpell('p1', inHand(game, 'p1', 'Remedy').id));
  game.dispatch(passPriority('p1'));
  assert.equal(castActions(game, 'Remedy').length, 1);
  game.dispatch(castSpell('p2', inHand(game, 'p2', 'Remedy').id));
  assert.equal(state(game).stack.length, 3);
  // Everyone passes after each resolution.
  while (state(game).stack.length) passRound(game);
  const order = events.filter((e) => e.name === 'stackObjectResolving').map((e) => `${e.payload.stackObject.controllerId}:${e.payload.stackObject.sourceName}`);
  assert.deepEqual(order, ['p2:Remedy', 'p1:Remedy', 'p1:Insight']);
  assert.equal(player(game, 'p1').life, 23);
  assert.equal(player(game, 'p2').life, 23);
});

test('a sorcery can\'t be cast in response', () => {
  const { game } = setup({ p1: ['Insight', 'Remedy'] });
  passRound(game);
  game.dispatch(castSpell('p1', inHand(game, 'p1', 'Remedy').id));
  assert.deepEqual(castActions(game, 'Insight'), []); // stack isn't empty
});

// -----------------------------------------------------------------------------
// Effects

test('"any target" means creatures and players, one cast action each', () => {
  const { game, mine, theirs } = withCreatures({ p1: ['Bear'], p2: ['Bear'], p1Hand: ['Shock'] });
  assert.deepEqual(castActions(game, 'Shock').map((a) => a.targets), [[mine[0]], [theirs[0]], ['p1'], ['p2']]);
});

test('damage to a player reduces their life', () => {
  const { game, events } = setup({ p1: ['Shock'] });
  passRound(game);
  cast(game, 'p1', 'Shock', ['p2']);
  assert.equal(player(game, 'p2').life, 18);
  assert.deepEqual(
    events.find((e) => e.name === 'damageDealt').payload,
    { seq: events.find((e) => e.name === 'damageDealt').payload.seq, sourceId: inHandOrGrave(game, 'p1', 'Shock'), targetPlayerId: 'p2', amount: 2 },
  );
});

test('damage to a creature is marked on it, and lethal damage kills it', () => {
  const { game, theirs } = withCreatures({ p2: ['Bear', 'Ox'], p1Hand: ['Shock', 'Shock'] });
  const [bear, ox] = theirs;
  cast(game, 'p1', 'Shock', [ox]);
  assert.equal(permanent(game, ox).damage, 2);
  const second = player(game, 'p1').hand.find((c) => c.name === 'Shock').id;
  game.dispatch(castSpell('p1', second, [bear]));
  passRound(game);
  assert.ok(!permanent(game, bear));
  assert.ok(player(game, 'p2').graveyard.some((c) => c.id === bear));
});

test('destroy puts the creature into its owner\'s graveyard, and its Aura falls off', () => {
  const { game, theirs, events } = withCreatures({ p2: ['Ox'], p1Hand: ['Doom', 'Might'] });
  const might = cast(game, 'p1', 'Might', [theirs[0]]);
  assert.equal(permanent(game, theirs[0]).power, 6);
  cast(game, 'p1', 'Doom', [theirs[0]]);
  assert.ok(!permanent(game, theirs[0]));
  assert.ok(!permanent(game, might));
  assert.ok(player(game, 'p1').graveyard.some((c) => c.id === might));
  assert.ok(events.some((e) => e.name === 'permanentDestroyed' && e.payload.cardId === theirs[0]));
});

test('a pump lasts until end of turn', () => {
  const { game, mine, events } = withCreatures({ p1: ['Bear'], p1Hand: ['Growth'] });
  cast(game, 'p1', 'Growth', [mine[0]]);
  const bear = permanent(game, mine[0]);
  assert.deepEqual([bear.power, bear.toughness, bear.keywords], [5, 5, ['trample']]);
  assert.equal(state(game).temporaryEffects.length, 1);
  advanceTo(game, { turn: 3, phase: PHASE.ENDING });
  assert.equal(permanent(game, mine[0]).power, 5);
  advanceTo(game, { turn: 4, phase: PHASE.BEGINNING });
  assert.deepEqual([permanent(game, mine[0]).power, permanent(game, mine[0]).keywords], [2, []]);
  assert.deepEqual(state(game).temporaryEffects, []);
  assert.ok(events.some((e) => e.name === 'temporaryEffectsEnded'));
});

test('a combat trick: pumping a blocker after blocks saves it and kills the attacker', () => {
  const { game, mine, theirs } = withCreatures({ p1: ['Ox'], p2: ['Bear'], p2Hand: ['Growth'] });
  passRound(game);
  passRound(game);
  game.dispatch(toggleAttacker('p1', mine[0]));
  game.dispatch(confirmAttackers('p1'));
  passRound(game);
  game.dispatch(setBlocker('p2', theirs[0], mine[0]));
  game.dispatch(confirmBlockers('p2'));
  // Declare blockers step: p1 passes, p2 casts the pump.
  game.dispatch(passPriority('p1'));
  game.dispatch(castSpell('p2', inHand(game, 'p2', 'Growth').id, [theirs[0]]));
  passRound(game); // the pump resolves
  assert.equal(state(game).step, STEP.DECLARE_BLOCKERS);
  passRound(game); // combat damage: 5/5 Bear vs 4/4 Ox
  assert.ok(!permanent(game, mine[0]));
  assert.equal(permanent(game, theirs[0]).damage, 4);
});

test('a spell whose only target became illegal doesn\'t resolve', () => {
  const { game, theirs, events } = withCreatures({ p2: ['Bear'], p1Hand: ['Shock', 'Shock'] });
  const [first, second] = player(game, 'p1').hand.filter((c) => c.name === 'Shock').map((c) => c.id);
  game.dispatch(castSpell('p1', first, [theirs[0]]));
  game.dispatch(castSpell('p1', second, [theirs[0]])); // in response, with priority held
  passRound(game); // the second Shock resolves; state-based actions kill the Bear
  assert.ok(!permanent(game, theirs[0]));
  passRound(game); // the first Shock has no legal target
  assert.ok(events.some((e) => e.name === 'stackObjectFizzled'));
  assert.deepEqual(player(game, 'p1').graveyard.map((c) => c.id).sort(), [first, second].sort());
});

test('an Aura whose target is gone doesn\'t resolve and goes to the graveyard', () => {
  const { game, mine, events } = withCreatures({ p1: ['Bear'], p1Hand: ['Might', 'Shock'] });
  const might = inHand(game, 'p1', 'Might').id;
  game.dispatch(castSpell('p1', might, [mine[0]]));
  game.dispatch(castSpell('p1', inHand(game, 'p1', 'Shock').id, [mine[0]]));
  passRound(game);
  passRound(game);
  assert.ok(!permanent(game, might));
  assert.ok(player(game, 'p1').graveyard.some((c) => c.id === might));
  assert.ok(events.some((e) => e.name === 'stackObjectFizzled'));
});

// -----------------------------------------------------------------------------
// AI

test('two basic AIs play a full game with instants and sorceries', async () => {
  const { SAMPLE_SPELLS, SAMPLE_SPELLS_DECK } = await import('../src/index.js');
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const game = new Game({ players, seed, cards: SAMPLE_SPELLS, decks: { p1: SAMPLE_SPELLS_DECK, p2: SAMPLE_SPELLS_DECK } });
    const ais = players.map(({ id }) => new BasicAIController({ game, playerId: id, delayMs: null }));
    const rejected = [];
    const cast = [];
    game.on('actionRejected', (e) => rejected.push(e));
    game.on('spellCast', (e) => cast.push(e));
    game.start();
    ais.forEach((ai) => ai.detach());
    assert.equal(game.getState().status, GAME_STATUS.GAME_OVER, `seed ${seed}`);
    assert.deepEqual(rejected, [], `seed ${seed}`);
    // Harmful spells only ever target the opponent or their creatures.
    for (const e of cast.filter((x) => ['Sample Shock', 'Sample Doom'].includes(x.cardName))) {
      const opponent = e.playerId === 'p1' ? 'p2' : 'p1';
      assert.ok(e.targets.every((t) => t === opponent || t.startsWith(`${opponent}-`)), `seed ${seed}: ${e.cardName} -> ${e.targets}`);
    }
    assert.ok(cast.some((e) => e.cardName.startsWith('Sample ')), `seed ${seed}: the AI casts sample spells`);
  }
});

test('the AIs only cast a Shock that kills: a creature or the player', async () => {
  const { listMacros } = await import('../src/ai/macroActions.js');
  const shocks = (game) => listMacros(game.getState(), 'p1').filter((m) => m.kind === 'cast').map((m) => m.targetId);
  // The basic AI burns at the end of the opponent's turn.
  const basicCast = (game) => {
    advanceTo(game, { turn: 4, phase: PHASE.ENDING });
    game.dispatch(passPriority('p2'));
    const action = new BasicAIController({ game: null, playerId: 'p1' }).chooseAction(game.getState());
    return action.type === ACTION.CAST_SPELL ? action.targets : null;
  };
  // Neither a 4/4 nor 20 life dies to it.
  let { game } = withCreatures({ p2: ['Ox'], p1Hand: ['Shock'] });
  assert.deepEqual(shocks(game), []);
  assert.equal(basicCast(game), null);
  // A 2/2 does.
  const bear = withCreatures({ p2: ['Bear'], p1Hand: ['Shock'] });
  assert.deepEqual(shocks(bear.game), [bear.theirs[0]]);
  // And so does an opponent at 2 life.
  ({ game } = withCreatures({ p2: ['Ox'], p1Hand: ['Blaze', 'Shock'] }));
  cast(game, 'p1', 'Blaze', ['p2']);
  assert.equal(player(game, 'p2').life, 2);
  assert.deepEqual(shocks(game), ['p2']);
});

test('"target attacking or blocking creature" means a creature in combat', () => {
  const bear = { id: 'bear', controllerId: 'p1', types: ['Creature'] };
  const wall = { id: 'wall', controllerId: 'p2', types: ['Creature'] };
  const idle = { id: 'idle', controllerId: 'p2', types: ['Creature'] };
  const combat = { attackers: [{ cardId: 'bear', blockerIds: ['wall'] }] };
  const kinds = (p) => [TARGET.ATTACKING_CREATURE, TARGET.ATTACKING_OR_BLOCKING_CREATURE].map((k) => matchesPermanentKind(p, k, 'p2', combat));
  assert.deepEqual(kinds(bear), [true, true]);
  assert.deepEqual(kinds(wall), [false, true]);
  assert.deepEqual(kinds(idle), [false, false]);
  assert.equal(matchesPermanentKind(bear, TARGET.ATTACKING_CREATURE, 'p2'), false); // outside combat
});

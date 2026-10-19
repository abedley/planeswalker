import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, GAME_STATUS, ACTION, DECISION, PHASE, CARD_TYPE, TARGET, AFFECTED, EFFECT, TRIGGER, TOKEN,
  passPriority, castSpell, activateAbility, chooseTargets, toggleAttacker, confirmAttackers, setBlocker, confirmBlockers,
  BasicAIController, SAMPLE_TRIGGERS, SAMPLE_TRIGGERS_DECK,
} from '../src/index.js';

const players = [{ id: 'p1' }, { id: 'p2' }];

// Free test cards.
const creature = (id, power, toughness, triggeredAbilities = []) => ({
  id, name: id, manaCost: {}, types: [CARD_TYPE.CREATURE], power, toughness, triggeredAbilities,
});
const when = (trigger, effects, target) => ({ id: trigger, text: `${trigger}: ...`, trigger, effects, ...(target ? { target } : {}) });
const spell = (id, effects, target) => ({ id, name: id, manaCost: {}, types: [CARD_TYPE.INSTANT], effects, ...(target ? { target } : {}) });
const CARDS = {
  Bear: creature('Bear', 2, 2),
  Healer: creature('Healer', 1, 1, [when(TRIGGER.ENTERS_BATTLEFIELD, [{ type: EFFECT.GAIN_LIFE, amount: 3 }])]),
  Sniper: creature('Sniper', 1, 1, [when(TRIGGER.ENTERS_BATTLEFIELD, [{ type: EFFECT.DEAL_DAMAGE, amount: 1 }], TARGET.ANY)]),
  Breaker: creature('Breaker', 1, 1, [when(TRIGGER.ENTERS_BATTLEFIELD, [{ type: EFFECT.DESTROY }], TARGET.ARTIFACT)]),
  Martyr: creature('Martyr', 1, 1, [when(TRIGGER.DIES, [{ type: EFFECT.DRAW_CARDS, count: 1 }])]),
  Bomber: creature('Bomber', 1, 1, [when(TRIGGER.DIES, [{ type: EFFECT.DEAL_DAMAGE, amount: 2 }], TARGET.ANY)]),
  Vain: creature('Vain', 1, 1, [when(TRIGGER.DIES, [{ type: EFFECT.ADD_COUNTERS, counter: '+1/+1', count: 1, affected: AFFECTED.SOURCE }])]),
  Twin: creature('Twin', 1, 1, [
    when(TRIGGER.ENTERS_BATTLEFIELD, [{ type: EFFECT.CREATE_TOKEN, count: 1, token: TOKEN.CLUE }]),
    when(TRIGGER.DIES, [{ type: EFFECT.GAIN_LIFE, amount: 1 }]),
  ]),
  Shock: spell('Shock', [{ type: EFFECT.DEAL_DAMAGE, amount: 2 }], TARGET.ANY),
  Gust: spell('Gust', [{ type: EFFECT.RETURN_TO_HAND }], TARGET.CREATURE),
  Banish: spell('Banish', [{ type: EFFECT.EXILE }], TARGET.CREATURE),
  Quake: spell('Quake', [{ type: EFFECT.DEAL_DAMAGE, amount: 1, affected: AFFECTED.EACH_CREATURE }]),
  Altar: {
    id: 'Altar', name: 'Altar', manaCost: {}, types: [CARD_TYPE.ENCHANTMENT],
    abilities: [{ id: 'sac', text: 'Sacrifice a creature: Draw a card.', cost: { sacrifice: TARGET.CREATURE }, effects: [{ type: EFFECT.DRAW_CARDS, count: 1 }] }],
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
const inHand = (game, playerId, name) => player(game, playerId).hand.find((c) => c.name === name)?.id;
const eventsNamed = (events, name) => events.filter((e) => e.name === name).map((e) => e.payload);

function passRound(game) {
  for (let i = 0; i < 2; i++) assert.deepEqual(game.dispatch(passPriority(state(game).priorityPlayerId)), { ok: true });
}

function advanceTo(game, { turn, phase }) {
  while (state(game).turn < turn || state(game).phase !== phase || state(game).pendingDecision) {
    const { pendingDecision, validActions } = state(game);
    if (pendingDecision) game.dispatch(validActions.find((a) => a.type.startsWith('CONFIRM_')) ?? validActions.at(-1));
    else passRound(game);
  }
}

/** Casts a card and lets it resolve (but not any abilities it triggers). */
function cast(game, playerId, name, targets) {
  const id = inHand(game, playerId, name);
  assert.deepEqual(game.dispatch(castSpell(playerId, id, targets)), { ok: true }, `cast ${name}`);
  passRound(game);
  return id;
}

/** p1's creatures from turn 1 and p2's from turn 2 (with their triggers resolved); returns at p1's turn 3 main. */
function withPermanents({ p1 = [], p2 = [], p1Hand = [], p2Hand = [] }) {
  const result = setup({ p1: [...p1, ...p1Hand], p2: [...p2, ...p2Hand] });
  const { game } = result;
  passRound(game);
  const resolveAll = () => { while (state(game).stack.length) passRound(game); };
  const mine = p1.map((name) => { const id = cast(game, 'p1', name); resolveAll(); return id; });
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  const theirs = p2.map((name) => { const id = cast(game, 'p2', name); resolveAll(); return id; });
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  return { ...result, mine, theirs };
}

test('an enters-the-battlefield ability triggers and goes on the stack above nothing else', () => {
  const { game, events } = setup({ p1: ['Healer'] });
  passRound(game);
  const healer = cast(game, 'p1', 'Healer');
  assert.ok(permanent(game, healer));
  // 603.3: it goes on the stack before the active player gets priority, so the opponent can respond.
  const { stack, priorityPlayerId } = state(game);
  assert.deepEqual(
    stack.map(({ kind, sourceId, controllerId, effects }) => ({ kind, sourceId, controllerId, effects })),
    [{ kind: 'triggeredAbility', sourceId: healer, controllerId: 'p1', effects: [{ type: EFFECT.GAIN_LIFE, amount: 3 }] }],
  );
  assert.equal(priorityPlayerId, 'p1');
  assert.equal(player(game, 'p1').life, 20);
  passRound(game);
  assert.equal(player(game, 'p1').life, 23);
  assert.deepEqual(
    events.filter((e) => ['abilityTriggered', 'triggeredAbilityPutOnStack'].includes(e.name)).map((e) => e.name),
    ['abilityTriggered', 'triggeredAbilityPutOnStack'],
  );
  assert.deepEqual(state(game).stack, []);
});

test('a card\'s triggered abilities are listed on it', () => {
  const { game } = setup({ p1: ['Twin'] });
  assert.deepEqual(player(game, 'p1').hand[0].triggeredAbilities.map((a) => [a.id, a.trigger, a.target]), [
    ['entersBattlefield', 'entersBattlefield', null], ['dies', 'dies', null],
  ]);
});

test('a triggered ability with several legal targets asks its controller to choose', () => {
  const { game, mine, theirs } = withPermanents({ p1: ['Bear'], p2: ['Bear'], p1Hand: ['Sniper'] });
  const sniper = inHand(game, 'p1', 'Sniper');
  game.dispatch(castSpell('p1', sniper));
  passRound(game);
  const { pendingDecision, validActions, priorityPlayerId } = state(game);
  assert.equal(priorityPlayerId, null);
  assert.deepEqual(
    { type: pendingDecision.type, playerId: pendingDecision.playerId, sourceId: pendingDecision.sourceId, targetKind: pendingDecision.targetKind },
    { type: DECISION.CHOOSE_TARGETS, playerId: 'p1', sourceId: sniper, targetKind: TARGET.ANY },
  );
  // Every creature (the Sniper itself included) and every player.
  assert.deepEqual(validActions.map((a) => a.targets[0]), [mine[0], theirs[0], sniper, 'p1', 'p2']);
  assert.equal(game.dispatch(passPriority('p1')).ok, false);
  assert.deepEqual(game.dispatch(chooseTargets('p1', ['p2'])), { ok: true });
  assert.equal(state(game).pendingDecision, null);
  assert.equal(state(game).priorityPlayerId, 'p1');
  assert.deepEqual(state(game).stack[0].targets, ['p2']);
  passRound(game);
  assert.equal(player(game, 'p2').life, 19);
});

test('a triggered ability with exactly one legal target takes it, and with none it\'s removed', () => {
  const { game, events } = setup({ p1: ['Breaker', 'Altar', 'Breaker'] });
  passRound(game);
  cast(game, 'p1', 'Breaker');
  assert.deepEqual(state(game).stack, []);
  assert.equal(eventsNamed(events, 'triggeredAbilityRemoved').length, 1);
  // The Altar is an enchantment, not an artifact, so still nothing to target.
  cast(game, 'p1', 'Altar');
  const second = inHand(game, 'p1', 'Breaker');
  cast(game, 'p1', 'Breaker');
  assert.equal(eventsNamed(events, 'triggeredAbilityRemoved').length, 2);
  assert.ok(permanent(game, second));
});

test('"dies" triggers when a creature goes to the graveyard from the battlefield, however it happens', () => {
  const { game, mine, events } = withPermanents({ p1: ['Martyr', 'Martyr', 'Martyr', 'Altar'], p1Hand: ['Shock', 'Quake'] });
  const handSize = () => player(game, 'p1').hand.length;
  let before = handSize();
  cast(game, 'p1', 'Shock', [mine[0]]); // lethal damage (state-based action)
  assert.equal(state(game).stack.length, 1);
  passRound(game);
  assert.equal(handSize(), before - 1 + 1);
  before = handSize();
  game.dispatch(activateAbility('p1', mine[3], 'sac', undefined, { sacrifice: [mine[1]] })); // sacrifice
  // The ability is activated and the trigger waits for the next time a player would get priority.
  assert.deepEqual(state(game).stack.map((s) => s.kind), ['activatedAbility', 'triggeredAbility']);
  passRound(game);
  passRound(game);
  assert.equal(handSize(), before + 2);
  assert.equal(eventsNamed(events, 'abilityTriggered').filter((t) => t.trigger === TRIGGER.DIES).length, 2);
});

test('leaving the battlefield another way isn\'t dying', () => {
  const { game, mine, events } = withPermanents({ p1: ['Martyr', 'Martyr'], p1Hand: ['Gust', 'Banish'] });
  cast(game, 'p1', 'Gust', [mine[0]]);
  cast(game, 'p1', 'Banish', [mine[1]]);
  assert.equal(eventsNamed(events, 'abilityTriggered').filter((t) => t.trigger === TRIGGER.DIES).length, 0);
});

test('a creature that dies in combat triggers, and its controller chooses targets on the other player\'s turn', () => {
  const { game, mine, theirs } = withPermanents({ p1: ['Bear'], p2: ['Bomber'] });
  advanceTo(game, { turn: 3, phase: PHASE.COMBAT });
  passRound(game);
  game.dispatch(toggleAttacker('p1', mine[0]));
  game.dispatch(confirmAttackers('p1'));
  passRound(game);
  game.dispatch(setBlocker('p2', theirs[0], mine[0]));
  game.dispatch(confirmBlockers('p2'));
  passRound(game);
  // Combat damage: the Bomber dies, and p2 (not the active player) chooses where its damage goes.
  const { pendingDecision } = state(game);
  assert.equal(pendingDecision.type, DECISION.CHOOSE_TARGETS);
  assert.equal(pendingDecision.playerId, 'p2');
  assert.equal(pendingDecision.priorityPlayerId, 'p1');
  game.dispatch(chooseTargets('p2', [mine[0]]));
  assert.equal(state(game).priorityPlayerId, 'p1');
  passRound(game);
  // The Bear had 1 damage from the Bomber, plus 2 more.
  assert.equal(permanent(game, mine[0]), undefined);
});

test('simultaneous triggers go on the stack in APNAP order, so the nonactive player\'s resolve first', () => {
  const { game, events } = withPermanents({ p1: ['Martyr'], p2: ['Twin'], p1Hand: ['Quake'] });
  cast(game, 'p1', 'Quake');
  const stack = state(game).stack;
  assert.deepEqual(stack.map((s) => s.controllerId), ['p1', 'p2']); // top is last
  passRound(game);
  assert.equal(player(game, 'p2').life, 21); // p2's resolved first
  assert.equal(state(game).stack.length, 1);
  passRound(game);
  assert.equal(eventsNamed(events, 'triggeredAbilityPutOnStack').length, 1 + 2); // Twin's ETB, then the two dies
});

test('an effect on a creature that has died does nothing', () => {
  const { game, mine } = withPermanents({ p1: ['Vain'], p1Hand: ['Shock'] });
  cast(game, 'p1', 'Shock', [mine[0]]);
  passRound(game);
  assert.equal(state(game).status, GAME_STATUS.IN_PROGRESS);
  assert.deepEqual(state(game).stack, []);
});

test('triggered abilities appear in state while they wait to be put on the stack', () => {
  const { game } = setup({ p1: ['Sniper'] });
  passRound(game);
  game.dispatch(castSpell('p1', inHand(game, 'p1', 'Sniper')));
  passRound(game);
  assert.equal(state(game).pendingTriggers.length, 1);
  assert.equal(state(game).pendingTriggers[0].targetKind, TARGET.ANY);
  game.dispatch(state(game).validActions.find((a) => a.type === ACTION.CHOOSE_TARGETS));
  assert.deepEqual(state(game).pendingTriggers, []);
});

test('the AI aims a triggered ability at the opponent\'s side', () => {
  const { game, theirs, events } = withPermanents({ p2: ['Bear'], p1: ['Bear'], p1Hand: ['Sniper'] });
  game.dispatch(castSpell('p1', inHand(game, 'p1', 'Sniper')));
  game.dispatch(passPriority('p1'));
  // p1 is now an AI, and chooses the Sniper's target as soon as it's asked.
  const ai = new BasicAIController({ game, playerId: 'p1', delayMs: null });
  game.dispatch(passPriority('p2'));
  const [{ targets }] = eventsNamed(events, 'triggeredAbilityPutOnStack').slice(-1);
  assert.ok(['p2', theirs[0]].includes(targets[0]), targets[0]);
  ai.detach();
});

test('two basic AIs play a full game with the triggered abilities sampler', () => {
  for (const seed of [1, 2, 3]) {
    const game = new Game({
      players, seed, cards: SAMPLE_TRIGGERS, decks: { p1: SAMPLE_TRIGGERS_DECK, p2: SAMPLE_TRIGGERS_DECK },
    });
    const seen = new Set();
    game.onAny((name) => seen.add(name));
    for (const { id } of players) new BasicAIController({ game, playerId: id, delayMs: null });
    game.start();
    assert.equal(state(game).status, GAME_STATUS.GAME_OVER);
    assert.ok(!seen.has('actionRejected'));
    for (const name of ['abilityTriggered', 'triggeredAbilityPutOnStack', 'decisionRequired']) assert.ok(seen.has(name), name);
  }
});

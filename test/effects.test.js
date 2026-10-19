import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, GAME_STATUS, ACTION, PHASE, CARD_TYPE, SUBTYPE, TARGET, AFFECTED, EFFECT, KEYWORD, ACTIVATION_TIMING,
  passPriority, castSpell, activateAbility, toggleAttacker, confirmAttackers,
  BasicAIController, SAMPLE_EFFECTS, SAMPLE_EFFECTS_DECK,
} from '../src/index.js';

const players = [{ id: 'p1' }, { id: 'p2' }];

// Free test cards, so tests can focus on costs and effects.
const spell = (id, effects, { target, type = CARD_TYPE.INSTANT, ...rest } = {}) => ({
  id, name: id, manaCost: {}, types: [type], effects, ...(target ? { target } : {}), ...rest,
});
const creature = (id, power, toughness, rest = {}) => ({
  id, name: id, manaCost: {}, types: [CARD_TYPE.CREATURE], power, toughness, ...rest,
});
const SAPROLING = { colors: ['green'], subtypes: ['Saproling'], power: 1, toughness: 1 };
const CARDS = {
  Bear: creature('Bear', 2, 2),
  Ox: creature('Ox', 4, 4),
  Shock: spell('Shock', [{ type: EFFECT.DEAL_DAMAGE, amount: 2 }], { target: TARGET.ANY }),
  Sprout: spell('Sprout', [{ type: EFFECT.CREATE_TOKEN, count: 2, token: SAPROLING }]),
  Blessing: spell('Blessing', [{ type: EFFECT.ADD_COUNTERS, counter: '+1/+1', count: 2 }], { target: TARGET.CREATURE }),
  Gust: spell('Gust', [{ type: EFFECT.RETURN_TO_HAND }], { target: TARGET.CREATURE }),
  Banish: spell('Banish', [{ type: EFFECT.EXILE }], { target: TARGET.NONLAND_PERMANENT }),
  Shatter: spell('Shatter', [{ type: EFFECT.DESTROY }], { target: TARGET.ARTIFACT_OR_ENCHANTMENT }),
  Snare: spell('Snare', [{ type: EFFECT.TAP }, { type: EFFECT.DRAW_CARDS, count: 1 }], { target: TARGET.CREATURE }),
  Wake: spell('Wake', [{ type: EFFECT.UNTAP }], { target: TARGET.PERMANENT }),
  Denial: spell('Denial', [{ type: EFFECT.COUNTER_SPELL }], { target: TARGET.SPELL }),
  Essence: spell('Essence', [{ type: EFFECT.COUNTER_SPELL }], { target: TARGET.CREATURE_SPELL }),
  Quake: spell('Quake', [
    { type: EFFECT.DEAL_DAMAGE, amount: 2, affected: AFFECTED.EACH_CREATURE },
    { type: EFFECT.DEAL_DAMAGE, amount: 2, affected: AFFECTED.EACH_OPPONENT },
  ], { type: CARD_TYPE.SORCERY }),
  Wrath: spell('Wrath', [{ type: EFFECT.DESTROY, affected: AFFECTED.EACH_CREATURE }], { type: CARD_TYPE.SORCERY }),
  Drain: spell('Drain', [
    { type: EFFECT.LOSE_LIFE, amount: 5, affected: AFFECTED.EACH_OPPONENT },
    { type: EFFECT.GAIN_LIFE, amount: 5 },
  ]),
  // Effects on players apply to "you" unless they say otherwise.
  Bleed: spell('Bleed', [{ type: EFFECT.LOSE_LIFE, amount: 3, affected: AFFECTED.TARGET }], { target: TARGET.OPPONENT }),
  Scour: spell('Scour', [{ type: EFFECT.MILL, count: 3, affected: AFFECTED.TARGET }], { target: TARGET.PLAYER }),
  Rampage: spell('Rampage', [{
    type: EFFECT.PUMP, power: 1, toughness: 1, keywords: [KEYWORD.TRAMPLE], affected: AFFECTED.EACH_CREATURE_YOU_CONTROL,
  }]),
  Ritual: spell('Ritual', [{ type: EFFECT.ADD_MANA, mana: { G: 3 } }]),
  Offering: spell('Offering', [{ type: EFFECT.DRAW_CARDS, count: 2 }], { additionalCost: { sacrifice: TARGET.CREATURE } }),
  Voice: spell('Voice', [{ type: EFFECT.DRAW_CARDS, count: 2 }], { additionalCost: { discard: 1 } }),
  Splinters: spell('Splinters', [{ type: EFFECT.DESTROY }], {
    type: CARD_TYPE.SORCERY, target: TARGET.CREATURE, additionalCost: { sacrifice: TARGET.CREATURE },
  }),
  Slinger: creature('Slinger', 1, 1, {
    abilities: [{
      id: 'ping', text: '{T}: Slinger deals 1 damage to any target.', cost: { tap: true },
      target: TARGET.ANY, effects: [{ type: EFFECT.DEAL_DAMAGE, amount: 1 }],
    }],
  }),
  Asp: creature('Asp', 1, 1, {
    keywords: [KEYWORD.DEATHTOUCH, KEYWORD.LIFELINK],
    abilities: [{
      id: 'ping', text: '{T}: Asp deals 1 damage to target creature.', cost: { tap: true },
      target: TARGET.CREATURE, effects: [{ type: EFFECT.DEAL_DAMAGE, amount: 1 }],
    }],
  }),
  Fanatic: creature('Fanatic', 1, 1, {
    abilities: [{
      id: 'boom', text: 'Sacrifice Fanatic: It deals 1 damage to any target.', cost: { sacrificeSelf: true },
      target: TARGET.ANY, effects: [{ type: EFFECT.DEAL_DAMAGE, amount: 1 }],
    }],
  }),
  Totem: {
    id: 'Totem', name: 'Totem', manaCost: {}, types: [CARD_TYPE.ARTIFACT],
    abilities: [{
      id: 'draw', text: '{T}, Sacrifice Totem: Draw a card.', cost: { tap: true, sacrificeSelf: true },
      effects: [{ type: EFFECT.DRAW_CARDS, count: 1 }],
    }],
  },
  Brute: creature('Brute', 2, 2, {
    abilities: [{
      id: 'pump', text: 'Pay 1 life: Brute gets +1/+1 until end of turn. Activate only as a sorcery.',
      cost: { life: 1 }, timing: ACTIVATION_TIMING.SORCERY,
      effects: [{ type: EFFECT.PUMP, power: 1, toughness: 1, affected: AFFECTED.SOURCE }],
    }],
  }),
  Altar: {
    id: 'Altar', name: 'Altar', manaCost: {}, types: [CARD_TYPE.ENCHANTMENT],
    abilities: [{
      id: 'spawn', text: 'Sacrifice a creature: Create two 1/1 green Saproling creature tokens.',
      cost: { sacrifice: TARGET.CREATURE }, effects: [{ type: EFFECT.CREATE_TOKEN, count: 2, token: SAPROLING }],
    }],
  },
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
const named = (game, name) => state(game).battlefield.filter((p) => p.name === name);
const inHand = (game, playerId, name) => player(game, playerId).hand.find((c) => c.name === name);
const actionsFor = (game, type, cardId) => state(game).validActions.filter((a) => a.type === type && a.cardId === cardId);
const eventsNamed = (events, name) => events.filter((e) => e.name === name).map((e) => e.payload);

function passRound(game) {
  for (let i = 0; i < 2; i++) assert.deepEqual(game.dispatch(passPriority(state(game).priorityPlayerId)), { ok: true });
}

function advanceTo(game, { turn, phase }) {
  while (state(game).turn < turn || state(game).phase !== phase) {
    const { pendingDecision, validActions } = state(game);
    // Confirm declarations; discard to hand size from the end of the hand (the Forests drawn last).
    if (pendingDecision) game.dispatch(validActions.find((a) => a.type.startsWith('CONFIRM_')) ?? validActions.at(-1));
    else passRound(game);
  }
}

/** Casts a card from hand and lets it (and anything above it) resolve. */
function cast(game, playerId, name, targets, costChoices) {
  const { id } = inHand(game, playerId, name);
  assert.deepEqual(game.dispatch(castSpell(playerId, id, targets, costChoices)), { ok: true }, `cast ${name}`);
  passRound(game);
  return id;
}

/** Activates an ability and lets it resolve. */
function activate(game, playerId, cardId, abilityId, targets, costChoices) {
  const result = game.dispatch(activateAbility(playerId, cardId, abilityId, targets, costChoices));
  assert.deepEqual(result, { ok: true }, `activate ${abilityId}`);
  passRound(game);
}

/** p1 has `p1` permanents from turn 1 and p2 has `p2` from turn 2; returns at p1's turn 3 main. */
function withPermanents({ p1 = [], p2 = [], p1Hand = [], p2Hand = [] }) {
  const result = setup({ p1: [...p1, ...p1Hand], p2: [...p2, ...p2Hand] });
  const { game } = result;
  passRound(game);
  const mine = p1.map((name) => cast(game, 'p1', name));
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  const theirs = p2.map((name) => cast(game, 'p2', name));
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  return { ...result, mine, theirs };
}

test('tokens enter the battlefield as creatures owned by their creator', () => {
  const { game, events } = setup({ p1: ['Sprout'] });
  passRound(game);
  cast(game, 'p1', 'Sprout');
  const tokens = named(game, 'Saproling Token');
  assert.equal(tokens.length, 2);
  for (const token of tokens) {
    assert.deepEqual(
      [token.token, token.ownerId, token.controllerId, token.power, token.toughness, token.subtypes, token.colors],
      [true, 'p1', 'p1', 1, 1, ['Saproling'], ['green']],
    );
    assert.equal(token.summoningSick, true);
  }
  assert.notEqual(tokens[0].id, tokens[1].id);
  assert.equal(eventsNamed(events, 'tokenCreated').length, 2);
});

test('a token that leaves the battlefield ceases to exist', () => {
  const { game } = setup({ p1: ['Sprout', 'Shock', 'Gust'] });
  passRound(game);
  cast(game, 'p1', 'Sprout');
  const [first, second] = named(game, 'Saproling Token');
  cast(game, 'p1', 'Shock', [first.id]);
  cast(game, 'p1', 'Gust', [second.id]);
  assert.deepEqual(named(game, 'Saproling Token'), []);
  // 704.5d: it isn't in the graveyard or the hand either.
  const p1 = player(game, 'p1');
  assert.equal([...p1.graveyard, ...p1.hand].some((c) => c.token), false);
  assert.deepEqual(p1.graveyard.map((c) => c.name), ['Sprout', 'Shock', 'Gust']);
});

test('+1/+1 counters raise power and toughness and go away when the permanent leaves', () => {
  const { game, mine, events } = withPermanents({ p1: ['Bear'], p1Hand: ['Blessing', 'Gust'] });
  cast(game, 'p1', 'Blessing', [mine[0]]);
  const bear = permanent(game, mine[0]);
  assert.deepEqual([bear.power, bear.toughness, bear.counters], [4, 4, { '+1/+1': 2 }]);
  assert.deepEqual(eventsNamed(events, 'countersAdded').map((e) => e.counters), [{ '+1/+1': 2 }]);
  // Counters last beyond the turn, unlike "until end of turn" effects.
  advanceTo(game, { turn: 4, phase: PHASE.PRECOMBAT_MAIN });
  assert.equal(permanent(game, mine[0]).power, 4);
  advanceTo(game, { turn: 5, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'Gust', [mine[0]]);
  const inHandAgain = inHand(game, 'p1', 'Bear');
  assert.deepEqual([inHandAgain.power, inHandAgain.counters], [2, undefined]);
});

test('bounce: the creature goes to its owner\'s hand, and an Aura on it goes to the graveyard', () => {
  const { game } = setup({ p1: ['Bear', 'Might', 'Gust'] });
  passRound(game);
  const bearId = cast(game, 'p1', 'Bear');
  cast(game, 'p1', 'Might', [bearId]);
  assert.equal(permanent(game, bearId).power, 4);
  cast(game, 'p1', 'Gust', [bearId]);
  assert.equal(permanent(game, bearId), undefined);
  assert.ok(inHand(game, 'p1', 'Bear'));
  assert.ok(player(game, 'p1').graveyard.some((c) => c.name === 'Might'));
});

test('exile puts a permanent into its owner\'s exile zone', () => {
  const { game, events } = setup({ p1: ['Bear', 'Banish'] });
  passRound(game);
  const bearId = cast(game, 'p1', 'Bear');
  // Lands are nonland-permanent-illegal targets; the Bear is fine.
  assert.deepEqual(actionsFor(game, ACTION.CAST_SPELL, inHand(game, 'p1', 'Banish').id).map((a) => a.targets), [[bearId]]);
  cast(game, 'p1', 'Banish', [bearId]);
  assert.deepEqual(player(game, 'p1').exile.map((c) => c.id), [bearId]);
  assert.equal(eventsNamed(events, 'permanentExiled').length, 1);
});

test('target kinds: artifact or enchantment, player, opponent', () => {
  const { game } = setup({ p1: ['Totem', 'Might', 'Bear', 'Shatter', 'Scour', 'Bleed'] });
  passRound(game);
  const totemId = cast(game, 'p1', 'Totem');
  const bearId = cast(game, 'p1', 'Bear');
  const mightId = cast(game, 'p1', 'Might', [bearId]);
  const targetsOf = (name) => actionsFor(game, ACTION.CAST_SPELL, inHand(game, 'p1', name).id).map((a) => a.targets[0]);
  assert.deepEqual(targetsOf('Shatter'), [totemId, mightId]);
  assert.deepEqual(targetsOf('Scour'), ['p1', 'p2']);
  assert.deepEqual(targetsOf('Bleed'), ['p2']);
  cast(game, 'p1', 'Bleed', ['p2']);
  assert.deepEqual([player(game, 'p1').life, player(game, 'p2').life], [20, 17]);
});

test('tap and untap', () => {
  const { game, theirs, events } = withPermanents({ p2: ['Ox'], p1Hand: ['Snare', 'Wake'] });
  const handBefore = player(game, 'p1').hand.length;
  cast(game, 'p1', 'Snare', [theirs[0]]);
  assert.equal(permanent(game, theirs[0]).tapped, true);
  assert.equal(player(game, 'p1').hand.length, handBefore); // cast one, drew one
  cast(game, 'p1', 'Wake', [theirs[0]]);
  assert.equal(permanent(game, theirs[0]).tapped, false);
  assert.deepEqual(
    events.filter((e) => ['permanentTapped', 'permanentUntapped'].includes(e.name)).map((e) => e.name),
    ['permanentTapped', 'permanentUntapped'],
  );
});

test('a counterspell targets a spell on the stack and counters it', () => {
  const { game, events } = setup({ p1: ['Bear'], p2: ['Denial'] });
  passRound(game);
  const bearId = inHand(game, 'p1', 'Bear').id;
  // Nothing to counter yet.
  assert.deepEqual(actionsFor(game, ACTION.CAST_SPELL, inHand(game, 'p2', 'Denial').id), []);
  game.dispatch(castSpell('p1', bearId));
  game.dispatch(passPriority('p1'));
  const denial = actionsFor(game, ACTION.CAST_SPELL, inHand(game, 'p2', 'Denial').id);
  const bearSpell = state(game).stack[0].id;
  assert.deepEqual(denial.map((a) => a.targets), [[bearSpell]]);
  game.dispatch(denial[0]);
  passRound(game);
  assert.deepEqual(state(game).stack, []);
  assert.equal(permanent(game, bearId), undefined);
  assert.deepEqual(player(game, 'p1').graveyard.map((c) => c.id), [bearId]);
  assert.equal(player(game, 'p2').graveyard[0].name, 'Denial');
  assert.deepEqual(eventsNamed(events, 'spellCountered').map((e) => e.cardId), [bearId]);
});

test('"counter target creature spell" can\'t target other spells or abilities', () => {
  const { game, mine } = withPermanents({ p1: ['Slinger'], p1Hand: ['Shock', 'Bear'], p2Hand: ['Essence'] });
  const essence = () => actionsFor(game, ACTION.CAST_SPELL, inHand(game, 'p2', 'Essence').id);
  game.dispatch(activateAbility('p1', mine[0], 'ping', ['p2']));
  game.dispatch(castSpell('p1', inHand(game, 'p1', 'Shock').id, ['p2']));
  game.dispatch(passPriority('p1'));
  assert.deepEqual(essence(), []);
  game.dispatch(passPriority('p2'));
  passRound(game);
  game.dispatch(castSpell('p1', inHand(game, 'p1', 'Bear').id));
  game.dispatch(passPriority('p1'));
  assert.equal(essence().length, 1);
});

test('a sweeper damages each creature and each opponent', () => {
  const { game, mine, theirs } = withPermanents({ p1: ['Bear', 'Ox'], p2: ['Bear'], p1Hand: ['Quake'] });
  cast(game, 'p1', 'Quake');
  assert.equal(permanent(game, mine[0]), undefined);
  assert.equal(permanent(game, theirs[0]), undefined);
  assert.equal(permanent(game, mine[1]).damage, 2);
  assert.equal(player(game, 'p2').life, 18);
  assert.equal(player(game, 'p1').life, 20);
});

test('"destroy all creatures" leaves other permanents alone', () => {
  const { game } = withPermanents({ p1: ['Bear', 'Totem'], p2: ['Ox'], p1Hand: ['Wrath'] });
  cast(game, 'p1', 'Wrath');
  assert.deepEqual(state(game).battlefield.filter((p) => p.name !== 'Forest').map((p) => p.name), ['Totem']);
});

test('life loss from each opponent can end the game', () => {
  const { game, events } = setup({ p1: ['Drain', 'Drain', 'Drain', 'Drain'] });
  passRound(game);
  for (let i = 0; i < 4; i++) cast(game, 'p1', 'Drain');
  assert.equal(state(game).status, GAME_STATUS.GAME_OVER);
  assert.equal(state(game).winnerId, 'p1');
  assert.equal(player(game, 'p1').life, 40);
  assert.equal(eventsNamed(events, 'lifeLost').length, 4);
});

test('mill puts the top cards of a library into the graveyard', () => {
  const { game } = setup({ p1: ['Scour'] });
  passRound(game);
  const top = player(game, 'p2').library.slice(0, 3).map((c) => c.id);
  cast(game, 'p1', 'Scour', ['p2']);
  assert.deepEqual(player(game, 'p2').graveyard.map((c) => c.id), top);
  assert.equal(player(game, 'p2').library.length, 40 - 7 - 3);
});

test('a pump for each creature you control', () => {
  const { game, mine, theirs } = withPermanents({ p1: ['Bear', 'Ox'], p2: ['Bear'], p1Hand: ['Rampage'] });
  cast(game, 'p1', 'Rampage');
  assert.deepEqual(mine.map((id) => [permanent(game, id).power, permanent(game, id).keywords]), [[3, ['trample']], [5, ['trample']]]);
  assert.equal(permanent(game, theirs[0]).power, 2);
});

test('a spell can add mana', () => {
  const { game } = setup({ p1: ['Ritual'] });
  passRound(game);
  cast(game, 'p1', 'Ritual');
  assert.equal(player(game, 'p1').manaPool.G, 3);
});

test('a tap ability that deals damage, with deathtouch and lifelink from its source', () => {
  const { game, mine, theirs } = withPermanents({ p1: ['Slinger', 'Asp'], p2: ['Ox'] });
  activate(game, 'p1', mine[0], 'ping', ['p2']);
  assert.equal(player(game, 'p2').life, 19);
  assert.equal(permanent(game, mine[0]).tapped, true);
  assert.deepEqual(actionsFor(game, ACTION.ACTIVATE_ABILITY, mine[0]), []);
  // The Asp can target only creatures (including itself).
  assert.deepEqual(actionsFor(game, ACTION.ACTIVATE_ABILITY, mine[1]).map((a) => a.targets[0]), [mine[0], mine[1], theirs[0]]);
  activate(game, 'p1', mine[1], 'ping', [theirs[0]]);
  assert.equal(permanent(game, theirs[0]), undefined); // deathtouch
  assert.equal(player(game, 'p1').life, 21); // lifelink
});

test('"Sacrifice this": the source is gone before the ability resolves, but it still resolves', () => {
  const { game, mine, events } = withPermanents({ p1: ['Fanatic', 'Totem'] });
  game.dispatch(activateAbility('p1', mine[0], 'boom', ['p2']));
  assert.equal(permanent(game, mine[0]), undefined);
  assert.ok(player(game, 'p1').graveyard.some((c) => c.id === mine[0]));
  passRound(game);
  assert.equal(player(game, 'p2').life, 19);
  const handBefore = player(game, 'p1').hand.length;
  activate(game, 'p1', mine[1], 'draw');
  assert.equal(player(game, 'p1').hand.length, handBefore + 1);
  assert.deepEqual(eventsNamed(events, 'permanentSacrificed').map((e) => e.cardId), mine);
  const activations = eventsNamed(events, 'abilityActivated');
  assert.deepEqual(activations.map((e) => e.costPaid), [{ sacrificed: [mine[0]] }, { tap: true, sacrificed: [mine[1]] }]);
});

test('"Sacrifice a creature": one action per creature, and none without a creature', () => {
  const { game, mine } = withPermanents({ p1: ['Altar', 'Bear', 'Ox'] });
  const [altar, bear, ox] = mine;
  assert.deepEqual(actionsFor(game, ACTION.ACTIVATE_ABILITY, altar).map((a) => a.costChoices), [
    { sacrifice: [bear] }, { sacrifice: [ox] },
  ]);
  // A cost choice that isn't offered is rejected.
  assert.equal(game.dispatch(activateAbility('p1', altar, 'spawn', undefined, { sacrifice: [altar] })).ok, false);
  activate(game, 'p1', altar, 'spawn', undefined, { sacrifice: [bear] });
  assert.equal(named(game, 'Saproling Token').length, 2);
  assert.equal(permanent(game, bear), undefined);
});

test('an additional cost to sacrifice a creature', () => {
  const { game, mine, theirs } = withPermanents({ p1: ['Bear'], p2: ['Ox'], p1Hand: ['Offering', 'Splinters'] });
  const offering = inHand(game, 'p1', 'Offering').id;
  assert.deepEqual(actionsFor(game, ACTION.CAST_SPELL, offering).map((a) => a.costChoices), [{ sacrifice: [mine[0]] }]);
  // 601.2: targets are chosen before costs are paid, so a spell can target the creature it sacrifices.
  const splinters = actionsFor(game, ACTION.CAST_SPELL, inHand(game, 'p1', 'Splinters').id);
  assert.deepEqual(splinters.map((a) => [a.targets[0], a.costChoices.sacrifice[0]]), [[mine[0], mine[0]], [theirs[0], mine[0]]]);
  game.dispatch(splinters[1]);
  assert.equal(permanent(game, mine[0]), undefined); // sacrificed while casting
  passRound(game);
  assert.equal(permanent(game, theirs[0]), undefined);
  // No creature left to sacrifice: Offering can't be cast.
  assert.deepEqual(actionsFor(game, ACTION.CAST_SPELL, offering), []);
});

test('an additional cost to discard a card offers every other card in hand', () => {
  const { game, events } = setup({ p1: ['Voice', 'Bear', 'Ox'] });
  passRound(game);
  const voice = inHand(game, 'p1', 'Voice').id;
  const others = player(game, 'p1').hand.filter((c) => c.id !== voice).map((c) => c.id);
  assert.deepEqual(actionsFor(game, ACTION.CAST_SPELL, voice).map((a) => a.costChoices.discard), others.map((id) => [id]));
  const handBefore = player(game, 'p1').hand.length;
  const ox = inHand(game, 'p1', 'Ox').id;
  cast(game, 'p1', 'Voice', undefined, { discard: [ox] });
  assert.equal(player(game, 'p1').hand.length, handBefore - 2 + 2);
  assert.deepEqual(player(game, 'p1').graveyard.map((c) => c.name), ['Ox', 'Voice']);
  assert.deepEqual(eventsNamed(events, 'spellCast').at(-1).additionalCostPaid, { discarded: [ox] });
});

test('an ability that pumps its own source, paid with life, at sorcery speed', () => {
  const { game, mine } = withPermanents({ p1: ['Brute'], p1Hand: ['Gust'] });
  activate(game, 'p1', mine[0], 'pump');
  activate(game, 'p1', mine[0], 'pump');
  assert.deepEqual([permanent(game, mine[0]).power, player(game, 'p1').life], [4, 18]);
  // Not while something is on the stack.
  game.dispatch(activateAbility('p1', mine[0], 'pump'));
  assert.deepEqual(actionsFor(game, ACTION.ACTIVATE_ABILITY, mine[0]), []);
  // If the source is gone when it resolves, the pump does nothing.
  cast(game, 'p1', 'Gust', [mine[0]]);
  assert.equal(state(game).stack.length, 1);
  passRound(game);
  assert.deepEqual(state(game).temporaryEffects.length, 0);
});

test('attacking with tokens', () => {
  const { game } = setup({ p1: ['Sprout'] });
  passRound(game);
  cast(game, 'p1', 'Sprout');
  advanceTo(game, { turn: 3, phase: PHASE.COMBAT });
  passRound(game); // beginning of combat
  for (const token of named(game, 'Saproling Token')) game.dispatch(toggleAttacker('p1', token.id));
  game.dispatch(confirmAttackers('p1'));
  advanceTo(game, { turn: 3, phase: PHASE.POSTCOMBAT_MAIN });
  assert.equal(player(game, 'p2').life, 18);
});

test('two basic AIs play a full game with the effects sampler', () => {
  const game = new Game({
    players, seed: 7, cards: SAMPLE_EFFECTS, decks: { p1: SAMPLE_EFFECTS_DECK, p2: SAMPLE_EFFECTS_DECK },
  });
  const seen = new Set();
  game.onAny((name) => seen.add(name));
  for (const { id } of players) new BasicAIController({ game, playerId: id, delayMs: null });
  game.start();
  assert.equal(state(game).status, GAME_STATUS.GAME_OVER);
  assert.ok(!seen.has('actionRejected'));
  for (const name of ['tokenCreated', 'abilityActivated', 'spellCast']) assert.ok(seen.has(name), name);
});

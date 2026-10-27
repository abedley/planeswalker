import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, ACTION, DECISION, PHASE, CARD_TYPE, TARGET, AFFECTED, EFFECT, TRIGGER, KEYWORD,
  passPriority, castSpell, activateAbility, chooseTargets, chooseMode, keepLegend, playLand,
  toggleAttacker, confirmAttackers, setBlocker, legalizeBlocks, blocksLegal, canBlockCreature,
} from '../src/index.js';

const players = [{ id: 'p1' }, { id: 'p2' }];

// Free test cards.
const creature = (id, power, toughness, more = {}) => ({
  id, name: id, manaCost: {}, types: [CARD_TYPE.CREATURE], subtypes: [], power, toughness, ...more,
});
const elf = (id, power, toughness, more = {}) => creature(id, power, toughness, { subtypes: ['Elf'], ...more });
const ability = (trigger, effects, more = {}) => ({ id: trigger, text: `${trigger}: ...`, trigger, effects, ...more });
const CARDS = {
  Bear: creature('Bear', 2, 2),
  Big: creature('Big', 3, 3),
  Elf: elf('Elf', 1, 1),
  Flyer: creature('Flyer', 1, 1, { keywords: [KEYWORD.FLYING] }),
  Archer: creature('Archer', 1, 3, { keywords: [KEYWORD.REACH] }),
  Ambusher: creature('Ambusher', 2, 2, { keywords: [KEYWORD.FLASH] }),
  Ranger: creature('Ranger', 3, 3, {
    triggeredAbilities: [ability(TRIGGER.CREATURE_ENTERS, [{ type: EFFECT.PUMP, power: 1, toughness: 0, affected: AFFECTED.SOURCE }], { filter: { other: true } })],
  }),
  Vanguard: elf('Vanguard', 1, 1, {
    triggeredAbilities: [ability(TRIGGER.CREATURE_ENTERS, [{ type: EFFECT.ADD_COUNTERS, counter: '+1/+1', count: 1, affected: AFFECTED.SOURCE }], {
      filter: { other: true, controller: 'any', subtypes: ['Elf'] },
    })],
  }),
  Giant: creature('Giant', 5, 3, {
    triggeredAbilities: [ability(TRIGGER.LAND_ENTERS, [{ type: EFFECT.CREATE_TOKEN, count: 1, token: { colors: ['green'], subtypes: ['Elf', 'Warrior'], power: 1, toughness: 1 } }])],
  }),
  Brawler: elf('Brawler', 4, 2, {
    keywords: [KEYWORD.MUST_BE_BLOCKED],
    triggeredAbilities: [ability(TRIGGER.ATTACKS, [{ type: EFFECT.PUMP, power: 2, toughness: 1 }], { target: TARGET.ELF_YOU_CONTROL, targetOther: true })],
  }),
  Gargaroth: creature('Gargaroth', 6, 6, {
    triggeredAbilities: [ability(TRIGGER.ATTACKS_OR_BLOCKS, [], {
      modes: [
        { text: 'Create a 3/3 Beast.', effects: [{ type: EFFECT.CREATE_TOKEN, count: 1, token: { colors: ['green'], subtypes: ['Beast'], power: 3, toughness: 3 } }] },
        { text: 'You gain 3 life.', effects: [{ type: EFFECT.GAIN_LIFE, amount: 3 }] },
        { text: 'Draw a card.', effects: [{ type: EFFECT.DRAW_CARDS, count: 1 }] },
      ],
    })],
  }),
  Bard: elf('Bard', 3, 3, {
    triggeredAbilities: [ability(TRIGGER.ENTERS_BATTLEFIELD, [], {
      modes: [
        { text: 'Destroy target artifact.', target: TARGET.ARTIFACT, effects: [{ type: EFFECT.DESTROY }] },
        { text: 'You gain 3 life.', effects: [{ type: EFFECT.GAIN_LIFE, amount: 3 }] },
      ],
    })],
  }),
  Chosen: elf('Chosen', 1, 1, {
    triggeredAbilities: [ability(TRIGGER.SPELL_CAST, [{ type: EFFECT.ADD_COUNTERS, counter: '+1/+1', count: 1, affected: AFFECTED.SOURCE }], {
      filter: { controller: 'any', colors: ['G'] },
    })],
  }),
  GreenBear: creature('GreenBear', 2, 2, { colors: ['G'] }),
  Sage: elf('Sage', 2, 1, {
    triggeredAbilities: [ability(TRIGGER.ENTERS_BATTLEFIELD, [{ type: EFFECT.DESTROY }], { target: TARGET.ARTIFACT, optional: true })],
  }),
  Trinket: { id: 'Trinket', name: 'Trinket', manaCost: {}, types: [CARD_TYPE.ARTIFACT] },
  Regrower: elf('Regrower', 4, 3, {
    triggeredAbilities: [ability(TRIGGER.ENTERS_BATTLEFIELD, [{ type: EFFECT.RETURN_FROM_GRAVEYARD }], { target: TARGET.PERMANENT_CARD_IN_YOUR_GRAVEYARD })],
  }),
  Kill: { id: 'Kill', name: 'Kill', manaCost: {}, types: [CARD_TYPE.INSTANT], target: TARGET.CREATURE, effects: [{ type: EFFECT.DESTROY }] },
  Pounce: {
    id: 'Pounce', name: 'Pounce', manaCost: {}, types: [CARD_TYPE.INSTANT],
    targets: [TARGET.CREATURE_YOU_CONTROL, TARGET.CREATURE_OPPONENT_CONTROLS], effects: [{ type: EFFECT.FIGHT }],
  },
  Audacity: {
    id: 'Audacity', name: 'Audacity', manaCost: {}, types: [CARD_TYPE.ENCHANTMENT], subtypes: ['Aura'], enchant: TARGET.CREATURE,
    staticAbilities: [{ affected: AFFECTED.ATTACHED_PERMANENT, power: 2, keywords: [KEYWORD.TRAMPLE] }],
    triggeredAbilities: [ability(TRIGGER.PUT_INTO_GRAVEYARD, [{ type: EFFECT.DRAW_CARDS, count: 1 }])],
  },
  Alpha: {
    id: 'Alpha', name: 'Alpha', manaCost: {}, types: [CARD_TYPE.ENCHANTMENT], subtypes: ['Aura'], enchant: TARGET.CREATURE,
    staticAbilities: [{ affected: AFFECTED.ATTACHED_PERMANENT, power: 2, toughness: 2, per: { of: 'creatures', controller: 'any', sharesTypeWith: true } }],
  },
  Timberwatch: elf('Timberwatch', 1, 2, {
    abilities: [{
      id: 'pump', text: '{T}: ...', cost: { tap: true }, target: TARGET.CREATURE,
      effects: [{ type: EFFECT.PUMP, power: 1, toughness: 1, per: { of: 'creatures', controller: 'any', subtypes: ['Elf'] } }],
    }],
  }),
  Priest: elf('Priest', 1, 1, {
    abilities: [{ id: 'mana', text: '{T}: ...', cost: { tap: true }, effects: [{ type: EFFECT.ADD_MANA, mana: { G: 1 }, per: { of: 'creatures', controller: 'any', subtypes: ['Elf'] } }] }],
  }),
  Dwynen: elf('Dwynen', 3, 4, {
    supertypes: ['Legendary'],
    triggeredAbilities: [ability(TRIGGER.ATTACKS, [{ type: EFFECT.GAIN_LIFE, amount: 1, per: { of: 'creatures', subtypes: ['Elf'], attacking: true } }])],
  }),
  Ghalta: creature('Ghalta', 12, 12, { manaCost: { generic: 10, G: 2 }, costReduction: { per: { of: 'power' } } }),
  Thicket: {
    id: 'Thicket', name: 'Thicket', types: [CARD_TYPE.LAND], entersTapped: true,
    abilities: [{ id: 'tapForG', text: '{T}: Add {G}.', cost: { tap: true }, effects: [{ type: EFFECT.ADD_MANA, mana: { G: 1 } }] }],
    handAbilities: [{ id: 'cycling', text: 'Cycling', cost: { discardSelf: true }, effects: [{ type: EFFECT.DRAW_CARDS, count: 1 }] }],
  },
  OranRief: {
    id: 'OranRief', name: 'OranRief', types: [CARD_TYPE.LAND],
    abilities: [{
      id: 'grow', text: '{T}: ...', cost: { tap: true },
      effects: [{ type: EFFECT.ADD_COUNTERS, counter: '+1/+1', count: 1, affected: AFFECTED.EACH_CREATURE, filter: { colors: ['G'], enteredThisTurn: true } }],
    }],
  },
  Scout: elf('Scout', 1, 1, { keywords: [KEYWORD.BLOCKED_ONLY_BY_FLYERS] }),
  Champion: elf('Champion', 5, 4, { keywords: [KEYWORD.CANT_BE_BLOCKED_BY_POWER_2_OR_LESS] }),
  Cavalry: elf('Cavalry', 4, 4, { keywords: [KEYWORD.MAX_ONE_BLOCKER] }),
  Taunter: elf('Taunter', 0, 1, { keywords: [KEYWORD.LURE] }),
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
const byName = (game, name, controllerId) => state(game).battlefield.find((p) => p.name === name && (!controllerId || p.controllerId === controllerId));
const inHand = (game, playerId, name) => player(game, playerId).hand.find((c) => c.name === name)?.id;
const eventsNamed = (events, name) => events.filter((e) => e.name === name).map((e) => e.payload);
const ok = (game, action, what) => assert.deepEqual(game.dispatch(action), { ok: true }, what ?? action.type);

/** Passes priority until the stack is empty and no decision is pending (resolving everything). */
function settle(game) {
  for (let i = 0; i < 20 && (state(game).stack.length || state(game).pendingTriggers.length); i++) {
    assert.equal(state(game).pendingDecision, null, 'no decision while settling');
    ok(game, passPriority(state(game).priorityPlayerId));
  }
}

function cast(game, playerId, name, targets) {
  ok(game, castSpell(playerId, inHand(game, playerId, name), targets), `cast ${name}`);
}

/** Passes until `playerId`'s turn `turn`, in `phase`, confirming empty declarations on the way. */
function advanceTo(game, { turn, phase }) {
  while (state(game).turn < turn || state(game).phase !== phase || state(game).pendingDecision) {
    const { pendingDecision, validActions } = state(game);
    if (pendingDecision) game.dispatch(validActions.find((a) => a.type.startsWith('CONFIRM_')) ?? validActions.at(-1));
    else ok(game, passPriority(state(game).priorityPlayerId));
  }
}

/** Advances to p1's turn 3 declare-attackers decision. */
function toAttack(game) {
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  while (!state(game).pendingDecision) ok(game, passPriority(state(game).priorityPlayerId));
  assert.equal(state(game).pendingDecision.type, DECISION.DECLARE_ATTACKERS);
}

/** After attackers are declared: passes until the blockers decision. */
function toBlocks(game) {
  while (!state(game).pendingDecision) ok(game, passPriority(state(game).priorityPlayerId));
  assert.equal(state(game).pendingDecision.type, DECISION.DECLARE_BLOCKERS);
}

test('flash: a creature with flash can be cast on the opponent\'s turn', () => {
  const { game } = setup({ p2: ['Ambusher', 'Bear'] });
  // p1's turn 1 upkeep: p1 passes, p2 gets priority.
  ok(game, passPriority('p1'));
  const casts = state(game).validActions.filter((a) => a.type === ACTION.CAST_SPELL).map((a) => a.cardId);
  assert.deepEqual(casts, [inHand(game, 'p2', 'Ambusher')]);
  cast(game, 'p2', 'Ambusher');
  settle(game);
  assert.ok(byName(game, 'Ambusher', 'p2'));
});

test('a land that enters tapped, and cycling from the hand', () => {
  const { game, events } = setup({ p1: ['Thicket', 'Thicket'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  ok(game, playLand('p1', inHand(game, 'p1', 'Thicket')));
  assert.equal(byName(game, 'Thicket').tapped, true);
  const before = player(game, 'p1').hand.length;
  const cycle = state(game).validActions.find((a) => a.type === ACTION.ACTIVATE_ABILITY && a.abilityId === 'cycling');
  ok(game, cycle);
  assert.equal(player(game, 'p1').graveyard.length, 1);
  assert.equal(eventsNamed(events, 'cardCycled').length, 1);
  settle(game);
  assert.equal(player(game, 'p1').hand.length, before);
});

test('legend rule: the player chooses which legendary permanent to keep', () => {
  const { game, events } = setup({ p1: ['Dwynen', 'Dwynen'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'Dwynen');
  settle(game);
  const first = byName(game, 'Dwynen').id;
  cast(game, 'p1', 'Dwynen');
  ok(game, passPriority('p1'));
  ok(game, passPriority('p2'));
  const decision = state(game).pendingDecision;
  assert.equal(decision.type, DECISION.LEGEND_RULE);
  assert.equal(decision.cardIds.length, 2);
  assert.equal(state(game).validActions.length, 2);
  ok(game, keepLegend('p1', first));
  assert.deepEqual(state(game).battlefield.filter((p) => p.name === 'Dwynen').map((p) => p.id), [first]);
  assert.equal(player(game, 'p1').graveyard.length, 1);
  assert.equal(eventsNamed(events, 'permanentToGraveyard').at(-1).reason, 'legendRule');
  assert.equal(state(game).priorityPlayerId, 'p1');
});

test('"whenever another creature you control enters" and "whenever another Elf enters"', () => {
  const { game } = setup({ p1: ['Ranger', 'Vanguard', 'Bear'], p2: ['Elf'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'Ranger');
  settle(game);
  assert.equal(byName(game, 'Ranger').power, 3, 'not for itself');
  cast(game, 'p1', 'Vanguard');
  settle(game);
  assert.equal(byName(game, 'Ranger').power, 4);
  assert.equal(byName(game, 'Vanguard').power, 1, 'not for itself');
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'Elf');
  settle(game);
  assert.equal(byName(game, 'Vanguard').power, 2, "an opponent's Elf counts");
  assert.equal(byName(game, 'Ranger').power, 3, "an opponent's creature doesn't, and the pump has ended");
});

test('landfall creates a token', () => {
  const { game } = setup({ p1: ['Giant'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'Giant');
  settle(game);
  ok(game, playLand('p1', inHand(game, 'p1', 'Forest')));
  settle(game);
  assert.ok(state(game).battlefield.some((p) => p.token && p.subtypes.includes('Elf')));
});

test('an attack trigger targeting another Elf you control', () => {
  const { game } = setup({ p1: ['Brawler', 'Elf'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'Brawler');
  settle(game);
  cast(game, 'p1', 'Elf');
  settle(game);
  toAttack(game);
  ok(game, toggleAttacker('p1', byName(game, 'Brawler').id));
  ok(game, confirmAttackers('p1'));
  // The only other Elf is the target; the Brawler can't target itself.
  assert.equal(state(game).stack.at(-1).targets[0], byName(game, 'Elf').id);
  settle(game);
  assert.equal(byName(game, 'Elf').power, 3);
  assert.equal(byName(game, 'Brawler').power, 4);
});

test('a modal "attacks or blocks" trigger asks for a mode', () => {
  const { game } = setup({ p1: ['Gargaroth'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'Gargaroth');
  settle(game);
  toAttack(game);
  ok(game, toggleAttacker('p1', byName(game, 'Gargaroth').id));
  ok(game, confirmAttackers('p1'));
  const decision = state(game).pendingDecision;
  assert.equal(decision.type, DECISION.CHOOSE_MODE);
  assert.deepEqual(state(game).validActions.map((a) => a.mode), [0, 1, 2]);
  ok(game, chooseMode('p1', 1));
  settle(game);
  assert.equal(player(game, 'p1').life, 23);
});

test('a modal enters trigger skips modes with no legal target', () => {
  const { game } = setup({ p1: ['Bard'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'Bard');
  ok(game, passPriority('p1'));
  ok(game, passPriority('p2'));
  // No artifact, so the only mode left (gain 3 life) is chosen automatically.
  assert.equal(state(game).pendingDecision, null);
  settle(game);
  assert.equal(player(game, 'p1').life, 23);
});

test('a spell-cast trigger, for any player\'s green spell', () => {
  const { game } = setup({ p1: ['Chosen', 'Bear'], p2: ['GreenBear'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'Chosen');
  settle(game);
  cast(game, 'p1', 'Bear');
  settle(game);
  assert.equal(byName(game, 'Chosen').power, 1, 'a colorless spell');
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'GreenBear');
  // The trigger goes on the stack above the spell.
  assert.deepEqual(state(game).stack.map((o) => o.kind), ['spell', 'triggeredAbility']);
  settle(game);
  assert.equal(byName(game, 'Chosen').power, 2);
});

test('an Aura\'s "put into a graveyard from the battlefield" trigger', () => {
  const { game } = setup({ p1: ['Bear', 'Audacity', 'Kill'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'Bear');
  settle(game);
  const bear = byName(game, 'Bear').id;
  cast(game, 'p1', 'Audacity', [bear]);
  settle(game);
  assert.equal(byName(game, 'Bear').power, 4);
  const hand = player(game, 'p1').hand.length;
  cast(game, 'p1', 'Kill', [bear]);
  settle(game);
  assert.equal(player(game, 'p1').hand.length, hand, 'Kill left the hand, and a card was drawn');
});

test('"you may": an optional trigger can be declined, even with one target', () => {
  const { game, events } = setup({ p1: ['Trinket', 'Sage'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'Trinket');
  settle(game);
  cast(game, 'p1', 'Sage');
  ok(game, passPriority('p1'));
  ok(game, passPriority('p2'));
  assert.equal(state(game).pendingDecision.type, DECISION.CHOOSE_TARGETS);
  assert.deepEqual(state(game).validActions.map((a) => a.targets.length), [1, 0]);
  ok(game, chooseTargets('p1', []));
  assert.equal(eventsNamed(events, 'triggeredAbilityRemoved').at(-1).reason, 'Declined.');
  assert.ok(byName(game, 'Trinket'));
});

test('returning a permanent card from your graveyard to your hand', () => {
  const { game, events } = setup({ p1: ['Bear', 'Kill', 'Regrower'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'Bear');
  settle(game);
  cast(game, 'p1', 'Kill', [byName(game, 'Bear').id]);
  settle(game);
  cast(game, 'p1', 'Regrower');
  settle(game);
  // Kill is an instant, so the Bear is the only legal target.
  assert.ok(inHand(game, 'p1', 'Bear'));
  assert.equal(player(game, 'p1').graveyard.map((c) => c.name).join(), 'Kill');
  assert.equal(eventsNamed(events, 'cardReturnedFromGraveyard').length, 1);
});

test('fight: two targets, and no damage if one is gone', () => {
  const { game } = setup({ p1: ['Big', 'Pounce', 'Pounce', 'Kill'], p2: ['Bear', 'Bear'] });
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'Bear');
  settle(game);
  cast(game, 'p2', 'Bear');
  settle(game);
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'Big');
  settle(game);
  const pounces = state(game).validActions.filter((a) => a.type === ACTION.CAST_SPELL && a.cardId === inHand(game, 'p1', 'Pounce'));
  assert.equal(pounces.length, 2, 'one per opposing creature');
  const [bearA, bearB] = state(game).battlefield.filter((p) => p.name === 'Bear').map((p) => p.id);
  const big = byName(game, 'Big').id;
  cast(game, 'p1', 'Pounce', [big, bearA]);
  settle(game);
  assert.equal(state(game).battlefield.some((p) => p.id === bearA), false);
  assert.equal(byName(game, 'Big').damage, 2);
  // The second Pounce, with its second target killed in response: no damage.
  cast(game, 'p1', 'Pounce', [big, bearB]);
  cast(game, 'p1', 'Kill', [bearB]);
  settle(game);
  assert.equal(byName(game, 'Big').damage, 2);
});

test('"for each" amounts: a pump per Elf, mana per Elf, life per attacking Elf', () => {
  const { game } = setup({ p1: ['Timberwatch', 'Priest', 'Dwynen'], p2: ['Elf'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'Timberwatch');
  settle(game);
  cast(game, 'p1', 'Priest');
  settle(game);
  cast(game, 'p1', 'Dwynen');
  settle(game);
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'Elf');
  settle(game);
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  ok(game, activateAbility('p1', byName(game, 'Priest').id, 'mana'));
  assert.equal(player(game, 'p1').manaPool.G, 4, 'every Elf on the battlefield');
  ok(game, activateAbility('p1', byName(game, 'Timberwatch').id, 'pump', [byName(game, 'Dwynen').id]));
  settle(game);
  assert.equal(byName(game, 'Dwynen').power, 7);
  while (!state(game).pendingDecision) ok(game, passPriority(state(game).priorityPlayerId));
  ok(game, toggleAttacker('p1', byName(game, 'Dwynen').id));
  ok(game, confirmAttackers('p1'));
  settle(game);
  assert.equal(player(game, 'p1').life, 21, 'one attacking Elf');
});

test('"+2/+2 for each other creature that shares a creature type with it"', () => {
  const { game } = setup({ p1: ['Elf', 'Elf', 'Bear', 'Alpha'], p2: ['Elf'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  for (const name of ['Elf', 'Elf', 'Bear']) {
    cast(game, 'p1', name);
    settle(game);
  }
  const [elfA] = state(game).battlefield.filter((p) => p.name === 'Elf');
  cast(game, 'p1', 'Alpha', [elfA.id]);
  settle(game);
  assert.equal(byName(game, 'Elf').power, 1 + 2);
  assert.equal(state(game).battlefield.find((p) => p.id === elfA.id).power, 3, 'one other Elf');
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'Elf');
  settle(game);
  assert.equal(state(game).battlefield.find((p) => p.id === elfA.id).power, 5, "an opponent's Elf too");
});

test('counters on each green creature that entered this turn', () => {
  const { game } = setup({ p1: ['OranRief', 'GreenBear', 'GreenBear', 'Bear'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  ok(game, playLand('p1', inHand(game, 'p1', 'OranRief')));
  cast(game, 'p1', 'GreenBear');
  settle(game);
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'GreenBear');
  settle(game);
  cast(game, 'p1', 'Bear');
  settle(game);
  ok(game, activateAbility('p1', byName(game, 'OranRief').id, 'grow'));
  settle(game);
  const powers = state(game).battlefield.filter((p) => p.name.includes('Bear')).map((p) => `${p.name}:${p.power}`).sort();
  assert.deepEqual(powers, ['Bear:2', 'GreenBear:2', 'GreenBear:3']);
});

test('a cost reduction by the total power of your creatures', () => {
  const { game } = setup({ p1: ['Ghalta', 'Big', 'Big', 'Big'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  for (let i = 0; i < 3; i++) {
    cast(game, 'p1', 'Big');
    settle(game);
  }
  // 9 power: Ghalta costs {1}{G}{G}.
  const forests = () => state(game).battlefield.filter((p) => p.name === 'Forest' && !p.tapped);
  ok(game, playLand('p1', inHand(game, 'p1', 'Forest')));
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  ok(game, playLand('p1', inHand(game, 'p1', 'Forest')));
  for (const forest of forests()) ok(game, activateAbility('p1', forest.id, 'tapForG'));
  assert.equal(player(game, 'p1').manaPool.G, 2);
  assert.ok(!state(game).validActions.some((a) => a.type === ACTION.CAST_SPELL && a.cardId === inHand(game, 'p1', 'Ghalta')));
});

test('evasion: flyers only, not by power 2 or less, not by more than one creature', () => {
  const bear = { power: 2, keywords: [] };
  const big = { power: 3, keywords: [] };
  const flyer = { power: 1, keywords: [KEYWORD.FLYING] };
  const reach = { power: 1, keywords: [KEYWORD.REACH] };
  assert.equal(canBlockCreature(bear, CARDS.Scout), false);
  assert.equal(canBlockCreature(reach, CARDS.Scout), false);
  assert.equal(canBlockCreature(flyer, CARDS.Scout), true);
  assert.equal(canBlockCreature(bear, CARDS.Champion), false);
  assert.equal(canBlockCreature(big, CARDS.Champion), true);

  const { game } = setup({ p1: ['Cavalry'], p2: ['Bear', 'Bear'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'Cavalry');
  settle(game);
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'Bear');
  settle(game);
  cast(game, 'p2', 'Bear');
  settle(game);
  toAttack(game);
  const cavalry = byName(game, 'Cavalry').id;
  ok(game, toggleAttacker('p1', cavalry));
  ok(game, confirmAttackers('p1'));
  toBlocks(game);
  const [a, b] = state(game).battlefield.filter((p) => p.name === 'Bear').map((p) => p.id);
  ok(game, setBlocker('p2', a, cavalry));
  assert.ok(!state(game).validActions.some((x) => x.type === ACTION.SET_BLOCKER && x.cardId === b && x.attackerId === cavalry));
});

test('requirements: "must be blocked if able" and "all creatures able to block it do so"', () => {
  const lure = { id: 'lure', keywords: [KEYWORD.LURE] };
  const must = { id: 'must', keywords: [KEYWORD.MUST_BE_BLOCKED] };
  const other = { id: 'other', keywords: [] };
  const menaceLure = { id: 'menaceLure', keywords: [KEYWORD.LURE, KEYWORD.MENACE] };
  const x = { id: 'x', keywords: [] };
  const y = { id: 'y', keywords: [] };
  const z = { id: 'z', keywords: [KEYWORD.FLYING] };
  const any = () => true;
  // All able blockers on the lure.
  assert.equal(blocksLegal([lure, other], [x, y], { x: 'lure' }, any), false);
  assert.equal(blocksLegal([lure, other], [x, y], { x: 'lure', y: 'lure' }, any), true);
  assert.deepEqual(legalizeBlocks([lure, other], [x, y], { x: 'other' }, any), { x: 'lure', y: 'lure' });
  // One blocker is enough for "must be blocked"; the rest are free.
  assert.equal(blocksLegal([must, other], [x, y], {}, any), false);
  assert.equal(blocksLegal([must, other], [x, y], { y: 'must', x: 'other' }, any), true);
  const fixed = legalizeBlocks([must, other], [x, y], { x: 'other', y: 'other' }, any);
  assert.deepEqual(Object.values(fixed).sort(), ['must', 'other'], 'one blocker moves');
  assert.equal(blocksLegal([must, other], [x, y], fixed, any), true);
  // A lure with menace and only one creature able to block it: no requirement can be met.
  const onlyX = (b) => b.id === 'x';
  assert.equal(blocksLegal([menaceLure], [x, z], {}, onlyX), true);
  // Nobody able to block: nothing required.
  assert.equal(blocksLegal([must], [x], {}, () => false), true);
});

test('the engine withholds CONFIRM_BLOCKERS until the lure is blocked by everyone able', () => {
  const { game } = setup({ p1: ['Taunter', 'Bear'], p2: ['Bear', 'Flyer'] });
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'Taunter');
  settle(game);
  cast(game, 'p1', 'Bear');
  settle(game);
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'Bear');
  settle(game);
  cast(game, 'p2', 'Flyer');
  settle(game);
  toAttack(game);
  const taunter = byName(game, 'Taunter').id;
  ok(game, toggleAttacker('p1', taunter));
  ok(game, toggleAttacker('p1', byName(game, 'Bear', 'p1').id));
  ok(game, confirmAttackers('p1'));
  toBlocks(game);
  const confirmable = () => state(game).validActions.some((a) => a.type === ACTION.CONFIRM_BLOCKERS);
  assert.equal(confirmable(), false);
  ok(game, setBlocker('p2', byName(game, 'Bear', 'p2').id, taunter));
  assert.equal(confirmable(), false);
  ok(game, setBlocker('p2', byName(game, 'Flyer', 'p2').id, taunter));
  assert.equal(confirmable(), true);
});

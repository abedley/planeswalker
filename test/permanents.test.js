import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, ACTION, PHASE, STEP, CARD_TYPE, SUBTYPE, KEYWORD, TARGET, AFFECTED, EFFECT, equipAbility,
  passPriority, castSpell, activateAbility, playLand, toggleAttacker, confirmAttackers, setBlocker,
  confirmBlockers,
} from '../src/index.js';

const players = [{ id: 'p1' }, { id: 'p2' }];

// Free test cards, so whole boards can be built in one main phase.
const creature = (id, power, toughness) => ({ id, name: id, manaCost: {}, types: [CARD_TYPE.CREATURE], power, toughness });
const CARDS = {
  Bear: creature('Bear', 2, 2),
  Mouse: creature('Mouse', 1, 1),
  Talisman: {
    id: 'Talisman', name: 'Talisman', manaCost: {}, types: [CARD_TYPE.ARTIFACT],
    abilities: [{ id: 'tapForG', text: '{T}: Add {G}.', cost: { tap: true }, effect: { type: EFFECT.ADD_MANA, mana: { G: 1 } } }],
  },
  Golem: { ...creature('Golem', 2, 2), types: [CARD_TYPE.ARTIFACT, CARD_TYPE.CREATURE] },
  Altar: {
    id: 'Altar', name: 'Altar', manaCost: {}, types: [CARD_TYPE.ENCHANTMENT],
    abilities: [{ id: 'gainLife', text: '{2}: You gain 1 life.', cost: { mana: { generic: 2 } }, effect: { type: EFFECT.GAIN_LIFE, amount: 1 } }],
  },
  Might: {
    id: 'Might', name: 'Might', manaCost: {}, types: [CARD_TYPE.ENCHANTMENT], subtypes: [SUBTYPE.AURA],
    enchant: TARGET.CREATURE,
    staticAbilities: [{ affected: AFFECTED.ATTACHED_PERMANENT, power: 2, toughness: 2, keywords: [KEYWORD.TRAMPLE] }],
  },
  Wings: {
    id: 'Wings', name: 'Wings', manaCost: {}, types: [CARD_TYPE.ENCHANTMENT], subtypes: [SUBTYPE.AURA],
    enchant: TARGET.CREATURE,
    staticAbilities: [{ affected: AFFECTED.ATTACHED_PERMANENT, keywords: [KEYWORD.FLYING] }],
  },
  Blade: {
    id: 'Blade', name: 'Blade', manaCost: {}, types: [CARD_TYPE.ARTIFACT], subtypes: [SUBTYPE.EQUIPMENT],
    staticAbilities: [{ affected: AFFECTED.ATTACHED_PERMANENT, power: 2, keywords: [KEYWORD.FIRST_STRIKE] }],
    abilities: [equipAbility({ generic: 1 })],
  },
};

/** Starts with the decks in order (no shuffle, no emblems) and moves to p1's turn 1 main phase. */
function setup({ p1 = [], p2 = [] } = {}) {
  const deck = (names) => [...names, ...Array(40 - names.length).fill('forest')];
  const game = new Game({
    players, cards: CARDS, shuffleLibraries: false, emblems: { p1: [], p2: [] }, decks: { p1: deck(p1), p2: deck(p2) },
  });
  const events = [];
  game.onAny((name, payload) => events.push({ name, payload }));
  game.start();
  passRound(game);
  return { game, events };
}

const state = (game) => game.getState();
const player = (game, id) => state(game).players.find((p) => p.id === id);
const permanent = (game, id) => state(game).battlefield.find((p) => p.id === id);
const inHand = (game, playerId, name) => player(game, playerId).hand.find((c) => c.name === name);
const actionsOf = (game, type) => state(game).validActions.filter((a) => a.type === type);

function passRound(game) {
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(game.dispatch(passPriority(state(game).priorityPlayerId)), { ok: true });
  }
}

/** Passes, confirming empty declarations or taking the first choice, until the given turn and phase. */
function advanceTo(game, { turn, phase }) {
  while (state(game).turn < turn || state(game).phase !== phase) {
    const { pendingDecision, validActions } = state(game);
    if (pendingDecision) game.dispatch(validActions.find((a) => a.type.startsWith('CONFIRM_')) ?? validActions[0]);
    else passRound(game);
  }
}

/** Casts the named card from hand (with optional targets) and lets it resolve. Returns its id. */
function cast(game, playerId, name, targets) {
  const { id } = inHand(game, playerId, name);
  assert.deepEqual(game.dispatch(castSpell(playerId, id, targets)), { ok: true }, `cast ${name}`);
  passRound(game);
  return id;
}

function playForestAndTap(game, playerId) {
  game.dispatch(playLand(playerId, inHand(game, playerId, 'Forest').id));
  const forest = state(game).battlefield.find((p) => p.controllerId === playerId && p.cardId === 'forest' && !p.tapped);
  assert.deepEqual(game.dispatch(activateAbility(playerId, forest.id, 'tapForG')), { ok: true });
}

// -----------------------------------------------------------------------------
// Artifacts and enchantments

test('an artifact is cast at sorcery speed and resolves onto the battlefield', () => {
  const { game } = setup({ p1: ['Talisman'] });
  const id = inHand(game, 'p1', 'Talisman').id;
  game.dispatch(castSpell('p1', id));
  assert.deepEqual(state(game).stack.map((o) => [o.kind, o.sourceId]), [['spell', id]]);
  passRound(game);
  assert.deepEqual(permanent(game, id).types, ['Artifact']);
  assert.equal(permanent(game, id).power, undefined);
});

test('a noncreature artifact can use {T} abilities the turn it arrives', () => {
  const { game } = setup({ p1: ['Talisman'] });
  const id = cast(game, 'p1', 'Talisman');
  assert.equal(permanent(game, id).summoningSick, true);
  assert.deepEqual(game.dispatch(activateAbility('p1', id, 'tapForG')), { ok: true });
  assert.equal(player(game, 'p1').manaPool.G, 1);
});

test('an artifact creature is both, and has summoning sickness', () => {
  const { game } = setup({ p1: ['Golem'] });
  const id = cast(game, 'p1', 'Golem');
  assert.deepEqual(permanent(game, id).types, ['Artifact', 'Creature']);
  passRound(game); // -> combat
  passRound(game); // -> declare attackers: the Golem can't attack yet
  assert.equal(state(game).pendingDecision, null);
});

test('an enchantment\'s activated ability can be used at instant speed, even on the opponent\'s turn', () => {
  const { game, events } = setup({ p1: ['Altar', 'Talisman'] });
  const altar = cast(game, 'p1', 'Altar');
  const talisman = cast(game, 'p1', 'Talisman');
  game.dispatch(playLand('p1', inHand(game, 'p1', 'Forest').id));
  const forest = state(game).battlefield.find((p) => p.cardId === 'forest').id;
  advanceTo(game, { turn: 2, phase: PHASE.BEGINNING });
  assert.equal(state(game).step, STEP.UPKEEP);
  game.dispatch(passPriority('p2')); // p1 gets priority in p2's upkeep
  game.dispatch(activateAbility('p1', forest, 'tapForG'));
  assert.ok(!actionsOf(game, ACTION.ACTIVATE_ABILITY).some((a) => a.cardId === altar)); // {2} needs two mana
  game.dispatch(activateAbility('p1', talisman, 'tapForG'));
  assert.deepEqual(game.dispatch(activateAbility('p1', altar, 'gainLife')), { ok: true });
  assert.equal(state(game).stack.length, 1);
  passRound(game);
  assert.equal(player(game, 'p1').life, 21);
  assert.equal(state(game).activePlayerId, 'p2');
  assert.ok(events.some((e) => e.name === 'lifeGained'));
});

// -----------------------------------------------------------------------------
// Auras

test('an Aura spell targets a creature: one cast action per legal target', () => {
  const { game } = setup({ p1: ['Bear', 'Might'], p2: ['Mouse'] });
  const might = inHand(game, 'p1', 'Might').id;
  // No creatures yet: the Aura can't be cast.
  assert.deepEqual(actionsOf(game, ACTION.CAST_SPELL).filter((a) => a.cardId === might), []);
  const bear = cast(game, 'p1', 'Bear');
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  const mouse = cast(game, 'p2', 'Mouse');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  // Any creature can be enchanted, including the opponent's.
  assert.deepEqual(
    actionsOf(game, ACTION.CAST_SPELL).filter((a) => a.cardId === might),
    [
      { type: ACTION.CAST_SPELL, playerId: 'p1', cardId: might, targets: [bear] },
      { type: ACTION.CAST_SPELL, playerId: 'p1', cardId: might, targets: [mouse] },
    ],
  );
  assert.equal(game.dispatch(castSpell('p1', might)).ok, false); // a target is required
});

test('an Aura enters attached to its target and changes its power, toughness and keywords', () => {
  const { game, events } = setup({ p1: ['Bear', 'Might'] });
  const bear = cast(game, 'p1', 'Bear');
  const might = inHand(game, 'p1', 'Might').id;
  game.dispatch(castSpell('p1', might, [bear]));
  assert.deepEqual(state(game).stack[0].targets, [bear]);
  passRound(game);

  assert.equal(permanent(game, might).attachedTo, bear);
  const host = permanent(game, bear);
  assert.deepEqual([host.power, host.toughness, host.keywords], [4, 4, ['trample']]);
  assert.deepEqual([host.base.power, host.base.toughness, host.base.keywords], [2, 2, []]);
  assert.ok(events.some((e) => e.name === 'attached' && e.payload.cardId === might && e.payload.attachedTo === bear));
});

test('an Aura goes to its owner\'s graveyard when the enchanted creature dies', () => {
  const { game, events } = setup({ p1: ['Bear', 'Wings'], p2: ['Mouse'] });
  const bear = cast(game, 'p1', 'Bear');
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  const mouse = cast(game, 'p2', 'Mouse');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  // p1 gives the opponent's Mouse flying, then attacks: the flying Mouse blocks and dies.
  const wings = cast(game, 'p1', 'Wings', [mouse]);
  assert.deepEqual(permanent(game, mouse).keywords, ['flying']);
  passRound(game);
  passRound(game);
  game.dispatch(toggleAttacker('p1', bear));
  game.dispatch(confirmAttackers('p1'));
  passRound(game);
  game.dispatch(setBlocker('p2', mouse, bear));
  game.dispatch(confirmBlockers('p2'));
  passRound(game);

  assert.ok(!permanent(game, mouse));
  assert.ok(!permanent(game, wings));
  assert.ok(player(game, 'p1').graveyard.some((c) => c.id === wings)); // owner's graveyard
  const deadMouse = player(game, 'p2').graveyard.find((c) => c.id === mouse);
  assert.deepEqual([deadMouse.power, deadMouse.keywords], [1, []]); // printed values again
  assert.equal(events.find((e) => e.name === 'permanentToGraveyard').payload.reason, 'auraNotLegallyAttached');
});

// -----------------------------------------------------------------------------
// Equipment

test('Equipment enters unattached; equip is a sorcery-speed ability that targets your creature', () => {
  const { game } = setup({ p1: ['Bear', 'Mouse', 'Blade'], p2: ['Mouse'] });
  const bear = cast(game, 'p1', 'Bear');
  const mouse = cast(game, 'p1', 'Mouse');
  const blade = cast(game, 'p1', 'Blade');
  assert.equal(permanent(game, blade).attachedTo, null);
  const equips = () => actionsOf(game, ACTION.ACTIVATE_ABILITY).filter((a) => a.abilityId === 'equip');
  assert.deepEqual(equips(), []); // Equip {1} needs mana

  playForestAndTap(game, 'p1');
  assert.deepEqual(equips(), [
    { type: ACTION.ACTIVATE_ABILITY, playerId: 'p1', cardId: blade, abilityId: 'equip', targets: [bear] },
    { type: ACTION.ACTIVATE_ABILITY, playerId: 'p1', cardId: blade, abilityId: 'equip', targets: [mouse] },
  ]);
  // Not at instant speed: after passing into combat, it's gone.
  passRound(game);
  assert.equal(state(game).phase, PHASE.COMBAT);
  assert.deepEqual(equips(), []);
});

test('equipping uses the stack, attaches, and grants the bonus; re-equipping moves it', () => {
  const { game, events } = setup({ p1: ['Bear', 'Mouse', 'Blade'] });
  const bear = cast(game, 'p1', 'Bear');
  const mouse = cast(game, 'p1', 'Mouse');
  const blade = cast(game, 'p1', 'Blade');
  playForestAndTap(game, 'p1');
  game.dispatch(activateAbility('p1', blade, 'equip', [bear]));
  assert.equal(player(game, 'p1').manaPool.G, 0); // paid {1} with {G}
  assert.deepEqual(state(game).stack.map((o) => [o.abilityId, o.targets]), [['equip', [bear]]]);
  assert.equal(permanent(game, blade).attachedTo, null);
  passRound(game);

  assert.equal(permanent(game, blade).attachedTo, bear);
  assert.deepEqual([permanent(game, bear).power, permanent(game, bear).toughness, permanent(game, bear).keywords], [4, 2, ['first strike']]);

  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  playForestAndTap(game, 'p1');
  // Not offered for the creature it's already attached to.
  assert.deepEqual(
    actionsOf(game, ACTION.ACTIVATE_ABILITY).filter((a) => a.abilityId === 'equip').map((a) => a.targets),
    [[mouse]],
  );
  game.dispatch(activateAbility('p1', blade, 'equip', [mouse]));
  passRound(game);
  assert.equal(permanent(game, blade).attachedTo, mouse);
  assert.deepEqual([permanent(game, bear).power, permanent(game, bear).keywords], [2, []]);
  assert.deepEqual([permanent(game, mouse).power, permanent(game, mouse).keywords], [3, ['first strike']]);
  assert.equal(events.findLast((e) => e.name === 'attached').payload.from, bear);
});

test('you can\'t equip the opponent\'s creatures', () => {
  const { game } = setup({ p1: ['Blade'], p2: ['Bear'] });
  const blade = cast(game, 'p1', 'Blade');
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  const bear = cast(game, 'p2', 'Bear');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  playForestAndTap(game, 'p1');
  assert.equal(game.dispatch(activateAbility('p1', blade, 'equip', [bear])).ok, false);
});

test('first strike granted by Equipment creates a first-strike damage step', () => {
  const { game, events } = setup({ p1: ['Mouse', 'Blade'], p2: ['Bear'] });
  const mouse = cast(game, 'p1', 'Mouse');
  const blade = cast(game, 'p1', 'Blade');
  playForestAndTap(game, 'p1');
  game.dispatch(activateAbility('p1', blade, 'equip', [mouse]));
  passRound(game);
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  const bear = cast(game, 'p2', 'Bear');
  // p2's Bear attacks on turn 4 and p1's 3/1 first-striking Mouse blocks: the Bear dies first.
  advanceTo(game, { turn: 4, phase: PHASE.PRECOMBAT_MAIN });
  passRound(game);
  passRound(game);
  game.dispatch(toggleAttacker('p2', bear));
  game.dispatch(confirmAttackers('p2'));
  passRound(game);
  game.dispatch(setBlocker('p1', mouse, bear));
  game.dispatch(confirmBlockers('p1'));
  passRound(game);
  assert.equal(state(game).step, STEP.FIRST_STRIKE_DAMAGE); // first strike came from the Equipment
  assert.ok(!permanent(game, bear));
  assert.ok(permanent(game, mouse));

  assert.equal(permanent(game, blade).attachedTo, mouse);
  assert.ok(events.every((e) => e.name !== 'unattached'));
});

test('Equipment becomes unattached when its creature dies', () => {
  const { game, events } = setup({ p1: ['Mouse', 'Blade'], p2: ['Bear', 'Bear'] });
  const mouse = cast(game, 'p1', 'Mouse');
  const blade = cast(game, 'p1', 'Blade');
  playForestAndTap(game, 'p1');
  game.dispatch(activateAbility('p1', blade, 'equip', [mouse]));
  passRound(game);
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  const bears = [cast(game, 'p2', 'Bear'), cast(game, 'p2', 'Bear')];
  // p1 attacks with the 3/1 first-striker; both Bears block. It kills one, the other kills it.
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  passRound(game);
  passRound(game);
  game.dispatch(toggleAttacker('p1', mouse));
  game.dispatch(confirmAttackers('p1'));
  passRound(game);
  for (const bear of bears) game.dispatch(setBlocker('p2', bear, mouse));
  game.dispatch(confirmBlockers('p2'));
  passRound(game);
  // Divide the 3 first-strike damage: all of it to the first Bear.
  const choice = state(game).validActions.find((a) => a.assignment?.[bears[0]] === 3);
  game.dispatch(choice);
  passRound(game); // regular damage: the surviving Bear kills the Mouse

  assert.ok(!permanent(game, mouse));
  assert.equal(permanent(game, blade).attachedTo, null);
  assert.ok(events.some((e) => e.name === 'unattached' && e.payload.cardId === blade && e.payload.from === mouse));
});

test('two basic AIs play a full game with artifacts, enchantments, Auras and Equipment', async () => {
  const { BasicAIController, SAMPLE_PERMANENTS, SAMPLE_PERMANENTS_DECK, GAME_STATUS } = await import('../src/index.js');
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const game = new Game({ players, seed, cards: SAMPLE_PERMANENTS, decks: { p1: SAMPLE_PERMANENTS_DECK, p2: SAMPLE_PERMANENTS_DECK } });
    const ais = players.map(({ id }) => new BasicAIController({ game, playerId: id, delayMs: null }));
    const seen = new Set();
    const rejected = [];
    game.on('spellCast', (e) => seen.add(e.cardName));
    game.on('attached', () => seen.add('attached'));
    game.on('actionRejected', (e) => rejected.push(e));
    game.start();
    ais.forEach((ai) => ai.detach());
    assert.equal(game.getState().status, GAME_STATUS.GAME_OVER, `seed ${seed}`);
    assert.deepEqual(rejected, [], `seed ${seed}`);
    assert.ok(seen.has('attached'), `seed ${seed}: something got attached`);
  }
});

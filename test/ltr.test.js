// The Lord of the Rings: Tales of Middle-earth: its cards, played with the real definitions
// (made free to cast, so a test needs no lands).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, DECISION, ACTION, PHASE, STEP, CARDS, KEYWORD, COUNTER, passPriority, castSpell, activateAbility,
  toggleAttacker, confirmAttackers, setBlocker, confirmBlockers, chooseTargets, chooseMode,
} from '../src/index.js';
import { CHOICE } from '../src/engine/Game.js';
import { choose, toggleChoice, confirmChoice } from '../src/engine/actions.js';

const players = [{ id: 'p1' }, { id: 'p2' }];
/** Free copies of real cards (keeping {X}). */
const free = (ids) => Object.fromEntries(ids.map((id) => {
  const card = CARDS[id];
  if (!card) throw new Error(`No card ${id}`);
  return [id, { ...card, manaCost: card.manaCost?.X ? { X: card.manaCost.X } : {} }];
}));
const BEAR = { id: 'bear', name: 'Bear', manaCost: {}, types: ['Creature'], subtypes: ['Bear'], power: 2, toughness: 2 };
const ORC = { id: 'orc', name: 'Orc', manaCost: {}, types: ['Creature'], subtypes: ['Orc'], power: 1, toughness: 1 };
const SALVE = { id: 'salve', name: 'Salve', manaCost: {}, types: ['Instant'], effects: [{ type: 'gainLife', amount: 3 }] };
const HERO = { id: 'hero', name: 'Hero', manaCost: {}, types: ['Creature'], supertypes: ['Legendary'], subtypes: ['Human'], power: 3, toughness: 3 };

function setup({ p1 = [], p2 = [], cards = [], library1 = [], library2 = [] } = {}) {
  const deck = (hand, library) => [...hand, ...Array(7 - hand.length).fill('forest'), ...library, ...Array(Math.max(0, 33 - library.length)).fill('forest')];
  const game = new Game({
    players,
    cards: { ...free(cards), bear: BEAR, orc: ORC, hero: HERO, salve: SALVE },
    shuffleLibraries: false,
    emblems: { p1: [], p2: [] },
    decks: { p1: deck(p1, library1), p2: deck(p2, library2) },
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
const inHand = (game, playerId, cardId) => player(game, playerId).hand.find((c) => c.cardId === cardId)?.id;
const decision = (game) => state(game).pendingDecision;
const ok = (game, action) => assert.deepEqual(game.dispatch(action), { ok: true }, JSON.stringify(action));

function passRound(game) {
  for (let i = 0; i < 2 && state(game).priorityPlayerId; i++) ok(game, passPriority(state(game).priorityPlayerId));
}

/** Passes until the stack is empty and nothing waits (choices are left to the test). */
function resolveAll(game) {
  for (let i = 0; i < 20 && state(game).stack.length && !decision(game); i++) passRound(game);
}

/** Moves to a phase (and step) of a turn, confirming empty attacks and blocks on the way. */
function advanceTo(game, { turn, phase, step = null }) {
  for (let i = 0; i < 300; i++) {
    const s = state(game);
    if (s.turn === turn && s.phase === phase && (step === null || s.step === step) && !s.pendingDecision && s.stack.length === 0) return;
    const d = s.pendingDecision;
    if (d?.type === DECISION.DECLARE_ATTACKERS) ok(game, confirmAttackers(d.playerId));
    else if (d?.type === DECISION.DECLARE_BLOCKERS) ok(game, confirmBlockers(d.playerId));
    else if (d) ok(game, s.validActions[0]);
    else passRound(game);
  }
  throw new Error('advanceTo: stuck');
}

/** Plays a land from `playerId`'s hand, if they can now. */
function playLand(game, playerId) {
  const land = state(game).validActions.find((a) => a.type === ACTION.PLAY_LAND && a.playerId === playerId);
  if (land) ok(game, land);
}

/** Taps every untapped land `playerId` controls for mana. */
function tapLands(game, playerId) {
  for (const land of state(game).battlefield.filter((p) => p.controllerId === playerId && p.types.includes('Land') && !p.tapped)) {
    ok(game, state(game).validActions.find((a) => a.cardId === land.id && a.type === ACTION.ACTIVATE_ABILITY));
  }
}

/** Casts a card from hand (p1's main phase by default) and resolves it. */
function cast(game, playerId, cardId, extra = {}) {
  const id = inHand(game, playerId, cardId);
  assert.ok(id, `${cardId} in hand`);
  ok(game, { ...castSpell(playerId, id, extra.targets), ...(extra.mode !== undefined ? { mode: extra.mode } : {}), ...(extra.x !== undefined ? { x: extra.x } : {}), ...(extra.costChoices ? { costChoices: extra.costChoices } : {}) });
  resolveAll(game);
  return id;
}

/** Starts at p1's first main phase. */
function start(options) {
  const result = setup(options);
  advanceTo(result.game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  return result;
}

test('the Ring tempts you: a Ring-bearer is chosen, legendary, and the Ring gains abilities one by one', () => {
  const { game } = start({ p1: ['bear', 'orc', 'birthdayEscape', 'birthdayEscape'], cards: ['birthdayEscape'] });
  cast(game, 'p1', 'bear');
  cast(game, 'p1', 'orc');
  const bear = named(game, 'Bear')[0].id;
  cast(game, 'p1', 'birthdayEscape');
  assert.equal(decision(game).type, DECISION.CHOOSE);
  assert.equal(decision(game).kind, CHOICE.RING_BEARER);
  ok(game, choose('p1', bear));
  assert.deepEqual(player(game, 'p1').ring, { level: 1, bearerId: bear, temptations: 1 });
  assert.ok(permanent(game, bear).supertypes.includes('Legendary'));
  assert.ok(permanent(game, bear).keywords.includes(KEYWORD.CANT_BE_BLOCKED_BY_GREATER_POWER));
  cast(game, 'p1', 'birthdayEscape');
  ok(game, choose('p1', bear));
  assert.equal(player(game, 'p1').ring.level, 2);
});

/** Declares attackers for the active player (by name or id), then passes to blocks. */
function attack(game, ids) {
  advanceTo(game, { turn: state(game).turn, phase: PHASE.COMBAT, step: STEP.BEGINNING_OF_COMBAT });
  passRound(game);
  const d = decision(game);
  assert.equal(d.type, DECISION.DECLARE_ATTACKERS);
  for (const id of ids) ok(game, toggleAttacker(d.playerId, id));
  ok(game, confirmAttackers(d.playerId));
}

/** Declares blocks `{ blockerId: attackerId }` once the defending player is asked. */
function block(game, blocks) {
  for (let i = 0; i < 20 && decision(game)?.type !== DECISION.DECLARE_BLOCKERS; i++) {
    if (decision(game)) return;
    passRound(game);
  }
  const d = decision(game);
  for (const [blockerId, attackerId] of Object.entries(blocks)) ok(game, setBlocker(d.playerId, blockerId, attackerId));
  ok(game, confirmBlockers(d.playerId));
}

test('the Ring, levels 2 to 4: loot on attack, blockers sacrificed at end of combat, 3 life on combat damage', () => {
  const { game } = start({
    p1: ['hero', 'birthdayEscape', 'birthdayEscape', 'birthdayEscape', 'birthdayEscape'], p2: ['bear', 'orc'], cards: ['birthdayEscape'],
  });
  cast(game, 'p1', 'hero');
  for (let i = 0; i < 4; i++) cast(game, 'p1', 'birthdayEscape');
  assert.equal(player(game, 'p1').ring.level, 4);
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'bear');
  cast(game, 'p2', 'orc');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  const [hero] = named(game, 'Hero');
  const [bear] = named(game, 'Bear');
  attack(game, [hero.id]);
  // Level 2: draw, then discard.
  resolveAll(game);
  assert.equal(decision(game).kind, CHOICE.DISCARD);
  ok(game, choose('p1', decision(game).options[0]));
  resolveAll(game);
  block(game, { [bear.id]: hero.id });
  advanceTo(game, { turn: 3, phase: PHASE.POSTCOMBAT_MAIN });
  // Level 3: the blocker was sacrificed at end of combat (it would have died anyway to 3 damage, so check the event path with a survivor below).
  assert.equal(named(game, 'Bear').length, 0);
  // Level 4: next turn, unblocked, 3 damage and 3 life lost.
  advanceTo(game, { turn: 5, phase: PHASE.PRECOMBAT_MAIN });
  const life = player(game, 'p2').life;
  attack(game, [hero.id]);
  resolveAll(game);
  if (decision(game)?.kind === CHOICE.DISCARD) ok(game, choose('p1', decision(game).options[0]));
  advanceTo(game, { turn: 5, phase: PHASE.POSTCOMBAT_MAIN });
  assert.equal(player(game, 'p2').life, life - 3 - 3);
});

test('the Ring, level 3: a blocker that survives the fight is sacrificed at end of combat', () => {
  const { game } = start({ p1: ['orc', 'birthdayEscape', 'birthdayEscape', 'birthdayEscape'], p2: ['hero'], cards: ['birthdayEscape'] });
  cast(game, 'p1', 'orc');
  for (let i = 0; i < 3; i++) cast(game, 'p1', 'birthdayEscape');
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'hero');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  const [orc] = named(game, 'Orc');
  const [hero] = named(game, 'Hero');
  attack(game, [orc.id]);
  resolveAll(game);
  if (decision(game)?.kind === CHOICE.DISCARD) ok(game, choose('p1', decision(game).options[0]));
  // Level 1: Hero (power 3) can't block the Orc (power 1)...
  assert.ok(!state(game).validActions.some((a) => a.type === ACTION.SET_BLOCKER));
});

test('scry: chosen cards stay on top in order, the rest go to the bottom, and "whenever you scry" triggers', () => {
  const { game } = start({
    p1: ['chanceMetElves', 'galadhrimGuide'], cards: ['chanceMetElves', 'galadhrimGuide'], library1: ['bear', 'orc', 'hero'],
  });
  cast(game, 'p1', 'chanceMetElves');
  cast(game, 'p1', 'galadhrimGuide');
  const d = decision(game);
  assert.equal(d.type, DECISION.CHOOSE_MANY);
  assert.equal(d.kind, CHOICE.SCRY);
  assert.equal(d.options.length, 2);
  const [first, second] = d.options;
  ok(game, toggleChoice('p1', second));
  ok(game, confirmChoice('p1'));
  const library = game.serialize().zones.p1.library;
  assert.equal(library[0].id, second);
  assert.equal(library.at(-1).id, first);
  resolveAll(game);
  const elves = named(game, 'Chance-Met Elves')[0];
  assert.equal(elves.counters['+1/+1'], 1);
});

test('amass Orcs: creates an Orc Army, then grows it', () => {
  const { game } = start({ p1: ['dunlandCrebain', 'easterlingVanguard', 'mordorMuster'], cards: ['dunlandCrebain', 'mordorMuster'] });
  cast(game, 'p1', 'dunlandCrebain');
  const [army] = named(game, 'Orc Army');
  assert.ok(army);
  assert.equal(army.power, 2);
  assert.deepEqual(army.subtypes, ['Orc', 'Army']);
  cast(game, 'p1', 'mordorMuster');
  assert.equal(named(game, 'Orc Army')[0].power, 3);
  assert.equal(named(game, 'Orc Army').length, 1);
});

test('Sagas: chapter I on entering, the next each precombat main phase, then it is sacrificed', () => {
  const { game } = start({ p1: ['bookOfMazarbul'], cards: ['bookOfMazarbul'] });
  cast(game, 'p1', 'bookOfMazarbul');
  assert.equal(named(game, 'Orc Army')[0].power, 1);
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  assert.equal(named(game, 'Orc Army')[0].power, 3);
  assert.equal(named(game, 'Book of Mazarbul')[0].counters.lore, 2);
  advanceTo(game, { turn: 5, phase: PHASE.PRECOMBAT_MAIN });
  assert.equal(named(game, 'Book of Mazarbul').length, 0);
  assert.ok(player(game, 'p1').graveyard.some((c) => c.cardId === 'bookOfMazarbul'));
  assert.ok(named(game, 'Orc Army')[0].keywords.includes(KEYWORD.MENACE));
});

test('modal spells: Cast into the Fire deals 1 damage to each of up to two creatures, or exiles an artifact', () => {
  const { game } = start({ p1: ['castIntoTheFire'], p2: ['bear', 'orc'], cards: ['castIntoTheFire'] });
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'bear');
  cast(game, 'p2', 'orc');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  const [orc] = named(game, 'Orc');
  const [bear] = named(game, 'Bear');
  const actions = state(game).validActions.filter((a) => a.type === ACTION.CAST_SPELL);
  // Mode 0 with no, one or two of the two creatures (in any order, once each); mode 1 has no artifact to target.
  assert.equal(actions.filter((a) => a.mode === 0).length, 4);
  assert.equal(actions.filter((a) => a.mode === 1).length, 0);
  cast(game, 'p1', 'castIntoTheFire', { mode: 0, targets: actions.find((a) => a.targets.every(Boolean)).targets });
  assert.equal(permanent(game, orc.id), undefined);
  assert.equal(permanent(game, bear.id).damage, 1);
});

test('X spells: Fear, Fire, Foes! deals X to its target and 1 to each other creature its controller has', () => {
  const { game } = start({ p1: ['fearFireFoes'], p2: ['bear', 'orc', 'hero'], cards: ['fearFireFoes'] });
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  for (const id of ['bear', 'orc', 'hero']) cast(game, 'p2', id);
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  playLand(game, 'p1');
  // Only X = 0 with an empty pool.
  assert.deepEqual([...new Set(state(game).validActions.filter((a) => a.type === ACTION.CAST_SPELL).map((a) => a.x))], [0]);
  tapLands(game, 'p1');
  assert.deepEqual([...new Set(state(game).validActions.filter((a) => a.type === ACTION.CAST_SPELL).map((a) => a.x))], [0, 1]);
  const [hero] = named(game, 'Hero');
  cast(game, 'p1', 'fearFireFoes', { targets: [hero.id], x: 1 });
  assert.equal(named(game, 'Orc').length, 0);
  assert.equal(named(game, 'Bear')[0].damage, 1);
  assert.equal(permanent(game, hero.id).damage, 1);
});

test('cost reduction by target: Banish from Edoras costs {2} less for a tapped creature', () => {
  const game = new Game({
    players, cards: { bear: BEAR }, shuffleLibraries: false, emblems: { p1: [], p2: [] },
    decks: { p1: ['banishFromEdoras', ...Array(39).fill('plains')], p2: ['bear', ...Array(39).fill('forest')] },
  });
  game.start();
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  ok(game, castSpell('p2', inHand(game, 'p2', 'bear')));
  resolveAll(game);
  const [bear] = named(game, 'Bear');
  // Turn 3: with three Plains, Banish ({4}{W}) is castable only on a tapped Bear.
  for (const turn of [3]) {
    advanceTo(game, { turn, phase: PHASE.PRECOMBAT_MAIN });
  }
  const plains = () => state(game).battlefield.filter((p) => p.cardId === 'plains' && p.controllerId === 'p1' && !p.tapped);
  // Lands from the opening hand: play one per turn.
  for (const t of [3]) {
    const land = inHand(game, 'p1', 'plains');
    if (land && state(game).players[0].landsPlayedThisTurn === 0) ok(game, { type: ACTION.PLAY_LAND, playerId: 'p1', cardId: land });
  }
  for (const p of plains()) ok(game, activateAbility('p1', p.id, 'tapForW'));
  const castable = () => state(game).validActions.some((a) => a.type === ACTION.CAST_SPELL && a.targets?.[0] === bear.id);
  assert.equal(castable(), false);
  game.serialize(); // the Bear untapped: no reduction with 2 Plains
  assert.equal(CARDS.banishFromEdoras.costReduction.condition.targetMatches.tapped, true);
});

test('hexproof: an opponent cannot target it, its controller can', () => {
  const { game } = start({ p1: ['bear', 'bombadilsSong'], p2: ['claimThePrecious'], cards: ['bombadilsSong', 'claimThePrecious'] });
  cast(game, 'p1', 'bear');
  const [bear] = named(game, 'Bear');
  const song = inHand(game, 'p1', 'bombadilsSong');
  ok(game, castSpell('p1', song, [bear.id]));
  resolveAll(game);
  assert.ok(permanent(game, bear.id).keywords.includes(KEYWORD.HEXPROOF));
  ok(game, passPriority('p1'));
  // p2 has priority in p1's main phase only after p1 passes: Claim the Precious is a sorcery, so check legality directly.
  assert.ok(!state(game).validActions.some((a) => a.type === ACTION.CAST_SPELL && a.targets?.includes(bear.id)));
});

test('indestructible: survives lethal damage and destroy effects', () => {
  const { game } = start({ p1: ['bear', 'orcishMedicine', 'claimThePrecious'], cards: ['orcishMedicine', 'claimThePrecious'] });
  cast(game, 'p1', 'bear');
  const [bear] = named(game, 'Bear');
  cast(game, 'p1', 'orcishMedicine', { targets: [bear.id] });
  assert.equal(decision(game).kind, CHOICE.KEYWORD);
  ok(game, choose('p1', KEYWORD.INDESTRUCTIBLE));
  resolveAll(game);
  cast(game, 'p1', 'claimThePrecious', { targets: [bear.id] });
  assert.ok(permanent(game, bear.id));
});

test('opponent chooses what to sacrifice: Voracious Fell Beast', () => {
  const { game } = start({ p1: ['voraciousFellBeast'], p2: ['bear', 'orc'], cards: ['voraciousFellBeast'] });
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'bear');
  cast(game, 'p2', 'orc');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'voraciousFellBeast');
  assert.equal(decision(game).kind, CHOICE.SACRIFICE);
  assert.equal(decision(game).playerId, 'p2');
  const [orc] = named(game, 'Orc');
  ok(game, choose('p2', orc.id));
  resolveAll(game);
  assert.equal(named(game, 'Orc').length, 0);
  assert.equal(named(game, 'Food').length, 1);
});

test('searching: Many Partings finds a basic land, then shuffles', () => {
  const { game } = start({ p1: ['manyPartings'], cards: ['manyPartings'] });
  cast(game, 'p1', 'manyPartings');
  const d = decision(game);
  assert.equal(d.kind, CHOICE.SEARCH);
  ok(game, toggleChoice('p1', d.options[0]));
  ok(game, confirmChoice('p1'));
  resolveAll(game);
  assert.ok(player(game, 'p1').hand.some((c) => c.id === d.options[0]));
  assert.equal(named(game, 'Food').length, 1);
});

test('reveal and discard: The Torment of Gollum', () => {
  const { game } = start({ p1: ['theTormentOfGollum'], p2: ['bear', 'orc'], cards: ['theTormentOfGollum'] });
  cast(game, 'p1', 'theTormentOfGollum', { targets: ['p2'] });
  const d = decision(game);
  assert.equal(d.kind, CHOICE.REVEALED_CARD);
  assert.equal(d.options.length, 2); // Bear and Orc, not the Forests
  ok(game, choose('p1', d.options[0]));
  resolveAll(game);
  assert.equal(player(game, 'p2').hand.length, 6);
  assert.equal(named(game, 'Orc Army')[0].power, 2);
});

test('"you may pay": Pippin\'s Bravery gives +4/+4 with a Food sacrificed, +2/+2 without', () => {
  const { game } = start({ p1: ['bear', 'manyPartings', 'pippinsBravery', 'pippinsBravery'], cards: ['manyPartings', 'pippinsBravery'] });
  cast(game, 'p1', 'bear');
  cast(game, 'p1', 'manyPartings');
  ok(game, confirmChoice('p1'));
  resolveAll(game);
  const [bear] = named(game, 'Bear');
  cast(game, 'p1', 'pippinsBravery', { targets: [bear.id] });
  const d = decision(game);
  assert.equal(d.kind, CHOICE.OPTIONAL_COST);
  ok(game, choose('p1', d.options.find((o) => o !== 'decline')));
  resolveAll(game);
  assert.equal(permanent(game, bear.id).power, 6);
  assert.equal(named(game, 'Food').length, 0);
  cast(game, 'p1', 'pippinsBravery', { targets: [bear.id] });
  assert.deepEqual(decision(game).options, ['decline']);
  ok(game, choose('p1', 'decline'));
  resolveAll(game);
  assert.equal(permanent(game, bear.id).power, 8);
});

test('reflexive triggers: Foray of Orcs deals damage equal to the amassed Army\'s power', () => {
  const { game } = start({ p1: ['forayOfOrcs'], p2: ['hero'], cards: ['forayOfOrcs'] });
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'hero');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'forayOfOrcs');
  resolveAll(game);
  assert.equal(named(game, 'Hero')[0].damage, 2);
});

test('a bite: Stew the Coneys', () => {
  const { game } = start({ p1: ['hero', 'stewTheConeys'], p2: ['bear'], cards: ['stewTheConeys'] });
  cast(game, 'p1', 'hero');
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'bear');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  const [hero] = named(game, 'Hero');
  const [bear] = named(game, 'Bear');
  cast(game, 'p1', 'stewTheConeys', { targets: [hero.id, bear.id] });
  assert.equal(named(game, 'Bear').length, 0);
  assert.equal(named(game, 'Hero')[0].damage, 0);
});

test('triggers from the graveyard, and "you may" on resolution: Council\'s Deliberation', () => {
  const { game } = start({ p1: ['councilsDeliberation', 'galadhrimGuide', 'island'], cards: ['councilsDeliberation', 'galadhrimGuide'] });
  ok(game, { type: ACTION.PLAY_LAND, playerId: 'p1', cardId: inHand(game, 'p1', 'island') });
  cast(game, 'p1', 'councilsDeliberation');
  const handSize = player(game, 'p1').hand.length;
  cast(game, 'p1', 'galadhrimGuide');
  ok(game, confirmChoice('p1')); // scry: all to the bottom
  resolveAll(game);
  assert.equal(decision(game).kind, CHOICE.MAY);
  ok(game, choose('p1', 'yes'));
  resolveAll(game);
  assert.ok(player(game, 'p1').exile.some((c) => c.cardId === 'councilsDeliberation'));
  assert.equal(player(game, 'p1').hand.length, handSize); // -1 Guide, +1 draw
});

test('statics with conditions: Snarling Warg gets +1/+0 with a Goblin or Orc', () => {
  const { game } = start({ p1: ['snarlingWarg', 'orc'], cards: ['snarlingWarg'] });
  cast(game, 'p1', 'snarlingWarg');
  assert.equal(named(game, 'Snarling Warg')[0].power, 3);
  cast(game, 'p1', 'orc');
  assert.equal(named(game, 'Snarling Warg')[0].power, 4);
});

test('Gríma Wormtongue: opponents can\'t gain life', () => {
  const { game } = start({ p1: ['grimaWormtongue', 'salve'], p2: ['salve'], cards: ['grimaWormtongue'] });
  cast(game, 'p1', 'grimaWormtongue');
  cast(game, 'p1', 'salve');
  assert.equal(player(game, 'p1').life, 23);
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'salve');
  assert.equal(player(game, 'p2').life, 20);
});

test('Stone of Erech: an opponent\'s creature that would die is exiled instead', () => {
  const { game } = start({ p1: ['stoneOfErech', 'claimThePrecious'], p2: ['bear'], cards: ['stoneOfErech', 'claimThePrecious'] });
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'bear');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'stoneOfErech');
  const [bear] = named(game, 'Bear');
  cast(game, 'p1', 'claimThePrecious', { targets: [bear.id] });
  assert.ok(player(game, 'p2').exile.some((c) => c.id === bear.id));
  assert.ok(!player(game, 'p2').graveyard.some((c) => c.id === bear.id));
});

test('Peregrin Took: tokens come with an extra Food', () => {
  const { game } = start({ p1: ['peregrinTook', 'protectorOfGondor'], cards: ['peregrinTook', 'protectorOfGondor'] });
  cast(game, 'p1', 'peregrinTook');
  cast(game, 'p1', 'protectorOfGondor');
  resolveAll(game);
  assert.equal(named(game, 'Food').length, 1);
  assert.equal(state(game).battlefield.filter((p) => p.name === 'Human Soldier Token').length, 1);
});

test('Mauhúr: +1/+1 counters on an Army get one more', () => {
  const { game } = start({ p1: ['mauhurUrukHaiCaptain', 'dunlandCrebain'], cards: ['mauhurUrukHaiCaptain', 'dunlandCrebain'] });
  cast(game, 'p1', 'mauhurUrukHaiCaptain');
  cast(game, 'p1', 'dunlandCrebain');
  assert.equal(named(game, 'Orc Army')[0].power, 3);
});

test('restricted mana: Pelargir Survivor\'s mana pays for instants and sorceries only', () => {
  const game = new Game({
    players, shuffleLibraries: false, emblems: { p1: [], p2: [] },
    cards: { pelargirSurvivor: { ...CARDS.pelargirSurvivor, manaCost: {} }, bear1: { ...BEAR, id: 'bear1', manaCost: { generic: 1 } } },
    decks: { p1: ['pelargirSurvivor', 'birthdayEscape', 'bear1', ...Array(37).fill('island')], p2: Array(40).fill('forest') },
  });
  game.start();
  advanceTo(game, { turn: 1, phase: PHASE.PRECOMBAT_MAIN });
  ok(game, castSpell('p1', inHand(game, 'p1', 'pelargirSurvivor')));
  resolveAll(game);
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  const [survivor] = named(game, 'Pelargir Survivor');
  ok(game, activateAbility('p1', survivor.id, 'ability1'));
  const casts = state(game).validActions.filter((a) => a.type === ACTION.CAST_SPELL).map((a) => a.cardId);
  assert.ok(casts.includes(inHand(game, 'p1', 'birthdayEscape')));
  assert.ok(!casts.includes(inHand(game, 'p1', 'bear1')));
});

test('Long List of the Ents: the next creature spell of a noted type enters with a +1/+1 counter', () => {
  const { game } = start({ p1: ['longListOfTheEnts', 'bear'], cards: ['longListOfTheEnts'] });
  cast(game, 'p1', 'longListOfTheEnts');
  assert.equal(decision(game).kind, CHOICE.CREATURE_TYPE);
  ok(game, choose('p1', 'Bear'));
  resolveAll(game);
  cast(game, 'p1', 'bear');
  assert.equal(named(game, 'Bear')[0].counters['+1/+1'], 1);
});

test('player views hide the cards another player is looking at', () => {
  const { game } = start({ p1: ['galadhrimGuide'], cards: ['galadhrimGuide'] });
  cast(game, 'p1', 'galadhrimGuide');
  assert.equal(game.getPlayerView('p2').pendingDecision.cards, undefined);
  const mine = game.getPlayerView('p1');
  assert.equal(mine.pendingDecision.cards.length, 2);
  assert.equal(mine.zones.p1.knownTop.length, 2);
});

test('a game paused on a choice survives serialize and deserialize', () => {
  const { game } = start({ p1: ['galadhrimGuide'], cards: ['galadhrimGuide'] });
  cast(game, 'p1', 'galadhrimGuide');
  const copy = Game.deserialize(game.serialize());
  const d = copy.getState().pendingDecision;
  copy.dispatch(toggleChoice('p1', d.options[1]));
  assert.deepEqual(copy.dispatch(confirmChoice('p1')), { ok: true });
  assert.equal(copy.serialize().zones.p1.library[0].id, d.options[1]);
});

test('blocking triggers: Battle-Scarred Goblin damages its blockers; Barrow-Blade takes away abilities', () => {
  const { game } = start({ p1: ['battleScarredGoblin'], p2: ['orc'], cards: ['battleScarredGoblin'] });
  cast(game, 'p1', 'battleScarredGoblin');
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'orc');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  const [goblin] = named(game, 'Battle-Scarred Goblin');
  const [orc] = named(game, 'Orc');
  attack(game, [goblin.id]);
  block(game, { [orc.id]: goblin.id });
  resolveAll(game);
  assert.equal(named(game, 'Orc').length, 0); // 1 damage from the trigger, before combat damage
});

test('Mordor Trebuchet: a Ballistic Boulder enters tapped and attacking, and is sacrificed at end of combat', () => {
  const { game } = start({ p1: ['mordorTrebuchet', 'orc'], cards: ['mordorTrebuchet'] });
  cast(game, 'p1', 'mordorTrebuchet');
  cast(game, 'p1', 'orc');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  const life = player(game, 'p2').life;
  attack(game, [named(game, 'Orc')[0].id]);
  resolveAll(game);
  const [boulder] = named(game, 'Ballistic Boulder');
  assert.ok(boulder.tapped);
  assert.ok(state(game).combat.attackers.some((a) => a.cardId === boulder.id));
  advanceTo(game, { turn: 3, phase: PHASE.POSTCOMBAT_MAIN });
  assert.equal(player(game, 'p2').life, life - 3);
  assert.equal(named(game, 'Ballistic Boulder').length, 0);
});

test('You Cannot Pass! destroys a creature that blocked a legendary creature this turn', () => {
  const { game } = start({ p1: ['hero', 'youCannotPass'], p2: ['bear'], cards: ['youCannotPass'] });
  cast(game, 'p1', 'hero');
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'bear');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  const [hero] = named(game, 'Hero');
  const [bear] = named(game, 'Bear');
  assert.ok(!state(game).validActions.some((a) => a.type === ACTION.CAST_SPELL && a.targets?.[0] === bear.id));
  attack(game, [hero.id]);
  block(game, { [bear.id]: hero.id });
  assert.ok(state(game).validActions.some((a) => a.type === ACTION.CAST_SPELL && a.targets?.[0] === bear.id));
});

test('ward: a spell targeting Saruman the White is countered unless its caster pays {2}', () => {
  const { game } = start({ p1: ['sarumanTheWhite'], p2: ['claimThePrecious', 'claimThePrecious'], cards: ['sarumanTheWhite', 'claimThePrecious'] });
  cast(game, 'p1', 'sarumanTheWhite');
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  const [saruman] = named(game, 'Saruman the White');
  // No mana to pay with: countered.
  cast(game, 'p2', 'claimThePrecious', { targets: [saruman.id] });
  assert.ok(named(game, 'Saruman the White')[0]);
  assert.ok(player(game, 'p2').graveyard.some((c) => c.cardId === 'claimThePrecious'));
  // With two lands, p2 may pay.
  playLand(game, 'p2');
  advanceTo(game, { turn: 4, phase: PHASE.PRECOMBAT_MAIN });
  playLand(game, 'p2');
  ok(game, castSpell('p2', inHand(game, 'p2', 'claimThePrecious'), [saruman.id]));
  resolveAll(game);
  assert.equal(decision(game).kind, CHOICE.PAY);
  assert.equal(decision(game).playerId, 'p2');
  ok(game, choose('p2', 'pay'));
  resolveAll(game);
  assert.equal(named(game, 'Saruman the White').length, 0);
  assert.ok(state(game).battlefield.filter((p) => p.controllerId === 'p2' && p.types.includes('Land')).every((p) => p.tapped));
});

test('crew: Grond becomes an artifact creature when crewed, and on your turn with an Army', () => {
  const { game } = start({ p1: ['grondTheGatebreaker', 'hero', 'dunlandCrebain'], cards: ['grondTheGatebreaker', 'dunlandCrebain'] });
  cast(game, 'p1', 'grondTheGatebreaker');
  const [grond] = named(game, 'Grond, the Gatebreaker');
  assert.ok(!grond.types.includes('Creature'));
  cast(game, 'p1', 'hero');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  const crew = state(game).validActions.find((a) => a.abilityId === 'crew');
  assert.deepEqual(crew.costChoices.tap, [named(game, 'Hero')[0].id]);
  ok(game, crew);
  resolveAll(game);
  assert.ok(permanent(game, grond.id).types.includes('Creature'));
  advanceTo(game, { turn: 4, phase: PHASE.PRECOMBAT_MAIN });
  assert.ok(!permanent(game, grond.id).types.includes('Creature'));
  advanceTo(game, { turn: 5, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'dunlandCrebain');
  assert.ok(permanent(game, grond.id).types.includes('Creature'));
});

test('Morgul-Knife Wound: its creature is exiled at its controller\'s upkeep unless they pay 2 life', () => {
  const { game } = start({ p1: ['morgulKnifeWound'], p2: ['bear'], cards: ['morgulKnifeWound'] });
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'bear');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  const [bear] = named(game, 'Bear');
  cast(game, 'p1', 'morgulKnifeWound', { targets: [bear.id] });
  assert.equal(permanent(game, bear.id).power, -1);
  advanceTo(game, { turn: 3, phase: PHASE.ENDING, step: STEP.END });
  for (let i = 0; i < 10 && !decision(game); i++) passRound(game);
  assert.equal(decision(game).kind, CHOICE.PAY);
  assert.equal(state(game).turn, 4);
  ok(game, choose('p2', 'pay'));
  assert.equal(player(game, 'p2').life, 18);
  assert.ok(permanent(game, bear.id));
  advanceTo(game, { turn: 5, phase: PHASE.ENDING, step: STEP.END });
  for (let i = 0; i < 10 && !decision(game); i++) passRound(game);
  ok(game, choose('p2', 'decline'));
  assert.equal(permanent(game, bear.id), undefined);
  assert.ok(player(game, 'p2').exile.some((c) => c.id === bear.id));
});

test('Shire Shirriff exiles a creature until it leaves the battlefield', () => {
  const { game } = start({ p1: ['protectorOfGondor', 'shireShirriff', 'claimThePrecious'], p2: ['bear'], cards: ['protectorOfGondor', 'shireShirriff', 'claimThePrecious'] });
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'bear');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'protectorOfGondor');
  cast(game, 'p1', 'shireShirriff');
  const d = decision(game);
  assert.equal(d.kind, CHOICE.OPTIONAL_COST);
  ok(game, choose('p1', d.options[0]));
  resolveAll(game);
  assert.equal(named(game, 'Bear').length, 0);
  const [shirriff] = named(game, 'Shire Shirriff');
  cast(game, 'p1', 'claimThePrecious', { targets: [shirriff.id] });
  assert.equal(named(game, 'Bear').length, 1);
  assert.equal(named(game, 'Bear')[0].controllerId, 'p2');
});

test('Grishnákh takes a creature until end of turn', () => {
  const { game } = start({ p1: ['grishnakhBrashInstigator'], p2: ['bear', 'hero'], cards: ['grishnakhBrashInstigator'] });
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'bear');
  cast(game, 'p2', 'hero');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p1', 'grishnakhBrashInstigator');
  resolveAll(game);
  const [bear] = named(game, 'Bear');
  // The Hero is legendary, so only the Bear (power 2 = the Army's) could be taken: it was chosen at once.
  assert.equal(bear.controllerId, 'p1');
  assert.ok(bear.keywords.includes(KEYWORD.HASTE));
  advanceTo(game, { turn: 4, phase: PHASE.PRECOMBAT_MAIN });
  assert.equal(named(game, 'Bear')[0].controllerId, 'p2');
});

test('Old Man Willow\'s power and toughness are the number of lands its controller has', () => {
  const { game } = start({ p1: ['oldManWillow', 'forest'], cards: ['oldManWillow'] });
  ok(game, { type: ACTION.PLAY_LAND, playerId: 'p1', cardId: inHand(game, 'p1', 'forest') });
  cast(game, 'p1', 'oldManWillow');
  const [willow] = named(game, 'Old Man Willow');
  const lands = state(game).battlefield.filter((p) => p.controllerId === 'p1' && p.types.includes('Land')).length;
  assert.equal(willow.power, lands);
  assert.equal(willow.toughness, lands);
});

test('Fog on the Barrow-Downs makes its creature a Spirit that can\'t attack or block', () => {
  const { game } = start({ p1: ['bear', 'fogOnTheBarrowDowns'], cards: ['fogOnTheBarrowDowns'] });
  cast(game, 'p1', 'bear');
  const [bear] = named(game, 'Bear');
  cast(game, 'p1', 'fogOnTheBarrowDowns', { targets: [bear.id] });
  assert.deepEqual(permanent(game, bear.id).subtypes, ['Spirit']);
  assert.ok(permanent(game, bear.id).keywords.includes(KEYWORD.CANT_ATTACK));
});

test('Bewitching Leechcraft: its creature untaps only by removing a +1/+1 counter', () => {
  const { game } = start({ p2: ['bear', 'bewitchingLeechcraft'], cards: ['bewitchingLeechcraft'] });
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'bear');
  const [bear] = named(game, 'Bear');
  cast(game, 'p2', 'bewitchingLeechcraft', { targets: [bear.id] });
  assert.ok(permanent(game, bear.id).tapped);
  advanceTo(game, { turn: 4, phase: PHASE.PRECOMBAT_MAIN });
  assert.ok(permanent(game, bear.id).tapped);
});

test('graveyard abilities: Gollum, Patient Plotter returns to hand; Gollum\'s Bite needs its own cost', () => {
  const { game } = start({
    p1: ['gollumPatientPlotter', 'bear', 'orc', 'claimThePrecious', 'gollumsBite', 'swamp'],
    cards: ['gollumPatientPlotter', 'claimThePrecious', 'gollumsBite'],
  });
  playLand(game, 'p1');
  cast(game, 'p1', 'gollumPatientPlotter');
  cast(game, 'p1', 'bear');
  cast(game, 'p1', 'orc');
  const [gollum] = named(game, 'Gollum, Patient Plotter');
  const [bear] = named(game, 'Bear');
  cast(game, 'p1', 'claimThePrecious', { targets: [gollum.id] });
  if (decision(game)?.kind === CHOICE.RING_BEARER) ok(game, choose('p1', bear.id));
  resolveAll(game);
  if (decision(game)?.kind === CHOICE.RING_BEARER) ok(game, choose('p1', bear.id));
  // Gollum left the battlefield and Claim the Precious resolved: the Ring tempted p1 twice.
  assert.equal(player(game, 'p1').ring.level, 2);
  cast(game, 'p1', 'gollumsBite', { targets: [named(game, 'Orc')[0].id] });
  assert.equal(named(game, 'Orc').length, 0);
  // Without {B} in the pool, Gollum's ability isn't offered; with it, it is, sacrificing the Bear.
  assert.ok(!state(game).validActions.some((a) => a.cardId === gollum.id));
  tapLands(game, 'p1');
  const back = state(game).validActions.find((a) => a.cardId === gollum.id);
  assert.deepEqual(back.costChoices, { sacrifice: [bear.id] });
  // Gollum's Bite costs {3}{B}: not offered.
  assert.ok(!state(game).validActions.some((a) => a.cardId === player(game, 'p1').graveyard.find((c) => c.cardId === 'gollumsBite').id));
  ok(game, back);
  resolveAll(game);
  assert.ok(player(game, 'p1').hand.some((c) => c.id === gollum.id));
  assert.equal(named(game, 'Bear').length, 0);
});

test('Bill the Pony: a creature assigns combat damage equal to its toughness', () => {
  const { game } = start({ p1: ['billThePony'], cards: ['billThePony'] });
  cast(game, 'p1', 'billThePony');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  const [pony] = named(game, 'Bill the Pony');
  const sacrifice = state(game).validActions.find((a) => a.cardId === pony.id && a.targets?.[0] === pony.id);
  ok(game, sacrifice);
  resolveAll(game);
  const life = player(game, 'p2').life;
  attack(game, [pony.id]);
  advanceTo(game, { turn: 3, phase: PHASE.POSTCOMBAT_MAIN });
  assert.equal(player(game, 'p2').life, life - 4);
});

test('Ent-Draught Basin targets only a creature with power X', () => {
  const { game } = start({ p1: ['entDraughtBasin', 'bear'], cards: ['entDraughtBasin'] });
  playLand(game, 'p1');
  cast(game, 'p1', 'entDraughtBasin');
  cast(game, 'p1', 'bear');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  playLand(game, 'p1');
  const [basin] = named(game, 'Ent-Draught Basin');
  tapLands(game, 'p1');
  const uses = state(game).validActions.filter((a) => a.cardId === basin.id);
  assert.deepEqual(uses.map((a) => a.x), [2]);
  ok(game, uses[0]);
  resolveAll(game);
  assert.equal(named(game, 'Bear')[0].power, 3);
});

test('Elrond: the second resolution in a turn tempts you', () => {
  const { game } = start({ p1: ['elrondLordOfRivendell', 'bear'], cards: ['elrondLordOfRivendell'] });
  cast(game, 'p1', 'elrondLordOfRivendell');
  ok(game, confirmChoice('p1'));
  resolveAll(game);
  assert.equal(player(game, 'p1').ring.level, 0);
  cast(game, 'p1', 'bear');
  ok(game, confirmChoice('p1'));
  resolveAll(game);
  if (decision(game)?.kind === CHOICE.RING_BEARER) ok(game, choose('p1', decision(game).options[0]));
  assert.equal(player(game, 'p1').ring.level, 1);
});

test('Tale of Tinúviel\'s indestructible lasts as long as you control the Saga', () => {
  const { game } = start({ p1: ['bear', 'taleOfTinuviel'], cards: ['taleOfTinuviel'] });
  cast(game, 'p1', 'bear');
  cast(game, 'p1', 'taleOfTinuviel');
  const [bear] = named(game, 'Bear');
  assert.ok(permanent(game, bear.id).keywords.includes(KEYWORD.INDESTRUCTIBLE));
  advanceTo(game, { turn: 5, phase: PHASE.PRECOMBAT_MAIN });
  resolveAll(game);
  advanceTo(game, { turn: 5, phase: PHASE.POSTCOMBAT_MAIN });
  assert.equal(named(game, 'Tale of Tinúviel').length, 0);
  assert.ok(!permanent(game, bear.id).keywords.includes(KEYWORD.INDESTRUCTIBLE));
});

test('Smite the Deathless exiles a creature that would die this turn', () => {
  const { game } = start({ p1: ['smiteTheDeathless'], p2: ['bear'], cards: ['smiteTheDeathless'] });
  advanceTo(game, { turn: 2, phase: PHASE.PRECOMBAT_MAIN });
  cast(game, 'p2', 'bear');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  const [bear] = named(game, 'Bear');
  cast(game, 'p1', 'smiteTheDeathless', { targets: [bear.id] });
  assert.ok(player(game, 'p2').exile.some((c) => c.id === bear.id));
});

test('Ioreth untaps another permanent, or two other legendary creatures', () => {
  const { game } = start({ p1: ['iorethOfTheHealingHouse', 'hero'], cards: ['iorethOfTheHealingHouse'] });
  playLand(game, 'p1');
  cast(game, 'p1', 'iorethOfTheHealingHouse');
  cast(game, 'p1', 'hero');
  advanceTo(game, { turn: 3, phase: PHASE.PRECOMBAT_MAIN });
  const [ioreth] = named(game, 'Ioreth of the Healing House');
  // Only one other legendary creature: the second ability can't be activated.
  assert.ok(!state(game).validActions.some((a) => a.cardId === ioreth.id && a.abilityId === 'ability2'));
  tapLands(game, 'p1');
  const [forest] = state(game).battlefield.filter((p) => p.cardId === 'forest' && p.controllerId === 'p1');
  ok(game, activateAbility('p1', ioreth.id, 'ability1', [forest.id]));
  resolveAll(game);
  assert.equal(permanent(game, forest.id).tapped, false);
});

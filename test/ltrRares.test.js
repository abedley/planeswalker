// The Lord of the Rings: Tales of Middle-earth: its rares and mythics, played with the real definitions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, DECISION, ACTION, PHASE, STEP, KEYWORD, COUNTER, castSpell, chooseTargets,
  toggleAttacker, confirmAttackers, setBlocker, confirmBlockers,
} from '../src/index.js';
import { CHOICE } from '../src/engine/Game.js';
import { choose, toggleChoice, confirmChoice } from '../src/engine/actions.js';
import {
  setup, state, player, permanent, named, byCard, inHand, decision, ok, passRound, resolveAll, advanceTo, cast, actionFor, activate, untilDecision,
} from './helpers/ltrGame.js';

const main = (turn = 1) => ({ turn, phase: PHASE.PRECOMBAT_MAIN });

/** Plays the land `cardId` from a player's hand (p1's by default). */
function playLand(game, cardId, playerId = 'p1') {
  ok(game, { type: ACTION.PLAY_LAND, playerId, cardId: inHand(game, playerId, cardId) });
}

/** Declares `ids` as p1's attackers (on turn `turn`), then lets p2 block as `blocks` says. */
function attack(game, turn, ids, blocks = {}) {
  advanceTo(game, { turn, phase: PHASE.COMBAT, step: STEP.BEGINNING_OF_COMBAT });
  passRound(game);
  resolveAll(game);
  for (const id of ids) ok(game, toggleAttacker('p1', id));
  ok(game, confirmAttackers('p1'));
  for (let i = 0; i < 10 && !(decision(game)?.type === DECISION.DECLARE_BLOCKERS) && state(game).step !== STEP.COMBAT_DAMAGE; i++) {
    if (decision(game)) return;
    passRound(game);
  }
  if (decision(game)?.type === DECISION.DECLARE_BLOCKERS) {
    for (const [blocker, attacker] of Object.entries(blocks)) ok(game, setBlocker('p2', blocker, attacker));
    ok(game, confirmBlockers('p2'));
  }
}

test('the legendary lands enter tapped unless you control a legendary creature', () => {
  const { game } = setup({ p1: ['minasTirith', 'hero', 'rivendell'] });
  advanceTo(game, main(1));
  playLand(game, 'minasTirith');
  assert.equal(byCard(game, 'minasTirith')[0].tapped, true);
  cast(game, 'p1', 'hero');
  advanceTo(game, main(3));
  playLand(game, 'rivendell');
  assert.equal(byCard(game, 'rivendell')[0].tapped, false);
});

test("Barad-dûr amasses X, for {X}{X}{B}, only once a creature has died this turn", () => {
  const { game } = setup({ p1: ['baradDur', 'swamp', 'swamp', 'swamp', 'swamp', 'bear', 'shock'], fill: 'swamp' });
  for (let turn = 1; turn <= 9; turn += 2) {
    advanceTo(game, main(turn));
    const land = state(game).validActions.find((a) => a.type === ACTION.PLAY_LAND && a.playerId === 'p1');
    if (land) ok(game, land);
  }
  const barad = byCard(game, 'baradDur')[0];
  const amass = () => state(game).validActions.filter((a) => a.cardId === barad.id && a.abilityId === 'ability2');
  for (const swamp of state(game).battlefield.filter((p) => p.cardId === 'swamp')) activate(game, 'p1', swamp.id);
  assert.equal(amass().length, 0, 'no creature has died');
  cast(game, 'p1', 'bear');
  cast(game, 'p1', 'shock', { targets: [byCard(game, 'bear')[0].id] });
  // Four Swamps' mana: X can be 0 or 1 ({X}{X}{B} with X = 1 is three mana).
  assert.deepEqual(amass().map((a) => a.x), [0, 1]);
  ok(game, amass().find((a) => a.x === 1));
  resolveAll(game);
  const army = named(game, 'Orc Army')[0];
  assert.equal(army.counters[COUNTER.PLUS_ONE], 1);
});

test("Boromir counters an opponent's spell cast without spending mana", () => {
  const { game, events } = setup({ p1: ['boromirWardenOfTheTower'], p2: ['salve'], cards: ['boromirWardenOfTheTower'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'boromirWardenOfTheTower');
  advanceTo(game, main(2));
  cast(game, 'p2', 'salve');
  assert.equal(player(game, 'p2').life, 20, 'countered');
  assert.ok(events.some((e) => e.name === 'spellCountered'));
});

test("Delighted Halfling's mana makes a legendary spell uncounterable", () => {
  const { game } = setup({ p1: ['delightedHalfling', 'hero'], p2: ['negate'], cards: ['delightedHalfling'], extra: { hero: { id: 'hero', name: 'Hero', manaCost: { W: 1 }, types: ['Creature'], supertypes: ['Legendary'], power: 3, toughness: 3 } } });
  advanceTo(game, main(1));
  cast(game, 'p1', 'delightedHalfling');
  advanceTo(game, main(3));
  const halfling = byCard(game, 'delightedHalfling')[0];
  activate(game, 'p1', halfling.id, { abilityId: 'ability2' });
  ok(game, castSpell('p1', inHand(game, 'p1', 'hero')));
  // p2 tries to counter it.
  ok(game, { type: ACTION.PASS_PRIORITY, playerId: 'p1' });
  ok(game, castSpell('p2', inHand(game, 'p2', 'negate'), [state(game).stack[0].id]));
  resolveAll(game);
  assert.equal(named(game, 'Hero').length, 1);
});

test('Dawn of a New Age: hope counters for your creatures, a card each end step, then 4 life', () => {
  const { game } = setup({ p1: ['bear', 'dawnOfANewAge'], cards: ['dawnOfANewAge'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'bear');
  cast(game, 'p1', 'dawnOfANewAge');
  assert.equal(byCard(game, 'dawnOfANewAge')[0].counters[COUNTER.HOPE], 1);
  const hand = player(game, 'p1').hand.length;
  advanceTo(game, { turn: 1, phase: PHASE.ENDING, step: STEP.END });
  resolveAll(game);
  assert.equal(player(game, 'p1').hand.length, hand + 1);
  assert.equal(byCard(game, 'dawnOfANewAge').length, 0, 'sacrificed');
  assert.equal(player(game, 'p1').life, 24);
});

test("Fall of Gil-galad III: the creature fights, and draws two when it dies", () => {
  const { game, events } = setup({ p1: ['bear', 'fallOfGilGalad'], p2: ['giant'], cards: ['fallOfGilGalad'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'bear');
  cast(game, 'p1', 'fallOfGilGalad');
  if (decision(game)?.kind === CHOICE.SCRY) ok(game, confirmChoice('p1'));
  advanceTo(game, main(2));
  cast(game, 'p2', 'giant');
  const giant = byCard(game, 'giant')[0];
  // Chapter III (turn 5): the Bear (+2 counters, 4/4) fights the Giant (5/5) and dies.
  advanceTo(game, main(5));
  assert.equal(byCard(game, 'bear').length, 0);
  assert.equal(permanent(game, giant.id).damage, 4);
  assert.ok(events.some((e) => e.name === 'cardsDrawn' && e.payload.playerId === 'p1' && e.payload.cardIds.length === 2));
});

test('Flame of Anor: two modes with a Wizard', () => {
  const wizard = { id: 'wizard', name: 'Wizard', manaCost: {}, types: ['Creature'], subtypes: ['Human', 'Wizard'], power: 1, toughness: 1 };
  const { game } = setup({ p1: ['flameOfAnor', 'wizard'], p2: ['giant'], cards: ['flameOfAnor'], extra: { wizard } });
  advanceTo(game, main(2));
  cast(game, 'p2', 'giant');
  advanceTo(game, main(3));
  const flame = inHand(game, 'p1', 'flameOfAnor');
  const modes = () => new Set(state(game).validActions.filter((a) => a.cardId === flame).map((a) => JSON.stringify(a.mode)));
  assert.ok(!modes().has('[0,2]'), 'one mode without a Wizard');
  cast(game, 'p1', 'wizard');
  assert.ok(modes().has('[0,2]'));
  const giant = byCard(game, 'giant')[0];
  const hand = player(game, 'p1').hand.length;
  cast(game, 'p1', 'flameOfAnor', { mode: [0, 2], targets: ['p1', giant.id] });
  assert.equal(player(game, 'p1').hand.length, hand - 1 + 2);
  assert.equal(byCard(game, 'giant').length, 0);
});

test('Flowering of the White Tree: legendary creatures get +2/+1 and ward {1}, others +1/+1', () => {
  const { game } = setup({ p1: ['floweringOfTheWhiteTree', 'hero', 'bear'], p2: ['shock'], cards: ['floweringOfTheWhiteTree'] });
  advanceTo(game, main(1));
  for (const id of ['floweringOfTheWhiteTree', 'hero', 'bear']) cast(game, 'p1', id);
  const hero = byCard(game, 'hero')[0];
  assert.deepEqual([hero.power, hero.toughness], [5, 4]);
  assert.deepEqual([byCard(game, 'bear')[0].power, byCard(game, 'bear')[0].toughness], [3, 3]);
  advanceTo(game, main(2));
  ok(game, castSpell('p2', inHand(game, 'p2', 'shock'), [hero.id]));
  // Ward triggers: p2 can't pay {1} (no lands untapped... they have none), so Shock is countered.
  resolveAll(game);
  assert.equal(permanent(game, hero.id).damage, 0);
});

test('Gimli, Mournful Avenger: indestructible after two deaths, and a fight on the third', () => {
  const { game } = setup({ p1: ['gimliMournfulAvenger', 'bear', 'orc', 'bear', 'shock', 'shock', 'shock'], p2: ['bear'], cards: ['gimliMournfulAvenger'] });
  advanceTo(game, main(2));
  cast(game, 'p2', 'bear');
  const theirs = byCard(game, 'bear')[0];
  advanceTo(game, main(3));
  for (const id of ['gimliMournfulAvenger', 'bear', 'orc', 'bear']) cast(game, 'p1', id);
  const gimli = byCard(game, 'gimliMournfulAvenger')[0];
  const mine = state(game).battlefield.filter((p) => p.controllerId === 'p1' && p.id !== gimli.id).map((p) => p.id);
  for (const [i, id] of mine.entries()) {
    cast(game, 'p1', 'shock', { targets: [id] });
    if (decision(game)?.type === DECISION.CHOOSE_TARGETS) ok(game, chooseTargets('p1', [theirs.id]));
    resolveAll(game);
    if (i === 1) assert.ok(permanent(game, gimli.id).keywords.includes(KEYWORD.INDESTRUCTIBLE));
  }
  // Three counters (3/2 → 6/5); the third resolution fought their Bear.
  assert.equal(permanent(game, gimli.id).counters[COUNTER.PLUS_ONE], 3);
  assert.equal(permanent(game, theirs.id), undefined);
});

test('Glóin goads a creature: it must attack on its next combat', () => {
  const { game } = setup({ p1: ['gloinDwarfEmissary', 'mithrilCoat'], p2: ['bear'], cards: ['gloinDwarfEmissary', 'mithrilCoat'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'gloinDwarfEmissary');
  cast(game, 'p1', 'mithrilCoat');
  assert.equal(named(game, 'Treasure').length, 1, 'a historic spell');
  advanceTo(game, main(2));
  cast(game, 'p2', 'bear');
  advanceTo(game, main(3));
  const bear = byCard(game, 'bear')[0];
  activate(game, 'p1', byCard(game, 'gloinDwarfEmissary')[0].id, { targets: [bear.id] });
  resolveAll(game);
  advanceTo(game, { turn: 4, phase: PHASE.COMBAT, step: STEP.BEGINNING_OF_COMBAT });
  passRound(game);
  assert.deepEqual(decision(game).attackers, [bear.id]);
  assert.ok(!state(game).validActions.some((a) => a.type === ACTION.TOGGLE_ATTACKER && a.cardId === bear.id));
});

test('Horn of the Mark: attack with two, look at five, take a creature', () => {
  const { game } = setup({ p1: ['hornOfTheMark', 'bear', 'orc'], library1: ['forest', 'giant', 'forest', 'forest', 'forest'], cards: ['hornOfTheMark'] });
  advanceTo(game, main(1));
  for (const id of ['hornOfTheMark', 'bear', 'orc']) cast(game, 'p1', id);
  attack(game, 3, [byCard(game, 'bear')[0].id, byCard(game, 'orc')[0].id]);
  resolveAll(game);
  const d = decision(game);
  assert.equal(d.kind, CHOICE.LOOK);
  assert.equal(d.cards.length, 5);
  assert.equal(d.options.length, 1);
  ok(game, toggleChoice('p1', d.options[0]));
  ok(game, confirmChoice('p1'));
  assert.ok(inHand(game, 'p1', 'giant'));
});

test("Isildur's Fateful Strike needs a legendary creature, and trims a big hand", () => {
  const { game } = setup({ p1: ['isildursFatefulStrike', 'hero'], p2: ['bear'], cards: ['isildursFatefulStrike'] });
  advanceTo(game, main(2));
  cast(game, 'p2', 'bear');
  advanceTo(game, main(3));
  const strike = inHand(game, 'p1', 'isildursFatefulStrike');
  assert.ok(!state(game).validActions.some((a) => a.cardId === strike), 'no legendary creature');
  cast(game, 'p1', 'hero');
  cast(game, 'p1', 'isildursFatefulStrike', { targets: [byCard(game, 'bear')[0].id] });
  // p2 has 7 cards: they exile 3.
  const d = decision(game);
  assert.equal(d.kind, CHOICE.EXILE_FROM_HAND);
  assert.equal(d.playerId, 'p2');
  for (const id of d.options.slice(0, 3)) ok(game, toggleChoice('p2', id));
  ok(game, confirmChoice('p2'));
  assert.equal(player(game, 'p2').hand.length, 4);
  assert.equal(player(game, 'p2').exile.length, 3);
});

test('Last March of the Ents: draw by greatest toughness, then put creatures onto the battlefield', () => {
  const { game } = setup({ p1: ['lastMarchOfTheEnts', 'bear', 'giant'], cards: ['lastMarchOfTheEnts'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'bear');
  const hand = player(game, 'p1').hand.length;
  cast(game, 'p1', 'lastMarchOfTheEnts');
  const d = decision(game);
  assert.equal(d.kind, CHOICE.HAND_CARDS);
  assert.equal(player(game, 'p1').hand.length, hand - 1 + 2);
  ok(game, toggleChoice('p1', inHand(game, 'p1', 'giant')));
  ok(game, confirmChoice('p1'));
  assert.equal(byCard(game, 'giant').length, 1);
});

test('Legolas, Master Archer: spells at him grow him; spells at their creatures shoot', () => {
  const { game } = setup({ p1: ['legolasMasterArcher', 'shock', 'shock'], p2: ['giant'], cards: ['legolasMasterArcher'] });
  advanceTo(game, main(2));
  cast(game, 'p2', 'giant');
  advanceTo(game, main(3));
  cast(game, 'p1', 'legolasMasterArcher');
  const legolas = byCard(game, 'legolasMasterArcher')[0];
  const giant = byCard(game, 'giant')[0];
  cast(game, 'p1', 'shock', { targets: [legolas.id] });
  assert.equal(permanent(game, legolas.id).counters[COUNTER.PLUS_ONE], 1);
  ok(game, castSpell('p1', inHand(game, 'p1', 'shock'), [giant.id]));
  if (decision(game)?.type === DECISION.CHOOSE_TARGETS) ok(game, chooseTargets('p1', [giant.id]));
  resolveAll(game);
  // 2 from Legolas (2/5 with the counter) and 2 from Shock.
  assert.equal(permanent(game, giant.id).damage, 4);
});

test("Lotho: a player's second spell each turn costs Lotho's controller 1 life for a Treasure", () => {
  const { game } = setup({ p1: ['lothoCorruptShirriff', 'salve', 'salve'], cards: ['lothoCorruptShirriff'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'lothoCorruptShirriff');
  cast(game, 'p1', 'salve');
  assert.equal(named(game, 'Treasure').length, 1);
  cast(game, 'p1', 'salve');
  assert.equal(named(game, 'Treasure').length, 1);
  assert.equal(player(game, 'p1').life, 20 - 1 + 6);
});

test('Merry: first strike while equipped; a card when attacking with another legend', () => {
  const { game } = setup({ p1: ['merryEsquireOfRohan', 'hero', 'stingTheGlintingDagger'], cards: ['merryEsquireOfRohan', 'stingTheGlintingDagger'], freeAbilities: true });
  advanceTo(game, main(1));
  for (const id of ['merryEsquireOfRohan', 'hero', 'stingTheGlintingDagger']) cast(game, 'p1', id);
  const merry = byCard(game, 'merryEsquireOfRohan')[0];
  assert.ok(!merry.keywords.includes(KEYWORD.FIRST_STRIKE));
  activate(game, 'p1', byCard(game, 'stingTheGlintingDagger')[0].id, { targets: [merry.id] });
  resolveAll(game);
  assert.ok(permanent(game, merry.id).keywords.includes(KEYWORD.FIRST_STRIKE));
  const hand = player(game, 'p1').hand.length;
  attack(game, 3, [merry.id, byCard(game, 'hero')[0].id]);
  resolveAll(game);
  assert.equal(player(game, 'p1').hand.length, hand + 1 + 1, 'the draw step and Merry');
});

test('Mines of Moria: the three cards to exile are chosen as the cost is paid', () => {
  const { game } = setup({ p1: ['minesOfMoria', 'salve', 'salve', 'salve'], fill: 'mountain' });
  advanceTo(game, main(1));
  for (let i = 0; i < 3; i++) cast(game, 'p1', 'salve');
  for (let turn = 1; turn <= 9; turn += 2) {
    advanceTo(game, main(turn));
    const land = state(game).validActions.find((a) => a.type === ACTION.PLAY_LAND && a.playerId === 'p1');
    if (land) ok(game, land);
  }
  for (const mountain of state(game).battlefield.filter((p) => p.cardId === 'mountain')) activate(game, 'p1', mountain.id);
  activate(game, 'p1', byCard(game, 'minesOfMoria')[0].id, { abilityId: 'ability2' });
  const d = decision(game);
  assert.equal(d.kind, CHOICE.EXILE_COST);
  assert.deepEqual([d.min, d.max], [3, 3]);
  for (const id of d.options) ok(game, toggleChoice('p1', id));
  ok(game, confirmChoice('p1'));
  assert.equal(player(game, 'p1').graveyard.length, 0);
  resolveAll(game);
  assert.equal(named(game, 'Treasure').length, 2);
});

test('Mount Doom: keep up to two creatures, destroy the rest', () => {
  const { game } = setup({ p1: ['mountDoom', 'mithrilCoat', 'hero', 'bear'], p2: ['giant', 'orc'], cards: ['mithrilCoat', 'mountDoom'], freeAbilities: true });
  advanceTo(game, main(1));
  playLand(game, 'mountDoom');
  for (const id of ['mithrilCoat', 'hero', 'bear']) cast(game, 'p1', id);
  if (decision(game)?.type === DECISION.CHOOSE_TARGETS) ok(game, chooseTargets('p1', [byCard(game, 'hero')[0].id]));
  advanceTo(game, main(2));
  cast(game, 'p2', 'giant');
  cast(game, 'p2', 'orc');
  advanceTo(game, main(3));
  const hero = byCard(game, 'hero')[0];
  activate(game, 'p1', byCard(game, 'mountDoom')[0].id, { abilityId: 'ability3' });
  resolveAll(game);
  const d = decision(game);
  assert.equal(d.kind, CHOICE.KEEP);
  ok(game, toggleChoice('p1', hero.id));
  ok(game, toggleChoice('p1', byCard(game, 'bear')[0].id));
  ok(game, confirmChoice('p1'));
  assert.deepEqual(state(game).battlefield.filter((p) => p.types.includes('Creature')).map((p) => p.name).sort(), ['Bear', 'Hero']);
  assert.equal(byCard(game, 'mithrilCoat').length, 0, 'sacrificed with Mount Doom');
});

test('One Ring to Rule Them All III: each opponent loses life for their creature cards', () => {
  const { game } = setup({ p1: ['oneRingToRuleThemAll', 'hero'], p2: ['bear', 'orc'], cards: ['oneRingToRuleThemAll'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'hero');
  cast(game, 'p1', 'oneRingToRuleThemAll');
  // I: the Ring tempts p1 (Hero is the only creature), then each player mills 3.
  assert.equal(player(game, 'p2').graveyard.length, 3);
  advanceTo(game, main(2));
  cast(game, 'p2', 'bear');
  cast(game, 'p2', 'orc');
  // II: destroy all nonlegendary creatures (the Hero is legendary).
  advanceTo(game, main(3));
  assert.equal(byCard(game, 'hero').length, 1);
  assert.equal(byCard(game, 'bear').length, 0);
  advanceTo(game, main(5));
  assert.equal(player(game, 'p2').life, 20 - 2);
});

test('Rangers of Ithilien steal a smaller creature until they leave', () => {
  const { game } = setup({ p1: ['rangersOfIthilien', 'shock', 'shock'], p2: ['bear', 'giant'], cards: ['rangersOfIthilien'] });
  advanceTo(game, main(2));
  cast(game, 'p2', 'bear');
  cast(game, 'p2', 'giant');
  advanceTo(game, main(3));
  const bear = byCard(game, 'bear')[0];
  ok(game, castSpell('p1', inHand(game, 'p1', 'rangersOfIthilien')));
  resolveAll(game);
  const d = decision(game);
  assert.equal(d.type, DECISION.CHOOSE_TARGETS);
  assert.ok(!state(game).validActions.some((a) => a.targets?.includes(byCard(game, 'giant')[0].id)), 'the Giant is bigger');
  ok(game, chooseTargets('p1', [bear.id]));
  resolveAll(game);
  if (decision(game)?.kind === CHOICE.RING_BEARER) ok(game, choose('p1', bear.id));
  assert.equal(permanent(game, bear.id).controllerId, 'p1');
  const rangers = byCard(game, 'rangersOfIthilien')[0];
  cast(game, 'p1', 'shock', { targets: [rangers.id] });
  cast(game, 'p1', 'shock', { targets: [rangers.id] });
  assert.equal(permanent(game, bear.id).controllerId, 'p2');
});

test("Sméagol, Helpful Guide: the Ring makes an opponent reveal until a land, which you take", () => {
  const { game } = setup({ p1: ['smeagolHelpfulGuide', 'callOfTheRing'], p2: [], library2: ['salve', 'salve', 'plains'], cards: ['smeagolHelpfulGuide', 'callOfTheRing'], extra: {} });
  advanceTo(game, main(1));
  cast(game, 'p1', 'smeagolHelpfulGuide');
  cast(game, 'p1', 'callOfTheRing');
  // p2's library starts after their 7-card hand of Forests: Salve, Salve, Plains on top.
  advanceTo(game, main(3));
  const plains = state(game).battlefield.find((p) => p.cardId === 'plains');
  assert.ok(plains && plains.controllerId === 'p1' && plains.ownerId === 'p2' && plains.tapped);
  assert.equal(player(game, 'p2').graveyard.filter((c) => c.cardId === 'salve').length, 1, 'p2 drew the first Salve on turn 2');
});

test('Spiteful Banditry deals X to each creature, and makes a Treasure once a turn', () => {
  const { game } = setup({ p1: ['spitefulBanditry', 'giant'], p2: ['bear', 'orc'], cards: ['spitefulBanditry'] });
  advanceTo(game, main(1));
  playLand(game, 'forest');
  advanceTo(game, main(2));
  cast(game, 'p2', 'bear');
  cast(game, 'p2', 'orc');
  advanceTo(game, main(3));
  playLand(game, 'forest');
  cast(game, 'p1', 'giant');
  for (const forest of byCard(game, 'forest')) activate(game, 'p1', forest.id);
  cast(game, 'p1', 'spitefulBanditry', { x: 2 });
  // 2 damage to each creature: the Bear and the Orc die (one Treasure), the Giant lives.
  assert.equal(byCard(game, 'bear').length + byCard(game, 'orc').length, 0);
  assert.equal(byCard(game, 'giant')[0].damage, 2);
  assert.equal(named(game, 'Treasure').length, 1);
});

test('Sting untaps its creature at each combat, and gives first strike against Orcs', () => {
  const { game } = setup({ p1: ['stingTheGlintingDagger', 'bear'], p2: ['orc'], cards: ['stingTheGlintingDagger'], freeAbilities: true });
  advanceTo(game, main(1));
  cast(game, 'p1', 'bear');
  cast(game, 'p1', 'stingTheGlintingDagger');
  const bear = byCard(game, 'bear')[0];
  activate(game, 'p1', byCard(game, 'stingTheGlintingDagger')[0].id, { targets: [bear.id] });
  resolveAll(game);
  assert.ok(permanent(game, bear.id).keywords.includes(KEYWORD.HASTE));
  advanceTo(game, main(2));
  cast(game, 'p2', 'orc');
  const orc = byCard(game, 'orc')[0];
  attack(game, 3, [bear.id], { [orc.id]: bear.id });
  assert.ok(permanent(game, bear.id).keywords.includes(KEYWORD.FIRST_STRIKE), 'blocked by an Orc');
  advanceTo(game, main(4));
  // The Bear attacked (tapped); Sting untaps it at the beginning of p2's combat.
  advanceTo(game, { turn: 4, phase: PHASE.COMBAT, step: STEP.BEGINNING_OF_COMBAT });
  resolveAll(game);
  assert.equal(permanent(game, bear.id).tapped, false);
});

test('The Balrog: cheaper for each permanent sacrificed this turn; only legends can block it', () => {
  const sacrificer = {
    id: 'sacrificer', name: 'Sacrificer', manaCost: { generic: 2 }, types: ['Creature'], power: 1, toughness: 1, costReduction: { per: { of: 'permanentsSacrificedThisTurn' } },
  };
  const { game } = setup({ p1: ['lembas', 'lembas', 'sacrificer', 'theBalrogDurinsBane'], p2: ['bear', 'hero'], cards: ['lembas', 'theBalrogDurinsBane'], extra: { sacrificer }, freeAbilities: true });
  advanceTo(game, main(1));
  for (let i = 0; i < 2; i++) {
    cast(game, 'p1', 'lembas');
    ok(game, confirmChoice('p1'));
    resolveAll(game);
  }
  const castable = () => state(game).validActions.some((a) => a.cardId === inHand(game, 'p1', 'sacrificer'));
  assert.ok(!castable());
  for (const lembas of byCard(game, 'lembas')) {
    activate(game, 'p1', lembas.id);
    resolveAll(game);
  }
  assert.ok(castable(), 'two permanents sacrificed: {2} less');
  cast(game, 'p1', 'theBalrogDurinsBane');
  advanceTo(game, main(2));
  cast(game, 'p2', 'bear');
  cast(game, 'p2', 'hero');
  advanceTo(game, { turn: 3, phase: PHASE.COMBAT, step: STEP.BEGINNING_OF_COMBAT });
  passRound(game);
  ok(game, toggleAttacker('p1', byCard(game, 'theBalrogDurinsBane')[0].id));
  ok(game, confirmAttackers('p1'));
  passRound(game);
  const blocks = state(game).validActions.filter((a) => a.type === ACTION.SET_BLOCKER);
  assert.deepEqual(blocks.map((a) => a.cardId), [byCard(game, 'hero')[0].id]);
});

test('The Battle of Bywater destroys big creatures, then makes a Food per creature you control', () => {
  const { game } = setup({ p1: ['bear', 'giant', 'theBattleOfBywater'], cards: ['theBattleOfBywater'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'bear');
  cast(game, 'p1', 'giant');
  cast(game, 'p1', 'theBattleOfBywater');
  assert.equal(byCard(game, 'giant').length, 0);
  assert.equal(named(game, 'Food').length, 1);
});

test('The Shire taps one of your creatures for a Food', () => {
  const { game } = setup({ p1: ['theShire', 'hero', 'bear'], freeAbilities: true, cards: ['theShire'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'hero');
  playLand(game, 'theShire');
  assert.equal(byCard(game, 'theShire')[0].tapped, false, 'you control a legendary creature');
  cast(game, 'p1', 'bear');
  const bear = byCard(game, 'bear')[0];
  activate(game, 'p1', byCard(game, 'theShire')[0].id, { abilityId: 'ability2', costChoices: { tap: [bear.id] } });
  resolveAll(game);
  assert.equal(permanent(game, bear.id).tapped, true, 'summoning sickness doesn\'t matter');
  assert.equal(named(game, 'Food').length, 1);
});

test('There and Back Again: Smaug, whose death makes fourteen Treasures', () => {
  const { game } = setup({ p1: ['thereAndBackAgain', 'shock', 'shock', 'shock'], p2: ['bear'], cards: ['thereAndBackAgain'], library1: ['mountain'] });
  advanceTo(game, main(2));
  cast(game, 'p2', 'bear');
  const bear = byCard(game, 'bear')[0];
  advanceTo(game, main(3));
  ok(game, castSpell('p1', inHand(game, 'p1', 'thereAndBackAgain')));
  resolveAll(game);
  if (decision(game)?.type === DECISION.CHOOSE_TARGETS) ok(game, chooseTargets('p1', [bear.id]));
  resolveAll(game);
  assert.ok(permanent(game, bear.id).keywords.includes(KEYWORD.CANT_BLOCK));
  advanceTo(game, main(7));
  const smaug = named(game, 'Smaug')[0];
  assert.ok(smaug.supertypes.includes('Legendary') && smaug.keywords.includes(KEYWORD.HASTE));
  assert.equal(byCard(game, 'thereAndBackAgain').length, 0);
  assert.ok(!permanent(game, bear.id).keywords.includes(KEYWORD.CANT_BLOCK), 'the Saga is gone');
  for (let i = 0; i < 3; i++) cast(game, 'p1', 'shock', { targets: [named(game, 'Smaug')[0].id] });
  assert.equal(named(game, 'Smaug').length, 0);
  assert.equal(named(game, 'Treasure').length, 14);
});

test('Witch-king of Angmar: creatures that hit you are sacrificed, and the Ring tempts you', () => {
  const { game } = setup({ p1: ['bear', 'orc'], p2: ['witchKingOfAngmar'], cards: ['witchKingOfAngmar'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'bear');
  cast(game, 'p1', 'orc');
  advanceTo(game, main(2));
  cast(game, 'p2', 'witchKingOfAngmar');
  attack(game, 3, [byCard(game, 'bear')[0].id]);
  advanceTo(game, { turn: 3, phase: PHASE.POSTCOMBAT_MAIN });
  assert.equal(byCard(game, 'bear').length, 0, 'the Bear hit p2');
  assert.equal(byCard(game, 'orc').length, 1);
  assert.equal(player(game, 'p2').ring.level, 1);
});

test('Andúril: a legendary bearer brings two attacking Spirits', () => {
  const { game } = setup({ p1: ['andurilFlameOfTheWest', 'hero'], cards: ['andurilFlameOfTheWest'], freeAbilities: true });
  advanceTo(game, main(1));
  cast(game, 'p1', 'hero');
  cast(game, 'p1', 'andurilFlameOfTheWest');
  const hero = byCard(game, 'hero')[0];
  activate(game, 'p1', byCard(game, 'andurilFlameOfTheWest')[0].id, { targets: [hero.id] });
  resolveAll(game);
  assert.deepEqual([permanent(game, hero.id).power, permanent(game, hero.id).toughness], [6, 4]);
  attack(game, 3, [hero.id]);
  resolveAll(game);
  const spirits = state(game).battlefield.filter((p) => p.name.includes('Spirit'));
  assert.equal(spirits.length, 2);
  assert.equal(state(game).combat.attackers.length, 3);
});

test('Shagrat takes an Equipment as it attacks, then amasses that many', () => {
  const { game } = setup({ p1: ['shagratLootBearer', 'stingTheGlintingDagger'], cards: ['shagratLootBearer', 'stingTheGlintingDagger'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'shagratLootBearer');
  cast(game, 'p1', 'stingTheGlintingDagger');
  const shagrat = byCard(game, 'shagratLootBearer')[0];
  attack(game, 3, [shagrat.id]);
  resolveAll(game);
  if (decision(game)?.type === DECISION.CHOOSE_TARGETS) ok(game, chooseTargets('p1', [byCard(game, 'stingTheGlintingDagger')[0].id]));
  resolveAll(game);
  assert.equal(byCard(game, 'stingTheGlintingDagger')[0].attachedTo, shagrat.id);
  assert.equal(named(game, 'Orc Army')[0].counters[COUNTER.PLUS_ONE], 1);
});

test('Call of the Ring: tempted each upkeep, and 2 life for a card on choosing a bearer', () => {
  const { game } = setup({ p1: ['callOfTheRing', 'bear'], cards: ['callOfTheRing'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'callOfTheRing');
  cast(game, 'p1', 'bear');
  // advanceTo takes the first option of each choice: paying 2 life.
  const hand = player(game, 'p1').hand.length;
  advanceTo(game, main(3));
  assert.equal(player(game, 'p1').life, 18);
  assert.equal(player(game, 'p1').hand.length, hand + 2, 'the draw step and Call of the Ring');
  assert.equal(player(game, 'p1').ring.level, 1);
});

test('Aragorn, the Uniter: each color of spell does its own thing', () => {
  const { game } = setup({ p1: ['aragornTheUniter', 'shock'], cards: ['aragornTheUniter'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'aragornTheUniter');
  // Shock is red: 3 damage to target opponent (and Shock's own 2).
  cast(game, 'p1', 'shock', { targets: ['p2'] });
  assert.equal(player(game, 'p2').life, 15);
});

test('Galadriel of Lothlórien: after scrying, a land on top goes onto the battlefield', () => {
  const { game } = setup({ p1: ['galadrielOfLothlorien', 'rivendell'], cards: ['galadrielOfLothlorien', 'rivendell'], library1: ['plains', 'salve'], freeAbilities: true });
  advanceTo(game, main(1));
  cast(game, 'p1', 'galadrielOfLothlorien');
  playLand(game, 'rivendell');
  activate(game, 'p1', byCard(game, 'rivendell')[0].id, { abilityId: 'ability2' });
  resolveAll(game);
  // Scry 2: keep both on top (Plains first).
  const d = decision(game);
  ok(game, toggleChoice('p1', d.options[0]));
  ok(game, toggleChoice('p1', d.options[1]));
  ok(game, confirmChoice('p1'));
  resolveAll(game);
  ok(game, choose('p1', 'yes'));
  assert.ok(byCard(game, 'plains')[0].tapped);
});

test('Samwise Gamgee: Food for each nontoken creature; three Foods bring back a historic card', () => {
  const { game } = setup({ p1: ['samwiseGamgee', 'bear', 'orc', 'hero', 'shock', 'shock'], cards: ['samwiseGamgee'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'samwiseGamgee');
  cast(game, 'p1', 'hero');
  cast(game, 'p1', 'shock', { targets: [byCard(game, 'hero')[0].id] });
  cast(game, 'p1', 'shock', { targets: [byCard(game, 'hero')[0].id] });
  for (const id of ['bear', 'orc']) cast(game, 'p1', id);
  assert.equal(named(game, 'Food').length, 3);
  const hero = player(game, 'p1').graveyard.find((c) => c.cardId === 'hero');
  const food = named(game, 'Food').map((p) => p.id);
  activate(game, 'p1', byCard(game, 'samwiseGamgee')[0].id, { targets: [hero.id], costChoices: { sacrifice: food } });
  resolveAll(game);
  assert.ok(inHand(game, 'p1', 'hero'));
});

test('Horn of Gondor makes a Soldier for each Human', () => {
  const { game } = setup({ p1: ['hornOfGondor', 'hero'], cards: ['hornOfGondor'], freeAbilities: true });
  advanceTo(game, main(1));
  cast(game, 'p1', 'hero');
  cast(game, 'p1', 'hornOfGondor');
  activate(game, 'p1', byCard(game, 'hornOfGondor')[0].id);
  resolveAll(game);
  // The Hero and the first Soldier are Humans.
  assert.equal(state(game).battlefield.filter((p) => p.name.includes('Soldier')).length, 3);
});

test('War of the Last Alliance finds legends, then gives double strike', () => {
  const { game } = setup({ p1: ['warOfTheLastAlliance'], cards: ['warOfTheLastAlliance'], library1: ['bear', 'hero'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'warOfTheLastAlliance');
  const d = decision(game);
  assert.equal(d.kind, CHOICE.SEARCH);
  assert.equal(d.options.length, 1);
  ok(game, toggleChoice('p1', d.options[0]));
  ok(game, confirmChoice('p1'));
  assert.ok(inHand(game, 'p1', 'hero'));
});

test('The Ring Goes South: lands for each legend, the rest on the bottom', () => {
  const { game } = setup({ p1: ['hero', 'theRingGoesSouth'], cards: ['theRingGoesSouth'], library1: ['salve', 'plains', 'salve'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'hero');
  cast(game, 'p1', 'theRingGoesSouth');
  assert.ok(byCard(game, 'plains')[0].tapped);
  const { library } = game.serialize().zones.p1;
  assert.equal(library.at(-1).cardId, 'salve');
});

test('games with the new state survive a serialize round trip', () => {
  const { game } = setup({ p1: ['gloinDwarfEmissary', 'mithrilCoat', 'rangersOfIthilien'], p2: ['bear'], cards: ['gloinDwarfEmissary', 'mithrilCoat', 'rangersOfIthilien'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'gloinDwarfEmissary');
  cast(game, 'p1', 'mithrilCoat');
  const copy = Game.deserialize(game.serialize());
  assert.deepEqual(copy.getState().battlefield, state(game).battlefield);
  assert.deepEqual(game.clone().getState().players, state(game).players);
});

// Wave B: counters, extra turns and combats, protection, and other contained rules.

test('Arwen, Mortal Queen: an indestructible counter to spend; lifelink counters are keywords', () => {
  const { game } = setup({ p1: ['arwenMortalQueen', 'bear'], cards: ['arwenMortalQueen'], freeAbilities: true });
  advanceTo(game, main(1));
  cast(game, 'p1', 'arwenMortalQueen');
  cast(game, 'p1', 'bear');
  const arwen = byCard(game, 'arwenMortalQueen')[0];
  assert.ok(arwen.keywords.includes(KEYWORD.INDESTRUCTIBLE), 'an indestructible counter');
  const bear = byCard(game, 'bear')[0];
  activate(game, 'p1', arwen.id, { targets: [bear.id] });
  resolveAll(game);
  const after = permanent(game, arwen.id);
  assert.ok(!after.counters[COUNTER.INDESTRUCTIBLE]);
  assert.ok(after.keywords.includes(KEYWORD.LIFELINK) && after.power === 3);
  const b = permanent(game, bear.id);
  assert.ok(b.keywords.includes(KEYWORD.LIFELINK) && b.keywords.includes(KEYWORD.INDESTRUCTIBLE) && b.power === 3);
  assert.equal(actionFor(game, ACTION.ACTIVATE_ABILITY, { cardId: arwen.id }), undefined, 'no counter left');
});

test('Aragorn, Company Leader: a chosen counter, copied onto another creature', () => {
  const { game } = setup({ p1: ['aragornCompanyLeader', 'bear', 'birthdayEscape'], cards: ['aragornCompanyLeader', 'birthdayEscape'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'aragornCompanyLeader');
  cast(game, 'p1', 'bear');
  const bear = byCard(game, 'bear')[0];
  cast(game, 'p1', 'birthdayEscape');
  ok(game, choose('p1', bear.id));
  resolveAll(game);
  assert.equal(decision(game).kind, CHOICE.COUNTER);
  ok(game, choose('p1', COUNTER.DEATHTOUCH));
  resolveAll(game);
  if (decision(game)?.type === DECISION.CHOOSE_TARGETS) ok(game, chooseTargets('p1', [bear.id]));
  resolveAll(game);
  assert.ok(byCard(game, 'aragornCompanyLeader')[0].keywords.includes(KEYWORD.DEATHTOUCH));
  assert.ok(permanent(game, bear.id).keywords.includes(KEYWORD.DEATHTOUCH));
});

test('Scroll of Isildur: stun counters keep creatures tapped through untaps', () => {
  const { game } = setup({ p1: ['scrollOfIsildur'], p2: ['bear', 'orc'], cards: ['scrollOfIsildur'] });
  advanceTo(game, main(2));
  cast(game, 'p2', 'bear');
  cast(game, 'p2', 'orc');
  advanceTo(game, main(3));
  cast(game, 'p1', 'scrollOfIsildur');
  resolveAll(game);
  advanceTo(game, main(5));
  // II: advanceTo picked the first targets: both creatures, tapped and stunned.
  const tapped = () => state(game).battlefield.filter((p) => p.controllerId === 'p2' && p.tapped && p.types.includes('Creature'));
  assert.equal(tapped().length, 2);
  assert.ok(tapped().every((p) => p.counters[COUNTER.STUN] === 1));
  advanceTo(game, main(6));
  assert.equal(tapped().length, 2, 'the stun counters came off instead');
  assert.ok(tapped().every((p) => !p.counters[COUNTER.STUN]));
  const hand = player(game, 'p1').hand.length;
  advanceTo(game, main(7));
  // III: a card for each tapped creature p2 controls (still tapped: the stun counters kept them so).
  assert.equal(player(game, 'p1').hand.length, hand + 1 + 2);
});

test('The Watcher in the Water: enters tapped with nine stun counters; Tentacles on opponents\' turns', () => {
  const { game } = setup({ p1: ['theWatcherInTheWater'], cards: ['theWatcherInTheWater'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'theWatcherInTheWater');
  const watcher = byCard(game, 'theWatcherInTheWater')[0];
  assert.ok(watcher.tapped);
  assert.equal(watcher.counters[COUNTER.STUN], 9);
  advanceTo(game, main(3));
  assert.equal(permanent(game, watcher.id).counters[COUNTER.STUN], 8);
});

test('Borne Upon a Wind: sorceries and creatures at instant speed this turn', () => {
  const { game } = setup({ p1: ['borneUponAWind', 'bear'], cards: ['borneUponAWind'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'borneUponAWind');
  advanceTo(game, { turn: 1, phase: PHASE.COMBAT, step: STEP.BEGINNING_OF_COMBAT });
  assert.ok(state(game).validActions.some((a) => a.type === ACTION.CAST_SPELL && a.cardId === inHand(game, 'p1', 'bear')));
});

test('Elrond, Master of Healing: counters on as many creatures as cards scried', () => {
  const { game } = setup({ p1: ['elrondMasterOfHealing', 'bear', 'orc', 'galadhrimGuide'], cards: ['elrondMasterOfHealing', 'galadhrimGuide'] });
  advanceTo(game, main(1));
  for (const id of ['elrondMasterOfHealing', 'bear', 'orc', 'galadhrimGuide']) cast(game, 'p1', id);
  ok(game, confirmChoice('p1'));
  resolveAll(game);
  const d = decision(game);
  assert.equal(d.targetKinds.length, 2, 'scry 2: up to two targets');
  ok(game, chooseTargets('p1', [byCard(game, 'bear')[0].id, byCard(game, 'orc')[0].id]));
  resolveAll(game);
  assert.equal(byCard(game, 'bear')[0].counters[COUNTER.PLUS_ONE], 1);
  assert.equal(byCard(game, 'orc')[0].counters[COUNTER.PLUS_ONE], 1);
});

test('Fall of Cair Andros amasses the excess of noncombat damage', () => {
  const { game } = setup({ p1: ['fallOfCairAndros', 'shock'], p2: ['orc'], cards: ['fallOfCairAndros'] });
  advanceTo(game, main(2));
  cast(game, 'p2', 'orc');
  advanceTo(game, main(3));
  cast(game, 'p1', 'fallOfCairAndros');
  cast(game, 'p1', 'shock', { targets: [byCard(game, 'orc')[0].id] });
  assert.equal(named(game, 'Orc Army')[0].counters[COUNTER.PLUS_ONE], 1);
});

test("Faramir, Prince of Ithilien: a card if they didn't attack, Soldiers if they did", () => {
  const { game } = setup({ p1: ['faramirPrinceOfIthilien'], p2: ['bear'], cards: ['faramirPrinceOfIthilien'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'faramirPrinceOfIthilien');
  advanceTo(game, main(2));
  cast(game, 'p2', 'bear');
  const hand = player(game, 'p1').hand.length;
  advanceTo(game, main(3));
  assert.equal(player(game, 'p1').hand.length, hand + 1 + 1, 'they didn\'t attack on turn 2');
  // Turn 4: p2 attacks with the Bear.
  advanceTo(game, { turn: 4, phase: PHASE.COMBAT, step: STEP.BEGINNING_OF_COMBAT });
  passRound(game);
  ok(game, toggleAttacker('p2', byCard(game, 'bear')[0].id));
  ok(game, confirmAttackers('p2'));
  advanceTo(game, main(5));
  assert.equal(state(game).battlefield.filter((p) => p.name.includes('Soldier')).length, 3);
});

test("Frodo, Sauron's Bane: hybrid mana makes him a Scout, then a Rogue who can end the game", () => {
  const { game } = setup({ p1: ['frodoSauronsBane'], cards: ['frodoSauronsBane'], fill: 'swamp' });
  for (let turn = 1; turn <= 5; turn += 2) {
    advanceTo(game, main(turn));
    const land = state(game).validActions.find((a) => a.type === ACTION.PLAY_LAND && a.playerId === 'p1');
    if (land) ok(game, land);
  }
  cast(game, 'p1', 'frodoSauronsBane');
  const frodo = byCard(game, 'frodoSauronsBane')[0];
  for (const swamp of byCard(game, 'swamp').slice(0, 2)) activate(game, 'p1', swamp.id);
  activate(game, 'p1', frodo.id, { abilityId: 'ability1' });
  resolveAll(game);
  const scout = permanent(game, frodo.id);
  assert.deepEqual([scout.subtypes, scout.power, scout.toughness], [['Halfling', 'Scout'], 2, 3]);
  assert.ok(scout.keywords.includes(KEYWORD.LIFELINK));
  advanceTo(game, main(7));
  assert.equal(permanent(game, frodo.id).power, 2, 'for good');
});

test('Forge Anew: an Equipment back from the graveyard, and the first equip each turn is free, at instant speed', () => {
  const shatter = { id: 'shatter', name: 'Shatter', manaCost: {}, types: ['Instant'], target: 'artifact', effects: [{ type: 'destroy' }] };
  const { game } = setup({ p1: ['stingTheGlintingDagger', 'shatter', 'forgeAnew', 'bear'], cards: ['stingTheGlintingDagger', 'forgeAnew'], extra: { shatter } });
  advanceTo(game, main(1));
  cast(game, 'p1', 'stingTheGlintingDagger');
  cast(game, 'p1', 'bear');
  cast(game, 'p1', 'shatter', { targets: [byCard(game, 'stingTheGlintingDagger')[0].id] });
  ok(game, castSpell('p1', inHand(game, 'p1', 'forgeAnew')));
  resolveAll(game);
  if (decision(game)?.type === DECISION.CHOOSE_TARGETS) ok(game, chooseTargets('p1', [player(game, 'p1').graveyard.find((c) => c.cardId === 'stingTheGlintingDagger').id]));
  resolveAll(game);
  const sting = byCard(game, 'stingTheGlintingDagger')[0];
  assert.ok(sting, 'back on the battlefield');
  advanceTo(game, { turn: 1, phase: PHASE.COMBAT, step: STEP.BEGINNING_OF_COMBAT });
  const equip = actionFor(game, ACTION.ACTIVATE_ABILITY, { cardId: sting.id, abilityId: 'equip' });
  assert.ok(equip, 'during combat, with no mana: free');
  ok(game, equip);
  resolveAll(game);
  assert.equal(byCard(game, 'stingTheGlintingDagger')[0].attachedTo, byCard(game, 'bear')[0].id);
});

test('Goldberry moves counters onto herself, then off for a card', () => {
  const { game } = setup({ p1: ['goldberryRiverDaughter', 'arwenMortalQueen'], cards: ['goldberryRiverDaughter', 'arwenMortalQueen'], freeAbilities: true });
  advanceTo(game, main(1));
  cast(game, 'p1', 'goldberryRiverDaughter');
  cast(game, 'p1', 'arwenMortalQueen');
  advanceTo(game, main(3));
  const goldberry = byCard(game, 'goldberryRiverDaughter')[0];
  const arwen = byCard(game, 'arwenMortalQueen')[0];
  activate(game, 'p1', goldberry.id, { abilityId: 'ability1', targets: [arwen.id] });
  resolveAll(game);
  assert.ok(permanent(game, goldberry.id).keywords.includes(KEYWORD.INDESTRUCTIBLE));
  assert.ok(!permanent(game, arwen.id).counters[COUNTER.INDESTRUCTIBLE]);
});

test('Hew the Entwood: sacrificed lands become a look at that many cards', () => {
  const { game } = setup({ p1: ['hewTheEntwood'], cards: ['hewTheEntwood'], library1: ['mountain', 'salve', 'mithrilCoat'] });
  advanceTo(game, main(1));
  playLand(game, 'forest');
  advanceTo(game, main(3));
  playLand(game, 'forest');
  // p1's library after the hand: turn 3 drew the Mountain, so the top is now Salve, Mithril Coat.
  cast(game, 'p1', 'hewTheEntwood');
  const sacrifice = decision(game);
  assert.equal(sacrifice.kind, CHOICE.SACRIFICE_ANY);
  for (const id of sacrifice.options) ok(game, toggleChoice('p1', id));
  ok(game, confirmChoice('p1'));
  const look = decision(game);
  assert.equal(look.kind, CHOICE.LOOK);
  assert.equal(look.cards.length, 2);
  for (const id of look.options) ok(game, toggleChoice('p1', id));
  ok(game, confirmChoice('p1'));
  assert.equal(byCard(game, 'mithrilCoat').length, 1);
});

test("Lobelia exiles a creature card that died this turn and makes Treasures for its power", () => {
  const { game } = setup({ p1: ['shock', 'lobeliaSackvilleBaggins'], p2: ['bear'], cards: ['lobeliaSackvilleBaggins'] });
  advanceTo(game, main(2));
  cast(game, 'p2', 'bear');
  advanceTo(game, main(3));
  cast(game, 'p1', 'shock', { targets: [byCard(game, 'bear')[0].id] });
  cast(game, 'p1', 'lobeliaSackvilleBaggins');
  assert.equal(player(game, 'p2').exile.length, 1);
  assert.equal(named(game, 'Treasure').length, 2);
});

test('Lost Isle Calling: a verse counter per scry, then cards and, at seven, an extra turn', () => {
  const scryTwice = { id: 'scryTwice', name: 'Scry Twice', manaCost: {}, types: ['Instant'], effects: [{ type: 'scry', count: 1 }, { type: 'scry', count: 1 }] };
  const { game } = setup({ p1: ['lostIsleCalling', ...Array(4).fill('scryTwice')], cards: ['lostIsleCalling'], freeAbilities: true, extra: { scryTwice } });
  advanceTo(game, main(1));
  cast(game, 'p1', 'lostIsleCalling');
  for (let i = 0; i < 4; i++) {
    cast(game, 'p1', 'scryTwice');
    for (let j = 0; j < 2; j++) {
      ok(game, confirmChoice('p1'));
      resolveAll(game);
    }
  }
  const isle = byCard(game, 'lostIsleCalling')[0];
  assert.equal(isle.counters[COUNTER.VERSE], 8);
  const hand = player(game, 'p1').hand.length;
  activate(game, 'p1', isle.id);
  resolveAll(game);
  assert.equal(byCard(game, 'lostIsleCalling').length, 0, 'exiled as the cost');
  assert.equal(player(game, 'p1').hand.length, hand + 8);
  advanceTo(game, main(2));
  assert.equal(state(game).activePlayerId, 'p1', 'the extra turn');
  advanceTo(game, main(3));
  assert.equal(state(game).activePlayerId, 'p2');
});

test('Orcish Bowmasters: shoot on entering and on extra draws, then amass', () => {
  const { game } = setup({ p1: ['orcishBowmasters'], p2: ['borneUponAWind'], cards: ['orcishBowmasters', 'borneUponAWind'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'orcishBowmasters');
  if (decision(game)?.type === DECISION.CHOOSE_TARGETS) ok(game, chooseTargets('p1', ['p2']));
  resolveAll(game);
  assert.equal(player(game, 'p2').life, 19);
  advanceTo(game, main(2));
  // p2's draw step draw didn't trigger it; their spell's draw does.
  assert.equal(player(game, 'p2').life, 19);
  ok(game, castSpell('p2', inHand(game, 'p2', 'borneUponAWind')));
  resolveAll(game);
  if (decision(game)?.type === DECISION.CHOOSE_TARGETS) ok(game, chooseTargets('p1', ['p2']));
  resolveAll(game);
  assert.equal(player(game, 'p2').life, 18);
  assert.equal(named(game, 'Orc Army')[0].counters[COUNTER.PLUS_ONE], 2);
});

test('Palantír of Orthanc: the opponent chooses between your card and their life', () => {
  const { game } = setup({ p1: ['palantirOfOrthanc'], cards: ['palantirOfOrthanc'], library1: ['giant'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'palantirOfOrthanc');
  assert.equal(untilDecision(game).kind, CHOICE.SCRY);
  ok(game, confirmChoice('p1'));
  const d = decision(game);
  assert.equal(d.kind, CHOICE.MAY);
  assert.equal(d.playerId, 'p2');
  ok(game, choose('p2', 'no'));
  // p1 mills one card (one influence counter).
  assert.equal(player(game, 'p1').graveyard.length, 1);
});

test('Phial of Galadriel: two cards from an empty hand; double life when low', () => {
  const emptyAndDraw = { id: 'emptyAndDraw', name: 'Empty and Draw', manaCost: {}, types: ['Sorcery'], effects: [{ type: 'discard', all: true }, { type: 'drawCards', count: 1 }] };
  const pain = { id: 'pain', name: 'Pain', manaCost: {}, types: ['Sorcery'], effects: [{ type: 'loseLife', amount: 15 }] };
  const { game } = setup({ p1: ['phialOfGaladriel', 'pain', 'salve', 'emptyAndDraw'], cards: ['phialOfGaladriel'], extra: { emptyAndDraw, pain } });
  advanceTo(game, main(1));
  cast(game, 'p1', 'phialOfGaladriel');
  cast(game, 'p1', 'pain');
  cast(game, 'p1', 'salve');
  assert.equal(player(game, 'p1').life, 5 + 6);
  cast(game, 'p1', 'emptyAndDraw');
  assert.equal(player(game, 'p1').hand.length, 2);
});

test('Radagast looks at cards for a creature of a new type', () => {
  const elk = { id: 'elk', name: 'Elk', manaCost: { generic: 2 }, types: ['Creature'], subtypes: ['Elk'], power: 2, toughness: 2 };
  const { game } = setup({ p1: ['radagastTheBrown', 'elk'], cards: ['radagastTheBrown'], library1: ['forest', 'bear', 'hero', 'elk'], extra: { elk } });
  advanceTo(game, main(1));
  playLand(game, 'forest');
  cast(game, 'p1', 'radagastTheBrown');
  // Radagast itself costs nothing here (mana value 0): nothing to look at.
  assert.equal(decision(game), null);
  advanceTo(game, main(3));
  playLand(game, 'forest');
  for (const forest of byCard(game, 'forest')) activate(game, 'p1', forest.id);
  cast(game, 'p1', 'elk');
  const d = decision(game);
  assert.equal(d.kind, CHOICE.LOOK);
  assert.equal(d.cards.length, 2, "the Elk's mana value");
  assert.equal(d.options.length, 2, 'the Bear and the Hero share no type with Radagast or the Elk');
  ok(game, toggleChoice('p1', d.options[0]));
  ok(game, confirmChoice('p1'));
  assert.ok(inHand(game, 'p1', 'bear'));
});

test('Sauron, the Dark Lord: ward—sacrifice a legend', () => {
  const { game } = setup({ p1: ['sauronTheDarkLord'], p2: ['hero', 'shock'], cards: ['sauronTheDarkLord'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'sauronTheDarkLord');
  advanceTo(game, main(2));
  cast(game, 'p2', 'hero');
  ok(game, castSpell('p2', inHand(game, 'p2', 'shock'), [byCard(game, 'sauronTheDarkLord')[0].id]));
  resolveAll(game);
  const d = decision(game);
  assert.equal(d.kind, CHOICE.PAY);
  ok(game, choose('p2', d.options[0]));
  resolveAll(game);
  assert.equal(byCard(game, 'hero').length, 0, 'sacrificed');
  assert.equal(byCard(game, 'sauronTheDarkLord')[0].damage, 2);
  // p2 cast two spells: two Armies' worth of counters.
  assert.equal(named(game, 'Orc Army')[0].counters[COUNTER.PLUS_ONE], 2);
});

test('The One Ring: protection from everything until your next turn, then burden', () => {
  const { game } = setup({ p1: ['theOneRing'], p2: ['shock'], cards: ['theOneRing'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'theOneRing');
  advanceTo(game, main(2));
  assert.ok(!state(game).validActions.some((a) => a.cardId === inHand(game, 'p2', 'shock') && a.targets?.[0] === 'p1'), 'p1 can\'t be targeted');
  advanceTo(game, main(3));
  activate(game, 'p1', byCard(game, 'theOneRing')[0].id);
  resolveAll(game);
  assert.equal(byCard(game, 'theOneRing')[0].counters[COUNTER.BURDEN], 1);
});

test('Éomer, Marshal of Rohan: a legend dying in the attack means another combat', () => {
  const { game, events } = setup({ p1: ['eomerMarshalOfRohan', 'hero'], p2: ['giant'], cards: ['eomerMarshalOfRohan'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'eomerMarshalOfRohan');
  cast(game, 'p1', 'hero');
  advanceTo(game, main(2));
  cast(game, 'p2', 'giant');
  const hero = byCard(game, 'hero')[0];
  const eomer = byCard(game, 'eomerMarshalOfRohan')[0];
  attack(game, 3, [hero.id, eomer.id], { [byCard(game, 'giant')[0].id]: hero.id });
  // The second combat: Éomer attacks again.
  for (let i = 0; i < 30 && decision(game)?.type !== DECISION.DECLARE_ATTACKERS; i++) {
    if (decision(game)) ok(game, state(game).validActions[0]);
    else passRound(game);
  }
  ok(game, toggleAttacker('p1', eomer.id));
  ok(game, confirmAttackers('p1'));
  advanceTo(game, { turn: 3, phase: PHASE.POSTCOMBAT_MAIN });
  assert.equal(byCard(game, 'hero').length, 0);
  const combats = events.filter((e) => e.name === 'stepStarted' && e.payload.turn === 3 && e.payload.step === STEP.BEGINNING_OF_COMBAT);
  assert.equal(combats.length, 2);
  assert.equal(player(game, 'p2').life, 20 - 4 - 4, 'Éomer attacked again, untapped');
});

test('Doors of Durin: scry 2, then a creature from the top joins the attack', () => {
  const { game } = setup({ p1: ['doorsOfDurin', 'bear'], cards: ['doorsOfDurin'], library1: ['forest', 'giant'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'doorsOfDurin');
  cast(game, 'p1', 'bear');
  attack(game, 3, [byCard(game, 'bear')[0].id]);
  resolveAll(game);
  // Turn 3 drew the Forest; the Giant is on top. Keep it there, then reveal it.
  const scry = decision(game);
  assert.equal(scry.kind, CHOICE.SCRY);
  ok(game, toggleChoice('p1', scry.options[0]));
  ok(game, confirmChoice('p1'));
  ok(game, choose('p1', 'yes'));
  resolveAll(game);
  const giant = byCard(game, 'giant')[0];
  assert.ok(giant.tapped);
  assert.ok(state(game).combat.attackers.some((a) => a.cardId === giant.id));
});

test('Tom Bombadil: a Saga finishing reveals the next Saga', () => {
  const { game } = setup({ p1: ['tomBombadil', 'theBathSong'], cards: ['tomBombadil', 'theBathSong'], library1: ['forest', 'forest', 'forest', 'forest', 'forest', 'salve', 'bookOfMazarbul'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'tomBombadil');
  cast(game, 'p1', 'theBathSong');
  advanceTo(game, main(5));
  assert.equal(byCard(game, 'bookOfMazarbul').length, 1);
});

test('Fangorn: attacking Treefolk add green mana, which stays', () => {
  const treefolk = { id: 'treefolk', name: 'Treefolk', manaCost: {}, types: ['Creature'], subtypes: ['Treefolk'], power: 2, toughness: 4 };
  const { game } = setup({ p1: ['fangornTreeShepherd', 'treefolk'], cards: ['fangornTreeShepherd'], extra: { treefolk } });
  advanceTo(game, main(1));
  cast(game, 'p1', 'fangornTreeShepherd');
  cast(game, 'p1', 'treefolk');
  attack(game, 3, [byCard(game, 'fangornTreeShepherd')[0].id, byCard(game, 'treefolk')[0].id]);
  resolveAll(game);
  assert.ok(!byCard(game, 'treefolk')[0].tapped, 'vigilance');
  advanceTo(game, { turn: 3, phase: PHASE.POSTCOMBAT_MAIN });
  assert.equal(player(game, 'p1').manaPool.G, 4);
});

// Wave C: protection, casting without paying or from other zones, and copy tokens.

test('Éowyn, Fearless Knight exiles a bigger creature; legends gain protection from its colors', () => {
  const redGiant = { ...{ id: 'redGiant', name: 'Red Giant', manaCost: {}, types: ['Creature'], subtypes: ['Giant'], power: 5, toughness: 5, colors: ['R'] } };
  const { game } = setup({ p1: ['eowynFearlessKnight', 'hero'], p2: ['redGiant', 'shock'], cards: ['eowynFearlessKnight'], extra: { redGiant } });
  advanceTo(game, main(2));
  cast(game, 'p2', 'redGiant');
  advanceTo(game, main(3));
  cast(game, 'p1', 'hero');
  cast(game, 'p1', 'eowynFearlessKnight');
  assert.equal(byCard(game, 'redGiant').length, 0, 'exiled');
  const hero = byCard(game, 'hero')[0];
  assert.deepEqual(hero.protections, [{ colors: ['R'] }]);
  // Shock is red (protection from red): it can't target the Hero.
  passRound(game);
  assert.ok(!state(game).validActions.some((a) => a.targets?.includes(hero.id)));
});

test('Pippin, Guard of the Citadel: protection from a chosen card type stops blocks and damage', () => {
  const { game } = setup({ p1: ['pippinGuardOfTheCitadel', 'bear'], p2: ['giant', 'shock'], cards: ['pippinGuardOfTheCitadel'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'pippinGuardOfTheCitadel');
  cast(game, 'p1', 'bear');
  advanceTo(game, main(2));
  cast(game, 'p2', 'giant');
  advanceTo(game, main(3));
  const bear = byCard(game, 'bear')[0];
  activate(game, 'p1', byCard(game, 'pippinGuardOfTheCitadel')[0].id, { targets: [bear.id] });
  resolveAll(game);
  assert.equal(decision(game).kind, CHOICE.CARD_TYPE);
  ok(game, choose('p1', 'Creature'));
  advanceTo(game, { turn: 3, phase: PHASE.COMBAT, step: STEP.BEGINNING_OF_COMBAT });
  passRound(game);
  ok(game, toggleAttacker('p1', bear.id));
  ok(game, confirmAttackers('p1'));
  passRound(game);
  // The Giant (a creature) can't block it.
  assert.ok(!state(game).validActions.some((a) => a.type === ACTION.SET_BLOCKER && a.attackerId === bear.id));
});

test('Glamdring: first strike, +1/+0 per instant and sorcery, and a free spell on combat damage', () => {
  const { game } = setup({ p1: ['glamdring', 'bear', 'salve', 'shock'], cards: ['glamdring'], freeAbilities: true });
  advanceTo(game, main(1));
  cast(game, 'p1', 'glamdring');
  cast(game, 'p1', 'bear');
  cast(game, 'p1', 'salve');
  const bear = byCard(game, 'bear')[0];
  activate(game, 'p1', byCard(game, 'glamdring')[0].id, { targets: [bear.id] });
  resolveAll(game);
  assert.equal(permanent(game, bear.id).power, 3, 'one instant in the graveyard');
  assert.ok(permanent(game, bear.id).keywords.includes(KEYWORD.FIRST_STRIKE));
  attack(game, 3, [bear.id]);
  const d = untilDecision(game);
  assert.equal(d.kind, CHOICE.CAST_FREE);
  ok(game, choose('p1', inHand(game, 'p1', 'shock')));
  // Shock has two kinds of target: which one is asked next.
  const v = decision(game);
  assert.equal(v.kind, CHOICE.CAST_FREE_VARIANT);
  const index = v.variants.findIndex((variant) => variant.targets[0] === 'p2');
  ok(game, choose('p1', String(index)));
  resolveAll(game);
  assert.equal(player(game, 'p2').life, 20 - 3 - 2);
});

test('Press the Enemy bounces a permanent, then casts a cheaper instant for free', () => {
  const { game } = setup({ p1: ['pressTheEnemy', 'salve'], p2: ['giant'], cards: ['pressTheEnemy'] });
  advanceTo(game, main(2));
  cast(game, 'p2', 'giant');
  advanceTo(game, main(3));
  cast(game, 'p1', 'pressTheEnemy', { targets: [byCard(game, 'giant')[0].id] });
  assert.ok(inHand(game, 'p2', 'giant'));
  assert.equal(decision(game).kind, CHOICE.CAST_FREE);
  ok(game, choose('p1', inHand(game, 'p1', 'salve')));
  resolveAll(game);
  assert.equal(player(game, 'p1').life, 23);
});

test('Moria Marauder: the exiled top card can be played this turn only', () => {
  const { game } = setup({ p1: ['moriaMarauder'], cards: ['moriaMarauder'], library1: ['forest', 'mountain', 'bear'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'moriaMarauder');
  attack(game, 3, [byCard(game, 'moriaMarauder')[0].id]);
  advanceTo(game, { turn: 3, phase: PHASE.POSTCOMBAT_MAIN });
  // Double strike: two hits, two cards exiled (the Mountain, then the Bear).
  const exiled = player(game, 'p1').exile;
  assert.deepEqual(exiled.map((c) => c.cardId), ['mountain', 'bear']);
  assert.ok(state(game).validActions.some((a) => a.type === ACTION.PLAY_LAND && a.zone === 'exile'));
  const bear = exiled.find((c) => c.cardId === 'bear');
  ok(game, { ...castSpell('p1', bear.id), zone: 'exile' });
  resolveAll(game);
  assert.equal(byCard(game, 'bear').length, 1);
  advanceTo(game, main(5));
  assert.ok(!state(game).validActions.some((a) => a.zone === 'exile'), 'only that turn');
});

test('Shadow of the Enemy: cast their creatures from exile with mana of any type', () => {
  const blueBird = { id: 'blueBird', name: 'Blue Bird', manaCost: { U: 1 }, types: ['Creature'], subtypes: ['Bird'], power: 1, toughness: 1 };
  const millSelf = { id: 'millSelf', name: 'Mill Self', manaCost: {}, types: ['Sorcery'], effects: [{ type: 'mill', count: 1 }] };
  const { game } = setup({ p1: ['shadowOfTheEnemy'], p2: ['millSelf'], library2: ['forest', 'blueBird'], cards: ['shadowOfTheEnemy'], extra: { blueBird, millSelf } });
  advanceTo(game, main(1));
  playLand(game, 'forest');
  advanceTo(game, main(2));
  cast(game, 'p2', 'millSelf');
  advanceTo(game, main(3));
  cast(game, 'p1', 'shadowOfTheEnemy', { targets: ['p2'] });
  const bird = player(game, 'p2').exile.find((c) => c.cardId === 'blueBird');
  assert.ok(bird);
  activate(game, 'p1', byCard(game, 'forest').find((p) => p.controllerId === 'p1').id);
  // A Forest's {G} pays the Bird's {U}.
  ok(game, { ...castSpell('p1', bird.id), zone: 'exile' });
  resolveAll(game);
  assert.equal(byCard(game, 'blueBird')[0].controllerId, 'p1');
});

test('Elven Chorus: cast creatures from the top of the library; creatures tap for any color', () => {
  const { game } = setup({ p1: ['elvenChorus', 'bear'], cards: ['elvenChorus'], library1: ['forest', 'giant'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'elvenChorus');
  cast(game, 'p1', 'bear');
  advanceTo(game, main(3));
  const view = game.getPlayerView('p1');
  assert.equal(view.zones.p1.knownTop[0].cardId, 'giant');
  const giant = state(game).players[0].library[0];
  ok(game, { ...castSpell('p1', giant.id), zone: 'library' });
  resolveAll(game);
  assert.equal(byCard(game, 'giant').length, 1);
  assert.ok(actionFor(game, ACTION.ACTIVATE_ABILITY, { cardId: byCard(game, 'bear')[0].id, abilityId: 'chorusMana' }));
});

test('Sauron, the Necromancer: a 3/3 Wraith copy attacks, then leaves unless he bears the Ring', () => {
  const { game } = setup({ p1: ['sauronTheNecromancer', 'giant', 'shock', 'shock', 'shock'], cards: ['sauronTheNecromancer'] });
  advanceTo(game, main(1));
  cast(game, 'p1', 'giant');
  for (let i = 0; i < 3; i++) cast(game, 'p1', 'shock', { targets: [byCard(game, 'giant')[0].id] });
  cast(game, 'p1', 'sauronTheNecromancer');
  attack(game, 3, [byCard(game, 'sauronTheNecromancer')[0].id]);
  resolveAll(game);
  const wraith = named(game, 'Giant').find((p) => p.token);
  assert.deepEqual([wraith.power, wraith.toughness, wraith.subtypes], [3, 3, ['Wraith']]);
  assert.ok(wraith.keywords.includes(KEYWORD.MENACE));
  assert.ok(state(game).combat.attackers.some((a) => a.cardId === wraith.id));
  advanceTo(game, main(4));
  assert.equal(named(game, 'Giant').length, 0, 'exiled at the end step');
});

test('Shelob: a creature a Spider damaged comes back as a Food copy', () => {
  const spider = { id: 'spider', name: 'Spider', manaCost: {}, types: ['Creature'], subtypes: ['Spider'], power: 1, toughness: 1 };
  const { game } = setup({ p1: ['shelobChildOfUngoliant', 'spider'], p2: ['bear'], cards: ['shelobChildOfUngoliant'], extra: { spider } });
  advanceTo(game, main(1));
  cast(game, 'p1', 'shelobChildOfUngoliant');
  cast(game, 'p1', 'spider');
  assert.ok(byCard(game, 'spider')[0].keywords.includes(KEYWORD.DEATHTOUCH));
  advanceTo(game, main(2));
  cast(game, 'p2', 'bear');
  advanceTo(game, { turn: 4, phase: PHASE.COMBAT, step: STEP.BEGINNING_OF_COMBAT });
  passRound(game);
  ok(game, toggleAttacker('p2', byCard(game, 'bear')[0].id));
  ok(game, confirmAttackers('p2'));
  passRound(game);
  ok(game, setBlocker('p1', byCard(game, 'spider')[0].id, byCard(game, 'bear')[0].id));
  ok(game, confirmBlockers('p1'));
  advanceTo(game, main(5));
  const food = named(game, 'Bear').find((p) => p.token);
  assert.ok(food && food.controllerId === 'p1');
  assert.deepEqual([food.types, food.subtypes], [['Artifact'], ['Food']]);
});

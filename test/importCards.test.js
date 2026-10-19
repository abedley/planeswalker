import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convertScryfallCard, cardIdFromName } from '../tools/scryfall/convert.js';
import { importCards } from '../tools/import-cards.js';
import { readImportedCards, writeImportedCards } from '../tools/scryfall/importedModule.js';
import { Game, castSpell, activateAbility, playLand, passPriority, PHASE, AFFECTED, TARGET } from '../src/index.js';
import { FIXTURES } from './fixtures/scryfallCards.js';

const convert = (key) => convertScryfallCard(FIXTURES[key]);
const problems = (key) => {
  const result = convert(key);
  assert.equal(result.ok, false, `${key} should not convert`);
  return result.problems;
};

test('card ids are camelCased names', () => {
  assert.equal(cardIdFromName('Llanowar Elves'), 'llanowarElves');
  assert.equal(cardIdFromName('Thalia, Guardian of Thraben'), 'thaliaGuardianOfThraben');
  assert.equal(cardIdFromName('Boggart Brute'), 'boggartBrute');
});

test('converts a vanilla creature with a generic mana cost', () => {
  const { ok, id, definition } = convert('grizzlyBears');
  assert.ok(ok);
  assert.equal(id, 'grizzlyBears');
  assert.deepEqual(
    { ...definition, scryfallId: undefined, scryfallUri: undefined },
    {
      id: 'grizzlyBears', name: 'Grizzly Bears', manaCost: { generic: 1, G: 1 },
      supertypes: [], types: ['Creature'], subtypes: ['Bear'], power: 2, toughness: 2,
      text: '', typeLine: 'Creature — Bear', oracleText: '', scryfallId: undefined, scryfallUri: undefined,
    },
  );
});

test('converts supported keywords, including several on one line and reminder text', () => {
  assert.deepEqual(convert('serraAngel').definition.keywords, ['flying', 'vigilance']);
  assert.deepEqual(convert('serraAngel').definition.manaCost, { generic: 3, W: 2 });
  assert.deepEqual(convert('vampireNighthawk').definition.keywords, ['flying', 'deathtouch', 'lifelink']);
  assert.deepEqual(convert('giantSpider').definition.keywords, ['reach']);
  assert.deepEqual(convert('boggartBrute').definition.keywords, ['menace']);
});

test('converts mana abilities, including a basic land\'s intrinsic one', () => {
  const tapForG = { id: 'tapForG', text: '{T}: Add {G}.', cost: { tap: true }, effect: { type: 'addMana', mana: { G: 1 } } };
  assert.deepEqual(convert('llanowarElves').definition.abilities, [tapForG]);
  const forest = convert('forest').definition;
  assert.deepEqual([forest.supertypes, forest.types, forest.subtypes], [['Basic'], ['Land'], ['Forest']]);
  assert.equal(forest.manaCost, undefined);
  assert.deepEqual(forest.abilities, [tapForG]);
  assert.deepEqual(convert('wastes').definition.abilities[0].effect.mana, { C: 1 });
});

test('reports rules text the engine can\'t do', () => {
  assert.deepEqual(problems('birdsOfParadise'), ['Unsupported rules text: "{T}: Add one mana of any color."']);
});

test('reports unsupported card types, supertypes and layouts', () => {
  assert.deepEqual(problems('jaceBeleren').slice(0, 2), [
    'Unsupported supertype: Legendary.',
    'Unsupported card type: Planeswalker.',
  ]);
  assert.deepEqual(problems('thalia'), [
    'Unsupported supertype: Legendary.',
    'Unsupported rules text: "Noncreature spells cost {1} more to cast."',
  ]);
  assert.deepEqual(problems('delverOfSecrets'), [
    'Unsupported layout "transform" (only single-faced "normal" cards are supported).',
  ]);
});

test('reports variable power/toughness, unsupported keywords and mana symbols', () => {
  assert.deepEqual(problems('tarmogoyf'), [
    'Unsupported power/toughness */1+* (only fixed numbers are supported).',
    `Unsupported rules text: "${FIXTURES.tarmogoyf.oracle_text}"`,
  ]);
  assert.deepEqual(problems('gladecoverScout'), ['Unsupported keyword: hexproof.']);
  assert.deepEqual(problems('kitchenFinks'), [
    'Unsupported mana symbol {G/W} in the mana cost.',
    'Unsupported mana symbol {G/W} in the mana cost.',
    'Unsupported rules text: "When Kitchen Finks enters, you gain 2 life."',
    'Unsupported keyword: persist.',
  ]);
});

test('importCards merges supported cards and reports the rest', () => {
  const existing = { grizzlyBears: { id: 'grizzlyBears', name: 'Old Bears' } };
  const { cards, imported, updated, skipped } = importCards(
    [FIXTURES.serraAngel, FIXTURES.grizzlyBears, FIXTURES.signInBlood, FIXTURES.llanowarElves],
    existing,
  );
  assert.deepEqual(imported, ['Serra Angel']);
  assert.deepEqual(updated, ['Grizzly Bears']);
  assert.deepEqual(Object.keys(cards).sort(), ['grizzlyBears', 'serraAngel']);
  assert.equal(cards.grizzlyBears.name, 'Grizzly Bears');
  assert.deepEqual(skipped.map((s) => s.name), ['Sign in Blood', 'Llanowar Elves']);
  assert.match(skipped[1].problems[0], /defined by hand/);
  assert.equal(existing.grizzlyBears.name, 'Old Bears'); // not mutated
});

test('the generated module round-trips and can be imported', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'planeswalker-import-'));
  try {
    const path = join(dir, 'importedCards.js');
    const { cards } = importCards([FIXTURES.vampireNighthawk, FIXTURES.serraAngel]);
    await writeImportedCards(path, cards);
    assert.deepEqual(await readImportedCards(path), cards);
    const module = await import(path);
    assert.deepEqual(Object.keys(module.IMPORTED_CARDS), ['serraAngel', 'vampireNighthawk']);
    assert.deepEqual(await readImportedCards(join(dir, 'missing.js')), {});
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('imported cards work in a game', () => {
  const { cards } = importCards([FIXTURES.grizzlyBears, FIXTURES.wastes]);
  const deck = ['wastes', 'wastes', 'grizzlyBears', ...Array(37).fill('wastes')];
  const game = new Game({
    players: [{ id: 'p1' }, { id: 'p2' }], cards, shuffleLibraries: false, decks: { p1: deck, p2: deck },
  });
  game.start();
  const hand = () => game.getState().players[0].hand;
  // Play a Wastes and tap it for {C}. Grizzly Bears costs {1}{G}, so it can't be cast with colorless mana.
  game.dispatch(passPriority('p1'));
  game.dispatch(passPriority('p2'));
  assert.equal(game.getState().phase, PHASE.PRECOMBAT_MAIN);
  game.dispatch(playLand('p1', hand().find((c) => c.cardId === 'wastes').id));
  const wastes = game.getState().battlefield[0];
  assert.deepEqual(game.dispatch(activateAbility('p1', wastes.id, 'tapForC')), { ok: true });
  assert.deepEqual(game.getState().players[0].manaPool.C, 1);
  const bears = hand().find((c) => c.cardId === 'grizzlyBears');
  assert.deepEqual([bears.power, bears.toughness, bears.manaCost], [2, 2, { generic: 1, G: 1 }]);
  assert.equal(game.dispatch(castSpell('p1', bears.id)).ok, false); // needs {G}
});

test('converts artifacts, Auras and Equipment', () => {
  const solRing = convert('solRing').definition;
  assert.deepEqual([solRing.types, solRing.manaCost], [['Artifact'], { generic: 1 }]);
  assert.deepEqual(solRing.abilities[0].effect.mana, { C: 2 });

  const holyStrength = convert('holyStrength').definition;
  assert.deepEqual([holyStrength.types, holyStrength.subtypes, holyStrength.enchant], [['Enchantment'], ['Aura'], TARGET.CREATURE]);
  assert.deepEqual(holyStrength.staticAbilities, [{ affected: AFFECTED.ATTACHED_PERMANENT, power: 1, toughness: 2 }]);

  const bonesplitter = convert('bonesplitter').definition;
  assert.deepEqual(bonesplitter.staticAbilities, [{ affected: AFFECTED.ATTACHED_PERMANENT, power: 2 }]);
  assert.deepEqual(bonesplitter.abilities.map((a) => [a.id, a.text, a.cost, a.target]),
    [['equip', 'Equip {1}', { mana: { generic: 1 } }, TARGET.CREATURE_YOU_CONTROL]]);

  assert.deepEqual(convert('arcaneFlight').definition.staticAbilities,
    [{ affected: AFFECTED.ATTACHED_PERMANENT, power: 1, toughness: 1, keywords: ['flying'] }]);
});

test('reports Aura and Equipment text the engine can\'t do', () => {
  assert.deepEqual(problems('rancor'), [
    'Unsupported rules text: "When Rancor is put into a graveyard from the battlefield, return Rancor to its owner\'s hand."',
  ]);
  assert.deepEqual(problems('pacifism'), ['Unsupported rules text: "Enchanted creature can\'t attack or block."']);
  assert.deepEqual(problems('lightningGreaves'), ['Unsupported keyword granted: shroud.']);
  assert.deepEqual(problems('gloriousAnthem'), ['Unsupported rules text: "Creatures you control get +1/+1."']);
});

test('imported Auras and Equipment work in a game', () => {
  const { cards } = importCards([FIXTURES.holyStrength, FIXTURES.grizzlyBears]);
  assert.ok(cards.holyStrength && cards.grizzlyBears);
  const game = new Game({ players: [{ id: 'p1' }, { id: 'p2' }], cards, seed: 1 });
  game.start();
  assert.equal(game.getState().status, 'inProgress');
});

test('converts instants and sorceries built from supported sentences', () => {
  const bolt = convert('lightningBolt').definition;
  assert.deepEqual([bolt.types, bolt.target, bolt.effects], [['Instant'], TARGET.ANY, [{ type: 'dealDamage', amount: 3 }]]);
  const growth = convert('giantGrowth').definition;
  assert.deepEqual([growth.target, growth.effects], [TARGET.CREATURE, [{ type: 'pump', power: 3, toughness: 3 }]]);
  assert.deepEqual(convert('murder').definition.effects, [{ type: 'destroy' }]);
  const divination = convert('divination').definition;
  assert.deepEqual([divination.types, divination.target, divination.effects], [['Sorcery'], undefined, [{ type: 'drawCards', count: 2 }]]);
  assert.deepEqual(problems('fling'), [
    'Unsupported rules text: "Fling deals damage equal to the sacrificed creature\'s power to any target."',
  ]);
});

test('converts common spell effects', () => {
  const effectsOf = (key) => {
    const { target, effects, additionalCost } = convert(key).definition;
    return { target, effects, ...(additionalCost ? { additionalCost } : {}) };
  };
  assert.deepEqual(effectsOf('unsummon'), { target: TARGET.CREATURE, effects: [{ type: 'returnToHand' }] });
  assert.deepEqual(effectsOf('naturalize'), { target: TARGET.ARTIFACT_OR_ENCHANTMENT, effects: [{ type: 'destroy' }] });
  assert.deepEqual(effectsOf('counterspell'), { target: TARGET.SPELL, effects: [{ type: 'counterSpell' }] });
  assert.deepEqual(effectsOf('essenceScatter').target, TARGET.CREATURE_SPELL);
  assert.deepEqual(effectsOf('negate').target, TARGET.NONCREATURE_SPELL);
  assert.deepEqual(effectsOf('darkRitual'), { target: undefined, effects: [{ type: 'addMana', mana: { B: 3 } }] });
  assert.deepEqual(effectsOf('raiseTheAlarm').effects, [{
    type: 'createToken', count: 2, token: { colors: ['white'], subtypes: ['Soldier'], power: 1, toughness: 1 },
  }]);
  assert.deepEqual(effectsOf('pyroclasm').effects, [{ type: 'dealDamage', amount: 2, affected: AFFECTED.EACH_CREATURE }]);
  assert.deepEqual(effectsOf('wrathOfGod').effects, [{ type: 'destroy', affected: AFFECTED.EACH_CREATURE }]);
  assert.deepEqual(effectsOf('overrun').effects, [{
    type: 'pump', power: 3, toughness: 3, keywords: ['trample'], affected: AFFECTED.EACH_CREATURE_YOU_CONTROL,
  }]);
  assert.deepEqual(effectsOf('lavaSpike'), { target: TARGET.PLAYER, effects: [{ type: 'dealDamage', amount: 3 }] });
  assert.deepEqual(convert('lavaSpike').definition.subtypes, ['Arcane']);
  assert.deepEqual(effectsOf('thoughtScour'), {
    target: TARGET.PLAYER, effects: [{ type: 'mill', count: 2, affected: AFFECTED.TARGET }, { type: 'drawCards', count: 1 }],
  });
  assert.deepEqual(effectsOf('battlegrowth'), { target: TARGET.CREATURE, effects: [{ type: 'addCounters', counter: '+1/+1', count: 1 }] });
});

test('converts additional costs to cast a spell', () => {
  assert.deepEqual(convert('villageRites').definition.additionalCost, { sacrifice: TARGET.CREATURE });
  assert.deepEqual(convert('tormentingVoice').definition.additionalCost, { discard: 1 });
  const splinters = convert('boneSplinters').definition;
  assert.deepEqual([splinters.additionalCost, splinters.target, splinters.effects], [{ sacrifice: TARGET.CREATURE }, TARGET.CREATURE, [{ type: 'destroy' }]]);
});

test('converts activated abilities with common costs and effects', () => {
  const abilitiesOf = (key) => convert(key).definition.abilities;
  assert.deepEqual(abilitiesOf('prodigalSorcerer'), [{
    id: 'ability1', text: '{T}: Prodigal Sorcerer deals 1 damage to any target.', cost: { tap: true },
    effect: { type: 'dealDamage', amount: 1 }, target: TARGET.ANY,
  }]);
  // "It" is the sacrificed creature itself.
  assert.deepEqual(abilitiesOf('moggFanatic')[0].cost, { sacrificeSelf: true });
  assert.deepEqual(abilitiesOf('moggFanatic')[0].effect, { type: 'dealDamage', amount: 1 });
  assert.deepEqual(abilitiesOf('mindStone').map((a) => [a.id, a.cost, a.effect]), [
    ['tapForC', { tap: true }, { type: 'addMana', mana: { C: 1 } }],
    ['ability2', { mana: { generic: 1 }, tap: true, sacrificeSelf: true }, { type: 'drawCards', count: 1 }],
  ]);
  assert.deepEqual(abilitiesOf('shivanDragon')[0].effect, { type: 'pump', power: 1, toughness: 0, affected: AFFECTED.SOURCE });
  assert.deepEqual(abilitiesOf('greed')[0].cost, { mana: { B: 1 }, life: 2 });
  assert.deepEqual(abilitiesOf('dragonRoost')[0].effect.token, {
    colors: ['red'], subtypes: ['Dragon'], power: 5, toughness: 5, keywords: ['flying'],
  });
});

test('reports costs and effects the engine can\'t do', () => {
  assert.deepEqual(problems('royalAssassin'), ['Unsupported rules text: "{T}: Destroy target tapped creature."']);
  assert.deepEqual(problems('signInBlood'), ['Unsupported rules text: "Target player draws two cards and loses 2 life."']);
  // Made up, for the two-target check.
  const twoTargets = {
    ...FIXTURES.naturalize, name: 'Double Shatter', oracle_text: 'Destroy target artifact. Destroy target enchantment.',
  };
  assert.deepEqual(convertScryfallCard(twoTargets).problems, [
    'More than one target isn\'t supported: "Destroy target artifact. Destroy target enchantment."',
  ]);
  const exileCost = { ...FIXTURES.greed, name: 'Grim Ledger', oracle_text: 'Exile a card from your graveyard: Draw a card.' };
  assert.deepEqual(convertScryfallCard(exileCost).problems, [
    'Unsupported cost: "Exile a card from your graveyard".',
  ]);
});

test('imported abilities and spells work in a game', () => {
  const { cards } = importCards([FIXTURES.mountain, FIXTURES.moggFanatic, FIXTURES.lavaSpike]);
  const deck = ['moggFanatic', 'lavaSpike', ...Array(38).fill('mountain')];
  const game = new Game({
    players: [{ id: 'p1' }, { id: 'p2' }], cards, shuffleLibraries: false, decks: { p1: deck, p2: deck }, emblems: { p1: [], p2: [] },
  });
  game.start();
  const p1 = () => game.getState().players[0];
  const pass = () => { game.dispatch(passPriority(game.getState().priorityPlayerId)); };
  const passRound = () => { pass(); pass(); };
  const playAndTap = () => {
    game.dispatch(playLand('p1', p1().hand.find((c) => c.cardId === 'mountain').id));
    const mountain = game.getState().battlefield.find((p) => p.cardId === 'mountain' && !p.tapped);
    assert.deepEqual(game.dispatch(activateAbility('p1', mountain.id, 'tapForR')), { ok: true });
  };
  passRound(); // upkeep -> main
  playAndTap();
  const fanatic = p1().hand.find((c) => c.cardId === 'moggFanatic').id;
  assert.deepEqual(game.dispatch(castSpell('p1', fanatic)), { ok: true });
  passRound();
  assert.deepEqual(game.dispatch(activateAbility('p1', fanatic, 'ability1', ['p2'])), { ok: true });
  passRound();
  assert.equal(game.getState().players[1].life, 19);
  assert.ok(p1().graveyard.some((c) => c.id === fanatic));
  while (game.getState().turn < 3 || game.getState().phase !== PHASE.PRECOMBAT_MAIN) {
    const { pendingDecision, validActions } = game.getState();
    if (pendingDecision) game.dispatch(validActions.find((a) => a.type.startsWith('CONFIRM_')) ?? validActions.at(-1));
    else pass();
  }
  playAndTap();
  const spike = p1().hand.find((c) => c.cardId === 'lavaSpike').id;
  // Lava Spike can target only players.
  assert.deepEqual(
    game.getState().validActions.filter((a) => a.cardId === spike).map((a) => a.targets),
    [['p1'], ['p2']],
  );
  assert.deepEqual(game.dispatch(castSpell('p1', spike, ['p2'])), { ok: true });
  passRound();
  assert.equal(game.getState().players[1].life, 16);
});

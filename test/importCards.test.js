import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convertScryfallCard, cardIdFromName } from '../tools/scryfall/convert.js';
import { importCards, parseCardLine } from '../tools/import-cards.js';
import { readImportedCards, readImportedModule, writeImportedCards } from '../tools/scryfall/importedModule.js';
import {
  Game, castSpell, activateAbility, playLand, passPriority, PHASE, AFFECTED, TARGET, TOKEN, TRIGGER, KEYWORD, EFFECT,
} from '../src/index.js';
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
  assert.equal(cardIdFromName('Healer\'s Hawk'), 'healersHawk');
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

test('keeps the art, artist, colors, rarity and set the app shows', () => {
  const { definition } = convert('runeclawBear');
  assert.deepEqual(definition.image, {
    art: 'https://cards.scryfall.io/art_crop/front/r/b/runeclaw.jpg',
    card: 'https://cards.scryfall.io/normal/front/r/b/runeclaw.jpg',
  });
  assert.deepEqual(
    [definition.artist, definition.colors, definition.rarity, definition.set, definition.collectorNumber],
    ['Jesper Ejsing', ['G'], 'common', 'm12', '197'],
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
  assert.deepEqual(problems('gildedLotus'), ['Unsupported rules text: "{T}: Add three mana of any one color."']);
});

test('reports unsupported card types, supertypes and layouts', () => {
  assert.deepEqual(problems('jaceBeleren')[0], 'Unsupported card type: Planeswalker.');
  assert.deepEqual(problems('thalia'), [
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
    'Unsupported keyword: persist.',
  ]);
});

test('importCards merges supported cards and reports the rest', () => {
  const existing = { grizzlyBears: { id: 'grizzlyBears', name: 'Old Bears' } };
  const { cards, imported, updated, skipped } = importCards(
    [FIXTURES.serraAngel, FIXTURES.grizzlyBears, FIXTURES.royalAssassin, FIXTURES.llanowarElves],
    existing,
  );
  assert.deepEqual(imported, ['Serra Angel']);
  assert.deepEqual(updated, ['Grizzly Bears']);
  assert.deepEqual(Object.keys(cards).sort(), ['grizzlyBears', 'serraAngel']);
  assert.equal(cards.grizzlyBears.name, 'Grizzly Bears');
  assert.deepEqual(skipped.map((s) => s.name), ['Royal Assassin', 'Llanowar Elves']);
  assert.match(skipped[1].problems[0], /defined by hand/);
  assert.equal(existing.grizzlyBears.name, 'Old Bears'); // not mutated
});

test('card list lines can pin a printing', () => {
  assert.deepEqual(parseCardLine('Shock'), { name: 'Shock' });
  assert.deepEqual(parseCardLine('Shock (M21)'), { name: 'Shock', set: 'm21' });
  assert.deepEqual(parseCardLine('  Hero\'s Downfall|fdn  # removal'), { name: 'Hero\'s Downfall', set: 'fdn' });
  assert.deepEqual(parseCardLine('4 Serra Angel (M19)'), { name: 'Serra Angel', set: 'm19' });
  assert.deepEqual(parseCardLine('Fire Elemental'), { name: 'Fire Elemental' });
  assert.equal(parseCardLine('# just a comment'), null);
  assert.equal(parseCardLine('   '), null);
});

test('hand-written cards get their art recorded instead of being replaced', async () => {
  const elves = { ...FIXTURES.llanowarElves, image_uris: { art_crop: 'art.jpg', normal: 'card.jpg' }, artist: 'Someone', colors: ['G'], set: 'm19', rarity: 'common' };
  const { cards, presentation, decorated } = importCards([elves]);
  assert.deepEqual(cards, {});
  assert.deepEqual(decorated, ['Llanowar Elves']);
  assert.deepEqual(presentation.llanowarElves, { image: { art: 'art.jpg', card: 'card.jpg' }, artist: 'Someone', colors: ['G'], rarity: 'common', set: 'm19' });
  const dir = await mkdtemp(join(tmpdir(), 'planeswalker-import-'));
  try {
    const path = join(dir, 'importedCards.js');
    await writeImportedCards(path, cards, presentation);
    assert.deepEqual(await readImportedModule(path), { cards, presentation });
    assert.deepEqual((await import(path)).CARD_PRESENTATION, presentation);
  } finally {
    await rm(dir, { recursive: true });
  }
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
  assert.deepEqual(problems('claustrophobia'), [
    'Unsupported rules text: "When this Aura enters, tap enchanted creature."',
    'Unsupported rules text: "Enchanted creature doesn\'t untap during its controller\'s untap step."',
  ]);
  assert.deepEqual(problems('lightningGreaves'), ['Unsupported keyword granted: shroud.']);
  // Both players' creatures: not an anthem the game has.
  assert.deepEqual(problems('crusade'), ['Unsupported rules text: "White creatures get +1/+1."']);
});

test('converts Auras that restrict attacking and blocking', () => {
  const restriction = (key) => convert(key).definition.staticAbilities;
  assert.deepEqual(restriction('pacifism'), [{ affected: AFFECTED.ATTACHED_PERMANENT, keywords: [KEYWORD.CANT_ATTACK, KEYWORD.CANT_BLOCK] }]);
  assert.deepEqual(restriction('maniacalRage'), [{ affected: AFFECTED.ATTACHED_PERMANENT, power: 2, toughness: 2, keywords: [KEYWORD.CANT_BLOCK] }]);
  assert.deepEqual(restriction('aetherTunnel'), [{ affected: AFFECTED.ATTACHED_PERMANENT, power: 1, keywords: [KEYWORD.CANT_BE_BLOCKED] }]);
});

test('converts anthems and lords', () => {
  const anthem = (key) => convert(key).definition.staticAbilities;
  const each = AFFECTED.EACH_CREATURE_YOU_CONTROL;
  assert.deepEqual(anthem('gloriousAnthem'), [{ affected: each, power: 1, toughness: 1 }]);
  assert.deepEqual(anthem('honorOfThePure'), [{ affected: each, power: 1, toughness: 1, colors: ['W'] }]);
  const captain = convert('captainOfTheWatch').definition;
  assert.deepEqual(captain.staticAbilities, [{
    affected: each, power: 1, toughness: 1, keywords: ['vigilance'], other: true, subtypes: ['Soldier'],
  }]);
  assert.deepEqual([captain.keywords, captain.triggeredAbilities[0].effect.count], [['vigilance'], 3]);
});

test('converts an Aura\'s "When this Aura enters" trigger', () => {
  const favor = convert('divineFavor').definition;
  assert.deepEqual([favor.triggeredAbilities[0].effect, favor.staticAbilities[0].toughness], [{ type: 'gainLife', amount: 3 }, 3]);
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

test('reads blocking restrictions', () => {
  const card = (base, name, text) => convertScryfallCard({ ...FIXTURES[base], name, oracle_text: text }).definition;
  assert.deepEqual(card('grizzlyBears', 'Craven Bears', "This creature can't block.").keywords, ["can't block"]);
  assert.deepEqual(card('grizzlyBears', 'Sneaky Bears', "Sneaky Bears can't be blocked.").keywords, ["can't be blocked"]);
  const panic = card('naturalize', 'Panic', "Target creature can't block this turn.");
  assert.deepEqual(panic.effects, [{ type: 'pump', keywords: ["can't block"] }]);
  assert.equal(panic.target, TARGET.CREATURE);
  assert.deepEqual(card('naturalize', 'Rout', "Creatures your opponents control can't block this turn.").effects, [
    { type: 'pump', keywords: ["can't block"], affected: AFFECTED.EACH_CREATURE_OPPONENTS_CONTROL },
  ]);
  assert.deepEqual(card('naturalize', 'Slip Through', "Target creature gets +2/+0 and can't be blocked this turn.").effects, [
    { type: 'pump', power: 2, toughness: 0, keywords: ["can't be blocked"] },
  ]);
});

test('reads sentences of two effects joined by "and"', () => {
  // Sign in Blood: the second effect takes the first's subject, the same target.
  const signInBlood = convert('signInBlood').definition;
  assert.deepEqual(signInBlood.effects.map((e) => [e.type, e.affected]), [['drawCards', AFFECTED.TARGET], ['loseLife', AFFECTED.TARGET]]);
  assert.equal(signInBlood.target, TARGET.PLAYER);
  const card = (base, name, text) => convertScryfallCard({ ...FIXTURES[base], name, oracle_text: text });
  const drain = card('grizzlyBears', 'Drain Bears', 'When this creature enters, target opponent loses 2 life and you gain 2 life.').definition;
  assert.deepEqual(drain.triggeredAbilities[0].effects.map((e) => [e.type, e.amount]), [['loseLife', 2], ['gainLife', 2]]);
  assert.equal(drain.triggeredAbilities[0].target, TARGET.OPPONENT);
  const ledger = card('naturalize', 'Dark Ledger', 'You draw two cards and lose 2 life.').definition;
  assert.deepEqual(ledger.effects.map((e) => [e.type, e.affected ?? null]), [['drawCards', null], ['loseLife', null]]);
  // Two different targets are still one too many.
  assert.deepEqual(card('naturalize', 'Wreck', 'Destroy target artifact and target player loses 2 life.').problems, [
    'More than one target isn\'t supported: "Destroy target artifact and target player loses 2 life."',
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

test('converts Treasure, Food and Clue tokens, investigate, and mana of any color', () => {
  const pie = convert('bakeIntoAPie').definition;
  assert.deepEqual([pie.target, pie.effects], [TARGET.CREATURE, [
    { type: 'destroy' }, { type: 'createToken', count: 1, token: TOKEN.FOOD },
  ]]);
  const score = convert('bigScore').definition;
  assert.deepEqual([score.additionalCost, score.effects], [{ discard: 1 }, [
    { type: 'drawCards', count: 2 }, { type: 'createToken', count: 2, token: TOKEN.TREASURE },
  ]]);
  assert.deepEqual(convert('sampleInquiry').definition.effects, [
    { type: 'createToken', count: 1, token: TOKEN.CLUE }, { type: 'drawCards', count: 1 },
  ]);
  const birds = convert('birdsOfParadise').definition;
  assert.deepEqual([birds.keywords, birds.abilities], [['flying'], [{
    id: 'tapForAnyColor', text: '{T}: Add one mana of any color.', cost: { tap: true }, effect: { type: 'addMana', anyColor: 1 },
  }]]);
});

test('imported Birds of Paradise and Big Score work in a game', () => {
  const { cards } = importCards([FIXTURES.mountain, FIXTURES.birdsOfParadise, FIXTURES.bigScore]);
  const deck = [...Array(4).fill('mountain'), 'bigScore', 'birdsOfParadise', ...Array(34).fill('mountain')];
  const game = new Game({
    players: [{ id: 'p1' }, { id: 'p2' }], cards, shuffleLibraries: false, decks: { p1: deck, p2: deck }, emblems: { p1: [], p2: [] },
  });
  game.start();
  // Big Score costs four: play a Mountain on each of p1's first four turns.
  const p1 = () => game.getState().players[0];
  const pass = () => game.dispatch(passPriority(game.getState().priorityPlayerId));
  const toMain = (turn) => {
    while (game.getState().turn < turn || game.getState().phase !== PHASE.PRECOMBAT_MAIN || game.getState().priorityPlayerId === null) {
      const { pendingDecision, validActions } = game.getState();
      if (pendingDecision) game.dispatch(validActions.find((a) => a.type.startsWith('CONFIRM_')) ?? validActions.at(-1));
      else pass();
    }
  };
  for (const turn of [1, 3, 5, 7]) {
    toMain(turn);
    game.dispatch(playLand('p1', p1().hand.find((c) => c.cardId === 'mountain').id));
  }
  for (const land of game.getState().battlefield.filter((p) => p.cardId === 'mountain')) {
    assert.deepEqual(game.dispatch(activateAbility('p1', land.id, 'tapForR')), { ok: true });
  }
  const bigScore = p1().hand.find((c) => c.cardId === 'bigScore').id;
  const mountainInHand = (id) => p1().hand.find((c) => c.id === id).cardId === 'mountain';
  const action = game.getState().validActions.find((a) => a.cardId === bigScore && mountainInHand(a.costChoices.discard[0]));
  assert.deepEqual(game.dispatch(action), { ok: true });
  pass();
  pass();
  const treasures = game.getState().battlefield.filter((p) => p.name === 'Treasure');
  assert.equal(treasures.length, 2);
  // A Treasure's green mana casts Birds of Paradise, whose own ability offers every color.
  assert.deepEqual(game.dispatch(activateAbility('p1', treasures[0].id, 'treasureMana', undefined, undefined, 'G')), { ok: true });
  const birds = p1().hand.find((c) => c.cardId === 'birdsOfParadise').id;
  assert.deepEqual(game.dispatch(castSpell('p1', birds)), { ok: true });
  pass();
  pass();
  toMain(9);
  assert.deepEqual(
    game.getState().validActions.filter((a) => a.cardId === birds).map((a) => a.manaColor),
    ['W', 'U', 'B', 'R', 'G'],
  );
});

test('converts "enters" and "dies" triggered abilities', () => {
  const triggersOf = (key) => convert(key).definition.triggeredAbilities;
  // Older Oracle wording ("enters the battlefield") and newer ("this creature enters") both work.
  assert.deepEqual(triggersOf('elvishVisionary'), [{
    id: TRIGGER.ENTERS_BATTLEFIELD, text: 'When Elvish Visionary enters the battlefield, draw a card.',
    trigger: TRIGGER.ENTERS_BATTLEFIELD, effect: { type: 'drawCards', count: 1 },
  }]);
  const wall = convert('wallOfOmens').definition;
  assert.deepEqual([wall.keywords, wall.triggeredAbilities[0].effect], [['defender'], { type: 'drawCards', count: 1 }]);
  assert.deepEqual(triggersOf('flametongueKavu')[0], {
    id: TRIGGER.ENTERS_BATTLEFIELD, text: 'When Flametongue Kavu enters, it deals 4 damage to target creature.',
    trigger: TRIGGER.ENTERS_BATTLEFIELD, effect: { type: 'dealDamage', amount: 4 }, target: TARGET.CREATURE,
  });
  assert.deepEqual(triggersOf('doomedTraveler')[0], {
    id: TRIGGER.DIES, text: 'When Doomed Traveler dies, create a 1/1 white Spirit creature token with flying.',
    trigger: TRIGGER.DIES,
    effect: { type: 'createToken', count: 1, token: { colors: ['white'], subtypes: ['Spirit'], power: 1, toughness: 1, keywords: ['flying'] } },
  });
  assert.deepEqual(problems('bloodArtist'), [`Unsupported rules text: "${FIXTURES.bloodArtist.oracle_text}"`]);
});

test('an imported Flametongue Kavu has to target itself when it\'s the only creature', () => {
  const { cards } = importCards([FIXTURES.flametongueKavu, FIXTURES.mountain]);
  // Free to cast, so the test is about the trigger rather than the mana.
  cards.flametongueKavu = { ...cards.flametongueKavu, manaCost: {} };
  const deck = ['flametongueKavu', ...Array(39).fill('mountain')];
  const game = new Game({
    players: [{ id: 'p1' }, { id: 'p2' }], cards, shuffleLibraries: false, decks: { p1: deck, p2: deck }, emblems: { p1: [], p2: [] },
  });
  game.start();
  const pass = () => game.dispatch(passPriority(game.getState().priorityPlayerId));
  pass();
  pass();
  const kavu = game.getState().players[0].hand.find((c) => c.cardId === 'flametongueKavu').id;
  assert.deepEqual(game.dispatch(castSpell('p1', kavu)), { ok: true });
  pass();
  pass();
  assert.deepEqual(game.getState().stack[0].targets, [kavu]);
  pass();
  pass();
  assert.ok(game.getState().players[0].graveyard.some((c) => c.id === kavu));
});

test('converts removal for creatures in combat', () => {
  const { ok, definition } = convert('divineVerdict');
  assert.ok(ok);
  assert.equal(definition.target, 'attackingOrBlockingCreature');
  assert.deepEqual(definition.effects, [{ type: 'destroy' }]);
});

// The Pathfinder's Elves.
const definition = (key) => {
  const result = convert(key);
  assert.equal(result.ok, true, `${key}: ${result.problems?.join(' / ')}`);
  return result.definition;
};

test('converts flash, on creatures and Auras', () => {
  assert.deepEqual(definition('dawnsLightArcher').keywords, [KEYWORD.FLASH, KEYWORD.REACH]);
  const invocation = definition('feralInvocation');
  assert.deepEqual(invocation.keywords, [KEYWORD.FLASH]);
  assert.equal(invocation.enchant, TARGET.CREATURE);
});

test('converts triggers on other creatures entering, landfall, attacks, blocks, spells and Auras', () => {
  assert.deepEqual(definition('beastKinRanger').triggeredAbilities[0], {
    id: TRIGGER.CREATURE_ENTERS, trigger: TRIGGER.CREATURE_ENTERS, filter: { other: true },
    text: 'Whenever another creature you control enters, this creature gets +1/+0 until end of turn.',
    effect: { type: EFFECT.PUMP, power: 1, toughness: 0, affected: AFFECTED.SOURCE },
  });
  assert.deepEqual(definition('elvishVanguard').triggeredAbilities[0].filter, { other: true, controller: 'any', subtypes: ['Elf'] });
  assert.equal(definition('elfswornGiant').triggeredAbilities[0].trigger, TRIGGER.LAND_ENTERS);
  const brawler = definition('vinebredBrawler');
  assert.deepEqual(brawler.keywords, [KEYWORD.MUST_BE_BLOCKED]);
  assert.deepEqual(
    [brawler.triggeredAbilities[0].trigger, brawler.triggeredAbilities[0].target, brawler.triggeredAbilities[0].targetOther],
    [TRIGGER.ATTACKS, TARGET.ELF_YOU_CONTROL, true],
  );
  assert.deepEqual(definition('titaniasChosen').triggeredAbilities[0].filter, { controller: 'any', colors: ['G'] });
  assert.equal(definition('audacity').triggeredAbilities[0].trigger, TRIGGER.PUT_INTO_GRAVEYARD);
  assert.equal(definition('elderGargaroth').triggeredAbilities[0].trigger, TRIGGER.ATTACKS_OR_BLOCKS);
});

test('converts "you may" and "choose one —" triggers', () => {
  const sage = definition('reclamationSage').triggeredAbilities[0];
  assert.deepEqual([sage.optional, sage.target, sage.effect], [true, TARGET.ARTIFACT_OR_ENCHANTMENT, { type: EFFECT.DESTROY }]);
  const bard = definition('inspiringBard').triggeredAbilities[0];
  assert.deepEqual(bard.modes, [
    { text: 'Bardic Inspiration — Target creature gets +2/+2 until end of turn.', effects: [{ type: EFFECT.PUMP, power: 2, toughness: 2 }], target: TARGET.CREATURE },
    { text: 'Song of Rest — You gain 3 life.', effects: [{ type: EFFECT.GAIN_LIFE, amount: 3 }] },
  ]);
  assert.equal(definition('coliseumBehemoth').triggeredAbilities[0].modes[0].target, TARGET.ARTIFACT_OR_ENCHANTMENT);
  assert.equal(definition('elderGargaroth').triggeredAbilities[0].modes.length, 3);
});

test('converts graveyard targets, Elf targets and fights', () => {
  assert.deepEqual(definition('elvishRegrower').triggeredAbilities[0].target, TARGET.PERMANENT_CARD_IN_YOUR_GRAVEYARD);
  assert.equal(definition('safewrightCavalry').abilities[0].target, TARGET.ELF_YOU_CONTROL);
  const pounce = definition('pounce');
  assert.deepEqual([pounce.effects, pounce.targets], [[{ type: EFFECT.FIGHT }], [TARGET.CREATURE_YOU_CONTROL, TARGET.CREATURE_OPPONENT_CONTROLS]]);
});

test('converts "for each" and "where X is" amounts', () => {
  assert.deepEqual(definition('elvishArchdruid').abilities[0].effect, {
    type: EFFECT.ADD_MANA, mana: { G: 1 }, per: { of: 'creatures', subtypes: ['Elf'] },
  });
  assert.equal(definition('elvishArchdruid').abilities[0].id, 'ability1', 'not a plain tapForG');
  assert.deepEqual(definition('gaeasCradle').abilities[0].effect.per, { of: 'creatures' });
  assert.deepEqual(definition('priestOfTitania').abilities[0].effect.per, { of: 'creatures', controller: 'any', subtypes: ['Elf'] });
  assert.deepEqual(definition('timberwatchElf').abilities[0].effect, {
    type: EFFECT.PUMP, power: 1, toughness: 1, per: { of: 'creatures', controller: 'any', subtypes: ['Elf'] },
  });
  assert.deepEqual(definition('dwynen').triggeredAbilities[0].effect.per, { of: 'creatures', subtypes: ['Elf'], attacking: true });
  assert.deepEqual(definition('alphaStatus').staticAbilities[0].per, { of: 'creatures', controller: 'any', sharesTypeWith: true });
  assert.deepEqual(definition('ghalta').costReduction, { per: { of: 'power' } });
});

test('converts legendary cards, a legendary card\'s short name, and Elf lords', () => {
  const dwynen = definition('dwynen');
  assert.deepEqual(dwynen.supertypes, ['Legendary']);
  assert.equal(dwynen.triggeredAbilities[0].trigger, TRIGGER.ATTACKS);
  const lord = { affected: AFFECTED.EACH_CREATURE_YOU_CONTROL, power: 1, toughness: 1, other: true, subtypes: ['Elf'] };
  assert.deepEqual(definition('canopyTactician').staticAbilities, [lord]);
  assert.deepEqual(definition('elvishArchdruid').staticAbilities, [lord]);
  assert.equal(definition('canopyTactician').abilities[0].id, 'tapForGGG');
  assert.deepEqual(definition('gaeasCradle').supertypes, ['Legendary']);
});

test('converts lands that enter tapped, cycling and the counters of Oran-Rief', () => {
  const thicket = definition('tranquilThicket');
  assert.equal(thicket.entersTapped, true);
  assert.deepEqual(thicket.handAbilities, [{
    id: 'cycling', text: 'Cycling {G}', cost: { mana: { G: 1 }, discardSelf: true }, effect: { type: EFFECT.DRAW_CARDS, count: 1 },
  }]);
  assert.deepEqual(definition('oranRief').abilities[1].effect, {
    type: EFFECT.ADD_COUNTERS, counter: '+1/+1', count: 1, filter: { colors: ['G'], enteredThisTurn: true }, affected: AFFECTED.EACH_CREATURE,
  });
});

test('converts the new blocking restrictions and requirements', () => {
  assert.deepEqual(definition('treetopScout').keywords, [KEYWORD.BLOCKED_ONLY_BY_FLYERS]);
  assert.deepEqual(definition('steelLeafChampion').keywords, [KEYWORD.CANT_BE_BLOCKED_BY_POWER_2_OR_LESS]);
  assert.deepEqual(definition('safewrightCavalry').keywords, [KEYWORD.MAX_ONE_BLOCKER]);
  assert.deepEqual(definition('tauntingElf').keywords, [KEYWORD.LURE]);
});

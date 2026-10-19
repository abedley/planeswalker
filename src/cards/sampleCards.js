import {
  CARD_TYPE, SUBTYPE, KEYWORD, TARGET, AFFECTED, EFFECT, equipAbility,
} from './cards.js';

/**
 * Sample creatures with one keyword each, for trying out combat rules (e.g. in the
 * debugger). They aren't real cards. Each costs {G} so a single Forest casts one.
 */
const creature = (id, name, power, toughness, keywords) => Object.freeze({
  id, name, manaCost: { G: 1 }, types: [CARD_TYPE.CREATURE], power, toughness, keywords,
});

export const SAMPLE_CARDS = Object.freeze({
  hasteWolf: creature('hasteWolf', 'Haste Wolf', 2, 1, [KEYWORD.HASTE]),
  firstStrikeElk: creature('firstStrikeElk', 'First Strike Elk', 2, 2, [KEYWORD.FIRST_STRIKE]),
  doubleStrikeFencer: creature('doubleStrikeFencer', 'Double Strike Fencer', 1, 2, [KEYWORD.DOUBLE_STRIKE]),
  trampleRhino: creature('trampleRhino', 'Trample Rhino', 3, 3, [KEYWORD.TRAMPLE]),
  menaceLynx: creature('menaceLynx', 'Menace Lynx', 2, 1, [KEYWORD.MENACE]),
  deathtouchAsp: creature('deathtouchAsp', 'Deathtouch Asp', 1, 1, [KEYWORD.DEATHTOUCH]),
  flyingOwl: creature('flyingOwl', 'Flying Owl', 1, 1, [KEYWORD.FLYING]),
  reachSpider: creature('reachSpider', 'Reach Spider', 1, 3, [KEYWORD.REACH]),
  lifelinkBat: creature('lifelinkBat', 'Lifelink Bat', 1, 2, [KEYWORD.LIFELINK]),
  defenderWall: creature('defenderWall', 'Defender Wall', 0, 4, [KEYWORD.DEFENDER]),
  vigilanceBear: creature('vigilanceBear', 'Vigilance Bear', 2, 2, [KEYWORD.VIGILANCE]),
});

/** 40 cards: 18 Forests and two of each of the 11 sample creatures. */
export const SAMPLE_DECK = Object.freeze([
  ...Array(18).fill('forest'),
  ...Object.keys(SAMPLE_CARDS).flatMap((id) => [id, id]),
]);

/**
 * Sample artifacts, enchantments, Auras and Equipment. Like the creatures above,
 * they're made up for trying out the rules.
 */
export const SAMPLE_PERMANENTS = Object.freeze({
  sampleTalisman: {
    id: 'sampleTalisman', name: 'Sample Talisman', manaCost: { generic: 1 }, types: [CARD_TYPE.ARTIFACT],
    abilities: [{ id: 'tapForG', text: '{T}: Add {G}.', cost: { tap: true }, effect: { type: EFFECT.ADD_MANA, mana: { G: 1 } } }],
    text: '{T}: Add {G}.',
  },
  sampleGolem: {
    id: 'sampleGolem', name: 'Sample Golem', manaCost: { generic: 2 },
    types: [CARD_TYPE.ARTIFACT, CARD_TYPE.CREATURE], subtypes: ['Golem'], power: 2, toughness: 2,
  },
  sampleAltar: {
    id: 'sampleAltar', name: 'Sample Altar', manaCost: { G: 1 }, types: [CARD_TYPE.ENCHANTMENT],
    abilities: [{ id: 'gainLife', text: '{2}: You gain 1 life.', cost: { mana: { generic: 2 } }, effect: { type: EFFECT.GAIN_LIFE, amount: 1 } }],
    text: '{2}: You gain 1 life.',
  },
  sampleMight: {
    id: 'sampleMight', name: 'Sample Might', manaCost: { G: 1 },
    types: [CARD_TYPE.ENCHANTMENT], subtypes: [SUBTYPE.AURA], enchant: TARGET.CREATURE,
    staticAbilities: [{ affected: AFFECTED.ATTACHED_PERMANENT, power: 2, toughness: 2, keywords: [KEYWORD.TRAMPLE] }],
    text: 'Enchant creature\nEnchanted creature gets +2/+2 and has trample.',
  },
  sampleWings: {
    id: 'sampleWings', name: 'Sample Wings', manaCost: { G: 1 },
    types: [CARD_TYPE.ENCHANTMENT], subtypes: [SUBTYPE.AURA], enchant: TARGET.CREATURE,
    staticAbilities: [{ affected: AFFECTED.ATTACHED_PERMANENT, toughness: 1, keywords: [KEYWORD.FLYING] }],
    text: 'Enchant creature\nEnchanted creature gets +0/+1 and has flying.',
  },
  sampleBlade: {
    id: 'sampleBlade', name: 'Sample Blade', manaCost: { generic: 1 },
    types: [CARD_TYPE.ARTIFACT], subtypes: [SUBTYPE.EQUIPMENT],
    staticAbilities: [{ affected: AFFECTED.ATTACHED_PERMANENT, power: 2, keywords: [KEYWORD.FIRST_STRIKE] }],
    abilities: [equipAbility({ generic: 1 })],
    text: 'Equipped creature gets +2/+0 and has first strike.\nEquip {1}',
  },
  sampleMail: {
    id: 'sampleMail', name: 'Sample Mail', manaCost: { generic: 2 },
    types: [CARD_TYPE.ARTIFACT], subtypes: [SUBTYPE.EQUIPMENT],
    staticAbilities: [{ affected: AFFECTED.ATTACHED_PERMANENT, toughness: 2, keywords: [KEYWORD.VIGILANCE] }],
    abilities: [equipAbility({ generic: 2 })],
    text: 'Equipped creature gets +0/+2 and has vigilance.\nEquip {2}',
  },
});

/** 40 cards: 17 Forests, 9 Llanowar Elves and two of each sample permanent. */
export const SAMPLE_PERMANENTS_DECK = Object.freeze([
  ...Array(17).fill('forest'),
  ...Array(9).fill('llanowarElves'),
  ...Object.keys(SAMPLE_PERMANENTS).flatMap((id) => [id, id]),
]);

/** Sample instants and sorceries, also made up. */
export const SAMPLE_SPELLS = Object.freeze({
  sampleShock: {
    id: 'sampleShock', name: 'Sample Shock', manaCost: { G: 1 }, types: [CARD_TYPE.INSTANT],
    target: TARGET.ANY, effects: [{ type: EFFECT.DEAL_DAMAGE, amount: 2 }],
    text: 'Sample Shock deals 2 damage to any target.',
  },
  sampleGrowth: {
    id: 'sampleGrowth', name: 'Sample Growth', manaCost: { G: 1 }, types: [CARD_TYPE.INSTANT],
    target: TARGET.CREATURE, effects: [{ type: EFFECT.PUMP, power: 3, toughness: 3 }],
    text: 'Target creature gets +3/+3 until end of turn.',
  },
  sampleRemedy: {
    id: 'sampleRemedy', name: 'Sample Remedy', manaCost: { G: 1 }, types: [CARD_TYPE.INSTANT],
    effects: [{ type: EFFECT.GAIN_LIFE, amount: 3 }],
    text: 'You gain 3 life.',
  },
  sampleDoom: {
    id: 'sampleDoom', name: 'Sample Doom', manaCost: { generic: 1, G: 1 }, types: [CARD_TYPE.SORCERY],
    target: TARGET.CREATURE, effects: [{ type: EFFECT.DESTROY }],
    text: 'Destroy target creature.',
  },
  sampleInsight: {
    id: 'sampleInsight', name: 'Sample Insight', manaCost: { generic: 1, G: 1 }, types: [CARD_TYPE.SORCERY],
    effects: [{ type: EFFECT.DRAW_CARDS, count: 2 }],
    text: 'Draw two cards.',
  },
});

/** 40 cards: 17 Forests, 13 Llanowar Elves and two of each sample spell. */
export const SAMPLE_SPELLS_DECK = Object.freeze([
  ...Array(17).fill('forest'),
  ...Array(13).fill('llanowarElves'),
  ...Object.keys(SAMPLE_SPELLS).flatMap((id) => [id, id]),
]);

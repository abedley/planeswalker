// Hand-written card objects in the shape Scryfall's API returns
// (https://scryfall.com/docs/api/cards), trimmed to the fields the importer reads.
// They mirror real cards but were not downloaded; they exist so the converter can
// be tested without network access.
const card = (fields) => ({
  object: 'card', layout: 'normal', keywords: [], oracle_text: '', id: `fixture-${fields.name}`,
  scryfall_uri: `https://scryfall.com/search?q=${encodeURIComponent(fields.name)}`, ...fields,
});

export const FIXTURES = {
  llanowarElves: card({
    name: 'Llanowar Elves', mana_cost: '{G}', type_line: 'Creature — Elf Druid',
    oracle_text: '{T}: Add {G}.', power: '1', toughness: '1',
  }),
  forest: card({ name: 'Forest', mana_cost: '', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)' }),
  wastes: card({ name: 'Wastes', mana_cost: '', type_line: 'Basic Land', oracle_text: '({T}: Add {C}.)' }),
  grizzlyBears: card({ name: 'Grizzly Bears', mana_cost: '{1}{G}', type_line: 'Creature — Bear', power: '2', toughness: '2' }),
  giantSpider: card({
    name: 'Giant Spider', mana_cost: '{3}{G}', type_line: 'Creature — Spider',
    oracle_text: 'Reach', keywords: ['Reach'], power: '2', toughness: '4',
  }),
  serraAngel: card({
    name: 'Serra Angel', mana_cost: '{3}{W}{W}', type_line: 'Creature — Angel',
    oracle_text: 'Flying, vigilance', keywords: ['Flying', 'Vigilance'], power: '4', toughness: '4',
  }),
  vampireNighthawk: card({
    name: 'Vampire Nighthawk', mana_cost: '{1}{B}{B}', type_line: 'Creature — Vampire Shaman',
    oracle_text: 'Flying, deathtouch, lifelink', keywords: ['Flying', 'Deathtouch', 'Lifelink'], power: '2', toughness: '3',
  }),
  boggartBrute: card({
    name: 'Boggart Brute', mana_cost: '{2}{R}', type_line: 'Creature — Goblin Warrior',
    oracle_text: 'Menace (This creature can\'t be blocked except by two or more creatures.)',
    keywords: ['Menace'], power: '3', toughness: '2',
  }),
  birdsOfParadise: card({
    name: 'Birds of Paradise', mana_cost: '{G}', type_line: 'Creature — Bird',
    oracle_text: 'Flying\n{T}: Add one mana of any color.', keywords: ['Flying'], power: '0', toughness: '1',
  }),
  lightningBolt: card({
    name: 'Lightning Bolt', mana_cost: '{R}', type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  }),
  thalia: card({
    name: 'Thalia, Guardian of Thraben', mana_cost: '{1}{W}', type_line: 'Legendary Creature — Human Soldier',
    oracle_text: 'First strike\nNoncreature spells cost {1} more to cast.', keywords: ['First strike'],
    power: '2', toughness: '1',
  }),
  delverOfSecrets: card({
    name: 'Delver of Secrets // Insectile Aberration', layout: 'transform', type_line: 'Creature — Human Wizard // Creature — Human Insect',
    card_faces: [{ name: 'Delver of Secrets' }, { name: 'Insectile Aberration' }],
  }),
  tarmogoyf: card({
    name: 'Tarmogoyf', mana_cost: '{1}{G}', type_line: 'Creature — Lhurgoyf',
    oracle_text: 'Tarmogoyf\'s power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.',
    power: '*', toughness: '1+*',
  }),
  gladecoverScout: card({
    name: 'Gladecover Scout', mana_cost: '{G}', type_line: 'Creature — Elf Scout',
    oracle_text: 'Hexproof (This creature can\'t be the target of spells or abilities your opponents control.)',
    keywords: ['Hexproof'], power: '1', toughness: '1',
  }),
  kitchenFinks: card({
    name: 'Kitchen Finks', mana_cost: '{1}{G/W}{G/W}', type_line: 'Creature — Ouphe',
    oracle_text: 'When Kitchen Finks enters, you gain 2 life.\nPersist (When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield under its owner\'s control with a -1/-1 counter on it.)',
    keywords: ['Persist'], power: '3', toughness: '2',
  }),
};

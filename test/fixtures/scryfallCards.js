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
  // With the presentation fields Scryfall returns for every card.
  runeclawBear: card({
    name: 'Runeclaw Bear', mana_cost: '{1}{G}', type_line: 'Creature — Bear', power: '2', toughness: '2',
    image_uris: {
      small: 'https://cards.scryfall.io/small/front/r/b/runeclaw.jpg',
      normal: 'https://cards.scryfall.io/normal/front/r/b/runeclaw.jpg',
      art_crop: 'https://cards.scryfall.io/art_crop/front/r/b/runeclaw.jpg',
    },
    artist: 'Jesper Ejsing', colors: ['G'], rarity: 'common', set: 'm12', collector_number: '197',
  }),
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
  solRing: card({ name: 'Sol Ring', mana_cost: '{1}', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' }),
  holyStrength: card({
    name: 'Holy Strength', mana_cost: '{W}', type_line: 'Enchantment — Aura',
    oracle_text: 'Enchant creature\nEnchanted creature gets +1/+2.', keywords: ['Enchant'],
  }),
  arcaneFlight: card({
    name: 'Arcane Flight', mana_cost: '{U}', type_line: 'Enchantment — Aura',
    oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1 and has flying.', keywords: ['Enchant'],
  }),
  rancor: card({
    name: 'Rancor', mana_cost: '{G}', type_line: 'Enchantment — Aura',
    oracle_text: 'Enchant creature\nEnchanted creature gets +2/+0 and has trample.\nWhen Rancor is put into a graveyard from the battlefield, return Rancor to its owner\'s hand.',
    keywords: ['Enchant'],
  }),
  pacifism: card({
    name: 'Pacifism', mana_cost: '{1}{W}', type_line: 'Enchantment — Aura',
    oracle_text: 'Enchant creature\nEnchanted creature can\'t attack or block.', keywords: ['Enchant'],
  }),
  maniacalRage: card({
    name: 'Maniacal Rage', mana_cost: '{1}{R}', type_line: 'Enchantment — Aura',
    oracle_text: 'Enchant creature\nEnchanted creature gets +2/+2 and can\'t block.', keywords: ['Enchant'],
  }),
  aetherTunnel: card({
    name: 'Aether Tunnel', mana_cost: '{1}{U}', type_line: 'Enchantment — Aura',
    oracle_text: 'Enchant creature\nEnchanted creature gets +1/+0 and can\'t be blocked.', keywords: ['Enchant'],
  }),
  divineFavor: card({
    name: 'Divine Favor', mana_cost: '{1}{W}', type_line: 'Enchantment — Aura',
    oracle_text: 'Enchant creature\nWhen this Aura enters, you gain 3 life.\nEnchanted creature gets +1/+3.', keywords: ['Enchant'],
  }),
  claustrophobia: card({
    name: 'Claustrophobia', mana_cost: '{1}{U}{U}', type_line: 'Enchantment — Aura',
    oracle_text: 'Enchant creature\nWhen this Aura enters, tap enchanted creature.\nEnchanted creature doesn\'t untap during its controller\'s untap step.',
    keywords: ['Enchant'],
  }),
  bonesplitter: card({
    name: 'Bonesplitter', mana_cost: '{1}', type_line: 'Artifact — Equipment',
    oracle_text: 'Equipped creature gets +2/+0.\nEquip {1}', keywords: ['Equip'],
  }),
  lightningGreaves: card({
    name: 'Lightning Greaves', mana_cost: '{2}', type_line: 'Artifact — Equipment',
    oracle_text: 'Equipped creature has haste and shroud. (It can\'t be the target of spells or abilities.)\nEquip {0}',
    keywords: ['Equip'],
  }),
  gloriousAnthem: card({
    name: 'Glorious Anthem', mana_cost: '{1}{W}{W}', type_line: 'Enchantment', oracle_text: 'Creatures you control get +1/+1.',
  }),
  honorOfThePure: card({
    name: 'Honor of the Pure', mana_cost: '{1}{W}', type_line: 'Enchantment', oracle_text: 'White creatures you control get +1/+1.',
  }),
  captainOfTheWatch: card({
    name: 'Captain of the Watch', mana_cost: '{4}{W}{W}', type_line: 'Creature — Human Soldier', power: '3', toughness: '3',
    oracle_text: 'Vigilance (Attacking doesn\'t cause this creature to tap.)\nOther Soldier creatures you control get +1/+1 and have vigilance.\nWhen this creature enters, create three 1/1 white Soldier creature tokens.',
    keywords: ['Vigilance'],
  }),
  crusade: card({
    name: 'Crusade', mana_cost: '{W}{W}', type_line: 'Enchantment', oracle_text: 'White creatures get +1/+1.',
  }),
  giantGrowth: card({
    name: 'Giant Growth', mana_cost: '{G}', type_line: 'Instant', oracle_text: 'Target creature gets +3/+3 until end of turn.',
  }),
  murder: card({ name: 'Murder', mana_cost: '{1}{B}{B}', type_line: 'Instant', oracle_text: 'Destroy target creature.' }),
  divination: card({ name: 'Divination', mana_cost: '{2}{U}', type_line: 'Sorcery', oracle_text: 'Draw two cards.' }),
  counterspell: card({ name: 'Counterspell', mana_cost: '{U}{U}', type_line: 'Instant', oracle_text: 'Counter target spell.' }),
  mountain: card({ name: 'Mountain', mana_cost: '', type_line: 'Basic Land — Mountain', oracle_text: '({T}: Add {R}.)' }),
  // Activated abilities
  prodigalSorcerer: card({
    name: 'Prodigal Sorcerer', mana_cost: '{2}{U}', type_line: 'Creature — Human Wizard',
    oracle_text: '{T}: Prodigal Sorcerer deals 1 damage to any target.', power: '1', toughness: '1',
  }),
  moggFanatic: card({
    name: 'Mogg Fanatic', mana_cost: '{R}', type_line: 'Creature — Goblin',
    oracle_text: 'Sacrifice Mogg Fanatic: It deals 1 damage to any target.', power: '1', toughness: '1',
  }),
  mindStone: card({
    name: 'Mind Stone', mana_cost: '{2}', type_line: 'Artifact',
    oracle_text: '{T}: Add {C}.\n{1}, {T}, Sacrifice Mind Stone: Draw a card.',
  }),
  shivanDragon: card({
    name: 'Shivan Dragon', mana_cost: '{4}{R}{R}', type_line: 'Creature — Dragon',
    oracle_text: 'Flying\n{R}: Shivan Dragon gets +1/+0 until end of turn.', keywords: ['Flying'], power: '5', toughness: '5',
  }),
  greed: card({ name: 'Greed', mana_cost: '{3}{B}', type_line: 'Enchantment', oracle_text: '{B}, Pay 2 life: Draw a card.' }),
  dragonRoost: card({
    name: 'Dragon Roost', mana_cost: '{4}{R}{R}', type_line: 'Enchantment',
    oracle_text: '{5}{R}{R}: Create a 5/5 red Dragon creature token with flying. (It can\'t be blocked except by creatures with flying or reach.)',
  }),
  royalAssassin: card({
    name: 'Royal Assassin', mana_cost: '{1}{B}{B}', type_line: 'Creature — Human Assassin',
    oracle_text: '{T}: Destroy target tapped creature.', power: '1', toughness: '1',
  }),
  // Instants and sorceries
  divineVerdict: card({ name: 'Divine Verdict', mana_cost: '{3}{W}', type_line: 'Instant', oracle_text: 'Destroy target attacking or blocking creature.' }),
  unsummon: card({ name: 'Unsummon', mana_cost: '{U}', type_line: 'Instant', oracle_text: 'Return target creature to its owner\'s hand.' }),
  naturalize: card({ name: 'Naturalize', mana_cost: '{1}{G}', type_line: 'Instant', oracle_text: 'Destroy target artifact or enchantment.' }),
  essenceScatter: card({ name: 'Essence Scatter', mana_cost: '{1}{U}', type_line: 'Instant', oracle_text: 'Counter target creature spell.' }),
  negate: card({ name: 'Negate', mana_cost: '{1}{U}', type_line: 'Instant', oracle_text: 'Counter target noncreature spell.' }),
  darkRitual: card({ name: 'Dark Ritual', mana_cost: '{B}', type_line: 'Instant', oracle_text: 'Add {B}{B}{B}.' }),
  raiseTheAlarm: card({
    name: 'Raise the Alarm', mana_cost: '{1}{W}', type_line: 'Instant', oracle_text: 'Create two 1/1 white Soldier creature tokens.',
  }),
  pyroclasm: card({ name: 'Pyroclasm', mana_cost: '{1}{R}', type_line: 'Sorcery', oracle_text: 'Pyroclasm deals 2 damage to each creature.' }),
  wrathOfGod: card({
    name: 'Wrath of God', mana_cost: '{2}{W}{W}', type_line: 'Sorcery', oracle_text: 'Destroy all creatures. They can\'t be regenerated.',
  }),
  overrun: card({
    name: 'Overrun', mana_cost: '{2}{G}{G}{G}', type_line: 'Sorcery',
    oracle_text: 'Creatures you control get +3/+3 and gain trample until end of turn.',
  }),
  lavaSpike: card({
    name: 'Lava Spike', mana_cost: '{R}', type_line: 'Sorcery — Arcane',
    oracle_text: 'Lava Spike deals 3 damage to target player or planeswalker.',
  }),
  thoughtScour: card({
    name: 'Thought Scour', mana_cost: '{U}', type_line: 'Instant', oracle_text: 'Target player mills two cards.\nDraw a card.', keywords: ['Mill'],
  }),
  battlegrowth: card({ name: 'Battlegrowth', mana_cost: '{G}', type_line: 'Instant', oracle_text: 'Put a +1/+1 counter on target creature.' }),
  villageRites: card({
    name: 'Village Rites', mana_cost: '{B}', type_line: 'Instant',
    oracle_text: 'As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards.',
  }),
  tormentingVoice: card({
    name: 'Tormenting Voice', mana_cost: '{1}{R}', type_line: 'Sorcery',
    oracle_text: 'As an additional cost to cast this spell, discard a card.\nDraw two cards.',
  }),
  boneSplinters: card({
    name: 'Bone Splinters', mana_cost: '{B}', type_line: 'Sorcery',
    oracle_text: 'As an additional cost to cast this spell, sacrifice a creature.\nDestroy target creature.',
  }),
  signInBlood: card({
    name: 'Sign in Blood', mana_cost: '{B}{B}', type_line: 'Sorcery', oracle_text: 'Target player draws two cards and loses 2 life.',
  }),
  fling: card({
    name: 'Fling', mana_cost: '{1}{R}', type_line: 'Instant',
    oracle_text: 'As an additional cost to cast this spell, sacrifice a creature.\nFling deals damage equal to the sacrificed creature\'s power to any target.',
  }),
  // Treasure, Food and Clue tokens
  bakeIntoAPie: card({
    name: 'Bake into a Pie', mana_cost: '{2}{B}{B}', type_line: 'Instant', keywords: ['Food'],
    oracle_text: 'Destroy target creature. Create a Food token. (It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")',
  }),
  bigScore: card({
    name: 'Big Score', mana_cost: '{3}{R}', type_line: 'Instant', keywords: ['Treasure'],
    oracle_text: 'As an additional cost to cast this spell, discard a card.\nDraw two cards and create two Treasure tokens. (They\'re artifacts with "{T}, Sacrifice this token: Add one mana of any color.")',
  }),
  // Made up: an instant that investigates.
  sampleInquiry: card({
    name: 'Sample Inquiry', mana_cost: '{U}', type_line: 'Instant', keywords: ['Investigate'],
    oracle_text: 'Investigate. (Create a Clue token. It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")\nDraw a card.',
  }),
  gildedLotus: card({
    name: 'Gilded Lotus', mana_cost: '{5}', type_line: 'Artifact', oracle_text: '{T}: Add three mana of any one color.',
  }),
  // Triggered abilities
  elvishVisionary: card({
    name: 'Elvish Visionary', mana_cost: '{1}{G}', type_line: 'Creature — Elf Shaman',
    oracle_text: 'When Elvish Visionary enters the battlefield, draw a card.', power: '1', toughness: '1',
  }),
  wallOfOmens: card({
    name: 'Wall of Omens', mana_cost: '{1}{W}', type_line: 'Creature — Wall', keywords: ['Defender'],
    oracle_text: 'Defender\nWhen this creature enters, draw a card.', power: '0', toughness: '4',
  }),
  flametongueKavu: card({
    name: 'Flametongue Kavu', mana_cost: '{3}{R}', type_line: 'Creature — Kavu',
    oracle_text: 'When Flametongue Kavu enters, it deals 4 damage to target creature.', power: '4', toughness: '2',
  }),
  doomedTraveler: card({
    name: 'Doomed Traveler', mana_cost: '{W}', type_line: 'Creature — Human Soldier',
    oracle_text: 'When Doomed Traveler dies, create a 1/1 white Spirit creature token with flying.', power: '1', toughness: '1',
  }),
  bloodArtist: card({
    name: 'Blood Artist', mana_cost: '{1}{B}', type_line: 'Creature — Vampire',
    oracle_text: 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.',
    power: '0', toughness: '1',
  }),
  jaceBeleren: card({
    name: 'Jace Beleren', mana_cost: '{1}{U}{U}', type_line: 'Legendary Planeswalker — Jace',
    oracle_text: '+2: Each player draws a card.\n−1: Target player draws a card.\n−10: Target player mills twenty cards.',
    keywords: ['Mill'], loyalty: '3',
  }),
  // The Pathfinder's Elves: the mechanics they brought.
  beastKinRanger: card({
    name: 'Beast-Kin Ranger', mana_cost: '{2}{G}', type_line: 'Creature — Elf Ranger', power: '3', toughness: '3', keywords: ['Trample'],
    oracle_text: "Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)\nWhenever another creature you control enters, this creature gets +1/+0 until end of turn.",
  }),
  dawnsLightArcher: card({
    name: "Dawn's Light Archer", mana_cost: '{2}{G}', type_line: 'Creature — Elf Archer', power: '4', toughness: '2', keywords: ['Flash', 'Reach'],
    oracle_text: 'Flash\nReach',
  }),
  feralInvocation: card({
    name: 'Feral Invocation', mana_cost: '{2}{G}', type_line: 'Enchantment — Aura', keywords: ['Flash', 'Enchant'],
    oracle_text: 'Flash (You may cast this spell any time you could cast an instant.)\nEnchant creature\nEnchanted creature gets +2/+2.',
  }),
  elfswornGiant: card({
    name: 'Elfsworn Giant', mana_cost: '{3}{G}{G}', type_line: 'Creature — Giant', power: '5', toughness: '3', keywords: ['Landfall', 'Reach'],
    oracle_text: 'Reach (This creature can block creatures with flying.)\nLandfall — Whenever a land you control enters, create a 1/1 green Elf Warrior creature token.',
  }),
  elvishRegrower: card({
    name: 'Elvish Regrower', mana_cost: '{2}{G}{G}', type_line: 'Creature — Elf Druid', power: '4', toughness: '3',
    oracle_text: 'When this creature enters, return target permanent card from your graveyard to your hand.',
  }),
  elvishVanguard: card({
    name: 'Elvish Vanguard', mana_cost: '{1}{G}', type_line: 'Creature — Elf Warrior', power: '1', toughness: '1',
    oracle_text: 'Whenever another Elf enters, put a +1/+1 counter on this creature.',
  }),
  inspiringBard: card({
    name: 'Inspiring Bard', mana_cost: '{3}{G}', type_line: 'Creature — Elf Bard', power: '3', toughness: '3',
    oracle_text: 'When this creature enters, choose one —\n• Bardic Inspiration — Target creature gets +2/+2 until end of turn.\n• Song of Rest — You gain 3 life.',
  }),
  reclamationSage: card({
    name: 'Reclamation Sage', mana_cost: '{2}{G}', type_line: 'Creature — Elf Shaman', power: '2', toughness: '1',
    oracle_text: 'When this creature enters, you may destroy target artifact or enchantment.',
  }),
  safewrightCavalry: card({
    name: 'Safewright Cavalry', mana_cost: '{3}{G}', type_line: 'Creature — Elf Warrior', power: '4', toughness: '4',
    oracle_text: "This creature can't be blocked by more than one creature.\n{5}: Target Elf you control gets +2/+2 until end of turn.",
  }),
  titaniasChosen: card({
    name: "Titania's Chosen", mana_cost: '{2}{G}', type_line: 'Creature — Elf Archer', power: '1', toughness: '1',
    oracle_text: 'Whenever a player casts a green spell, put a +1/+1 counter on this creature.',
  }),
  tranquilThicket: card({
    name: 'Tranquil Thicket', mana_cost: '', type_line: 'Land', keywords: ['Cycling'],
    oracle_text: 'This land enters tapped.\n{T}: Add {G}.\nCycling {G} ({G}, Discard this card: Draw a card.)',
  }),
  treetopScout: card({
    name: 'Treetop Scout', mana_cost: '{G}', type_line: 'Creature — Elf Scout', power: '1', toughness: '1',
    oracle_text: "This creature can't be blocked except by creatures with flying.",
  }),
  vinebredBrawler: card({
    name: 'Vinebred Brawler', mana_cost: '{2}{G}', type_line: 'Creature — Elf Berserker', power: '4', toughness: '2',
    oracle_text: 'This creature must be blocked if able.\nWhenever this creature attacks, another target Elf you control gets +2/+1 until end of turn.',
  }),
  alphaStatus: card({
    name: 'Alpha Status', mana_cost: '{2}{G}', type_line: 'Enchantment — Aura', keywords: ['Enchant'],
    oracle_text: 'Enchant creature\nEnchanted creature gets +2/+2 for each other creature on the battlefield that shares a creature type with it.',
  }),
  audacity: card({
    name: 'Audacity', mana_cost: '{G}', type_line: 'Enchantment — Aura', keywords: ['Enchant'],
    oracle_text: "Enchant creature\nEnchanted creature gets +2/+0 and has trample. (It can deal excess combat damage to the player or planeswalker it's attacking.)\nWhen this Aura is put into a graveyard from the battlefield, draw a card.",
  }),
  canopyTactician: card({
    name: 'Canopy Tactician', mana_cost: '{3}{G}', type_line: 'Creature — Elf Warrior', power: '3', toughness: '3',
    oracle_text: 'Other Elves you control get +1/+1.\n{T}: Add {G}{G}{G}.',
  }),
  coliseumBehemoth: card({
    name: 'Coliseum Behemoth', mana_cost: '{5}{G}{G}', type_line: 'Creature — Beast', power: '7', toughness: '7', keywords: ['Trample'],
    oracle_text: 'Trample\nWhen this creature enters, choose one —\n• Destroy target artifact or enchantment.\n• Draw a card.',
  }),
  dwynen: card({
    name: 'Dwynen, Gilt-Leaf Daen', mana_cost: '{2}{G}{G}', type_line: 'Legendary Creature — Elf Warrior', power: '3', toughness: '4', keywords: ['Reach'],
    oracle_text: 'Reach (This creature can block creatures with flying.)\nOther Elf creatures you control get +1/+1.\nWhenever Dwynen attacks, you gain 1 life for each attacking Elf you control.',
  }),
  elderGargaroth: card({
    name: 'Elder Gargaroth', mana_cost: '{3}{G}{G}', type_line: 'Creature — Beast', power: '6', toughness: '6', keywords: ['Reach', 'Vigilance', 'Trample'],
    oracle_text: 'Reach, vigilance, trample\nWhenever this creature attacks or blocks, choose one —\n• Create a 3/3 green Beast creature token.\n• You gain 3 life.\n• Draw a card.',
  }),
  elvishArchdruid: card({
    name: 'Elvish Archdruid', mana_cost: '{1}{G}{G}', type_line: 'Creature — Elf Druid', power: '2', toughness: '2',
    oracle_text: 'Other Elf creatures you control get +1/+1.\n{T}: Add {G} for each Elf you control.',
  }),
  gaeasCradle: card({
    name: "Gaea's Cradle", mana_cost: '', type_line: 'Legendary Land', oracle_text: '{T}: Add {G} for each creature you control.',
  }),
  ghalta: card({
    name: 'Ghalta, Primal Hunger', mana_cost: '{10}{G}{G}', type_line: 'Legendary Creature — Elder Dinosaur', power: '12', toughness: '12', keywords: ['Trample'],
    oracle_text: "This spell costs {X} less to cast, where X is the total power of creatures you control.\nTrample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)",
  }),
  oranRief: card({
    name: 'Oran-Rief, the Vastwood', mana_cost: '', type_line: 'Land',
    oracle_text: 'This land enters tapped.\n{T}: Add {G}.\n{T}: Put a +1/+1 counter on each green creature that entered this turn.',
  }),
  pounce: card({
    name: 'Pounce', mana_cost: '{1}{G}', type_line: 'Instant', keywords: ['Fight'],
    oracle_text: "Target creature you control fights target creature you don't control. (Each deals damage equal to its power to the other.)",
  }),
  priestOfTitania: card({
    name: 'Priest of Titania', mana_cost: '{1}{G}', type_line: 'Creature — Elf Druid', power: '1', toughness: '1',
    oracle_text: '{T}: Add {G} for each Elf on the battlefield.',
  }),
  steelLeafChampion: card({
    name: 'Steel Leaf Champion', mana_cost: '{G}{G}{G}', type_line: 'Creature — Elf Knight', power: '5', toughness: '4',
    oracle_text: "This creature can't be blocked by creatures with power 2 or less.",
  }),
  tauntingElf: card({
    name: 'Taunting Elf', mana_cost: '{G}', type_line: 'Creature — Elf', power: '0', toughness: '1',
    oracle_text: 'All creatures able to block this creature do so.',
  }),
  timberwatchElf: card({
    name: 'Timberwatch Elf', mana_cost: '{2}{G}', type_line: 'Creature — Elf', power: '1', toughness: '2',
    oracle_text: '{T}: Target creature gets +X/+X until end of turn, where X is the number of Elves on the battlefield.',
  }),
};

/**
 * Decks of real cards (imported from Scryfall, see cards/real-cards.txt), one per
 * color, at two strengths: a lighter build for the early opponents and a full one.
 * Every deck is 40 cards: 17 basic lands and 23 spells.
 */

/** A deck from `{ cardId: count }`. */
const deck = (counts) => Object.freeze(Object.entries(counts).flatMap(([id, n]) => Array(n).fill(id)));

export const REAL_DECKS = Object.freeze({
  /** Green Stompy: big creatures, pump spells and Auras, Overrun and Overcome. */
  greenStompy: deck({
    forest: 17,
    llanowarElves: 3, greenwoodSentinel: 2, druidOfTheCowl: 1, centaurCourser: 3,
    thornhideWolves: 1, vigilantBaloth: 2, thrashingBrontodon: 1, colossalDreadmaw: 2,
    titanicGrowth: 2, overrun: 2, overcome: 1,
    oakenform: 1, mantleOfWebs: 1, brawlersPlate: 1,
  }),
  /** Blue Skies: walls hold the ground while flyers (and unblockable creatures) attack; counters and card draw. */
  blueSkies: deck({
    island: 17,
    aegisTurtle: 1, wallOfMist: 1, phantomWarrior: 2, cloudkinSeer: 3, skyscanner: 2, snappingDrake: 3,
    bigfinBouncer: 1, airElemental: 2, essenceScatter: 2, unsummon: 1, divination: 1,
    aetherTunnel: 1, sensoryDeprivation: 1, kitesail: 1, arcaneEncyclopedia: 1,
  }),
  /** White Weenie: cheap creatures and tokens, team pumps and anthems, Pacifism and removal for creatures in combat. */
  whiteWeenie: deck({
    plains: 17,
    savannahLions: 3, dawnwingMarshal: 2, griffinSentinel: 2, inspiringCaptain: 2, benalishMarshal: 1,
    gallantCavalry: 2, serraAngel: 2, angelOfTheDawn: 1, concordiaPegasus: 1,
    raiseTheAlarm: 1, momentOfHeroism: 1, gideonsReproach: 1, gloriousAnthem: 1,
    pacifism: 1, divineFavor: 1, veteransSidearm: 1,
  }),
  /** White Recruits: the lighter white build. */
  whiteRecruits: deck({
    plains: 17,
    savannahLions: 3, healersHawk: 2, daybreakChaplain: 2, griffinSentinel: 3, gallantCavalry: 2,
    concordiaPegasus: 2, raiseTheAlarm: 2, momentOfHeroism: 2, gideonsReproach: 2,
    luminousBonds: 1, holyStrength: 1, shortSword: 1,
  }),
  /** Black Removal: deathtouch, lifelink, kill spells and curses, and draining the opponent. */
  blackRemoval: deck({
    swamp: 17,
    childOfNight: 3, vampireInterloper: 2, walkingCorpse: 1, tatteredMummy: 1, vampireNighthawk: 2,
    skeletonArcher: 2, twoHeadedZombie: 1, vampireSpawn: 2, vampireSovereign: 1,
    boneSplinters: 1, murder: 2, herosDownfall: 1, sovereignsBite: 1,
    weightOfTheUnderworld: 1, basiliskCollar: 1, rodOfRuin: 1,
  }),
  /** Black Rabble: the lighter black build. */
  blackRabble: deck({
    swamp: 17,
    childOfNight: 3, walkingCorpse: 2, doomedDissenter: 3, vampireOfTheDireMoon: 2, fetidImp: 2,
    skeletonArcher: 2, twoHeadedZombie: 2, stab: 1, villageRites: 1, boneSplinters: 1,
    cripplingBlight: 1, weakness: 1, unholyStrength: 1, gorgonFlail: 1,
  }),
  /** Red Burn: hasty creatures, pingers and burn to the face. */
  redBurn: deck({
    mountain: 17,
    fanaticalFirebrand: 3, prodigalPyromancer: 2, viashinoPyromancer: 2, boggartBrute: 2, emberHauler: 2, hostileMinotaur: 1,
    siegebreakerGiant: 1, shivanDragon: 1,
    shock: 3, lightningStrike: 2, burnBright: 1,
    goblinWarPaint: 1, swordOfVengeance: 1, explosiveApparatus: 1,
  }),
  /** Red Raiders: the lighter red build. */
  redRaiders: deck({
    mountain: 17,
    fanaticalFirebrand: 3, hostileMinotaur: 2, boggartBrute: 3, emberHauler: 2, pitchburnDevils: 2,
    havocDevils: 2, fireElemental: 1, prodigalPyromancer: 1, shock: 3, lavaAxe: 1,
    maniacalRage: 1, maraudersAxe: 1, vialOfDragonfire: 1,
  }),
  /** The boss's dragons: burn to hold the ground, then dragons (with double strike, from Fireshrieker). */
  dragonlord: deck({
    mountain: 17,
    fanaticalFirebrand: 2, viashinoPyromancer: 2, hostileMinotaur: 1, emberHauler: 2,
    rapaciousDragon: 2, volcanicDragon: 2, shivanDragon: 2,
    prodigalPyromancer: 1, shock: 3, lightningStrike: 2, electrify: 1,
    lightningTalons: 1, fireshrieker: 1, meteorite: 1,
  }),
});

/** Real cards offered only as rewards. */
export const REWARD_ONLY_CARDS = Object.freeze([
  'gigantosaurus', 'pelakkaWurm', 'rhoxOracle', 'mammothSpider',
  'mysticArchaeologist', 'cancel', 'negate', 'moatPiranhas', 'keenGlidemaster', 'wishcoinCrab',
  'stoneGolem', 'palladiumMyr', 'manalith',
  'dayOfJudgment', 'preposterousProportions', 'stormCaller', 'chandrasMagmutt', 'pyroclasticElemental',
  'sowerOfChaos', 'vampireInterloper', 'frilledSeaSerpent', 'mistCloakedHerald', 'roguesPassage', 'suspiciousBookcase',
  'skymarchBloodletter', 'spiritOfMalevolence', 'vampireNeonate', 'vampireOpportunist', 'agonizingSyphon', 'sorinsThirst',
  // Out of the decks, but still worth offering.
  'bloodDivination', 'giantSpider', 'tolarianScholar', 'revitalize', 'inspiredCharge', 'boltwave', 'thrillOfPossibility',
  'giantGrowth', 'divineVerdict', 'cavalryDrillmaster', 'honorOfThePure',
]);

/**
 * The Pathfinder's Elves (https://moxfield.com/decks/OI7KqguvQECVPrOhlSQjvw): 16 Forests
 * and Tranquil Thicket, mana Elves, Elves that grow with each other, and a few big
 * green creatures. Kept apart from REAL_DECKS, so its cards aren't offered to the
 * other planeswalkers.
 */
export const PATHFINDER_DECK = deck({
  forest: 16, tranquilThicket: 1,
  llanowarElves: 2, druidOfTheCowl: 1, treetopScout: 1, elvishArchers: 1, elvishVanguard: 1, elvishWarrior: 1,
  beastKinRanger: 1, dawnsLightArcher: 1, reclamationSage: 1, titaniasChosen: 1, vinebredBrawler: 1,
  elderleafMentor: 1, inspiringBard: 1, safewrightCavalry: 1, elvishRegrower: 1, elfswornGiant: 1, tajuruPathwarden: 1,
  galewindMoose: 1, giantGrowth: 1, overcome: 1, feralInvocation: 1, shortBow: 1,
});

/** The Pathfinder's rewards: the deck's sideboard. */
export const PATHFINDER_REWARDS = Object.freeze([
  'alphaStatus', 'audacity', 'canopyTactician', 'coliseumBehemoth', 'dwynenGiltLeafDaen', 'elderGargaroth',
  'elvishArchdruid', 'gaeasCradle', 'ghaltaPrimalHunger', 'gigantosaurus', 'imperiousPerfect', 'oranRiefTheVastwood',
  'overrun', 'pounce', 'priestOfTitania', 'steelLeafChampion', 'tauntingElf', 'timberwatchElf',
]);

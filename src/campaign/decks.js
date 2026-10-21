/**
 * Decks of real cards (imported from Scryfall, see cards/real-cards.txt), one per
 * color, at two strengths: a lighter build for the early opponents and a full one.
 * Every deck is 40 cards: 17 basic lands and 23 spells.
 */

/** A deck from `{ cardId: count }`. */
const deck = (counts) => Object.freeze(Object.entries(counts).flatMap(([id, n]) => Array(n).fill(id)));

export const REAL_DECKS = Object.freeze({
  /** Green Stompy: big creatures, pump spells, Overrun. */
  greenStompy: deck({
    forest: 17,
    llanowarElves: 3, greenwoodSentinel: 2, druidOfTheCowl: 2, centaurCourser: 3, giantSpider: 1,
    thornhideWolves: 2, vigilantBaloth: 2, thrashingBrontodon: 1, colossalDreadmaw: 2,
    giantGrowth: 2, titanicGrowth: 2, overrun: 1,
  }),
  /** Blue Skies: walls hold the ground while flyers attack; counters and card draw. */
  blueSkies: deck({
    island: 17,
    aegisTurtle: 1, wallOfMist: 2, tolarianScholar: 2, cloudkinSeer: 3, skyscanner: 2, snappingDrake: 3,
    bigfinBouncer: 2, airElemental: 2, essenceScatter: 2, unsummon: 2, divination: 2,
  }),
  /** White Weenie: cheap creatures, tokens and team pumps. */
  whiteWeenie: deck({
    plains: 17,
    savannahLions: 3, healersHawk: 2, daybreakChaplain: 2, griffinSentinel: 2, inspiringCaptain: 2,
    gallantCavalry: 2, cavalryDrillmaster: 2, serraAngel: 2, angelOfTheDawn: 1, concordiaPegasus: 1,
    raiseTheAlarm: 2, momentOfHeroism: 1, revitalize: 1,
  }),
  /** White Recruits: the lighter white build. */
  whiteRecruits: deck({
    plains: 17,
    savannahLions: 3, healersHawk: 2, daybreakChaplain: 3, griffinSentinel: 3, gallantCavalry: 2,
    concordiaPegasus: 3, raiseTheAlarm: 3, momentOfHeroism: 2, revitalize: 2,
  }),
  /** Black Removal: deathtouch, lifelink and kill spells. */
  blackRemoval: deck({
    swamp: 17,
    childOfNight: 3, vampireOfTheDireMoon: 2, walkingCorpse: 2, fetidImp: 2, doomedDissenter: 1,
    vampireNighthawk: 2, skeletonArcher: 2, twoHeadedZombie: 2,
    stab: 1, boneSplinters: 1, villageRites: 1, murder: 2, herosDownfall: 1, bloodDivination: 1,
  }),
  /** Black Rabble: the lighter black build. */
  blackRabble: deck({
    swamp: 17,
    childOfNight: 3, walkingCorpse: 3, doomedDissenter: 3, vampireOfTheDireMoon: 2, fetidImp: 2,
    skeletonArcher: 2, twoHeadedZombie: 3, stab: 2, villageRites: 2, boneSplinters: 1,
  }),
  /** Red Burn: hasty creatures and burn to the face. */
  redBurn: deck({
    mountain: 17,
    fanaticalFirebrand: 3, viashinoPyromancer: 2, boggartBrute: 2, emberHauler: 2, hostileMinotaur: 2,
    pitchburnDevils: 1, fireElemental: 1, havocDevils: 1, shivanDragon: 1,
    shock: 3, lightningStrike: 2, electrify: 1, lavaAxe: 1, thrillOfPossibility: 1,
  }),
  /** Red Raiders: the lighter red build. */
  redRaiders: deck({
    mountain: 17,
    fanaticalFirebrand: 3, hostileMinotaur: 3, boggartBrute: 3, emberHauler: 2, pitchburnDevils: 2,
    havocDevils: 2, fireElemental: 2, shock: 3, lavaAxe: 2, thrillOfPossibility: 1,
  }),
  /** The boss's dragons: burn to hold the ground, then dragons. */
  dragonlord: deck({
    mountain: 17,
    fanaticalFirebrand: 2, viashinoPyromancer: 2, hostileMinotaur: 2, emberHauler: 2, fireElemental: 1,
    rapaciousDragon: 2, volcanicDragon: 2, shivanDragon: 2,
    shock: 3, lightningStrike: 2, electrify: 2, thrillOfPossibility: 1,
  }),
});

/** Real cards offered only as rewards. */
export const REWARD_ONLY_CARDS = Object.freeze([
  'gigantosaurus', 'pelakkaWurm', 'rhoxOracle', 'mammothSpider',
  'mysticArchaeologist', 'cancel', 'negate', 'moatPiranhas', 'keenGlidemaster', 'wishcoinCrab',
  'maraudersAxe', 'shortSword', 'stoneGolem', 'palladiumMyr', 'manalith',
]);

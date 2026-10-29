/**
 * Two 40-card decks of The Lord of the Rings: Tales of Middle-earth commons and uncommons,
 * to try the set in the debugger and the AI arena (they aren't campaign decks).
 */

/** Green-white Hobbits: Food, the Ring and legends. */
export const LTR_FELLOWSHIP_DECK = Object.freeze([
  ...Array(8).fill('forest'), ...Array(8).fill('plains'),
  'frodoBaggins', 'tookReaper', 'tookReaper', 'rosieCottonOfSouthLane', 'peregrinTook', 'meriadocBrandybuck',
  'brandywineFarmer', 'brandywineFarmer', 'eastfarthingFarmer', 'eastfarthingFarmer', 'nimbleHobbit', 'nimbleHobbit',
  'shireShirriff', 'samwiseTheStouthearted', 'butterburBreeInnkeeper', 'bombadilsSong', 'secondBreakfast', 'pippinsBravery',
  'stalwartsOfOsgiliath', 'enragedHuorn', 'generousEnt', 'manyPartings', 'protectorOfGondor', 'galadhrimGuide',
]);

/** Black-red Orcs: amass, Armies and removal. */
export const LTR_MORDOR_DECK = Object.freeze([
  ...Array(8).fill('swamp'), ...Array(8).fill('mountain'),
  'urukHaiBerserker', 'urukHaiBerserker', 'easterlingVanguard', 'easterlingVanguard', 'dunlandCrebain', 'dunlandCrebain',
  'mordorMuster', 'mordorMuster', 'gothmogMorgulLieutenant', 'grishnakhBrashInstigator', 'mauhurUrukHaiCaptain',
  'uglukOfTheWhiteHand', 'snarlingWarg', 'battleScarredGoblin', 'battleScarredGoblin', 'goblinFireleaper',
  'ologHaiCrusher', 'swarmingOfMoria', 'forayOfOrcs', 'claimThePrecious', 'orcishMedicine', 'bookOfMazarbul',
  'warbeastOfGorgoroth', 'voraciousFellBeast',
]);

/** The LTR decks by name. */
export const LTR_DECKS = Object.freeze({ fellowship: LTR_FELLOWSHIP_DECK, mordor: LTR_MORDOR_DECK });

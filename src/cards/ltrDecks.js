/**
 * Two 40-card decks of The Lord of the Rings: Tales of Middle-earth cards, mostly commons and
 * uncommons with a few rares, to try the set in the debugger and the AI arena (they aren't
 * campaign decks).
 */

/** Green-white Hobbits: Food, the Ring and legends. */
export const LTR_FELLOWSHIP_DECK = Object.freeze([
  ...Array(7).fill('forest'), ...Array(8).fill('plains'), 'theShire',
  'frodoBaggins', 'samwiseGamgee', 'tookReaper', 'rosieCottonOfSouthLane', 'peregrinTook', 'meriadocBrandybuck',
  'brandywineFarmer', 'brandywineFarmer', 'eastfarthingFarmer', 'eastfarthingFarmer', 'nimbleHobbit', 'nimbleHobbit',
  'shireShirriff', 'samwiseTheStouthearted', 'butterburBreeInnkeeper', 'bombadilsSong', 'secondBreakfast', 'pippinsBravery',
  'stalwartsOfOsgiliath', 'arwenMortalQueen', 'generousEnt', 'manyPartings', 'delightedHalfling', 'galadhrimGuide',
]);

/** Black-red Orcs: amass, Armies and removal. */
export const LTR_MORDOR_DECK = Object.freeze([
  ...Array(7).fill('swamp'), ...Array(7).fill('mountain'), 'baradDur', 'minesOfMoria',
  'urukHaiBerserker', 'orcishBowmasters', 'easterlingVanguard', 'easterlingVanguard', 'dunlandCrebain', 'dunlandCrebain',
  'mordorMuster', 'mordorMuster', 'gothmogMorgulLieutenant', 'grishnakhBrashInstigator', 'mauhurUrukHaiCaptain',
  'uglukOfTheWhiteHand', 'snarlingWarg', 'battleScarredGoblin', 'battleScarredGoblin', 'goblinFireleaper',
  'shagratLootBearer', 'moriaMarauder', 'forayOfOrcs', 'claimThePrecious', 'orcishMedicine', 'bookOfMazarbul',
  'warbeastOfGorgoroth', 'witchKingOfAngmar',
]);

/** The LTR decks by name. */
export const LTR_DECKS = Object.freeze({ fellowship: LTR_FELLOWSHIP_DECK, mordor: LTR_MORDOR_DECK });

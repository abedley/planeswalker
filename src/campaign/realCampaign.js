import { AI_KIND } from './campaign.js';
import { SAMPLE_CAMPAIGN } from './sampleCampaign.js';
import { REAL_DECKS, REWARD_ONLY_CARDS } from './decks.js';

/**
 * The campaign the app plays: real cards (imported from Scryfall, see
 * cards/real-cards.txt), a deck per color, and a ladder from light builds up to the
 * Dragonlord. The planeswalkers' emblems and powers are shared with the sample
 * campaign.
 */
const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

const LANDS = new Set(['forest', 'island', 'plains', 'swamp', 'mountain']);
const spellsOf = (...decks) => [...new Set(decks.flat().filter((id) => !LANDS.has(id)))];

export const CAMPAIGN = deepFreeze({
  rules: {
    lives: 3,
    minDeckSize: 40,
    rewards: { cards: 2, powers: 1, removeCard: true },
  },

  // Every card is in CARDS already (imported or hand-written).
  cards: {},
  emblems: SAMPLE_CAMPAIGN.emblems,
  powers: SAMPLE_CAMPAIGN.powers,

  planeswalkers: {
    warden: {
      ...SAMPLE_CAMPAIGN.planeswalkers.warden,
      text: 'A keeper of the deep forests. Big creatures, bigger counters.',
      colors: ['G'],
      decks: ['greenStompy'],
    },
    sage: {
      ...SAMPLE_CAMPAIGN.planeswalkers.sage,
      text: 'A scholar of the skies. Flyers, walls and counterspells.',
      colors: ['U'],
      decks: ['blueSkies'],
    },
  },

  starterDecks: {
    greenStompy: { name: 'Green Stompy', cards: REAL_DECKS.greenStompy },
    blueSkies: { name: 'Blue Skies', cards: REAL_DECKS.blueSkies },
  },

  opponents: {
    // Outskirts: lighter builds, basic AI.
    shieldMaiden: { name: 'Shield-Maiden', color: 'white', deck: REAL_DECKS.whiteRecruits, ai: { kind: AI_KIND.BASIC } },
    graveRobber: { name: 'Grave Robber', color: 'black', deck: REAL_DECKS.blackRabble, ai: { kind: AI_KIND.BASIC } },
    raider: { name: 'Goblin Raider', color: 'red', deck: REAL_DECKS.redRaiders, ai: { kind: AI_KIND.BASIC } },
    // Deep Wilds: full builds, searching.
    knightCaptain: { name: 'Knight-Captain', color: 'white', deck: REAL_DECKS.whiteWeenie, ai: { kind: AI_KIND.SEARCH, budgetMs: 500, weights: 'aggro' } },
    nightStalker: { name: 'Night Stalker', color: 'black', deck: REAL_DECKS.blackRemoval, ai: { kind: AI_KIND.SEARCH, budgetMs: 500 } },
    pyromancer: { name: 'Pyromancer', color: 'red', deck: REAL_DECKS.redBurn, ai: { kind: AI_KIND.SEARCH, budgetMs: 500, weights: 'aggro' } },
    // Citadel: the other planeswalkers' colors, thinking harder, with an emblem.
    beastLord: {
      name: 'Beast Lord', color: 'green', deck: REAL_DECKS.greenStompy, emblems: ['planeswalker'],
      ai: { kind: AI_KIND.SEARCH, budgetMs: 1500 },
    },
    stormCaller: {
      name: 'Storm Caller', color: 'blue', deck: REAL_DECKS.blueSkies, emblems: ['planeswalker'],
      ai: { kind: AI_KIND.SEARCH, budgetMs: 1500, weights: 'control' },
    },
    // Throne: the boss.
    dragonlord: {
      name: 'The Dragonlord', color: 'red', deck: REAL_DECKS.dragonlord, emblems: ['bossDominion', 'planeswalker'], startingLife: 25,
      ai: { kind: AI_KIND.SEARCH, budgetMs: 2500 },
    },
  },

  cardPools: {
    early: spellsOf(REAL_DECKS.whiteRecruits, REAL_DECKS.blackRabble, REAL_DECKS.redRaiders, REAL_DECKS.greenStompy, REAL_DECKS.blueSkies),
    late: spellsOf(...Object.values(REAL_DECKS), REWARD_ONLY_CARDS),
  },

  ladder: [
    { id: 'outskirts', name: 'Outskirts', fights: 2, opponents: ['shieldMaiden', 'graveRobber', 'raider'], cardPool: 'early' },
    { id: 'wilds', name: 'Deep Wilds', fights: 2, opponents: ['knightCaptain', 'nightStalker', 'pyromancer'], cardPool: 'late' },
    { id: 'citadel', name: 'Citadel', fights: 1, opponents: ['beastLord', 'stormCaller'], cardPool: 'late', rewards: { cards: 2, powers: 2 } },
    { id: 'throne', name: 'Throne', boss: true, fights: 1, opponents: ['dragonlord'] },
  ],
});
